/* ==========================================================================
   GRAVITAS+ WORKSPACE  ·  ADMIN KIT
   The parts every Platform Admin screen is built from.

   Why a kit. Platform Admin is fourteen screens in four modules
   (ws-admin.js, ws-topic-admin.js, ws-core-links.js and the Nextcloud
   Mirror in ws-nextcloud-native.js), and each module carried its own copy
   of `doc`, `section`, `row`, `field` and `checkbox`. The copies had
   drifted into three looks: `fl-` panels rescued by two adoption sheets,
   Topic admin's own injected <style> with hand-picked rgba borders, and the
   Mirror's `nc-` cards. Fixing the look screen by screen would have let it
   drift again, so the screens now share one set of parts and differ only
   in what they say.

   The parts are the Dashboard's, not new ones. The page head is
   C.pageHead, the grid is C.bento, a box is C.card, a number is
   C.statTile, a list entry is a `wc-item`-shaped row, a control is
   `v-input`, a button is `ws-btn`, tabs are the course screen's
   `flc-tabs`. What the workspace lacked for administration — a field grid,
   a switch, a grant row, a sticky save bar, a nested editor, a message
   thread — lives here and in ws-admin.css, under `adm-` names nothing else
   styles.

   Two rules the kit holds its callers to:

   STATE IS A WORD WITH A TONE.  A status is a badge, and only states an
   administrator acts on (pending, failed, suspended) are tinted. Raw JSON is
   never printed: detail objects go through `kv()`.

   THE SAVE BUTTON IS ALWAYS IN REACH.  A form longer than one screen ends
   in `foot()`, which sticks to the bottom of the view, so changing a field
   at the top never means hunting for the button.
   ========================================================================== */

import * as C from './ws-charts.js?v=20261011-r2';
import { label as platformLabel } from './ws-platform.js?v=20261011-r2';

export const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

export const icon = (name, cls = 'g-wi') => window.GravitasIcons?.icon(name, cls) || '';
export const label = (value) => platformLabel(value || '');
export { C };

export function slugify(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '').trim()
    .replace(/\s+/g, '-').replace(/-+/g, '-');
}

/* ---- Page ---------------------------------------------------------------- */

/* Every admin screen opens the way the four workspaces do: title, one
   sentence, an optional context line on the right and the screen's actions
   on their own row beneath. There is no "CORE / PLATFORM ADMIN" eyebrow any
   more: the breadcrumb above already says it, and no other workspace screen
   repeated its breadcrumb inside the page. */
export function page(host, { title, meta = '', actions = [], mark = null, name = '', detail = '' }) {
  host.innerHTML = '';
  const wrap = el('div', 'ws-doc ws-doc--wide fl-doc adm');
  wrap.append(C.pageHead({ title, meta, mark, name, detail, actions }));
  host.append(wrap);
  return wrap;
}

/* The loading shape is the shape the screen will have: a row of tiles and
   two cards, not seven equal grey slabs. */
export function loading(host, title, { tiles = 4, cards = [8, 4] } = {}) {
  const wrap = page(host, { title });
  const grid = C.bento();
  const tileNodes = Array.from({ length: tiles }, () => el('div', 'fl-skeleton adm-skeleton'));
  grid.append(...(tiles ? C.tileRow(tileNodes) : []));
  for (const span of cards) {
    const card = el('div', 'fl-skeleton adm-skeleton');
    card.dataset.span = String(span);
    card.dataset.tall = '';
    grid.append(card);
  }
  wrap.append(grid);
  return wrap;
}

export function failure(host, title, error, retry) {
  const wrap = page(host, { title });
  const box = card({ title: 'This view could not be loaded', tone: '' });
  box.body.append(C.note(error?.message || 'The server did not return a usable response.'));
  if (retry) box.body.append(C.actions([button('Retry', retry, { solid: true })]));
  wrap.append(C.bento([box.box]));
  return wrap;
}

/* ---- Controls ------------------------------------------------------------ */

export function button(text, handler, { solid = false, tiny = false, danger = false, type = 'button' } = {}) {
  const node = el('button', `ws-btn${solid ? ' ws-btn--solid' : ''}${tiny ? ' ws-btn--tiny' : ''}${danger ? ' ws-btn--danger' : ''}`, text);
  node.type = type;
  if (handler) node.addEventListener('click', handler);
  return node;
}

export function link(go, text, href, options = {}) {
  return button(text, () => go(href), options);
}

export function anchor(text, href, { tiny = false, solid = false, external = true } = {}) {
  const node = el('a', `ws-btn${solid ? ' ws-btn--solid' : ''}${tiny ? ' ws-btn--tiny' : ''}`, text);
  node.href = href || '#';
  if (external) { node.target = '_blank'; node.rel = 'noopener'; }
  return node;
}

export function badge(text, tone = '') {
  const node = el('span', 'v-badge', text);
  if (tone) node.dataset.tone = tone;
  return node;
}

/* Words that name a state somebody has to act on, and the tone each gets.
   Everything else is a neutral label. */
const TONES = {
  pending: 'warn', invited: 'warn', draft: 'warn', waiting_team: 'warn', needs_changes: 'warn', intake: 'warn', review: 'warn', paused: 'warn',
  failed: 'bad', suspended: 'bad', hidden: 'bad', revoked: 'bad', disabled: 'bad', cancelled: 'bad', conflict: 'bad', error: 'bad', high: 'bad',
  active: 'ok', published: 'ok', approved: 'ok', paid: 'ok', resolved: 'ok', completed: 'ok', delivered: 'ok', synced: 'ok',
};

export function stateBadge(value, text = '') {
  const key = String(value || '').toLowerCase();
  return badge(text || label(value), TONES[key] || '');
}

export function input(value = '', type = 'text', placeholder = '') {
  const node = el('input', 'v-input');
  node.type = type;
  if (type !== 'file') node.value = value ?? '';
  if (placeholder) node.placeholder = placeholder;
  return node;
}

export function textarea(value = '', rows = 4, placeholder = '', { code = false } = {}) {
  const node = el('textarea', `v-input${code ? ' adm-code' : ''}`);
  node.value = value ?? '';
  node.rows = rows;
  if (placeholder) node.placeholder = placeholder;
  if (code) node.spellcheck = false;
  return node;
}

export function select(options, value) {
  const node = el('select', 'v-input');
  for (const [optionValue, text] of options) {
    const option = el('option', null, text);
    option.value = optionValue;
    option.selected = String(optionValue) === String(value ?? '');
    node.append(option);
  }
  return node;
}

export function field(text, control, hint = '', { wide = false } = {}) {
  const wrap = el('label', 'adm-field');
  if (wide) wrap.dataset.wide = '';
  wrap.append(el('span', 'adm-field__label', text), control);
  if (hint) wrap.append(el('p', 'adm-field__hint', hint));
  return wrap;
}

export function fields(nodes, cols = '') {
  const grid = el('div', 'adm-fields');
  if (cols) grid.dataset.cols = String(cols);
  nodes.filter(Boolean).forEach((node) => grid.append(node));
  return grid;
}

export function heading(text) {
  return el('h3', 'adm-heading', text);
}

/* An on/off setting. `role="switch"` so a screen reader announces on and
   off rather than checked, which is what the control means. */
export function toggle(checked, title, hint = '') {
  const wrap = el('label', 'adm-switch');
  const text = el('span', 'adm-switch__text');
  text.append(el('span', 'adm-switch__title', title));
  if (hint) text.append(el('span', 'adm-switch__hint', hint));
  const node = el('input', 'adm-toggle');
  node.type = 'checkbox';
  node.setAttribute('role', 'switch');
  node.checked = !!checked;
  wrap.append(text, node);
  return { wrap, input: node };
}

export function switches(items) {
  const box = el('div', 'adm-switches');
  items.filter(Boolean).forEach((item) => box.append(item.wrap || item));
  return box;
}

export function status() {
  const node = el('p', 'v-note');
  node.setAttribute('role', 'status');
  return node;
}

export function setStatus(node, text, tone = '') {
  node.textContent = text;
  if (tone) node.dataset.tone = tone;
  else node.removeAttribute('data-tone');
}

/* The sticky save bar. The status line sits at its far end, so "Saved."
   appears beside the button that caused it. */
export function foot(buttons = [], line = null) {
  const bar = el('div', 'adm-foot');
  buttons.filter(Boolean).forEach((item) => bar.append(item));
  if (line) bar.append(line);
  return bar;
}

export function cardActions(buttons = [], line = null) {
  const bar = el('div', 'adm-card-actions');
  buttons.filter(Boolean).forEach((item) => bar.append(item));
  if (line) bar.append(line);
  return bar;
}

/* A segmented choice for a filter with a handful of values. It replaces a
   select inside a labelled field, which on a toolbar read as a form. */
export function choices(options, value, onChange) {
  const group = el('div', 'v-choices');
  group.setAttribute('role', 'group');
  let current = String(value ?? '');
  const buttons = [];
  for (const [optionValue, text] of options) {
    const node = el('button', 'v-choice', text);
    node.type = 'button';
    node.setAttribute('aria-pressed', String(String(optionValue) === current));
    node.addEventListener('click', () => {
      if (String(optionValue) === current) return;
      current = String(optionValue);
      buttons.forEach(([v, b]) => b.setAttribute('aria-pressed', String(String(v) === current)));
      onChange(current);
    });
    buttons.push([optionValue, node]);
    group.append(node);
  }
  group.value = () => current;
  return group;
}

export function search(placeholder, onInput, delay = 220) {
  const wrap = el('label', 'adm-search');
  wrap.innerHTML = icon('search');
  const node = input('', 'search', placeholder);
  node.setAttribute('aria-label', placeholder);
  let timer = null;
  node.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => onInput(node.value.trim()), delay);
  });
  wrap.append(node);
  return { wrap, input: node };
}

export function toolbar(start = [], end = []) {
  const bar = el('div', 'adm-toolbar');
  start.filter(Boolean).forEach((item) => bar.append(item));
  const tail = end.filter(Boolean);
  if (tail.length) {
    const box = el('div', 'adm-toolbar__end');
    tail.forEach((item) => box.append(item));
    bar.append(box);
  }
  return bar;
}

export function count(n, one, many = `${one}s`) {
  return el('span', 'adm-count', `${n} ${n === 1 ? one : many}`);
}

/* ---- Dialog -------------------------------------------------------------- */

/* A form in a dialog, drawn with the shared ws-action-dialog styles. `build`
   fills the field grid and returns whatever the submit handler needs;
   `onSubmit` throws to keep the dialog open with its message shown, and
   returns to close it. Escape, the backdrop and Cancel all close it.
   Screens used to carry their own copy of this, each a little different. */
export function dialog(title, build, { submit = '', onSubmit = null, danger = false } = {}) {
  document.querySelector('.ws-action-dialog-layer[data-kit-dialog]')?.remove();
  const layer = el('div', 'ws-action-dialog-layer');
  layer.dataset.kitDialog = '';
  const box = el('section', 'ws-action-dialog');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', title);
  const form = el('form', 'ws-action-dialog__body');
  const head = el('div', 'ws-action-dialog__head');
  head.append(el('h2', null, title));
  const grid = el('div', 'ws-action-dialog__grid');
  const line = el('p', 'ws-action-dialog__error');
  line.setAttribute('aria-live', 'polite');
  const bar = el('div', 'ws-action-dialog__actions');
  const close = () => { document.removeEventListener('keydown', onKey); layer.remove(); };
  const onKey = (event) => { if (event.key === 'Escape') close(); };
  const cancel = button(submit ? 'Cancel' : 'Close', close);
  bar.append(cancel);
  let send = null;
  if (submit && onSubmit) {
    send = button(submit, null, { solid: !danger, danger, type: 'submit' });
    bar.append(send);
  }
  const refs = build(grid, { close, line }) || {};
  form.append(head, grid, line, bar);
  box.append(form);
  layer.append(box);
  document.body.append(layer);
  document.addEventListener('keydown', onKey);
  layer.addEventListener('pointerdown', (event) => { if (event.target === layer) close(); });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!send) return;
    line.textContent = '';
    send.disabled = true;
    cancel.disabled = true;
    try {
      await onSubmit(refs, { close, line });
      close();
    } catch (error) {
      line.textContent = error?.data?.messages?.join(' ') || error?.data?.detail || error?.message || 'That did not go through.';
      send.disabled = false;
      cancel.disabled = false;
    }
  });
  queueMicrotask(() => form.querySelector('input:not([type="hidden"]):not([disabled]), select, textarea')?.focus());
  return { close, line };
}

/* ---- Boxes --------------------------------------------------------------- */

export function card({ title = '', note = '', span = 12, tone = '', actions = [] } = {}) {
  const tools = actions.filter(Boolean);
  let action = null;
  if (tools.length) {
    action = el('div');
    tools.forEach((item) => action.append(item));
  }
  const made = C.card({ title, note, span, tone, action });
  return { box: made.box, body: made.body, head: made.head };
}

export function bento(children = []) {
  return C.bento(children.filter(Boolean));
}

export function tiles(list) {
  return C.bento(C.tileRow(list.filter(Boolean)));
}

export const tile = C.statTile;

export function empty(text, actionsList = []) {
  const box = el('div', 'adm-empty');
  box.append(C.note(text));
  const tools = actionsList.filter(Boolean);
  if (tools.length) box.append(C.actions(tools));
  return box;
}

export function initials(name) {
  const parts = String(name || '?').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function avatar(name, { series = '', mark = '', large = false } = {}) {
  const node = el('span', `adm-avatar${large ? ' adm-avatar--lg' : ''}`);
  if (series) node.dataset.series = String(series);
  if (mark) node.innerHTML = icon(mark);
  else node.textContent = initials(name);
  return node;
}

/* One list entry. A row that opens something is a button and carries no
   other buttons; a row with actions is a div and the actions sit at its
   end. That is the whole contract, and it keeps buttons out of buttons. */
export function row({ title, meta = '', body = '', badges = [], lead = null, actions = [], onClick = null, current = false, chevron = true }) {
  const node = el(onClick ? 'button' : 'div', 'adm-row wc-item');
  if (onClick) {
    node.type = 'button';
    node.addEventListener('click', onClick);
  }
  if (current) node.setAttribute('aria-current', 'true');
  if (lead) {
    node.dataset.lead = '';
    node.append(lead);
  }
  const main = el('div', 'adm-row__main');
  main.append(el('span', 'adm-row__title', title || 'Untitled'));
  if (meta) main.append(el('span', 'adm-row__meta', meta));
  if (body) main.append(el('p', 'adm-row__body', body));
  node.append(main);

  const aside = el('div', 'adm-row__aside');
  badges.filter(Boolean).forEach((item) => aside.append(typeof item === 'string' ? badge(item) : item));
  actions.filter(Boolean).forEach((item) => aside.append(item));
  if (onClick && chevron) {
    const go = el('span', 'adm-row__go');
    go.innerHTML = icon('chevron');
    aside.append(go);
  }
  if (aside.childElementCount) node.append(aside);
  return node;
}

export function list(rows = []) {
  const box = el('div', 'adm-list');
  rows.filter(Boolean).forEach((item) => box.append(item));
  return box;
}

/* A nested object inside a form: a module, a lesson, a node. */
export function sub(title, { meta = '', tools = [] } = {}) {
  const box = el('div', 'adm-sub');
  const head = el('div', 'adm-sub__head');
  const name = el('span', 'adm-sub__title', title);
  if (meta) name.append(el('small', null, meta));
  const bar = el('div', 'adm-sub__tools');
  tools.filter(Boolean).forEach((item) => bar.append(item));
  head.append(name, bar);
  box.append(head);
  box.head = head;
  box.titleNode = name;
  return box;
}

/* Up / down / remove for an entry in an ordered list of editors. */
export function orderTools(node, removeText = 'Remove') {
  const up = button('↑', () => { const prev = node.previousElementSibling; if (prev) node.parentNode.insertBefore(node, prev); }, { tiny: true });
  up.setAttribute('aria-label', 'Move up');
  const down = button('↓', () => { const next = node.nextElementSibling; if (next) node.parentNode.insertBefore(next, node); }, { tiny: true });
  down.setAttribute('aria-label', 'Move down');
  const remove = button(removeText, () => node.remove(), { tiny: true, danger: true });
  return [up, down, remove];
}

export function stack(children = []) {
  const box = el('div', 'adm-stack');
  children.filter(Boolean).forEach((item) => box.append(item));
  return box;
}

/* A detail object as small key/value chips. Printing JSON.stringify into a
   row was the old way, and `{"modules":["lms"]}` is not a sentence. */
export function kv(detail) {
  const entries = Object.entries(detail || {}).filter(([, value]) => value !== '' && value != null);
  if (!entries.length) return null;
  const box = el('div', 'adm-kv');
  for (const [key, value] of entries.slice(0, 8)) {
    const chip = el('span');
    const text = Array.isArray(value) ? value.join(', ') : (typeof value === 'object' ? Object.entries(value).map(([k, v]) => `${k}=${v}`).join(' ') : String(value));
    chip.append(el('b', null, `${key.replace(/_/g, ' ')} `), document.createTextNode(text));
    box.append(chip);
  }
  return box;
}

export function defs(pairs) {
  const box = el('dl', 'adm-defs');
  for (const [term, text] of pairs) {
    const line = el('div');
    line.append(el('dt', null, term), el('dd', null, text));
    box.append(line);
  }
  return box;
}

/* ---- Tabs ----------------------------------------------------------------
   The course screen's tab bar, for admin pages too long to read as one
   scroll. `eager` builds every pane up front and only hides the others —
   required inside a form, whose submit reads controls on every tab. The
   open tab is kept in the URL hash, so a reload or a Back lands on it. */
export function tabs(list, build, { name = 'Sections', eager = false, remember = true } = {}) {
  const box = el('section', 'flc-tabbed adm-tabs');
  const bar = el('div', 'flc-tabs');
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', name);
  const panel = el('div', 'flc-tabpanel');
  const panes = new Map();
  const buttons = new Map();
  const keys = list.map(([key]) => key);
  const wanted = remember ? location.hash.replace(/^#/, '') : '';
  let active = keys.includes(wanted) ? wanted : keys[0];

  const makePane = (key) => {
    const pane = el('div', 'flc-tabpanel__pane');
    pane.id = `adm-tab-${key}`;
    pane.setAttribute('role', 'tabpanel');
    pane.setAttribute('aria-labelledby', `adm-tabbtn-${key}`);
    panel.append(pane);
    panes.set(key, pane);
    return pane;
  };

  const fill = async (key, pane) => {
    try {
      const nodes = await build(key);
      pane.replaceChildren(...(Array.isArray(nodes) ? nodes : [nodes]).filter(Boolean));
    } catch (error) {
      pane.replaceChildren(empty(error?.message || 'This section could not be loaded.'));
    }
  };

  const show = (key, memo) => {
    active = key;
    for (const [name2, node] of buttons) {
      const on = name2 === key;
      node.setAttribute('aria-selected', String(on));
      node.tabIndex = on ? 0 : -1;
    }
    if (remember && memo) history.replaceState(history.state, '', `${location.pathname}${location.search}#${key}`);
    let pane = panes.get(key);
    if (!pane) {
      pane = makePane(key);
      pane.append(el('div', 'fl-skeleton adm-skeleton'));
      fill(key, pane);
    }
    for (const [name2, node] of panes) node.hidden = name2 !== key;
  };

  for (const [key, text] of list) {
    const node = el('button', 'flc-tab', text);
    node.type = 'button';
    node.id = `adm-tabbtn-${key}`;
    node.setAttribute('role', 'tab');
    node.setAttribute('aria-controls', `adm-tab-${key}`);
    node.addEventListener('click', () => show(key, true));
    buttons.set(key, node);
    bar.append(node);
  }
  bar.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    let index = keys.indexOf(active);
    if (event.key === 'ArrowRight') index = (index + 1) % keys.length;
    if (event.key === 'ArrowLeft') index = (index - 1 + keys.length) % keys.length;
    if (event.key === 'Home') index = 0;
    if (event.key === 'End') index = keys.length - 1;
    show(keys[index], true);
    buttons.get(keys[index]).focus();
  });

  if (eager) {
    for (const key of keys) {
      const pane = makePane(key);
      const nodes = build(key);
      pane.append(...(Array.isArray(nodes) ? nodes : [nodes]).filter(Boolean));
    }
  }
  box.append(bar, panel);
  show(active, false);
  box.show = (key) => show(key, true);
  return box;
}
