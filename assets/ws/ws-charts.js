/* ==========================================================================
   GRAVITAS+ WORKSPACE  ·  CHART KIT
   Small drawing primitives for the workspace screens: stat tiles, an arc
   gauge, progress rings, horizontal bars, columns and stacked meters.

   Why a kit rather than a library. The repository has no build step and no
   package manager, so a chart dependency would have to be vendored, pinned
   and carried forever for what these screens actually need: proportion,
   ranking and completion. All of that is a rectangle, an arc and a label.
   Everything below is plain DOM and inline SVG, so it runs exactly as it
   sits on disk and inherits the theme instead of re-declaring it.

   Two rules the kit enforces on its callers, because they are the rules
   that keep a dashboard honest:

   DENOMINATOR.  Nothing here draws a proportion without one. `gauge`,
   `ring` and `stackedMeter` all take a total; if the total is zero they
   render the empty state and say so rather than drawing a full circle of
   nothing. A chart that looks the same at "0 of 0" and "12 of 12" is a
   lie told in ink.

   TOKENS.  Colour comes from gravitas.css. The series palette in
   ws-charts.css maps to the brand's accent and its three signal colours,
   so every chart already works in both themes and nothing here needs to
   know which theme is live.
   ========================================================================== */

const SVGNS = 'http://www.w3.org/2000/svg';

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVGNS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function mark(name) {
  const icons = window.GravitasIcons;
  return icons && name ? icons.icon(name, 'g-wi') : '';
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

/* One decimal only when it earns one: "41%" beats "41.0%", and "0.6%" is
   still worth distinguishing from zero. */
function pct(value) {
  const n = clamp(num(value), 0, 100);
  return `${n % 1 ? n.toFixed(1) : Math.round(n)}%`;
}

function share(value, total) {
  const t = num(total);
  if (t <= 0) return 0;
  return clamp((num(value) / t) * 100, 0, 100);
}

/* ==========================================================================
   CARDS AND THE BENTO
   A dashboard card is not a workspace panel: no sunken header bar, no
   hairline between rows, one generous box holding a title and one figure.
   The bento is twelve columns, and a card says how many it takes.

   The reason this lives in the kit rather than in a screen: the first
   version of the dashboard put a panel around every list, and on an account
   with nothing in it the result was five dashed rectangles each apologising
   in a different paragraph. A card knows how to be empty in one line.
   ========================================================================== */

export function card({ title = '', note = '', span = 12, tone = '', action = null } = {}) {
  const box = el('section', 'wc-card');
  if (tone) box.classList.add(`wc-card--${tone}`);
  box.dataset.span = String(span);

  const head = el('div', 'wc-card__head');
  if (title) {
    const heading = el('div');
    heading.append(el('h2', 'wc-card__title', title));
    if (note) heading.append(el('p', 'wc-card__note', note));
    head.append(heading);
    if (action) head.append(action);
    box.append(head);
  }

  const body = el('div', 'wc-card__body');
  box.append(body);
  return { box, body, head };
}

export function bento(cards = []) {
  const grid = el('div', 'wc-bento');
  cards.filter(Boolean).forEach((item) => grid.append(item));
  return grid;
}

/* One line, where a whole empty panel used to be. */
export function note(text) {
  return el('p', 'wc-note', text);
}

export function actions(buttons = []) {
  const strip = el('div', 'wc-actions');
  buttons.filter(Boolean).forEach((button) => strip.append(button));
  return strip;
}

export function list(items = []) {
  const wrap = el('div', 'wc-list');
  items.filter(Boolean).forEach((item) => wrap.append(item));
  return wrap;
}

export function listItem({ title, meta = '', icon = '', series = '', right = null, onClick = null }) {
  const node = el(onClick ? 'button' : 'div', 'wc-item');
  if (onClick) {
    node.type = 'button';
    node.classList.add('wc-item--button');
    node.addEventListener('click', onClick);
  }
  if (series) node.dataset.series = series;

  if (icon) {
    node.classList.add('wc-item--marked');
    const glyph = el('span', 'wc-item__mark');
    glyph.innerHTML = mark(icon);
    node.append(glyph);
  }

  const main = el('div', 'wc-item__main');
  main.append(el('span', 'wc-item__title', title || 'Untitled'));
  if (meta) main.append(el('span', 'wc-item__meta', meta));
  node.append(main);

  if (right) node.append(right);
  return node;
}

/* ==========================================================================
   STAT TILES
   The shape every dashboard converges on: a number large enough to read
   across a desk, the thing it counts underneath it, and — only where the
   payload actually carries a denominator — a hairline meter showing the
   part of it that is finished.
   ========================================================================== */

export function statTile({
  value, label, note = '', icon = '', tone = '', featured = false,
  part = null, total = null, onClick = null,
}) {
  const node = el(onClick ? 'button' : 'div', 'wc-tile');
  if (onClick) {
    node.type = 'button';
    node.addEventListener('click', onClick);
    node.classList.add('wc-tile--button');
  }
  if (featured) node.dataset.featured = 'true';
  if (tone) node.dataset.tone = tone;

  const head = el('div', 'wc-tile__head');
  if (icon) {
    const glyph = el('span', 'wc-tile__icon');
    glyph.innerHTML = mark(icon);
    head.append(glyph);
  }
  head.append(el('span', 'wc-tile__label', label));
  if (onClick) {
    const go = el('span', 'wc-tile__go');
    go.innerHTML = mark('arrow');
    head.append(go);
  }
  node.append(head);

  node.append(el('strong', 'wc-tile__value', String(value ?? 0)));

  if (total != null && num(total) > 0 && part != null) {
    node.append(meter(share(part, total), `${num(part)} of ${num(total)}`));
  } else if (note) {
    node.append(el('small', 'wc-tile__note', note));
  }
  return node;
}

export function statGrid(tiles = []) {
  const grid = el('div', 'wc-tiles');
  tiles.filter(Boolean).forEach((tile) => grid.append(tile));
  return grid;
}

/* A bare proportion bar with its reading beside it. */
export function meter(percentValue, text = '') {
  const wrap = el('div', 'wc-meter');
  const track = el('span', 'wc-meter__track');
  const fill = el('span', 'wc-meter__fill');
  fill.style.setProperty('--wc-fill', `${clamp(num(percentValue), 0, 100)}%`);
  track.append(fill);
  wrap.append(track);
  if (text) wrap.append(el('small', 'wc-meter__text', text));
  return wrap;
}

/* ==========================================================================
   ARC GAUGE
   A 270-degree arc rather than a full ring: the gap at the bottom is where
   the caption goes, and an open arc is harder to misread as a pie of parts
   when it is showing one proportion.

   The arc is drawn with pathLength="100", so the dash array is the
   percentage itself and no radius arithmetic has to agree with the CSS.
   ========================================================================== */

export function gauge({ value, total, label = '', caption = '', empty = 'Nothing tracked yet' }) {
  const wrap = el('figure', 'wc-gauge');
  const box = el('div', 'wc-gauge__plot');

  const frame = svg('svg', { viewBox: '0 0 120 120', class: 'wc-gauge__svg', role: 'img' });
  const ARC = 'M27.47 92.53 A46 46 0 1 1 92.53 92.53';
  frame.append(svg('path', { d: ARC, class: 'wc-gauge__track', pathLength: 100 }));

  const has = num(total) > 0;
  const reached = has ? share(value, total) : 0;

  frame.append(svg('path', {
    d: ARC, class: 'wc-gauge__value', pathLength: 100,
    'stroke-dasharray': `${reached} 100`,
  }));

  const caption_ = svg('title', {});
  caption_.textContent = has ? `${num(value)} of ${num(total)} complete` : empty;
  frame.append(caption_);
  box.append(frame);

  const centre = el('div', 'wc-gauge__centre');
  centre.append(el('strong', 'wc-gauge__value-text', has ? pct(reached) : '—'));
  /* No denominator, no label: "FINISHED" under a dash reads as a figure
     that failed to load rather than as a member with nothing tracked. */
  if (label && has) centre.append(el('span', 'wc-gauge__label', label));
  box.append(centre);

  wrap.append(box);
  wrap.append(el('figcaption', 'wc-gauge__caption', has ? caption : empty));
  return wrap;
}

/* A ring small enough to sit inside a list row. Same pathLength trick. */
export function ring(percentValue, { size = 34, label = '' } = {}) {
  const value = clamp(num(percentValue), 0, 100);
  const wrap = el('div', 'wc-ring');
  wrap.style.setProperty('--wc-ring-size', `${size}px`);

  const frame = svg('svg', { viewBox: '0 0 40 40', class: 'wc-ring__svg', role: 'img' });
  frame.append(svg('circle', { cx: 20, cy: 20, r: 16, class: 'wc-ring__track', pathLength: 100 }));
  frame.append(svg('circle', {
    cx: 20, cy: 20, r: 16, class: 'wc-ring__value', pathLength: 100,
    'stroke-dasharray': `${value} 100`,
  }));
  const title = svg('title', {});
  title.textContent = label || `${pct(value)} complete`;
  frame.append(title);

  wrap.append(frame);
  wrap.append(el('span', 'wc-ring__text', String(Math.round(value))));
  return wrap;
}

/* ==========================================================================
   BARS
   `barRows` ranks named quantities against the largest of them; `columns`
   is the same data stood up, for when the labels are short and ordered
   (days, months, stages). Both scale against the real maximum and print
   the real number, so the bar is a reading aid rather than the reading.
   ========================================================================== */

/* `scaffold` keeps the chart on screen when every value is zero: the labels,
   the empty tracks and the zeros, which is a truthful drawing of an account
   with nothing in it and reads as a chart waiting to fill rather than as a
   feature that failed. Without it an all-zero series collapses to one line
   of text, which is right when the categories themselves are unknown. */
export function barRows(items = [], { emptyText = 'Nothing to chart yet', scaffold = false } = {}) {
  const wrap = el('div', 'wc-bars');
  const rows = items.filter(Boolean);
  const max = Math.max(1, ...rows.map((item) => num(item.value)));

  if (!rows.length || (!scaffold && rows.every((item) => num(item.value) === 0))) {
    wrap.append(el('p', 'wc-empty', emptyText));
    return wrap;
  }

  for (const item of rows) {
    const line = el(item.onClick ? 'button' : 'div', 'wc-bar');
    if (item.onClick) {
      line.type = 'button';
      line.classList.add('wc-bar--button');
      line.addEventListener('click', item.onClick);
    }
    if (item.series) line.dataset.series = item.series;

    line.append(el('span', 'wc-bar__label', item.label));
    const track = el('span', 'wc-bar__track');
    const fill = el('span', 'wc-bar__fill');
    /* A zero stays a zero: no minimum width that would draw a sliver where
       there is nothing. Small non-zero values get 2% so they stay visible. */
    const width = num(item.value) === 0 ? 0 : Math.max(2, (num(item.value) / max) * 100);
    fill.style.setProperty('--wc-fill', `${width}%`);
    track.append(fill);
    line.append(track);
    line.append(el('span', 'wc-bar__value', String(num(item.value))));
    wrap.append(line);
  }
  return wrap;
}

export function columns(items = [], { emptyText = 'Nothing to chart yet', unit = '', scaffold = false } = {}) {
  const wrap = el('div', 'wc-columns');
  const rows = items.filter(Boolean);
  const max = Math.max(1, ...rows.map((item) => num(item.value)));

  if (!rows.length || (!scaffold && rows.every((item) => num(item.value) === 0))) {
    wrap.append(el('p', 'wc-empty', emptyText));
    return wrap;
  }

  const plot = el('div', 'wc-columns__plot');
  for (const item of rows) {
    const col = el('div', 'wc-column');
    if (item.series) col.dataset.series = item.series;
    if (num(item.value) && num(item.value) === max) col.dataset.peak = 'true';

    const track = el('span', 'wc-column__track');
    /* A zero draws nothing at all inside its track. A minimum-height stub
       would read as a small value, and on a seven-day strip the difference
       between "one event" and "none" is the whole point of the chart. */
    if (num(item.value)) {
      const fill = el('span', 'wc-column__fill');
      fill.style.setProperty('--wc-fill', `${Math.max(8, (num(item.value) / max) * 100)}%`);
      fill.append(el('span', 'wc-column__value', `${num(item.value)}${unit}`));
      track.append(fill);
    }
    track.title = `${item.label}: ${num(item.value)}${unit ? ` ${unit}` : ''}`;

    col.append(track, el('span', 'wc-column__label', item.label));
    plot.append(col);
  }
  wrap.append(plot);
  return wrap;
}

/* ==========================================================================
   STACKED METER + LEGEND
   One bar cut into named parts. Used where the parts are the whole story —
   published against pending, one kind of event against another — and a
   second chart would only repeat the first.
   ========================================================================== */

export function stackedMeter(segments = [], { emptyText = 'Nothing yet' } = {}) {
  const parts = segments.filter((item) => num(item.value) > 0);
  const wrap = el('div', 'wc-stack');

  if (!parts.length) {
    wrap.append(el('p', 'wc-empty', emptyText));
    return wrap;
  }

  const total = parts.reduce((sum, item) => sum + num(item.value), 0);
  const bar = el('div', 'wc-stack__bar');
  for (const item of parts) {
    const part = el('span', 'wc-stack__part');
    part.dataset.series = item.series || '1';
    part.style.setProperty('--wc-part', `${(num(item.value) / total) * 100}%`);
    part.title = `${item.label}: ${num(item.value)}`;
    bar.append(part);
  }
  wrap.append(bar);
  wrap.append(legend(parts));
  return wrap;
}

export function legend(items = []) {
  const wrap = el('div', 'wc-legend');
  for (const item of items) {
    const entry = el('span', 'wc-legend__item');
    const dot = el('i', 'wc-legend__dot');
    dot.dataset.series = item.series || '1';
    entry.append(dot, el('span', 'wc-legend__label', item.label));
    if (item.value != null) entry.append(el('span', 'wc-legend__value', String(num(item.value))));
    wrap.append(entry);
  }
  return wrap;
}

export { pct as formatPercent, share as shareOf };
