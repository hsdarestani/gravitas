"""Public Pulsar grounding from a limited, non-private browser page snapshot.

The public frontend is static and may be ahead of the CMS during editorial work.
Browser-provided catalog entries are navigation hints, NOT system instructions.
Only same-site topic URLs and bounded plain-text titles are retained.
"""
import re


def _text(value, limit=180):
    if not isinstance(value, str):
        return ''
    return re.sub(r'\s+', ' ', re.sub(r'[\x00-\x1f\x7f]', ' ', value)).strip()[:limit]


def _site_path(value, *, topic_only=False):
    raw = _text(value, 250)
    if not raw or raw.startswith(('//', '\\', '#')) or ':' in raw or '?' in raw:
        return ''
    path = '/' + raw.lstrip('/')
    if '..' in path or '\\' in path or not re.fullmatch(r'/[a-zA-Z0-9/_-]+(?:\.html)?', path):
        return ''
    if topic_only and not re.fullmatch(r'/topic-[a-zA-Z0-9-]+\.html', path):
        return ''
    return path


def normalize_page_context(data):
    if not isinstance(data, dict):
        return {}
    page = {
        'page': _site_path(data.get('page')) or '/',
        'title': _text(data.get('title')),
        'heading': _text(data.get('heading'), 220),
    }
    featured = data.get('homepage_topic')
    if isinstance(featured, dict):
        href = _site_path(featured.get('href'), topic_only=True)
        title = _text(featured.get('title'), 220)
        if title and href:
            page['homepage_topic'] = {'title': title, 'href': href}
    entries = data.get('topics')
    if isinstance(entries, list):
        topics, seen = [], set()
        for entry in entries[:30]:
            if not isinstance(entry, dict):
                continue
            title = _text(entry.get('title'), 220)
            href = _site_path(entry.get('href'), topic_only=True)
            status = _text(entry.get('status'), 15).lower()
            if not title or not href or status != 'available' or href in seen:
                continue
            topics.append({'title': title, 'href': href, 'status': 'available'})
            seen.add(href)
        page['topics'] = topics
        page['catalog_checked'] = bool(data.get('catalog_checked'))
    return page


def _contains(text, *phrases):
    return any(phrase in text for phrase in phrases)


def public_faq(message):
    """Versioned navigation FAQ: links are verified public site routes."""
    q = message.casefold()
    targets = (
        (('where is the lab', 'where can i find the lab', 'open the lab', 'آزمایشگاه کجاست', 'لب کجاست'),
         'The interactive Lab is here.', {'label': 'Open Lab', 'href': '/lab.html'}),
        (('where is the community', 'join the community', 'open community', 'کامیونیتی کجاست'),
         'Community discussions and participation start here.', {'label': 'Community', 'href': '/community.html'}),
        (('where is learning', 'where are learning paths', 'open learning', 'مسیر یادگیری کجاست'),
         'Browse Learning here.', {'label': 'Learning', 'href': '/learn.html'}),
        (('where are the topics', 'where can i see topics', 'open topics', 'browse topics', 'تاپیک ها کجاست', 'موضوعات کجاست'),
         'Browse the current Topics and their availability here.', {'label': 'Topics', 'href': '/topics.html'}),
    )
    for triggers, answer, link in targets:
        if _contains(q, *triggers):
            return {'reply': answer, 'links': [link]}
    return None


def direct_public_answer(message, page, database_topics=()):
    """Handle unambiguous site-navigation questions without an LLM guess."""
    q = _text(message, 500).casefold()
    topic_words = ('topic', 'topics', 'تاپیک', 'موضوع', 'موضوعات')
    about_topics = _contains(q, *topic_words)
    wants_list = about_topics and _contains(
        q, 'all topic', 'what topics', 'which topic', 'list topic',
        'topics till now', 'topics so far', 'every topic', 'همه', 'لیست', 'چه موضوع',
    )
    mentions_home = _contains(q, 'first page', '1st page', 'homepage', 'home page',
                             'landing page', 'صفحه اول', 'صفحه اصلی')
    wants_featured = about_topics and _contains(
        q, 'what is the topic', 'current topic', 'another topic', 'other topic',
        'topic on the first', 'topic on the home', 'موضوع فعلی', 'موضوع صفحه',
        'تاپیک فعلی', 'تاپیک صفحه',
    )
    asks_page_access = mentions_home and _contains(
        q, 'access', 'see', 'read', 'look', 'دسترسی', 'میبینی', 'می‌بینی',
    )
    featured = page.get('homepage_topic') or {}
    catalog = page.get('topics') or []
    if wants_list:
        if catalog and page.get('catalog_checked'):
            lines = ['Currently available Topics:']
            lines.extend(f"{i}. {row['title']}" for i, row in enumerate(catalog, 1))
            links = [{'label': row['title'], 'href': row['href']} for row in catalog[:8]]
            links.append({'label': 'All Topics (including planned)', 'href': '/topics.html'})
            return {'reply': '\n'.join(lines), 'links': links}
        # The CMS is a partial source while the frontend is being revised.
        if database_topics:
            return {
                'reply': 'The CMS currently lists ' + ', '.join(database_topics[:8]) +
                         '. The live Topics page may include additional entries.',
                'links': [{'label': 'See current Topics', 'href': '/topics.html'}],
            }
        return {
            'reply': 'The live Topics list is here. I cannot verify its full contents from this request.',
            'links': [{'label': 'Topics', 'href': '/topics.html'}],
        }
    if (wants_featured or asks_page_access) and featured:
        label = featured['title']
        intro = 'The homepage features' if mentions_home or asks_page_access else 'The featured Topic is'
        return {'reply': f'{intro} “{label}”.', 'links': [
            {'label': 'Open Topic', 'href': featured['href']},
            {'label': 'All Topics', 'href': '/topics.html'},
        ]}
    if wants_featured and page.get('page', '').startswith('/topic-'):
        current = next((row for row in catalog if row['href'] == page['page']), None)
        if current:
            return {'reply': f"You're reading “{current['title']}”.",
                    'links': [{'label': 'This Topic', 'href': current['href']}]}
    return public_faq(message)


def public_page_summary(page):
    bits = [f"Page path: {page.get('page', '/')}"]
    if page.get('title'):
        bits.append('Page title: ' + page['title'])
    if page.get('heading'):
        bits.append('Page heading: ' + page['heading'])
    if page.get('homepage_topic'):
        v = page['homepage_topic']
        bits.append('Homepage featured Topic: ' + v['title'] + ' (' + v['href'] + ')')
    if page.get('catalog_checked'):
        lines = [f"{row['title']} ({row['href']})" for row in page.get('topics', [])]
        bits.append('Available Topics visible in public index: ' + ('; '.join(lines) or 'none'))
    return '\n'.join(bits)
