"""Read-only, licensed scientific resource lookup for the existing Pulsar Telegram bot.

The feature never fetches arbitrary user URLs, scrapes paywalls, writes tasks, or
saves resource files. Metadata comes from official ISO links, OpenAlex,
Crossref and Open Library. PDF delivery is restricted to known public arXiv
URLs; other open-access PDFs are linked rather than downloaded by the server.
"""
import re
from urllib.parse import quote, urlparse

import requests

DOI_RE = re.compile(r'10\.\d{4,9}/[^\s<>\"“”]+', re.I)
ISO_RE = re.compile(r'^https://(?:www\.)?iso\.org/standard/(\d+)\.html/?$', re.I)
ARXIV_RE = re.compile(
    r'^https://(?:www\.|export\.)?arxiv\.org/(?:abs|pdf)/(\d{4}\.\d{4,5})(?:\.pdf)?/?$', re.I
)
COMMAND_RE = re.compile(r'^/(find|paper|source|book)(?:@\w+)?(?:\s+([\s\S]+))?$', re.I)
ISBN_RE = re.compile(r'^(?:97[89][\d -]{10,17}|[\dXx][\dXx -]{8,15})$')
MAX_QUERY = 400
API_TIMEOUT = (3, 6)
USER_AGENT = 'GraviQuest-Pulsar/1.0 (scientific resource lookup)'
ISO_KNOWN = {
    '35736': (
        'ISO/IEC 25012:2008',
        'Software engineering — Software product Quality Requirements and Evaluation (SQuaRE) — Data quality model',
    ),
}


def _safe_link(raw):
    """Only render bounded public-looking HTTPS links returned by metadata APIs."""
    value = str(raw or '').strip()
    if not value or len(value) > 1300:
        return ''
    try:
        parsed = urlparse(value)
        host = (parsed.hostname or '').lower().rstrip('.')
        if (parsed.scheme != 'https' or not host or parsed.username or parsed.password
                or parsed.port not in (None, 443) or host == 'localhost'
                or host.endswith(('.localhost', '.local', '.internal'))
                or host.replace('.', '').isdigit()):
            return ''
    except ValueError:
        return ''
    return value


def _arxiv_pdf(raw):
    """Allow Telegram to retrieve files only from a trusted OA repository."""
    link = _safe_link(raw)
    if not link:
        return ''
    parsed = urlparse(link)
    if (parsed.hostname or '').lower() != 'arxiv.org' or parsed.query or parsed.fragment:
        return ''
    if re.fullmatch(r'/pdf/\d{4}\.\d{4,5}(?:\.pdf)?', parsed.path, re.I):
        return link
    return ''


def parse_request(text):
    """Return a lookup specification or None for ordinary Pulsar conversation."""
    raw = str(text or '').strip()
    command = COMMAND_RE.fullmatch(raw)
    command_name = command.group(1).lower() if command else ''
    if command:
        requested = (command.group(2) or '').strip()
        if not requested:
            return {'kind': 'help'}
    else:
        requested = raw
        # Never hijack ordinary chat, work logs, or task drafts.
        if (not requested or '\n' in requested or len(requested) > MAX_QUERY
                or ' ' in requested):
            return None
        if not (ISO_RE.fullmatch(requested) or ARXIV_RE.fullmatch(requested)
                or DOI_RE.fullmatch(requested) or
                requested.startswith(('https://doi.org/', 'https://dx.doi.org/'))):
            return None

    if len(requested) > MAX_QUERY:
        return {'kind': 'too_long'}
    match = ISO_RE.fullmatch(requested)
    if match:
        return {'kind': 'iso', 'id': match.group(1)}
    match = ARXIV_RE.fullmatch(requested)
    if match:
        return {'kind': 'arxiv', 'id': match.group(1)}
    if requested.startswith(('https://doi.org/', 'https://dx.doi.org/')):
        doi = requested.split('.org/', 1)[-1].split('?', 1)[0].strip()
    else:
        doi = requested
    if DOI_RE.fullmatch(doi):
        return {'kind': 'doi', 'value': doi.rstrip('.,;')}
    compact = requested.replace('-', '').replace(' ', '')
    if ISBN_RE.fullmatch(requested) and len(compact) in (10, 13):
        return {'kind': 'isbn', 'value': compact.upper()}
    if requested.startswith(('https://', 'http://')):
        return {'kind': 'unsupported_url'}
    return {'kind': 'book_title' if command_name == 'book' else 'title', 'value': requested}


def _get_json(url, params=None):
    response = requests.get(
        url, params=params, timeout=API_TIMEOUT,
        headers={'User-Agent': USER_AGENT, 'Accept': 'application/json'},
        allow_redirects=False,
    )
    response.raise_for_status()
    result = response.json()
    if not isinstance(result, dict):
        raise ValueError('invalid_resource_metadata')
    return result


def _papers(spec):
    params = {'per_page': 3}
    if spec['kind'] == 'doi':
        params = {'filter': 'doi:https://doi.org/' + spec['value'], 'per_page': 1}
    else:
        params['search'] = spec['value']
    data = _get_json('https://api.openalex.org/works', params=params)
    rows = [row for row in data.get('results', []) if isinstance(row, dict)]
    # For exact DOI lookups, Crossref is a useful authoritative metadata fallback.
    if not rows and spec['kind'] == 'doi':
        doi = spec['value']
        try:
            crossref = _get_json('https://api.crossref.org/works/' + quote(doi, safe=''))
            item = crossref.get('message') or {}
            title = (item.get('title') or [''])[0]
            if title:
                rows = [{
                    'display_name': title, 'publication_year': None,
                    'doi': 'https://doi.org/' + doi,
                    'open_access': {'is_oa': False},
                }]
        except (requests.RequestException, ValueError, IndexError, TypeError):
            pass
    return rows


def _paper_messages(rows, language='fa'):
    if not rows:
        return [{'text': 'منبعی پیدا نشد. عنوان دقیق یا DOI را بفرست.' if language == 'fa'
                 else 'No matching resource found. Try an exact title or DOI.'}]
    fa = language == 'fa'
    chunks = ['📚 Pulsar · Scientific Resource Finder',
              'نتایج منابع علمی:' if fa else 'Scientific resources:']
    attachment = None
    for index, item in enumerate(rows[:3], 1):
        title = ' '.join(str(item.get('display_name') or item.get('title') or 'Untitled').split())[:240]
        year = item.get('publication_year')
        doi = _safe_link(item.get('doi'))
        oa = item.get('open_access') or {}
        locs = [item.get('best_oa_location'), item.get('primary_location')]
        locs += (item.get('locations') or [])[:10]
        pdf = ''
        landing = ''
        for location in locs:
            if not isinstance(location, dict):
                continue
            if not landing:
                landing = _safe_link(location.get('landing_page_url'))
            if not pdf and location.get('is_oa'):
                pdf = _safe_link(location.get('pdf_url'))
        open_page = landing or doi or _safe_link(item.get('id'))
        chunks.append('\n' + f'{index}. {title}' + (f' ({year})' if year else ''))
        if doi:
            chunks.append('DOI: ' + doi)
        if pdf:
            chunks.append(('✅ PDF آزاد: ' if fa else '✅ Open-access PDF: ') + pdf)
            if attachment is None:
                attachment = _arxiv_pdf(pdf)
        elif oa.get('is_oa'):
            chunks.append('✅ صفحه دسترسی آزاد' if fa else '✅ Open-access page available')
        else:
            chunks.append('🔒 PDF آزاد تأیید نشد' if fa else '🔒 No verified open-access PDF')
        if open_page and open_page != doi and open_page != pdf:
            chunks.append(('صفحه منبع: ' if fa else 'Source: ') + open_page)
    chunks.append('\nفایل‌های دارای محدودیت نشر به‌صورت خودکار بازنشر نمی‌شوند.' if fa
                  else '\nCopyright-restricted files are not redistributed.')
    result = [{'text': '\n'.join(chunks)[:4096]}]
    if attachment:
        result.append({'document_url': attachment, 'caption': 'Open-access paper · arXiv'})
    return result


def _book_messages(isbn, language):
    data = _get_json('https://openlibrary.org/isbn/' + quote(isbn, safe='') + '.json')
    title = str(data.get('title') or 'Unknown book')[:250]
    key = str(data.get('key') or '')
    url = _safe_link('https://openlibrary.org' + key) if key.startswith('/books/') else (
        'https://openlibrary.org/isbn/' + isbn
    )
    if language == 'fa':
        return [{'text': f'📚 {title}\nISBN: {isbn}\nکتاب: {url}\n'
                         'برای نسخه قابل امانت یا خرید، گزینه‌های قانونی صفحه کتاب را ببین.'}]
    return [{'text': f'📚 {title}\nISBN: {isbn}\nBook: {url}\n'
                     'Check the book page for licensed loan or purchase options.'}]


def _book_title_messages(title, language):
    data = _get_json('https://openlibrary.org/search.json', params={
        'title': title[:200], 'limit': 3,
        'fields': 'title,author_name,key,first_publish_year',
    })
    docs = [item for item in data.get('docs', []) if isinstance(item, dict)][:3]
    if not docs:
        return [{'text': 'کتابی با این عنوان پیدا نشد.' if language == 'fa'
                 else 'No matching book was found.'}]
    lines = ['📚 Pulsar · Books']
    for index, item in enumerate(docs, 1):
        name = str(item.get('title') or 'Untitled')[:200]
        authors = ', '.join(str(name) for name in (item.get('author_name') or [])[:2])
        key = str(item.get('key') or '')
        link = 'https://openlibrary.org' + key if key.startswith('/works/') else ''
        lines.append(f'{index}. {name}' + (f' — {authors}' if authors else ''))
        if link:
            lines.append(link)
    lines.append('نسخه‌های امانت یا خرید مجاز را در صفحه کتاب بررسی کن.' if language == 'fa'
                 else 'Check each book page for licensed borrowing or purchase.')
    return [{'text': '\n'.join(lines)[:4096]}]


def lookup_messages(spec, language='fa'):
    kind = spec['kind']
    fa = language == 'fa'
    if kind == 'help':
        return [{'text': ('🔎 جست‌وجوی منابع علمی:\n/find عنوان مقاله یا کتاب\n'
                          '/paper DOI\n/book ISBN\n'
                          'یا لینک ISO، arXiv و DOI را مستقیم بفرست.\n'
                          'فقط فایل‌های آزاد و مجاز ارسال می‌شوند.') if fa else
                 ('🔎 Scientific resources:\n/find title\n/paper DOI\n/book ISBN\n'
                  'Or send an ISO, arXiv or DOI link. Only authorized open-access files are delivered.')}]
    if kind == 'too_long':
        return [{'text': 'عنوان خیلی طولانی است.' if fa else 'Query is too long.'}]
    if kind == 'unsupported_url':
        return [{'text': ('این لینک مستقیم قابل جست‌وجو نیست. DOI، ISBN یا عنوان منبع را با /find بفرست.'
                          if fa else 'Unsupported link. Please send a DOI, ISBN, or /find title.')}]
    if kind == 'iso':
        code = spec['id']
        official = 'https://www.iso.org/standard/' + code + '.html'
        name, title = ISO_KNOWN.get(code, ('ISO Standard #' + code, ''))
        intro = f'📘 {name}' + (f'\n{title}' if title else '')
        if fa:
            return [{'text': intro + '\nمنبع رسمی: ' + official +
                     '\nاستانداردهای ISO معمولاً دارای مجوز و هزینه هستند؛ لینک رسمی و پیش‌نمایش را بررسی کن. '
                     'PDF کامل رایگان تأیید نشده است.'}]
        return [{'text': intro + '\nOfficial source: ' + official +
                 '\nISO standards may require purchase or institutional access. '
                 'No free full PDF has been verified.'}]
    if kind == 'arxiv':
        ident = spec['id']
        return [{'text': ('✅ مقاله arXiv با دسترسی آزاد' if fa else '✅ Open-access arXiv paper')
                 + '\nhttps://arxiv.org/abs/' + ident},
                {'document_url': 'https://arxiv.org/pdf/' + ident, 'caption': 'arXiv ' + ident}]
    try:
        if kind == 'isbn':
            return _book_messages(spec['value'], language)
        if kind == 'book_title':
            return _book_title_messages(spec['value'], language)
        if kind in ('doi', 'title'):
            return _paper_messages(_papers(spec), language)
    except requests.HTTPError as exc:
        if kind == 'isbn' and exc.response is not None and exc.response.status_code == 404:
            return [{'text': 'این ISBN در Open Library پیدا نشد.' if fa
                     else 'This ISBN was not found in Open Library.'}]
        return [{'text': 'سرویس جست‌وجو موقتاً پاسخ مناسب نمی‌دهد. دوباره امتحان کن.' if fa
                 else 'The resource search service is temporarily unavailable. Try again.'}]
    except (requests.RequestException, ValueError, TypeError):
        return [{'text': 'سرویس جست‌وجو موقتاً در دسترس نیست. دوباره امتحان کن.' if fa
                 else 'The resource search service is temporarily unavailable. Try again.'}]
    return None


def handle_resource_request(text):
    """Return messages for a scholarly request, or None for normal Pulsar flow."""
    spec = parse_request(text)
    if spec is None:
        return None
    language = 'fa' if re.search(r'[\u0600-\u06ff]', str(text or '')) else 'en'
    return lookup_messages(spec, language)
