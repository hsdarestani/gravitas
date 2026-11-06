"""Grounding and short navigation answers for the public Pulsar widget.

The public frontend can temporarily lead the database during the topic CMS
migration. Only display-safe fields are accepted from the browser; no HTML,
private workspace data, or arbitrary URLs are passed through.
"""
import re
from urllib.parse import urlsplit


PUBLIC_FAQ = (
    (('where are the topics', 'where can i find topics', 'where is the topics page'),
     'Open the Topics index to see published and planned questions.',
     '/topics.html', 'Browse Topics'),
    (('where is the lab', 'where can i find the lab', 'open the lab'),
     'The interactive simulations are in the Lab.',
     '/lab.html', 'Open Lab'),
    (('where is the community', 'how can i join the community', 'propose a topic'),
     'You can suggest questions and join the discussion in Community.',
     '/community.html', 'Community'),
    (('where can i learn', 'where are the courses', 'open learning'),
     'Learning paths and courses are on the Learn page.',
     '/learn.html', 'Open Learn'),
)


def clean_text(value, limit=240):
    if not isinstance(value, str):
        return ''
    return re.sub(r'\s+', ' ', value).strip()[:limit]


def public_href(value):
    """Only routes to known, same-origin, public Topic pages are permitted."""
    href = clean_text(value, 180)
    if not re.fullmatch(r'/?topic-[a-z0-9-]+\.html(?:#[a-z0-9-]+)?', href):
        return ''
    return '/' + href.lstrip('/')


def public_page(value):
    path = urlsplit(clean_text(value, 250)).path
    if path in ('', '/'):
        return '/'
    if re.fullmatch(r'/[a-z0-9-]+\.html', path):
        return path
    return '/'


def public_navigation_href(value):
    """Validate a same-origin public navigation destination or page anchor."""
    href = clean_text(value, 180)
    if '..' in href or '?' in href or href.startswith('//'):
        return ''
    if re.fullmatch(r'#[a-zA-Z0-9_-]{1,90}', href):
        return href
    if not re.fullmatch(
        r'/?[a-z0-9_-]+(?:/[a-z0-9_-]+)*(?:\\.html)?(?:#[a-zA-Z0-9_-]+)?',
        href,
    ):
        return ''
    return '/' + href.lstrip('/')


def page_observation(raw):
    """A brief, untrusted observation of the currently rendered public page."""
    raw = raw if isinstance(raw, dict) else {}
    featured = clean_text(raw.get('featured_topic'), 220)
    featured_href = public_href(raw.get('featured_href'))
    actions = []
    for action in (raw.get('actions') if isinstance(raw.get('actions'), list) else [])[:18]:
        if not isinstance(action, dict):
            continue
        label = clean_text(action.get('label'), 100)
        href = public_navigation_href(action.get('href'))
        if label:
            actions.append({'label': label, 'href': href})
    return {
        'heading': clean_text(raw.get('heading'), 180),
        'featured_topic': featured if featured_href else '',
        'featured_href': featured_href if featured else '',
        'actions': actions,
    }


def public_topic_catalog(raw):
    """Accept an upper-bounded list of topic cards from /topics.html."""
    rows, seen = [], set()
    if not isinstance(raw, list):
        return rows
    for item in raw[:40]:
        if not isinstance(item, dict):
            continue
        title = clean_text(item.get('title'), 220)
        status = clean_text(item.get('status'), 20).lower()
        href = public_href(item.get('href'))
        if status not in ('open', 'planned') or not title:
            continue
        if status == 'open' and not href:
            continue
        key = title.casefold()
        if key in seen:
            continue
        seen.add(key)
        rows.append({'title': title, 'status': status, 'href': href if status == 'open' else ''})
    return rows


def topic_rows_from_db(items):
    """Fallback when the frontend's topic inventory cannot be loaded."""
    rows = []
    for item in items:
        title = clean_text(getattr(item, 'title', ''), 220)
        # CMS slugs are not guaranteed to equal public page filenames.
        rows.append({'title': title, 'status': 'open', 'href': ''})
    return [row for row in rows if row['title']]


def _has_topic_word(q):
    return bool(re.search(r'\btopics?\b', q))


def _is_list_request(q):
    return (
        q in ('topics', 'all topics', 'list topics')
        or bool(re.search(r'\b(all|list|which|what|available|published|existing)\b.{0,35}\btopics\b', q))
        or bool(re.search(r'\btopics\b.{0,25}\b(so far|till now|to date|available|published)\b', q))
    )


def _is_home_question(q):
    return bool(re.search(r'\b(first page|1st page|home\s?page|homepage|front page)\b', q))


def _is_current_topic_question(q):
    return (
        q in ('what is the topic', 'what is the topic?', 'current topic', 'which topic')
        or bool(re.search(r'\b(topic on (this|the) page|topic (is|was) (shown|featured)|which topic is this)\b', q))
    )


def _topic_links(rows, limit=2):
    links = [{'label': 'Browse Topics', 'href': '/topics.html'}]
    if limit <= 0:
        return links
    for row in rows:
        if row['status'] == 'open' and row.get('href'):
            links.append({'label': row['title'][:65], 'href': row['href']})
        if len(links) >= limit + 1:
            break
    return links


def short_public_answer(message, *, page='/', observation=None, catalog=None, db_topics=None):
    """Deterministic answers for common site questions; do not ask the model to guess."""
    q = clean_text(message, 500).casefold().strip(' .?!')
    page = public_page(page)
    observation = page_observation(observation)
    catalog = public_topic_catalog(catalog)
    rows = catalog or (db_topics or [])
    if not q:
        return None

    # These questions must be answered from the actual public cards, not from
    # an unrelated article or a potentially stale Topic record in the DB.
    if _is_list_request(q):
        if catalog:
            open_rows = [r for r in rows if r['status'] == 'open']
            planned = [r for r in rows if r['status'] == 'planned']
            parts = []
            if open_rows:
                parts.append('Open topics:\n' + '\n'.join('• ' + r['title'] for r in open_rows))
            if planned:
                parts.append('Planned topics:\n' + '\n'.join('• ' + r['title'] for r in planned))
            return ('\n\n'.join(parts), _topic_links(rows)) if parts else None
        if rows:
            return (
                'The database currently lists: ' + '; '.join(r['title'] for r in rows)
                + '. For the current public lineup, open the Topics page.',
                _topic_links(rows, limit=0),
            )
        return ('See the current topics and planned questions on the Topics page.',
                [{'label': 'Browse Topics', 'href': '/topics.html'}])

    if _is_home_question(q) or _is_current_topic_question(q):
        if page in ('/', '/index.html') or _is_home_question(q):
            featured = observation.get('featured_topic')
            href = observation.get('featured_href')
            if featured and href:
                return ('The homepage features “' + featured + '”.',
                        [{'label': 'Open the featured topic', 'href': href},
                         {'label': 'All Topics', 'href': '/topics.html'}])
        if page.startswith('/topic-') and rows:
            match = next((r for r in rows if r.get('href') == page), None)
            if match:
                return ('This page is “' + match['title'] + '”.',
                        [{'label': 'All Topics', 'href': '/topics.html'}])
        if _has_topic_word(q) or _is_home_question(q):
            return ('I can verify the topics listed on the public Topics page; open it here.',
                    [{'label': 'Browse Topics', 'href': '/topics.html'}])

    if q in ('what is a topic', 'what are topics'):
        return ('A GraviQuest Topic explores one question using video, an essay, sources and interactive material.',
                [{'label': 'Browse Topics', 'href': '/topics.html'}])

    # Answer a named on-page action without guessing where its button leads.
    if any(word in q for word in ('button', 'click', 'where', 'find', 'open')):
        for action in observation['actions']:
            label = action['label']
            if len(label) >= 5 and label.casefold() in q and action['href']:
                return ('Use “' + label + '” on this page.',
                        [{'label': label, 'href': action['href']}])

    for questions, answer, href, label in PUBLIC_FAQ:
        if q in questions:
            return answer, [{'label': label, 'href': href}]
    return None
