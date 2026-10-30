"""Date windows reported in team documents, not fabricated event timestamps.

An activity range describes calendar days on which work was reported. It is
never a deadline by itself and cannot establish an exact activation hour.
"""
import re
import unicodedata
from datetime import date, datetime, time, timezone

MONTHS = {name: index for index, names in enumerate([
    ('jan', 'january'), ('feb', 'february'), ('mar', 'march'), ('apr', 'april'),
    ('may',), ('jun', 'june'), ('jul', 'july'), ('aug', 'august'),
    ('sep', 'sept', 'september'), ('oct', 'october'), ('nov', 'november'), ('dec', 'december'),
], 1) for name in names}
MONTH = '(?:' + '|'.join(sorted(MONTHS, key=len, reverse=True)) + ')'
DIGITS = str.maketrans('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789')


def activity_window(value, *, year=2026):
    if not isinstance(value, str):
        return None
    text = unicodedata.normalize('NFKC', value).translate(DIGITS).lower()
    text = text.replace('–', '-').replace('—', '-').replace('−', '-')
    dates = []
    try:
        for token in re.findall(r'\b20\d{2}-\d{1,2}-\d{1,2}\b', text):
            yy, mm, dd = map(int, token.split('-'))
            dates.append(date(yy, mm, dd))
        if not dates:
            match = re.search(r'(\d{1,2})\s*(' + MONTH + r')\s*(?:-|to|until)\s*(\d{1,2})\s*(' + MONTH + r')', text)
            if match:
                dates = [date(year, MONTHS[match[2]], int(match[1])), date(year, MONTHS[match[4]], int(match[3]))]
            else:
                match = re.search(r'(\d{1,2})\s*(?:-|to|until)\s*(\d{1,2})\s*(' + MONTH + r')', text)
                if match:
                    dates = [date(year, MONTHS[match[3]], int(match[1])), date(year, MONTHS[match[3]], int(match[2]))]
                else:
                    for match in re.finditer(r'(\d{1,2})\s*(' + MONTH + r')\b', text):
                        dates.append(date(year, MONTHS[match[2]], int(match[1])))
    except (ValueError, KeyError):
        return None
    if not dates or dates[-1] < dates[0]:
        return None
    return min(dates), max(dates)


def day_stamp(value):
    # Noon is an internal representative of a calendar day, not a claimed
    # hour worked. Every derived value carries precision=day in provenance.
    return datetime.combine(value, time(12), tzinfo=timezone.utc)


def title_key(value):
    text = unicodedata.normalize('NFKC', str(value or '')).lower()
    text = re.sub(r'^(?:\[[^]]+\]\s*)?(?:task\s*\d+\s*[:—-]\s*)?', '', text)
    text = re.sub(r'\s*=\s*[\d.]+\s*h\s*$', '', text)
    return ' '.join(re.sub(r'[^\w\s]', ' ', text).split())


def document_activity_rows(document, tab_names):
    """Preserve native tab and paragraph locations for every dated statement."""
    result, headings = [], {}
    for paragraph in document.get('paragraphs', []):
        text = paragraph.get('text', '').strip()
        tab = paragraph.get('tabId')
        if re.match(r'^TASK\s*\d+\s*[:—-]', text, re.I):
            headings[tab] = text
            continue
        status = re.search(r'\b(Done|Doing|Retest|In progress|Superseded|Pending|Blocked)\b', text, re.I)
        if status is None:
            continue
        raw = text[status.end():].strip(' |—-')
        window = activity_window(raw)
        if not window:
            continue
        title = text[:status.start()].strip(' *-—|')
        if not title:
            continue
        result.append({'title': title, 'title_key': title_key(title), 'status': status[1].lower(),
            'start': window[0].isoformat(), 'end': window[1].isoformat(), 'raw_date': raw,
            'document_id': document['documentId'], 'revision_id': document.get('revisionId'),
            'tab_id': tab, 'tab_title': tab_names.get(tab, ''), 'heading': headings.get(tab, ''),
            'paragraph_start': paragraph.get('startIndex'), 'paragraph_end': paragraph.get('endIndex'),
            'quote': text})
    return result
