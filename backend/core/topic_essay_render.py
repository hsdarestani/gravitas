"""Render the public essay format without interpreting arbitrary source HTML."""
from html import escape, unescape
import re

from markdown_it import MarkdownIt

_FRONT_MATTER = re.compile(r'\A(?:\ufeff)?---[ \t]*\n.*?^---[ \t]*(?:\n|$)', re.M | re.S)
_DRAFT = re.compile(r'^\s*(?:#{1,6}\s+|<!--\s*)drafting notes\b', re.I | re.M)
_COMMENT = re.compile(r'<!--.*?(?:-->|\Z)', re.S)
_CONTAINER = re.compile(
    r'^ {0,3}:::[ \t]+(pullquote|godeeper|figure|box)(?:[ \t]+([^\n]*?))?[ \t]*\n'
    r'(.*?)(?:^ {0,3}|[ \t]+):::[ \t]*$', re.M | re.S,
)
_ABBR = re.compile(r'<abbr title=(["\'])([^<>\n]{1,400}?)\1>([^<>\n]{1,200})</abbr>')
_REFERENCE = re.compile(r'<a id=(["\'])(ref-[a-z0-9-]+)\1></a>')
_REFERENCE_ID = re.compile(r'ref-[a-z0-9-]+')
_MARKDOWN = MarkdownIt('commonmark', {'html': False, 'maxNesting': 20}).enable(['table', 'strikethrough'])


def _safe_inline(state, silent):
    source = state.src
    start = state.pos
    if source.startswith('<abbr ', start):
        match = _ABBR.match(source, start, state.posMax)
        if not match:
            return False
        if not silent:
            token = state.push('essay_abbreviation', '', 0)
            token.meta = {'title': unescape(match[2]), 'label': unescape(match[3])}
    elif source.startswith('<a id=', start):
        match = _REFERENCE.match(source, start, state.posMax)
        if not match:
            return False
        if not silent:
            token = state.push('essay_reference', '', 0)
            token.content = match[2]
    else:
        return False
    state.pos = match.end()
    return True


def _abbreviation(renderer, tokens, index, options, env):
    meta = tokens[index].meta
    return f'<abbr title="{escape(meta["title"])}">{escape(meta["label"])}</abbr>'


def _reference(renderer, tokens, index, options, env):
    ref = escape(tokens[index].content)
    return f'<span class="ta-essay-ref" id="{escape(env["scope"])}-{ref}"></span>'


_MARKDOWN.inline.ruler.before('html_inline', 'essay_safe_inline', _safe_inline)
_MARKDOWN.add_render_rule('essay_abbreviation', _abbreviation)
_MARKDOWN.add_render_rule('essay_reference', _reference)


def _tokens_html(tokens, env):
    for token in tokens:
        if token.type in {'heading_open', 'heading_close'}:
            token.tag = f'h{min(6, int(token.tag[1]) + 2)}'
        for inline in token.children or ():
            href = inline.attrGet('href')
            if href and href.startswith('#') and _REFERENCE_ID.fullmatch(href[1:]):
                inline.attrSet('href', f'#{env["scope"]}-{href[1:]}')
    return _MARKDOWN.renderer.render(tokens, _MARKDOWN.options, env)


def _markup(source, env):
    return _tokens_html(_MARKDOWN.parse(source, env), env)


def _inline_markup(source, env):
    return _tokens_html(_MARKDOWN.parseInline(source, env), env)


def _figure(figure_id, source, env):
    # The author's figure blocks contain both the data and layout directions.
    # Render only the reader-facing data, caption, and annotations.
    lines = source.strip().splitlines()
    if not lines:
        return ''
    title = lines[0].strip()
    body = '\n'.join(lines[1:]).strip()
    caption = re.search(r'(?m)\bCaption:[ \t]*["“]([^"”\n]+)["”][ \t]*$', body)
    caption_html = f'<figcaption>{escape(caption[1])}</figcaption>' if caption else ''
    if caption:
        body = body[:caption.start()].rstrip()
    source_note = ''
    if figure_id == 'rate-chart':
        data = next((line for line in lines[1:] if line.startswith('Data ')), '')
        data_match = re.match(r'^Data(?: \((.*?)\))?:[ \t]*(.*)$', data)
        entries = data_match[2] if data_match else data
        if data_match and data_match[1]:
            source_note = data_match[1]
        values = []
        for entry in entries.split('·'):
            match = re.fullmatch(r'\s*([^:]+):\s*1 in ([0-9][0-9,]{0,14})\.?\s*', entry)
            if match:
                denominator = int(match[2].replace(',', ''))
                if denominator:
                    values.append((match[1], match[2], 1 / denominator))
        if values:
            maximum = max(value[2] for value in values)
            rows = ''.join(
                f'<li><div><span>{escape(period)}</span><strong>1 in {escape(ratio)}</strong></div>'
                f'<meter aria-hidden="true" min="0" max="{maximum}" value="{rate}"></meter></li>'
                for period, ratio, rate in values
            )
            chart = f'<ul class="ta-essay-chart">{rows}</ul>'
        else:
            chart = _markup(data, env)
    elif figure_id == 'raw-vs-matched':
        source_match = re.search(r'values from (.+)\.$', body, re.M)
        source_note = source_match[1] if source_match else ''
        rows = []
        for line in body.splitlines():
            match = re.match(r'^[-*]\s+([^:]+):\s*(.+)$', line)
            if match:
                rows.append(
                    f'<tr><th scope="row">{_inline_markup(match[1], env)}</th>'
                    f'<td>{_inline_markup(match[2], env)}</td></tr>'
                )
        chart = '<table><tbody>' + ''.join(rows) + '</tbody></table>' if rows else ''
    else:
        if figure_id == 'timeline':
            title = re.split(r'\s+One horizontal line\b', title, maxsplit=1)[0]
        if figure_id == 'fake-citation':
            body = re.sub(r'^Annotate each element:[ \t]*\n', '', body, flags=re.M)
            body = re.sub(r'\bRight-hand panel: the ', 'The ', body)
        chart = _markup(body, env)
    heading = _inline_markup(title, env)
    credit = f'<p class="ta-essay-credit">Source: {_inline_markup(source_note, env)}</p>' if source_note else ''
    return f'<figure class="ta-essay-figure"><h5>{heading}</h5>{chart}{credit}{caption_html}</figure>'


def _component(kind, argument, source, env):
    heading = escape(argument.strip().strip('"“”'))
    if kind == 'figure':
        return _figure(argument.removeprefix('id='), source, env)
    if kind == 'pullquote':
        quote, separator, author = source.strip().rpartition('\n— ')
        if not separator:
            quote, author = source, ''
        attribution = f'<figcaption>{escape(author.strip())}</figcaption>' if author else ''
        return f'<figure class="ta-essay-quote"><blockquote>{_markup(quote, env)}</blockquote>{attribution}</figure>'
    body = _markup(source, env)
    if kind == 'godeeper':
        return f'<details class="ta-essay-detail"><summary>{heading or "Go deeper"}</summary>{body}</details>'
    title = f'<h5>{heading}</h5>' if heading else ''
    return f'<aside class="ta-essay-box">{title}{body}</aside>'


def render_essay(source, scope):
    source = source.replace('\r\n', '\n').replace('\r', '\n')
    source = _FRONT_MATTER.sub('', source, count=1)
    draft = _DRAFT.search(source)
    if draft:
        source = re.sub(r'(?m)^---[ \t]*\s*\Z', '', source[:draft.start()])
    source = _COMMENT.sub('', source)
    env = {'scope': scope}
    title = ''
    rendered = []
    cursor = 0
    for match in _CONTAINER.finditer(source):
        tokens = _MARKDOWN.parse(source[cursor:match.start()], env)
        if cursor == 0:
            title, tokens = _extract_title(tokens)
        rendered.append(_tokens_html(tokens, env))
        rendered.append(_component(match[1], match[2] or '', match[3], env))
        cursor = match.end()
    tokens = _MARKDOWN.parse(source[cursor:], env)
    if cursor == 0:
        title, tokens = _extract_title(tokens)
    rendered.append(_tokens_html(tokens, env))
    return title, ''.join(rendered)


def _extract_title(tokens):
    if not tokens or tokens[0].type != 'heading_open' or tokens[0].tag != 'h1':
        return '', tokens
    title = ''.join(child.content for child in tokens[1].children or []
                    if child.type in {'text', 'code_inline'}).strip()
    return (title, tokens[3:]) if title else ('', tokens)
