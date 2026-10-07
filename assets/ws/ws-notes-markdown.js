/* Gravitas+ Notes · Markdown reader
 *
 * The Read view of a research note. Notes are stored as Markdown in the
 * official Nextcloud Notes app, so the Read view has to show what Nextcloud
 * and Obsidian would show for the same file, not a dialect of our own:
 * headings, lists nested by indentation, `- [ ]` tasks, quotes, fenced code,
 * pipe tables, ==highlights==, ~~strikes~~, links, plus the two habits a
 * researcher brings from Obsidian — `[[Another note]]` and `#tag`.
 *
 * It is built from DOM nodes, never from innerHTML: a note is authored text
 * that may have been typed in Nextcloud by someone else, and it must never
 * become markup in this page. The LMS course reader (ws-member-lms.js) made
 * the same choice for the same reason; this one adds what notes need and the
 * course reader does not — tasks that can be ticked in place, which is why
 * every task carries the source line it came from.
 *
 * Maths is left as written. ws-math.js typesets $…$, $$…$$ and \(…\) in any
 * text node that lands in the workspace, so the reader's only duty is to keep
 * a formula in one text node and not mistake the * in $a*b$ for emphasis.
 */

const SAFE_HREF = /^(https?:|mailto:|\/(?!\/)|#)/i;
const INLINE = new RegExp([
  /(`[^`\n]+`)/.source,                                       // 1 code
  /(\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\)|\$[^$\n]+?\$)/.source,  // 2 maths
  /\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/.source,              // 3,4 wiki link
  /\*\*([^*]+?)\*\*|__([^_]+?)__/.source,                     // 5,6 strong
  /~~([^~\n]+?)~~/.source,                                    // 7 strike
  /==([^=\n]+?)==/.source,                                    // 8 highlight
  /\*([^*\s][^*\n]*?)\*|(?<![\w])_([^_\s][^_\n]*?)_(?![\w])/.source, // 9,10 em
  /\[([^\]\n]+)\]\(([^)\s]+)\)/.source,                       // 11,12 link
  /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/.source,           // 13 bare URL
  /(?<![\w#&/])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/.source,      // 14 tag
].join('|'), 'gu');

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TASK = /^\[([ xX])\]\s+(.*)$/s;
const FENCE = /^\s*(```|~~~)/;
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const BLOCK_START = /^\s*(```|~~~|#{1,6}\s|>|[-*+]\s+|\d+[.)]\s+|(-{3,}|\*{3,}|_{3,})\s*$)/;

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function indentOf(text) {
  return text.replace(/\t/g, '    ').match(/^\s*/)[0].length;
}

function appendLines(target, text) {
  text.split('\n').forEach((part, index) => {
    if (index) target.append(el('br'));
    if (part) target.append(document.createTextNode(part));
  });
}

function inline(text, target, hooks) {
  const source = String(text);
  let last = 0;
  for (const m of source.matchAll(INLINE)) {
    if (m.index > last) appendLines(target, source.slice(last, m.index));
    if (m[1]) target.append(el('code', null, m[1].slice(1, -1)));
    else if (m[2]) target.append(document.createTextNode(m[2]));
    else if (m[3]) {
      const name = m[3].trim();
      const open = hooks.wiki?.(name);
      const link = el(open ? 'button' : 'span', 'nb-wiki', (m[4] || name).trim());
      if (open) {
        link.type = 'button';
        link.addEventListener('click', open);
      } else {
        link.dataset.missing = '';
        link.title = 'No note with this title yet';
      }
      target.append(link);
    } else if (m[5] || m[6]) target.append(inline(m[5] || m[6], el('strong'), hooks));
    else if (m[7]) target.append(inline(m[7], el('s'), hooks));
    else if (m[8]) target.append(inline(m[8], el('mark'), hooks));
    else if (m[9] || m[10]) target.append(inline(m[9] || m[10], el('em'), hooks));
    else if (m[11]) {
      if (SAFE_HREF.test(m[12])) {
        const a = el('a', null, m[11]);
        a.href = m[12];
        if (/^https?:/i.test(m[12])) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
        target.append(a);
      } else {
        target.append(document.createTextNode(m[11]));
      }
    } else if (m[13]) {
      const a = el('a', null, m[13]);
      a.href = m[13];
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      target.append(a);
    } else if (m[14]) {
      const tag = el(hooks.tag ? 'button' : 'span', 'nb-tag', `#${m[14]}`);
      if (hooks.tag) {
        tag.type = 'button';
        tag.addEventListener('click', () => hooks.tag(m[14]));
      }
      target.append(tag);
    }
    last = m.index + m[0].length;
  }
  if (last < source.length) appendLines(target, source.slice(last));
  return target;
}

/* Lists nest by indentation, the way Obsidian and Nextcloud read them. A
   deeper item opens a child list under the previous item; an indented plain
   line continues it. */
function list(lines, start, base, hooks) {
  const first = LIST_ITEM.exec(lines[start].line);
  const ordered = /\d/.test(first[2]);
  const node = el(ordered ? 'ol' : 'ul');
  if (ordered) node.start = parseInt(first[2], 10) || 1;
  let i = start;
  let item = null;
  let body = null;
  while (i < lines.length) {
    const line = lines[i].line;
    const m = LIST_ITEM.exec(line);
    if (!m) {
      if (item && line.trim() && indentOf(line) > base) {
        body.append(el('br'), document.createTextNode(line.trim()));
        i += 1;
        continue;
      }
      break;
    }
    const depth = indentOf(m[1]);
    if (depth < base) break;
    if (depth > base && item) {
      const child = list(lines, i, depth, hooks);
      item.append(child.node);
      i = child.next;
      continue;
    }
    if (/\d/.test(m[2]) !== ordered) break;
    item = el('li');
    const task = TASK.exec(m[3]);
    if (task) {
      item.className = 'nb-task';
      const at = lines[i].at;
      const box = el('input');
      box.type = 'checkbox';
      box.checked = task[1] !== ' ';
      box.setAttribute('aria-label', task[2]);
      if (!hooks.toggle) box.disabled = true;
      else box.addEventListener('change', () => hooks.toggle(at, box.checked));
      body = inline(task[2], el('span'), hooks);
      if (box.checked) item.dataset.done = '';
      item.append(box, body);
    } else {
      body = inline(m[3], el('span'), hooks);
      item.append(body);
    }
    node.append(item);
    i += 1;
  }
  return { node, next: i };
}

function cells(row) {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function blocks(lines, hooks) {
  const root = document.createDocumentFragment();
  let i = 0;
  while (i < lines.length) {
    const { line } = lines[i];
    if (!line.trim()) { i += 1; continue; }

    if (FENCE.test(line)) {
      const fence = FENCE.exec(line)[1];
      const lang = line.trim().slice(3).trim();
      const code = [];
      i += 1;
      while (i < lines.length && !lines[i].line.trim().startsWith(fence)) { code.push(lines[i].line); i += 1; }
      i += 1;
      const pre = el('pre');
      const inner = el('code', null, code.join('\n'));
      if (lang) inner.dataset.lang = lang;
      pre.append(inner);
      root.append(pre);
      continue;
    }
    const heading = /^\s*(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      // The note title is the page's h1, so a "# " inside the note is the
      // first level under it.
      const level = heading[1].length;
      const node = el(`h${Math.min(6, level + 1)}`);
      node.dataset.level = String(level);
      root.append(inline(heading[2], node, hooks));
      i += 1;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      root.append(el('hr'));
      i += 1;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quoted = [];
      while (i < lines.length && /^\s*>/.test(lines[i].line)) {
        quoted.push({ line: lines[i].line.replace(/^\s*>\s?/, ''), at: lines[i].at });
        i += 1;
      }
      const quote = el('blockquote');
      quote.append(blocks(quoted, hooks));
      root.append(quote);
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const result = list(lines, i, indentOf(line), hooks);
      root.append(result.node);
      i = result.next;
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && lines[i + 1].line.includes('|') && TABLE_RULE.test(lines[i + 1].line)) {
      const wrap = el('div', 'nb-table');
      const table = el('table');
      const head = el('thead');
      const headRow = el('tr');
      cells(line).forEach((cell) => headRow.append(inline(cell, el('th'), hooks)));
      head.append(headRow);
      const body = el('tbody');
      i += 2;
      while (i < lines.length && lines[i].line.includes('|') && lines[i].line.trim()) {
        const row = el('tr');
        cells(lines[i].line).forEach((cell) => row.append(inline(cell, el('td'), hooks)));
        body.append(row);
        i += 1;
      }
      table.append(head, body);
      wrap.append(table);
      root.append(wrap);
      continue;
    }
    const para = [line];
    i += 1;
    while (i < lines.length && lines[i].line.trim() && !BLOCK_START.test(lines[i].line)) {
      para.push(lines[i].line);
      i += 1;
    }
    root.append(inline(para.join('\n'), el('p'), hooks));
  }
  return root;
}

/* hooks: { wiki(title) → click handler | null, tag(name), toggle(line, checked) } */
export function renderNoteMarkdown(source, hooks = {}) {
  const root = el('div', 'nb-md');
  const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n').map((line, at) => ({ line, at }));
  root.append(blocks(lines, hooks));
  // Researchers here write Persian and English in the same note. Each block
  // takes its direction from its own first strong character, as Nextcloud's
  // and Obsidian's editors do, rather than the whole note taking the first.
  root.querySelectorAll('p, li, h2, h3, h4, h5, h6, blockquote, th, td').forEach((node) => { node.dir = 'auto'; });
  return root;
}

/* Plain text for list previews and search: the words, without the marks. */
export function plainNoteText(source) {
  return String(source || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/gm, '')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, name, alias) => alias || name)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~=`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
