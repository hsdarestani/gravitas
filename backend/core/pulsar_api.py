import json
import logging
import re
import time
from uuid import uuid4

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from . import topic_01
from .models import ContentItem, PublicPageSnapshot
from .topic_essay_api import TOPIC_01_PAGE, public_essay_context, public_essay_label, published_essays
from .pulsar import PulsarError, configured, run_text
from .pulsar_runtime.errors import PulsarProviderError
from .pulsar_public_guide import PUBLIC_SYSTEM, destinations, present_answer, recent_history, progression_answer, public_thread_context
from .pulsar_public_context import (
    clean_text,
    page_observation,
    public_page,
    public_topic_catalog,
    short_public_answer,
    topic_rows_from_db,
)

logger = logging.getLogger(__name__)


def _unavailable(error, started):
    # Follow the provider cause through the shared gateway without exposing
    # exception text, user content, URLs, credentials or private thread IDs.
    seen = set()
    cause = error
    while cause is not None and id(cause) not in seen:
        seen.add(id(cause))
        if isinstance(cause, PulsarProviderError):
            break
        cause = cause.__cause__
    info = cause.diagnostics() if isinstance(cause, PulsarProviderError) else {
        'code': 'pulsar_unavailable', 'provider': 'unavailable',
        'http_status': None, 'provider_codes': [], 'retry_after': None,
    }
    request_id = uuid4().hex
    logger.warning('pulsar_public_failure %s', json.dumps({
        **info, 'request_id': request_id, 'elapsed_ms': int((time.monotonic() - started) * 1000),
    }))
    code = info['code']
    reply = {
        'cloudflare_ai_quota_exhausted': 'Pulsar has reached its AI provider’s free usage limit. Live explanations are temporarily unavailable; please try later.',
        'cloudflare_ai_rate_limited': 'Pulsar’s AI provider is temporarily limiting requests. Please wait before trying again.',
        'cloudflare_ai_authentication_failed': 'Pulsar’s AI connection needs attention from the site team. Please try again later.',
        'cloudflare_ai_timeout': 'Pulsar’s AI provider took too long to respond. Please try again later.',
    }.get(code, 'Pulsar could not answer just now. Please try your question again in a moment.')
    response = JsonResponse({'ok': False, 'reply': reply, 'links': [], 'provider': 'fallback',
        'retryable': code != 'cloudflare_ai_authentication_failed', 'error': code,
        'provider_codes': info['provider_codes'], 'request_id': request_id,
        'version': 'public-guide-v2'}, status=429 if code in (
            'cloudflare_ai_quota_exhausted', 'cloudflare_ai_rate_limited') else 503)
    if info.get('retry_after') is not None:
        response['Retry-After'] = str(info['retry_after'])
    return response


def _excerpts(text, question, *, limit):
    """Bound long pages without losing a relevant section near the end."""
    if len(text) <= limit:
        return text
    terms = set(re.findall(r'\w{4,}', question.casefold()))
    parts = [text[i:i + 900] for i in range(0, len(text), 900)]
    ranked = sorted(range(1, len(parts)), key=lambda i: -len(terms.intersection(re.findall(r'\w{4,}', parts[i].casefold()))))
    selected = sorted([0, *ranked[:max(0, limit // 920 - 1)]])
    return '\n…\n'.join(parts[i] for i in selected)[:limit]


def _synced_page_context(snapshot, message, anchor):
    if not snapshot:
        return ''
    sections = snapshot.get('sections', [])
    page_summary = bool(re.search(r'\b(summarize|summary of) (this |the )?page\b', message, re.I))
    if anchor and not page_summary:
        # A neighbouring section or Related card is not the current argument.
        # Keep the overview and actual section; add evidence only if requested.
        relevant_ids = {'', anchor}
        if re.search(r'\b(evidence|sources?|citations?)\b', message, re.I):
            relevant_ids.add('sources')
        scoped = [part for part in sections if part['id'] in relevant_ids]
        if any(part['id'] == anchor for part in scoped):
            sections = scoped
    terms = set(re.findall(r'\w{4,}', message.casefold()))

    def rank(section):
        title = section['title'] + ' ' + section['id']
        return (
            bool(anchor and section['id'] == anchor),
            len(terms.intersection(re.findall(r'\w{4,}', title.casefold()))),
            len(terms.intersection(re.findall(r'\w{4,}', section['text'].casefold()))),
        )

    selected = sorted(sections, key=rank, reverse=True)[:4]
    return '\n'.join(
        f'[{part["title"] or part["id"] or "Page"}] ' + _excerpts(part['text'], message, limit=1800 if part['id'] == anchor else 850)
        for part in selected
    )[:4200]


def _essay_context(page, message, snapshot, anchor='', reading=None):
    if not (anchor.startswith('essay') or re.search(r'\b(essay|essays|reference|citation|citations)\b', message, re.I)):
        return ''
    if page not in ('/', '/', TOPIC_01_PAGE):
        if not re.search(r'topic\s+0?1\b|answer that looked right', message, re.I):
            return ''
        snapshot = PublicPageSnapshot.objects.filter(path=TOPIC_01_PAGE).values_list('content', flat=True).first() or {}
    essays = published_essays()
    legacy = snapshot.get('legacy_essays', {})
    blocks = []
    # One text per essay: the fullest level that is published. The Researcher
    # slots kept the names overview and deep; the simpler levels say the same
    # thing in fewer words, so they would only crowd the context.
    for depth, label, simpler in (('overview', 'Overview', ('e1-undergrad', 'e1-curious')),
                                  ('deep', 'In depth', ('e2-undergrad', 'e2-curious'))):
        number = '1' if depth == 'overview' else '2'
        selected = str((reading or {}).get('essay') or '')
        if not selected and re.fullmatch(r'essay-[12]', anchor):
            selected = anchor[-1]
        if selected in ('1', '2') and selected != number:
            continue
        level = (reading or {}).get('level')
        level_slot = f'e{number}-{level}' if level in ('curious', 'undergrad') else depth
        candidates = (level_slot, depth) + simpler
        chosen = next((slot for slot in candidates if slot in essays), None)
        if chosen:
            label = public_essay_label(essays[chosen], label)
            text = public_essay_context(essays[chosen])
        else:
            text = '\n'.join(legacy.get(depth, []))
        if text:
            blocks.append(label + ':\n' + _excerpts(text, message, limit=3600))
    return '\n\n'.join(blocks)


@csrf_exempt
@require_POST
def public_pulsar_ask(request):
    started = time.monotonic()
    if len(request.body) > 24000:
        return JsonResponse({'ok': False, 'error': 'request_too_large'}, status=413)
    try:
        data = json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        data = {}
    if not isinstance(data, dict):
        data = {}
    message = clean_text(data.get('message'), 4000)
    if not message:
        return JsonResponse({'ok': False, 'error': 'message_required'}, status=400)

    page = public_page(data.get('page')) if data.get('page') else ''
    key = '/' if page == '/' else page
    # One query supplies a small public inventory; only selected excerpts are
    # transmitted. It contains no account, private research or draft records.
    pages = dict(PublicPageSnapshot.objects.values_list('path', 'content'))
    live = topic_01.snapshot()
    if live:
        prior = pages.get(TOPIC_01_PAGE, {})
        pages[TOPIC_01_PAGE] = {**prior, 'sections': live['sections'],
            'observation': {**prior.get('observation', {}), 'heading': live['title']}}
    if key == '/topic':
        slug = clean_text(data.get('topic_slug'), 140)
        dynamic = topic_01.snapshot(slug) if re.fullmatch(r'[a-z0-9-]+', slug) else None
        if dynamic:
            pages[key] = {'sections': dynamic['sections'], 'observation': {'heading': dynamic['title'], 'actions': []}}
        else:
            pages.pop(key, None)
    snapshot = pages.get(key, {})
    observation = snapshot.get('observation') or page_observation(data.get('page_context') if key else {})
    catalog = public_topic_catalog(pages.get('/topics', {}).get('topic_catalog', data.get('topic_catalog')))
    history = recent_history(data.get('history'))
    if not snapshot and re.search(r'\b(summari[sz]e (?:this|the)(?: page)?|what (?:is|s) this page about)\b', message, re.I):
        return JsonResponse({'ok': True,
            'reply': 'I do not have verified content for this page, so I cannot summarize it. You can ask about a specific concept or choose a published Topic.',
            'links': [], 'provider': 'public_context_missing', 'version': 'public-guide-v2'})
    db_topics = []
    if not catalog:
        db_topics = topic_rows_from_db(ContentItem.objects.filter(kind='topic', status='published')[:20])
    allowed = destinations(pages, catalog, key)
    anchor = clean_text(data.get('section'), 90)
    suggested = data.get('suggested') if isinstance(data.get('suggested'), list) else []
    progression = progression_answer(message, key, observation, catalog, pages, allowed, history, anchor, suggested[:10])
    if progression:
        reply, links = progression
        return JsonResponse({'ok': True, 'reply': reply, 'links': links,
            'provider': 'public_progression', 'version': 'public-guide-v2'})
    answer = short_public_answer(message, page=page, observation=observation,
                                 catalog=catalog, db_topics=db_topics, history=history)
    if answer is not None:
        reply, links = answer
        return JsonResponse({'ok': True, 'reply': reply,
            'links': [link for link in links if link['href'] in allowed],
            'provider': 'public_navigation', 'version': 'public-guide-v2'})

    reading = data.get('reading') if isinstance(data.get('reading'), dict) else {}
    # The essay picker is independent of the section URL.
    if anchor.startswith('essay') and str(reading.get('essay')) in ('1', '2'):
        anchor = 'essay-' + str(reading['essay'])
    section_key = 'essay' if anchor.startswith('essay-') else 'video' if anchor.startswith('video-') else anchor
    query = message + ' ' + ' '.join(turn['content'] for turn in history[-2:])
    synced_context = _synced_page_context(snapshot, query, section_key)
    essay_context = _essay_context(page, query, snapshot, anchor, reading)
    # Follow-ups from home can progress into the featured Topic's actual
    # sections, rather than choosing a second generic site destination.
    related = ''
    featured_href = observation.get('featured_href', '')
    if key in ('/', '/topics') and featured_href in pages:
        related = _synced_page_context(pages[featured_href], query, '')[:1600]
    elif key in ('/', '/topics') and TOPIC_01_PAGE in pages:
        related = _synced_page_context(pages[TOPIC_01_PAGE], query, '')[:1600]
    relevant_paths = {key, featured_href, TOPIC_01_PAGE if related else ''}
    relevant = {href: label for href, label in allowed.items() if href.split('#')[0] in relevant_paths}
    offered = dict(list({**relevant, **{href: label for href, label in allowed.items() if '#' not in href}}.items())[:40])
    visible_context = '\n'.join(f'- {row["status"]}: {row["title"]}' for row in catalog)
    prompt = json.dumps({
        'Current page': {'route': key or '(unknown)', 'heading': observation.get('heading', ''),
                         'section': anchor, 'reading': {k: clean_text(str(reading.get(k, '')), 30)
                         for k in ('essay', 'level', 'mode')},
                         'page_context_available': bool(snapshot)},
        'Visible main-page actions:': [a['label'] for a in observation.get('actions', [])],
        'Public website topic cards': visible_context,
        'Synchronized public page copy': synced_context or '(Unavailable: do not invent the current page.)',
        'Related published Topic': related,
        'Topic essay as shown to readers': essay_context,
        'Current public Forum thread': ((public_thread_context(data.get('forum_topic')) or '(This thread is not available as an anonymous public read.)')
                                       if key == '/forum' and data.get('forum_topic') else ''),
        'Recent conversation': history,
        'Available destinations': offered,
        'Visitor question': message,
    }, ensure_ascii=False)
    if configured():
        try:
            result = run_text(system=PUBLIC_SYSTEM, user=prompt,
                max_tokens=550 if re.search(r'\b(detailed|in depth|step by step)\b', message, re.I) else 240,
                surface='public', skill='public', operation='answer',
                thread_id=clean_text(data.get('thread_id'), 160) or None,
                # Public continuity is the visitor's bounded local thread.
                # Never resolve an anonymous client-supplied thread to DB memory.
                locale=clean_text(data.get('locale'), 40) or None,
                metadata={'page': key, 'continuity': False})
            reply, links = present_answer(result.text, offered, key)
            if not reply:
                raise PulsarError('public_answer_empty')
            # A model must not turn legacy product copy into a launch claim.
            # The boundary is enforced for summaries as well as direct FAQs.
            preview = next((note for prefix, note in (
                ('/lab', 'The Lab is under construction and is not publicly available yet.'),
                ('/education', 'This is a pre-launch preview; the learning product is not publicly available yet.'),
                ('/learn', 'Learning courses are under construction and are not open for enrollment.'),
                ('/path-', 'This course is planned and is not open for enrollment.'),
                ('/game-', 'This interactive experience is a pre-launch preview, not a publicly launched product.'),
                ('/newsletter', 'The newsletter is marked Soon; this page describes its planned format.'),
            ) if key.startswith(prefix)), '')
            if preview and re.search(r'\b(summari[sz]e|summary|this page|this about|what next|open|use|enroll)\b', message, re.I) and not re.search(
                r'\b(under construction|pre-launch|not (?:yet |publicly )?(?:available|operational|open)|planned|marked Soon)\b', reply, re.I,
            ):
                reply = preview + ' ' + reply
            if essay_context and not links and key == TOPIC_01_PAGE and key + '#essay' in offered:
                links = [{'label': 'Read the essays', 'href': key + '#essay'}]
            return JsonResponse({'ok': True, 'reply': reply, 'links': links,
                'provider': result.provider, 'run_id': result.run_id, 'version': 'public-guide-v2',
                'metrics': {'latency_ms': int((time.monotonic() - started) * 1000),
                            'input_tokens': getattr(result, 'input_tokens', 0),
                            'output_tokens': getattr(result, 'output_tokens', 0),
                            'context_chars': len(prompt),
                            'page_context_available': bool(snapshot)}})
        except PulsarError as error:
            return _unavailable(error, started)
    # Honest transient failure, without a keyword index inventing capabilities.
    return _unavailable(PulsarProviderError('pulsar_provider_not_configured', provider='unavailable'), started)
