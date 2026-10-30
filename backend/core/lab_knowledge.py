"""Bounded, section-addressable scientific context for Lab Pulsar."""
import hashlib
import json
import math
import re
from collections import defaultdict

from django.core.cache import cache
from django.http import HttpResponse, JsonResponse
from django.views.decorators.http import require_http_methods

from .lab_knowledge_models import LabKnowledgeDocument, LabRunSnapshot, LabScenario
from .models import InteractiveLab

POLICY_KEYS = ('generation', 'verification', 'replication', 'funding', 'aiAdoption', 'alpha',
               'sampleSize', 'transparency', 'diversity', 'pressure', 'network', 'uncertainty')


def digest(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def sections(markdown):
    """Stable local anchors, independent of external publisher markup."""
    result, seen = [], defaultdict(int)
    for block in re.split(r'(?m)^(?=#{1,4} )', markdown):
        block = block.strip()
        if not block:
            continue
        head = re.match(r'^(#{1,4}) (.+)', block)
        title = head[2].strip() if head else 'Overview'
        anchor = re.sub(r'[^\w\s-]', '', title.lower())
        anchor = re.sub(r'[-\s]+', '-', anchor).strip('-')[:100] or 'overview'
        seen[anchor] += 1
        if seen[anchor] > 1:
            anchor += '-' + str(seen[anchor])
        result.append({'anchor': anchor, 'title': title, 'text': block,
                       'level': len(head[1]) if head else 1})
    return result


def published_lab(slug):
    from .lab_api import _public
    lab = InteractiveLab.objects.filter(slug=slug).first()
    return lab if lab and _public(lab) else None


def document_json(doc, body=False):
    data = {'slug': doc.slug, 'title': doc.title, 'source_url': doc.source_url,
            'license': doc.license, 'kind': doc.kind, 'version': doc.version,
            'content_hash': doc.content_hash, 'is_published': doc.is_published,
            'sections': [{k: s[k] for k in ('anchor', 'title', 'level')} for s in doc.sections]}
    if body:
        data['markdown'] = doc.markdown
        data['sections'] = doc.sections
    return data


@require_http_methods(['GET'])
def public_knowledge(request, slug, document=''):
    lab = published_lab(slug)
    if not lab:
        return JsonResponse({'ok': False, 'error': 'not_found'}, status=404)
    docs = LabKnowledgeDocument.objects.filter(lab=lab, is_published=True)
    if not document:
        return JsonResponse({'ok': True, 'documents': [document_json(d) for d in docs]})
    doc = docs.filter(slug=document).first()
    if not doc:
        return JsonResponse({'ok': False, 'error': 'not_found'}, status=404)
    if request.GET.get('format') == 'md':
        response = HttpResponse(doc.markdown, content_type='text/markdown; charset=utf-8')
        response['Content-Disposition'] = f'attachment; filename="{doc.slug}.md"'
        response['X-Content-Type-Options'] = 'nosniff'
        return response
    return JsonResponse({'ok': True, 'document': document_json(doc, True)})


@require_http_methods(['GET', 'PUT'])
def admin_knowledge(request, lab_id, document=''):
    from .lab_api import _admin, _denied, _body, _audit
    from django.db import transaction
    if not _admin(request):
        return _denied(request)
    lab = InteractiveLab.objects.filter(pk=lab_id).first()
    if not lab:
        return JsonResponse({'ok': False, 'error': 'not_found'}, status=404)
    if request.method == 'GET':
        return JsonResponse({'ok': True, 'documents': [document_json(d, True) for d in lab.knowledge_documents.all()]})
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,99}', document):
        return JsonResponse({'ok': False, 'error': 'invalid_slug'}, status=400)
    try:
        data = _body(request, limit=500000)
        markdown = data.get('markdown')
        if not isinstance(markdown, str) or not 10 <= len(markdown) <= 400000:
            raise ValueError('invalid_markdown')
        url = str(data.get('source_url') or '')[:700]
        if url and not url.startswith('https://'):
            raise ValueError('https_source_required')
        with transaction.atomic():
            doc = LabKnowledgeDocument.objects.select_for_update().filter(lab=lab, slug=document).first()
            if doc and data.get('version') != doc.version:
                return JsonResponse({'ok': False, 'error': 'version_conflict'}, status=409)
            if not doc:
                doc = LabKnowledgeDocument(lab=lab, slug=document, version=0)
            doc.title = str(data.get('title') or document)[:300]
            doc.markdown = markdown
            doc.source_url = url
            doc.license = str(data.get('license') or '')[:250]
            doc.kind = str(data.get('kind') or 'note')[:30]
            doc.is_published = data.get('is_published', True) is True
            doc.sections = sections(markdown)
            doc.content_hash = digest(markdown)
            doc.version += 1
            doc.save()
            _audit(request, lab, 'lab.knowledge_updated', {'document': document, 'version': doc.version})
        return JsonResponse({'ok': True, 'document': document_json(doc, True)})
    except ValueError as exc:
        return JsonResponse({'ok': False, 'error': str(exc)}, status=400)


def clean_numbers(raw, keys=None, limit=40):
    if not isinstance(raw, dict):
        return {}
    return {str(k)[:60]: v for k, v in list(raw.items())[:limit]
            if (keys is None or k in keys) and type(v) in (int, float)
            and math.isfinite(v) and abs(v) < 1e12}


def clean_context(raw):
    raw = raw if isinstance(raw, dict) else {}
    lab = raw.get('lab') if isinstance(raw.get('lab'), dict) else {}
    paper = raw.get('paper') if isinstance(raw.get('paper'), dict) else {}
    def small_record(record, allowed):
        return {k: str(record[k])[:140] if isinstance(record[k], str) else record[k]
                for k in allowed if k in record and (isinstance(record[k], str) or
                record[k] is None or type(record[k]) in (int, float, bool))}
    events = raw.get('events') if isinstance(raw.get('events'), list) else []
    changes = raw.get('changes') if isinstance(raw.get('changes'), list) else []
    return {
        'world': 'B' if raw.get('world') == 'B' else 'A',
        'day': max(0, min(1000000, raw.get('day', 0))) if type(raw.get('day')) is int else 0,
        'playing': raw.get('playing') is True, 'hasFork': raw.get('hasFork') is True,
        'view': str(raw.get('view') or '')[:20],
        'lab': small_record(lab, ('id', 'name', 'domain', 'paperCount')) or None,
        'paper': small_record(paper, ('id', 'title', 'status', 'replications', 'pValue')) or None,
        'policies': clean_numbers(raw.get('policies'), POLICY_KEYS),
        'design': clean_numbers(raw.get('design')),
        'metrics': clean_numbers(raw.get('metrics')),
        'delta': clean_numbers(raw.get('delta')),
        'events': [small_record(e, ('day', 'type', 'text')) for e in events[:8] if isinstance(e, dict)],
        'changes': [small_record(c, ('day', 'key', 'before', 'after')) for c in changes[-8:] if isinstance(c, dict)],
    }


def atlas_context(lab, policies):
    # Stay bounded even as the atlas grows. A current engine hash prevents old
    # scientific models being mistaken for the model currently on screen.
    engine = next((f.get('content', '') for f in lab.published_files if f.get('name') == 'engine.js'), '')
    engine_sha = digest(engine)
    rows = LabScenario.objects.filter(lab=lab, engine_sha=engine_sha)
    candidates = list(rows.only('family', 'parameters', 'design', 'seed', 'days', 'result')[:2400])
    closest = sorted(candidates, key=lambda x: sum(abs(x.parameters.get(k, 5)-v)
                     for k, v in policies.items()))[:3] if policies else candidates[:3]
    return {'engine_sha': engine_sha, 'runs_for_current_engine': rows.count(),
            'policy_combinations': str(10 ** len(POLICY_KEYS)), 'coverage': 'sampled, not exhaustive',
            'nearest_examples': [{'family': x.family, 'policies': x.parameters, 'design': x.design,
                 'seed': x.seed, 'days': x.days, 'result': x.result,
                 'relation': 'separate precomputed run; not this visitor checkpoint'} for x in closest]}


def scientific_context(lab, question='', event='', state=None):
    """Retrieve exact sections; return a citation allowlist with no invented refs."""
    docs = list(lab.knowledge_documents.filter(is_published=True))
    words = set(re.findall(r'\w{3,}', (question + ' ' + event).lower()))
    if any(x in (question + event).lower() for x in ('replic', 'تکرار')):
        words.update(('replication', 'independent'))
    if any(x in (question + event).lower() for x in ('interdiscip', 'divers', 'رشته')):
        words.update(('diversity', 'cross', 'discipline'))
    ranked = []
    for doc in docs:
        for section in doc.sections:
            text = section['text']
            score = sum(3 if w in section['title'].lower() else 1 for w in words if w in text.lower())
            if doc.kind == 'model':
                score += 2
            ranked.append((score, doc, section))
    ranked.sort(key=lambda x: x[0], reverse=True)
    # Include each source's best substantive section before filling remaining
    # slots, so numerous model headings cannot crowd all papers out.
    substantive = [r for r in ranked if r[2]['title'].lower() not in {'import provenance', 'references'} and r[2]['level'] > 1]
    chosen = []
    for doc in docs:
        chosen.extend([r for r in substantive if r[1].pk == doc.pk][:2])
    ranked = chosen + [r for r in ranked if r not in chosen]
    excerpts, citations, budget = [], [], 23000
    for _, doc, section in ranked:
        if len(excerpts) >= 12 or budget < 300:
            break
        text = section['text'][:min(4800, budget)]
        key = doc.slug + '#' + section['anchor']
        excerpts.append({'citation': key, 'kind': doc.kind, 'text': text})
        citations.append({'id': key, 'document': doc.slug, 'anchor': section['anchor'],
                          'title': doc.title, 'section': section['title'], 'source_url': doc.source_url})
        budget -= len(text)
    # Always supply the complete Lab rationale, independent of query language.
    # Paper retrieval then adds relevant sections without replacing model rules.
    full_guides = []
    for doc in [d for d in docs if d.kind == 'model'][:1]:
        full_guides.append({'document': doc.slug, 'markdown': doc.markdown[:22000]})
        for section in doc.sections:
            key = doc.slug + '#' + section['anchor']
            if not any(c['id'] == key for c in citations):
                citations.append({'id': key, 'document': doc.slug, 'anchor': section['anchor'],
                                  'title': doc.title, 'section': section['title'], 'source_url': doc.source_url})
    return {'documents': [document_json(d) for d in docs], 'sections': excerpts,
            'complete_model_guides': full_guides,
            'citation_allowlist': [c['id'] for c in citations],
            'atlas': atlas_context(lab, (state or {}).get('policies', {}))}, citations


@require_http_methods(['GET'])
def public_scenarios(request, slug):
    lab = published_lab(slug)
    if not lab:
        return JsonResponse({'ok': False, 'error': 'not_found'}, status=404)
    policies = {k: float(request.GET[k]) for k in POLICY_KEYS if request.GET.get(k, '').isdigit()
                and 1 <= float(request.GET[k]) <= 10}
    context = atlas_context(lab, policies)
    family = request.GET.get('family', '')[:100]
    rows = lab.scenario_atlas.filter(engine_sha=context['engine_sha'])
    if family:
        rows = rows.filter(family=family)
    offset = min(100000, max(0, int(request.GET.get('offset', '0')))) if request.GET.get('offset', '0').isdigit() else 0
    examples = list(rows.values('signature', 'family', 'parameters', 'design', 'seed', 'days', 'result')[offset:offset+36])
    return JsonResponse({'ok': True, **context, 'families': list(lab.scenario_atlas.filter(
        engine_sha=context['engine_sha']).order_by('family').values_list('family', flat=True).distinct()),
        'examples': examples, 'offset': offset, 'next_offset': offset+36 if len(examples) == 36 else None,
        'design_axes': {'labsPerDomain': [3, 7, 14], 'truthPriorOverride': [None, .1, .3, .5],
                        'teamSizes': [[1, 3], [3, 5], [5, 8]], 'aiRoleFraction': [0, .25, .48, .75, 1]},
        'policy_axes': {k: list(range(1, 11)) for k in POLICY_KEYS},
        'policy_and_listed_design_combinations': str(180 * 10 ** len(POLICY_KEYS)),
        'limits': 'Seeds, time, interventions and checkpoints add further states. No exhaustive coverage claim.'})


@require_http_methods(['GET', 'POST'])
def lab_snapshots(request, slug):
    from .lab_api import _body
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
    lab = published_lab(slug)
    if not lab:
        return JsonResponse({'ok': False, 'error': 'not_found'}, status=404)
    if request.method == 'GET':
        return JsonResponse({'ok': True, 'snapshots': list(LabRunSnapshot.objects.filter(
            lab=lab, owner=request.user).values('id', 'payload', 'provenance', 'created_at')[:20])})
    try:
        data = _body(request, limit=20000)
        payload = clean_context(data.get('context'))
        payload['seed'] = data.get('seed') if type(data.get('seed')) is int else None
        payload['engine_sha'] = digest(next((f.get('content', '') for f in lab.published_files if f.get('name') == 'engine.js'), ''))
        signature = digest(json.dumps(payload, sort_keys=True, ensure_ascii=False))
        existing = LabRunSnapshot.objects.filter(lab=lab, owner=request.user, signature=signature).first()
        if existing:
            return JsonResponse({'ok': True, 'id': existing.pk, 'created': False, 'provenance': existing.provenance})
        if not cache.add(f'gq:lab:snapshot:{request.user.pk}:{lab.pk}', 1, 5):
            return JsonResponse({'ok': False, 'error': 'rate_limited'}, status=429)
        snap = LabRunSnapshot.objects.create(lab=lab, owner=request.user, signature=signature, payload=payload)
        return JsonResponse({'ok': True, 'id': snap.pk, 'created': True, 'provenance': snap.provenance}, status=201)
    except ValueError as exc:
        return JsonResponse({'ok': False, 'error': str(exc)}, status=400)
