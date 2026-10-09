/* Gravitas+ Notes · commands in the writing surface
 *
 * A note is Markdown, because it lives in the Nextcloud Notes app and has to
 * read the same there, in Files and in Obsidian. The editor is therefore a
 * plain textarea, and that is deliberate: a contenteditable "rich" editor
 * would have to turn its DOM back into Markdown on every save, and every
 * such round trip that has been tried somewhere drops a nested list or
 * rewrites someone's table. What a textarea lacked was everything that makes
 * Notion pleasant to write in without knowing the syntax — so that is what
 * this module adds, on top of the text, never instead of it:
 *
 * - "/" at the start of a line or after a space opens a menu of blocks. It
 *   filters as you type ("/h2", "/todo"), takes arrows, Enter and Escape,
 *   and writes the Markdown for the chosen block. Anyone who knows the syntax
 *   can keep typing it; the menu only ever writes what they would have.
 * - Selecting text raises a small toolbar for inline marks — bold, italic,
 *   strike, code, highlight, maths, links — and for turning the line into a
 *   heading, a quote or a list item.
 * - Every change goes through execCommand('insertText'), so Ctrl+Z undoes a
 *   command the way it undoes typing. Assigning .value empties the browser's
 *   undo stack, which in a writing surface is losing work.
 *
 * - Pointing at a line shows a gutter beside it, as in Notion: "+" adds a
 *   block below and opens the menu there, and the grip moves the block by
 *   dragging (or Alt+Shift+↑/↓ from the keyboard). A click on the grip
 *   selects the block, which raises the formatting toolbar for all of it.
 *   A block is what has to move as one: a fenced code block, a $$ equation,
 *   a table, or a list item with the items indented under it.
 *
 * Positions come from a mirror element: a hidden div with the textarea's
 * metrics and the text up to the caret, whose end is where the caret is.
 * Both popups are fixed to the viewport and follow the page when it scrolls.
 */

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

/* ---- Text edits ----------------------------------------------------------- */
export function replaceRange(area, start, end, text, caret = null, caretEnd = caret) {
  area.focus();
  area.setSelectionRange(start, end);
  let done = false;
  try {
    done = text ? document.execCommand('insertText', false, text) : document.execCommand('delete');
  } catch {
    done = false;
  }
  if (!done) {
    area.setRangeText(text, start, end, 'end');
    area.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (caret != null) area.setSelectionRange(caret, caretEnd);
}

export function wrapSelection(area, mark, closing = mark) {
  const { selectionStart: s, selectionEnd: e, value } = area;
  const chosen = value.slice(s, e);
  const n = mark.length;
  const m = closing.length;
  if (chosen.length >= n + m && chosen.startsWith(mark) && chosen.endsWith(closing)) {
    replaceRange(area, s, e, chosen.slice(n, -m), s, e - n - m);
  } else if (value.slice(s - n, s) === mark && value.slice(e, e + m) === closing) {
    replaceRange(area, s - n, e + m, chosen, s - n, e - n);
  } else {
    replaceRange(area, s, e, `${mark}${chosen}${closing}`, s + n, e + n);
  }
}

const BLOCK_PREFIX = /^(\s*)(#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|>\s?)?/;

function lineAt(value, index) {
  const start = value.lastIndexOf('\n', index - 1) + 1;
  const found = value.indexOf('\n', index);
  return { start, end: found === -1 ? value.length : found };
}

/* Turn the caret's line into another kind of block: whatever marker it had
   is replaced, its indentation and its words are kept. Choosing the kind it
   already is turns it back into plain text, the way a toolbar toggle does. */
function setLinePrefix(area, prefix, at = area.selectionStart) {
  const { value } = area;
  const { start, end } = lineAt(value, at);
  const line = value.slice(start, end);
  const m = BLOCK_PREFIX.exec(line);
  const indent = m[1] || '';
  const current = m[2] || '';
  const rest = line.slice(m[0].length);
  const same = prefix && current.replace(/\s+$/, ' ') === prefix;
  const next = `${indent}${same ? '' : prefix}${rest}`;
  if (next === line) return;
  replaceRange(area, start, end, next, start + next.length);
}

/* A multi-line block goes on its own lines: in place of an empty line, or
   below the current one. `caretAt` is where the caret lands inside it. */
function insertBlock(area, text, caretAt) {
  const { value, selectionStart: at } = area;
  const { start, end } = lineAt(value, at);
  const empty = !value.slice(start, end).trim();
  const lead = empty ? '' : '\n';
  const from = empty ? start : end;
  const to = end;
  const trail = value.slice(to, to + 1) === '\n' || to === value.length ? '' : '\n';
  replaceRange(area, from, to, `${lead}${text}${trail}`, from + lead.length + caretAt);
}

function insertInline(area, before, after = '') {
  const { selectionStart: s, selectionEnd: e, value } = area;
  const chosen = value.slice(s, e);
  replaceRange(area, s, e, `${before}${chosen}${after}`, s + before.length, s + before.length + chosen.length);
}

const today = () => new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

/* ---- The block menu ----------------------------------------------------- */
export const COMMANDS = [
  { group: 'Basic blocks', id: 'text', label: 'Text', glyph: 'T', hint: '', words: 'paragraph plain body', run: (a) => setLinePrefix(a, '') },
  { group: 'Basic blocks', id: 'h1', label: 'Heading 1', glyph: 'H1', hint: '#', words: 'title big', run: (a) => setLinePrefix(a, '# ') },
  { group: 'Basic blocks', id: 'h2', label: 'Heading 2', glyph: 'H2', hint: '##', words: 'subtitle section', run: (a) => setLinePrefix(a, '## ') },
  { group: 'Basic blocks', id: 'h3', label: 'Heading 3', glyph: 'H3', hint: '###', words: 'subsection small', run: (a) => setLinePrefix(a, '### ') },
  { group: 'Lists', id: 'bullet', label: 'Bulleted list', glyph: '•', hint: '-', words: 'unordered ul bullet', run: (a) => setLinePrefix(a, '- ') },
  { group: 'Lists', id: 'number', label: 'Numbered list', glyph: '1.', hint: '1.', words: 'ordered ol numbered', run: (a) => setLinePrefix(a, '1. ') },
  { group: 'Lists', id: 'todo', label: 'To-do list', glyph: '☐', hint: '[ ]', words: 'task checkbox check todo', run: (a) => setLinePrefix(a, '- [ ] ') },
  { group: 'Blocks', id: 'quote', label: 'Quote', glyph: '❝', hint: '>', words: 'blockquote citation', run: (a) => setLinePrefix(a, '> ') },
  { group: 'Blocks', id: 'callout', label: 'Callout', glyph: '!', hint: '> **', words: 'note info warning aside', run: (a) => insertBlock(a, '> **Note** ', 11) },
  { group: 'Blocks', id: 'code', label: 'Code block', glyph: '</>', hint: '```', words: 'snippet program script', run: (a) => insertBlock(a, '```\n\n```', 4) },
  { group: 'Blocks', id: 'math', label: 'Equation', glyph: '∑', hint: '$$', words: 'math latex formula tex', run: (a) => insertBlock(a, '$$\n\n$$', 3) },
  { group: 'Blocks', id: 'table', label: 'Table', glyph: '⊞', hint: '|', words: 'grid columns rows', run: (a) => insertBlock(a, '| Column | Column |\n| --- | --- |\n|  |  |', 36) },
  { group: 'Blocks', id: 'divider', label: 'Divider', glyph: '—', hint: '---', words: 'rule line separator hr', run: (a) => insertBlock(a, '---\n', 4) },
  { group: 'Insert', id: 'link', label: 'Link to note', glyph: '[[', hint: '[[ ]]', words: 'wiki reference page backlink', run: (a) => insertInline(a, '[[', ']]') },
  { group: 'Insert', id: 'date', label: 'Today’s date', glyph: 'D', hint: '', words: 'date today now day', run: (a) => insertInline(a, today()) },
];

function matches(query) {
  const q = query.trim().toLowerCase();
  if (!q) return COMMANDS;
  return COMMANDS
    .map((command) => {
      const label = command.label.toLowerCase();
      const score = label.startsWith(q) ? 0
        : command.id.startsWith(q) ? 1
          : label.includes(q) ? 2
            : command.words.includes(q) ? 3 : -1;
      return { command, score };
    })
    .filter((item) => item.score >= 0)
    .sort((a, b) => a.score - b.score)
    .map((item) => item.command);
}

/* ---- Caret geometry ------------------------------------------------------ */
const MIRRORED = [
  'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'letterSpacing',
  'lineHeight', 'textTransform', 'wordSpacing', 'textIndent', 'tabSize', 'direction',
];

function caretPoint(area, index) {
  const style = getComputedStyle(area);
  const mirror = document.createElement('div');
  for (const name of MIRRORED) mirror.style[name] = style[name];
  Object.assign(mirror.style, {
    position: 'absolute', top: '0', left: '-9999px', visibility: 'hidden',
    whiteSpace: 'pre-wrap', overflowWrap: 'break-word', height: 'auto', overflow: 'hidden',
  });
  mirror.textContent = area.value.slice(0, index);
  const mark = document.createElement('span');
  mark.textContent = '​';
  mirror.append(mark);
  document.body.append(mirror);
  const box = area.getBoundingClientRect();
  const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.6;
  const point = {
    left: box.left + mark.offsetLeft - area.scrollLeft,
    top: box.top + mark.offsetTop - area.scrollTop,
    height: line,
  };
  mirror.remove();
  return point;
}

/* ---- Blocks and their lines -------------------------------------------- */
const FENCE_LINE = /^\s*(```|~~~)/;
const MATH_LINE = /^\s*\$\$\s*$/;
const TABLE_LINE = /^\s*\|/;
const LIST_START = /^\s*([-*+]|\d+[.)])\s/;
const indentOf = (line) => line.replace(/\t/g, '    ').match(/^\s*/)[0].length;

// [{ start, end }] in line numbers, end exclusive.
export function blocksOf(value) {
  const lines = value.split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const start = i;
    const line = lines[i];
    if (FENCE_LINE.test(line) || MATH_LINE.test(line)) {
      const closing = FENCE_LINE.test(line) ? FENCE_LINE : MATH_LINE;
      i += 1;
      while (i < lines.length && !closing.test(lines[i])) i += 1;
      i += 1;
    } else if (TABLE_LINE.test(line)) {
      while (i < lines.length && TABLE_LINE.test(lines[i])) i += 1;
    } else if (LIST_START.test(line)) {
      const base = indentOf(line);
      i += 1;
      while (i < lines.length && lines[i].trim() && indentOf(lines[i]) > base) i += 1;
    } else {
      i += 1;
    }
    blocks.push({ start, end: Math.min(i, lines.length) });
  }
  return blocks;
}

// Moves block `from` so it sits before block `to` (blocks.length = the end).
export function moveBlock(value, from, to) {
  const lines = value.split('\n');
  const blocks = blocksOf(value);
  const block = blocks[from];
  if (!block || to < 0 || to > blocks.length || to === from || to === from + 1) return null;
  const moved = lines.slice(block.start, block.end);
  const rest = [...lines.slice(0, block.start), ...lines.slice(block.end)];
  let at = to < blocks.length ? blocks[to].start : lines.length;
  if (at > block.start) at -= moved.length;
  const next = [...rest.slice(0, at), ...moved, ...rest.slice(at)];
  const caret = next.slice(0, at).reduce((sum, line) => sum + line.length + 1, 0);
  return { value: next.join('\n'), caret };
}

const lineStartOffset = (value, line) => value.split('\n').slice(0, line).reduce((sum, text) => sum + text.length + 1, 0);

/* Where each logical line sits inside the textarea, measured once per text
   and width with the same mirror technique as the caret. */
function lineBoxes(area) {
  const style = getComputedStyle(area);
  const mirror = document.createElement('div');
  for (const name of MIRRORED) mirror.style[name] = style[name];
  Object.assign(mirror.style, {
    position: 'absolute', top: '0', left: '-9999px', visibility: 'hidden',
    whiteSpace: 'pre-wrap', overflowWrap: 'break-word', height: 'auto', overflow: 'hidden',
  });
  for (const line of area.value.split('\n')) {
    const row = document.createElement('div');
    row.textContent = line || '​';
    mirror.append(row);
  }
  document.body.append(mirror);
  const boxes = [...mirror.children].map((row) => ({ top: row.offsetTop, height: row.offsetHeight }));
  mirror.remove();
  return boxes;
}

function place(pop, point, { above = false } = {}) {
  const gap = 6;
  const width = pop.offsetWidth;
  const height = pop.offsetHeight;
  const left = Math.max(8, Math.min(point.left, innerWidth - width - 8));
  let top = above ? point.top - height - gap : point.top + point.height + gap;
  if (!above && top + height > innerHeight - 8) top = point.top - height - gap;
  if (above && top < 8) top = point.top + point.height + gap;
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(Math.max(8, top))}px`;
}

/* The gutter's two controls are drawn, not typed: a "+" and a "⋮⋮" set in
   the text font sat on its baseline at its size, small and out of line with
   each other. Both icons share one box and one stroke, centred on the
   block's first line. */
const GUTTER_SIZE = 26;
const GUTTER_ICONS = {
  plus: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  grip: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
};

/* ---- Attach -------------------------------------------------------------- */
export function attachCommands(area, { scroller = null, gutterHost = null } = {}) {
  const menu = el('div', 'nbc-menu');
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', 'Blocks');
  menu.hidden = true;
  const bubble = el('div', 'nbc-bubble');
  bubble.setAttribute('role', 'toolbar');
  bubble.setAttribute('aria-label', 'Format selection');
  bubble.hidden = true;
  document.body.append(menu, bubble);
  // Clicking a popup must not take the caret or the selection out of the text.
  for (const pop of [menu, bubble]) pop.addEventListener('mousedown', (event) => event.preventDefault());

  /* -- Menu -- */
  const state = { open: false, slash: null, items: [], active: 0 };

  function drawMenu() {
    menu.innerHTML = '';
    if (!state.items.length) {
      menu.append(el('p', 'nbc-menu__empty', 'No matching block'));
      return;
    }
    let group = '';
    state.items.forEach((command, index) => {
      if (command.group !== group) {
        group = command.group;
        menu.append(el('p', 'nbc-menu__group', group));
      }
      const item = el('button', 'nbc-item');
      item.type = 'button';
      item.setAttribute('role', 'option');
      item.id = `nbc-${command.id}`;
      item.setAttribute('aria-selected', String(index === state.active));
      item.append(el('span', 'nbc-item__glyph', command.glyph), el('span', 'nbc-item__label', command.label));
      if (command.hint) item.append(el('kbd', 'nbc-item__hint', command.hint));
      item.addEventListener('mouseenter', () => { state.active = index; mark(); });
      item.addEventListener('click', () => choose(command));
      menu.append(item);
    });
    mark();
  }

  function mark() {
    const nodes = menu.querySelectorAll('.nbc-item');
    nodes.forEach((node, index) => node.setAttribute('aria-selected', String(index === state.active)));
    const active = nodes[state.active];
    if (active) {
      area.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView({ block: 'nearest' });
    }
  }

  function openMenu(slash = null) {
    hideBubble();
    state.open = true;
    state.slash = slash;
    state.items = COMMANDS;
    state.active = 0;
    menu.hidden = false;
    area.setAttribute('aria-expanded', 'true');
    drawMenu();
    place(menu, caretPoint(area, area.selectionStart));
  }

  function closeMenu() {
    if (!state.open) return;
    state.open = false;
    state.slash = null;
    menu.hidden = true;
    area.setAttribute('aria-expanded', 'false');
    area.removeAttribute('aria-activedescendant');
  }

  function refreshMenu() {
    if (!state.open || state.slash == null) return;
    const caret = area.selectionStart;
    const query = area.value.slice(state.slash + 1, caret);
    if (area.value[state.slash] !== '/' || caret <= state.slash || /\s/.test(query) || query.length > 24) {
      closeMenu();
      return;
    }
    state.items = matches(query);
    state.active = Math.min(state.active, Math.max(0, state.items.length - 1));
    drawMenu();
    place(menu, caretPoint(area, state.slash));
  }

  function choose(command) {
    if (!command) return;
    if (state.slash != null && area.value[state.slash] === '/') {
      // Take "/query" out first, so the command acts on the line as it was.
      replaceRange(area, state.slash, area.selectionStart, '', state.slash);
    }
    closeMenu();
    command.run(area);
  }

  /* -- Selection toolbar -- */
  const tools = [
    ['B', 'Bold (Ctrl+B)', () => wrapSelection(area, '**'), 'strong'],
    ['I', 'Italic (Ctrl+I)', () => wrapSelection(area, '*'), 'em'],
    ['S', 'Strikethrough', () => wrapSelection(area, '~~'), 's'],
    ['</>', 'Inline code', () => wrapSelection(area, '`'), 'code'],
    ['H', 'Highlight', () => wrapSelection(area, '=='), 'mark'],
    ['∑', 'Inline maths', () => wrapSelection(area, '$'), ''],
    ['|'],
    ['Link', 'Web link (Ctrl+K)', () => link(), ''],
    ['[[ ]]', 'Link to a note', () => wrapSelection(area, '[[', ']]'), ''],
    ['|'],
    ['H2', 'Heading', () => setLinePrefix(area, '## ', area.selectionStart), ''],
    ['❝', 'Quote', () => setLinePrefix(area, '> ', area.selectionStart), ''],
    ['•', 'Bulleted list', () => setLinePrefix(area, '- ', area.selectionStart), ''],
    ['☐', 'To-do', () => setLinePrefix(area, '- [ ] ', area.selectionStart), ''],
  ];
  for (const [text, label, run, look] of tools) {
    if (text === '|') { bubble.append(el('span', 'nbc-bubble__sep')); continue; }
    const button = el('button', 'nbc-tool', text);
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    if (look) button.dataset.look = look;
    button.addEventListener('click', () => { run(); requestAnimationFrame(syncBubble); });
    bubble.append(button);
  }

  // A web link wraps the words and selects the address placeholder, so the
  // next keystrokes (or a paste) replace it.
  function link() {
    const { selectionStart: s, selectionEnd: e, value } = area;
    const chosen = value.slice(s, e) || 'link';
    const text = `[${chosen}](https://)`;
    replaceRange(area, s, e, text, s + chosen.length + 3, s + text.length - 1);
    hideBubble();
  }

  function hideBubble() { bubble.hidden = true; }

  function syncBubble() {
    if (state.open || document.activeElement !== area) { hideBubble(); return; }
    const { selectionStart: s, selectionEnd: e } = area;
    if (s === e || !area.value.slice(s, e).trim()) { hideBubble(); return; }
    bubble.hidden = false;
    const start = caretPoint(area, s);
    const end = caretPoint(area, e);
    // Centred over the selection when it sits on one line, at its start when
    // it runs over several.
    const left = start.top === end.top ? (start.left + end.left) / 2 - bubble.offsetWidth / 2 : start.left;
    place(bubble, { ...start, left }, { above: true });
  }

  /* -- Line gutter -- */
  const gutter = gutterHost ? el('div', 'nbc-gutter') : null;
  const drop = gutterHost ? el('div', 'nbc-drop') : null;
  const geometry = { key: '', boxes: [], blocks: [] };
  let hovered = -1;
  let dragging = null;

  function measure() {
    const key = `${area.clientWidth}:${area.value}`;
    if (geometry.key !== key) {
      geometry.key = key;
      geometry.boxes = lineBoxes(area);
      geometry.blocks = blocksOf(area.value);
    }
    return geometry;
  }

  // Block index under a viewport y, or -1 outside the text.
  function blockAt(y) {
    const { boxes, blocks } = measure();
    const rel = y - area.getBoundingClientRect().top;
    if (rel < 0 || !boxes.length) return -1;
    for (let index = 0; index < blocks.length; index += 1) {
      const last = boxes[blocks[index].end - 1];
      if (rel < last.top + last.height) return index;
    }
    return -1;
  }

  // The boundary (0…blocks.length) nearest a viewport y, for dropping.
  function boundaryAt(y) {
    const { boxes, blocks } = measure();
    const rel = y - area.getBoundingClientRect().top;
    for (let index = 0; index < blocks.length; index += 1) {
      const first = boxes[blocks[index].start];
      const last = boxes[blocks[index].end - 1];
      if (rel < (first.top + last.top + last.height) / 2) return index;
    }
    return blocks.length;
  }

  // Offsets inside the host: the textarea's top plus a line's top.
  const hostTop = () => area.getBoundingClientRect().top - gutterHost.getBoundingClientRect().top;

  function showGutter(index) {
    if (!gutter || dragging) return;
    const { boxes, blocks } = measure();
    const block = blocks[index];
    if (!block || area.hidden || area.readOnly) { hideGutter(); return; }
    hovered = index;
    const first = boxes[block.start];
    const line = parseFloat(getComputedStyle(area).lineHeight) || first.height;
    gutter.hidden = false;
    gutter.style.top = `${Math.round(hostTop() + first.top + (Math.min(line, first.height) - GUTTER_SIZE) / 2)}px`;
    gutter.style.left = `${Math.round(area.offsetLeft - GUTTER_SIZE * 2 - 6)}px`;
  }

  function hideGutter() {
    if (gutter && !dragging) { gutter.hidden = true; hovered = -1; }
  }

  function moveTo(from, to) {
    const result = moveBlock(area.value, from, to);
    if (!result) return;
    replaceRange(area, 0, area.value.length, result.value, result.caret);
    geometry.key = '';
  }

  if (gutter) {
    gutter.hidden = true;
    drop.hidden = true;
    const add = el('button', 'nbc-gutter__btn');
    add.innerHTML = GUTTER_ICONS.plus;
    add.type = 'button';
    add.title = 'Add a block below';
    add.setAttribute('aria-label', 'Add a block below');
    const grip = el('button', 'nbc-gutter__btn nbc-gutter__grip');
    grip.innerHTML = GUTTER_ICONS.grip;
    grip.type = 'button';
    grip.title = 'Drag to move · click to select';
    grip.setAttribute('aria-label', 'Move block');
    gutter.append(add, grip);
    gutterHost.append(gutter, drop);
    for (const node of [gutter, drop]) node.addEventListener('mousedown', (event) => event.preventDefault());

    add.addEventListener('click', () => {
      const block = measure().blocks[hovered];
      if (!block) return;
      const lines = area.value.split('\n');
      const at = lineStartOffset(area.value, block.end - 1) + lines[block.end - 1].length;
      replaceRange(area, at, at, '\n', at + 1);
      hideGutter();
      openMenu();
    });

    grip.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || hovered < 0) return;
      event.preventDefault();
      grip.setPointerCapture(event.pointerId);
      dragging = { from: hovered, startY: event.clientY, moved: false, to: hovered };
    });
    grip.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      if (!dragging.moved && Math.abs(event.clientY - dragging.startY) < 4) return;
      dragging.moved = true;
      gutterHost.dataset.dragging = '';
      if (scroller) {
        const box = scroller.getBoundingClientRect();
        if (event.clientY < box.top + 48) scroller.scrollTop -= 14;
        else if (event.clientY > box.bottom - 48) scroller.scrollTop += 14;
      }
      const to = boundaryAt(event.clientY);
      dragging.to = to;
      const { boxes, blocks } = measure();
      const edge = to < blocks.length ? boxes[blocks[to].start].top : (() => { const last = boxes[boxes.length - 1]; return last.top + last.height; })();
      drop.hidden = false;
      drop.style.top = `${Math.round(hostTop() + edge - 1)}px`;
      drop.style.left = `${area.offsetLeft}px`;
      drop.style.width = `${area.offsetWidth}px`;
    });
    const endDrag = () => {
      if (!dragging) return;
      const { from, to, moved } = dragging;
      dragging = null;
      drop.hidden = true;
      delete gutterHost.dataset.dragging;
      if (moved) {
        moveTo(from, to);
        hideGutter();
        return;
      }
      // A click selects the block, so the toolbar can format all of it.
      const block = measure().blocks[from];
      const lines = area.value.split('\n');
      const start = lineStartOffset(area.value, block.start);
      const end = lineStartOffset(area.value, block.end - 1) + lines[block.end - 1].length;
      area.focus();
      area.setSelectionRange(start, end);
      requestAnimationFrame(syncBubble);
    };
    grip.addEventListener('pointerup', endDrag);
    grip.addEventListener('pointercancel', () => { dragging = null; drop.hidden = true; delete gutterHost.dataset.dragging; });
  }

  const onHover = (event) => {
    if (dragging || gutter.contains(event.target)) return;
    const index = blockAt(event.clientY);
    if (index < 0) hideGutter();
    else if (index !== hovered || gutter.hidden) showGutter(index);
  };
  const onLeave = () => hideGutter();

  /* -- Events -- */
  const onKeydown = (event) => {
    const mod = event.ctrlKey || event.metaKey;
    if (event.altKey && event.shiftKey && !mod && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      const caretLine = area.value.slice(0, area.selectionStart).split('\n').length - 1;
      const blocks = blocksOf(area.value);
      const from = blocks.findIndex((block) => caretLine >= block.start && caretLine < block.end);
      if (from >= 0) moveTo(from, event.key === 'ArrowUp' ? from - 1 : from + 2);
      return;
    }
    if (state.open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopImmediatePropagation();
        const count = state.items.length || 1;
        state.active = (state.active + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
        mark();
        return;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && !event.isComposing) {
        if (!state.items.length) { closeMenu(); return; }
        event.preventDefault();
        event.stopImmediatePropagation();
        choose(state.items[state.active]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeMenu();
        return;
      }
    }
    if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      link();
    } else if (mod && event.key === '/') {
      event.preventDefault();
      openMenu();
    }
  };
  const onInput = (event) => {
    hideBubble();
    if (gutter) hideGutter();
    if (state.open) { refreshMenu(); return; }
    if (event.inputType !== 'insertText' || event.data !== '/') return;
    const at = area.selectionStart - 1;
    const before = at > 0 ? area.value[at - 1] : '\n';
    if (/\s/.test(before)) openMenu(at);
  };
  const onSelect = () => {
    if (state.open && state.slash != null) refreshMenu();
    requestAnimationFrame(syncBubble);
  };
  const onBlur = () => { closeMenu(); hideBubble(); };
  const onScroll = () => {
    if (state.open) place(menu, caretPoint(area, state.slash ?? area.selectionStart));
    if (!bubble.hidden) syncBubble();
  };
  const onOutside = (event) => {
    if (state.open && !menu.contains(event.target) && event.target !== area) closeMenu();
  };

  area.setAttribute('aria-haspopup', 'listbox');
  area.setAttribute('aria-expanded', 'false');
  area.addEventListener('keydown', onKeydown, true);
  area.addEventListener('input', onInput);
  area.addEventListener('mouseup', onSelect);
  area.addEventListener('keyup', onSelect);
  area.addEventListener('blur', onBlur);
  (scroller || window).addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  document.addEventListener('pointerdown', onOutside, true);
  if (gutter) {
    gutterHost.addEventListener('mousemove', onHover);
    gutterHost.addEventListener('mouseleave', onLeave);
  }

  return {
    open() {
      area.focus();
      openMenu();
    },
    close() { closeMenu(); hideBubble(); if (gutter) hideGutter(); },
    destroy() {
      area.removeEventListener('keydown', onKeydown, true);
      area.removeEventListener('input', onInput);
      area.removeEventListener('mouseup', onSelect);
      area.removeEventListener('keyup', onSelect);
      area.removeEventListener('blur', onBlur);
      (scroller || window).removeEventListener('scroll', onScroll);
      removeEventListener('resize', onScroll);
      document.removeEventListener('pointerdown', onOutside, true);
      if (gutter) {
        gutterHost.removeEventListener('mousemove', onHover);
        gutterHost.removeEventListener('mouseleave', onLeave);
        gutter.remove();
        drop.remove();
      }
      menu.remove();
      bubble.remove();
    },
  };
}
