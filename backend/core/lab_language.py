"""Keep a Lab explanation in its requested language without changing evidence."""
import re


PROTECTED = re.compile(r'\[[a-z0-9-]+#[a-z0-9-]+\]|https?://[^\s)]+|`[^`]+`|\d+(?:[.,]\d+)*')
LATIN_WORD = re.compile(r'[A-Za-z\u00c0-\u024f]{3,}')
TECHNICAL_NAMES = {'pulsar', 'graviquest', 'science', 'universe', 'world', 'llm',
                   'ioannidis', 'simmons', 'smaldino', 'mcelreath', 'openai', 'cloudflare'}
COMMON_INTRUSIONS = {'cuando': 'وقتی', 'yanlış': 'نادرست', '根据': 'بر اساس'}


def answer_locale(question, page_locale):
    return 'fa' if re.search(r'[پچژگکی]', question) else str(page_locale or 'en')[:32]


def normalize_persian_prose(text, question=''):
    """Normalize observed connectives, never quoted code or evidence."""
    parts = re.split('(' + PROTECTED.pattern + ')', text)
    for i in range(0, len(parts), 2):
        for foreign, persian in COMMON_INTRUSIONS.items():
            if foreign.casefold() in question.casefold():
                continue
            pattern = re.escape(foreign) if foreign == '根据' else r'\b' + re.escape(foreign) + r'\b'
            parts[i] = re.sub(pattern, persian, parts[i], flags=re.IGNORECASE)
    return ''.join(parts)


def needs_persian_edit(text):
    prose = PROTECTED.sub('', text)
    return (bool(re.search(r'[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]', prose)) or
            any(word.casefold() not in TECHNICAL_NAMES for word in LATIN_WORD.findall(prose)))


def protect_evidence(text):
    tokens = {}

    def replace(match):
        # Letter-only markers do not collide with a number from the model.
        token = '⟦' + 'X' * (len(tokens) + 1) + '⟧'
        tokens[token] = match[0]
        return token

    return PROTECTED.sub(replace, text), tokens


def restore_evidence(edited, tokens):
    for token in tokens:
        if edited.count(token) != 1:
            return None
    prose = edited
    for token in tokens:
        prose = prose.replace(token, '')
    if re.search(r'\d', prose):
        return None  # An editor must not introduce new measurements.
    for token, value in tokens.items():
        edited = edited.replace(token, value)
    return None if needs_persian_edit(edited) else edited
