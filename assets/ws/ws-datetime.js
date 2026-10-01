/* ==========================================================================
   DATE-TIME FIELD
   A due-date control drawn by the workspace instead of by the browser.

   The course plan and the lesson composer used <input type="datetime-local">.
   The field itself takes CSS, but the popup it opens does not: Chrome paints
   its own grey calendar with a separate AM/PM wheel in a system font, and no
   selector, pseudo-element or color-scheme setting reaches inside it. It was
   the one surface in the workspace the brand could not touch, and it looked
   like it — a different grey from every panel, a different type, a twelve-hour
   clock beside a twenty-four-hour app. Firefox and Safari each draw another,
   so there was not even one foreign picker to get used to.

   So the popup is ours. What is kept from the native control is its contract:
   the element this returns answers `.value` and `.hidden` and fires `change`,
   and the value is the same local "YYYY-MM-DDTHH:MM" string datetime-local
   produced, so a call site that did `new Date(due.value).toISOString()` keeps
   working unchanged. Empty means no date, as before.

   The popover is appended to <body> and positioned fixed against the trigger
   rather than nested in it, because the panels it sits in clip overflow and a
   calendar cut off at a card edge is worse than the native one. It flips above
   the trigger when there is no room below and is clamped to the viewport.

   Picking a day does not close it, because a due date usually wants a time
   too; Done, Escape or a click outside does. Time is twenty-four-hour, as
   everywhere else in the workspace. The week starts on Monday unless the
   browser reports a locale that says otherwise.
   ==========================================================================*/

const pad = (n) => String(n).padStart(2, '0');
const glyph = (name) => window.GravitasIcons?.icon(name, 'g-wi') || '';
const DEFAULT_TIME = [9, 0];

const weekStart = (() => {
  try {
    const info = new Intl.Locale(navigator.language).weekInfo
      || new Intl.Locale(navigator.language).getWeekInfo?.();
    if (info?.firstDay) return info.firstDay % 7; /* 1 = Monday … 7 = Sunday */
  } catch { /* older engines: fall through */ }
  return 1;
})();

const sameDay = (a, b) => a && b
  && a.getFullYear() === b.getFullYear()
  && a.getMonth() === b.getMonth()
  && a.getDate() === b.getDate();

function parse(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(value || ''));
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || DEFAULT_TIME[0]), +(m[5] || DEFAULT_TIME[1]));
  return Number.isNaN(d.getTime()) ? null : d;
}

const serialise = (d) => d
  ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  : '';

function display(d) {
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return `${d.toLocaleDateString('en-GB', opts)} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

function button(cls, text, label) {
  const node = el('button', cls, text);
  node.type = 'button';
  if (label) node.setAttribute('aria-label', label);
  return node;
}

/* One popover at a time: opening a second field closes the first. */
let openField = null;

export function dateTimeField({ placeholder = 'Due date', className = 'v-input fl-input' } = {}) {
  let value = null;   /* the committed Date, or null */
  let view = null;    /* first of the month on screen */
  let focusDay = null;
  let pop = null;
  /* A field removed while open (the panel redraws whole after a save) must not
     leave its popover floating over the next render. */
  const watch = new MutationObserver(() => { if (pop && !root.isConnected) close(); });

  const root = el('div', `ws-dt ${className}`.trim());
  const trigger = button('ws-dt__trigger');
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  const icon = el('span', 'ws-dt__icon');
  icon.innerHTML = glyph('meeting');
  const text = el('span', 'ws-dt__text');
  trigger.append(icon, text);
  const clear = button('ws-dt__clear', null, 'Clear date');
  clear.innerHTML = glyph('close');
  root.append(trigger, clear);

  const paint = () => {
    text.textContent = value ? display(value) : placeholder;
    root.toggleAttribute('data-empty', !value);
    clear.hidden = !value;
  };

  const commit = (next, { silent = false } = {}) => {
    const before = serialise(value);
    value = next ? new Date(next) : null;
    paint();
    if (!silent && serialise(value) !== before) {
      root.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };

  Object.defineProperty(root, 'value', {
    get: () => serialise(value),
    set: (v) => commit(parse(v), { silent: true }),
  });

  /* ---- popover ---------------------------------------------------------- */

  const place = () => {
    if (!pop) return;
    const r = trigger.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const gap = 6;
    const room = window.innerHeight - r.bottom;
    const top = room >= h + gap + 8 || r.top < h + gap + 8
      ? Math.min(r.bottom + gap, window.innerHeight - h - 8)
      : r.top - h - gap;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    pop.style.top = `${Math.max(8, top)}px`;
    pop.style.left = `${Math.max(8, left)}px`;
  };

  const onOutside = (event) => {
    if (pop && !pop.contains(event.target) && !root.contains(event.target)) close();
  };

  function close({ focus = false } = {}) {
    if (!pop) return;
    pop.remove();
    pop = null;
    openField = null;
    trigger.setAttribute('aria-expanded', 'false');
    watch.disconnect();
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('resize', place);
    window.removeEventListener('scroll', place, true);
    if (focus) trigger.focus();
  }

  function open() {
    if (openField && openField !== close) openField();
    openField = close;
    const base = value || new Date();
    view = new Date(base.getFullYear(), base.getMonth(), 1);
    focusDay = new Date(base.getFullYear(), base.getMonth(), base.getDate());

    pop = el('div', 'ws-dt-pop');
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Choose date and time');
    pop.addEventListener('keydown', onKey);
    document.body.append(pop);
    draw();
    trigger.setAttribute('aria-expanded', 'true');
    watch.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    pop.querySelector('.ws-dt-pop__day[tabindex="0"]')?.focus();
  }

  const pick = (day) => {
    const [h, m] = value ? [value.getHours(), value.getMinutes()] : DEFAULT_TIME;
    commit(new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m));
    focusDay = new Date(day);
    if (day.getMonth() !== view.getMonth() || day.getFullYear() !== view.getFullYear()) {
      view = new Date(day.getFullYear(), day.getMonth(), 1);
    }
    draw();
  };

  function draw() {
    if (!pop) return;
    pop.innerHTML = '';
    const today = new Date();

    const head = el('div', 'ws-dt-pop__head');
    const prev = button('ws-dt-pop__nav ws-dt-pop__nav--prev', null, 'Previous month');
    prev.innerHTML = glyph('chevron');
    const next = button('ws-dt-pop__nav', null, 'Next month');
    next.innerHTML = glyph('chevron');
    const title = el('strong', 'ws-dt-pop__title',
      view.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }));
    title.setAttribute('aria-live', 'polite');
    prev.addEventListener('click', () => shiftMonth(-1));
    next.addEventListener('click', () => shiftMonth(1));
    head.append(prev, title, next);

    const grid = el('div', 'ws-dt-pop__grid');
    grid.setAttribute('role', 'grid');
    for (let i = 0; i < 7; i += 1) {
      const wd = new Date(2024, 0, 7 + ((weekStart + i) % 7)); /* 7 Jan 2024 is a Sunday */
      const cell = el('span', 'ws-dt-pop__wd', wd.toLocaleDateString('en-GB', { weekday: 'narrow' }));
      cell.title = wd.toLocaleDateString('en-GB', { weekday: 'long' });
      grid.append(cell);
    }
    const lead = (view.getDay() - weekStart + 7) % 7;
    const start = new Date(view.getFullYear(), view.getMonth(), 1 - lead);
    for (let i = 0; i < 42; i += 1) {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const cell = button('ws-dt-pop__day', String(day.getDate()),
        day.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
      if (day.getMonth() !== view.getMonth()) cell.dataset.outside = '';
      if (sameDay(day, today)) cell.dataset.today = '';
      if (sameDay(day, value)) {
        cell.dataset.selected = '';
        cell.setAttribute('aria-pressed', 'true');
      }
      cell.tabIndex = sameDay(day, focusDay) ? 0 : -1;
      cell.dataset.date = serialise(day).slice(0, 10);
      cell.addEventListener('click', () => pick(day));
      grid.append(cell);
    }

    const time = el('div', 'ws-dt-pop__time');
    const tLabel = el('span', 'ws-dt-pop__label', 'Time');
    const hours = timeInput('Hours', value ? value.getHours() : DEFAULT_TIME[0], 23, 1);
    const minutes = timeInput('Minutes', value ? value.getMinutes() : DEFAULT_TIME[1], 59, 5);
    const setTime = () => {
      const base = value || focusDay || new Date();
      commit(new Date(base.getFullYear(), base.getMonth(), base.getDate(),
        +hours.value, +minutes.value));
      if (!pop.querySelector('[data-selected]')) draw();
    };
    hours.addEventListener('change', setTime);
    minutes.addEventListener('change', setTime);
    const sep = el('span', 'ws-dt-pop__colon', ':');
    const quick = el('div', 'ws-dt-pop__quick');
    [['Today', 0], ['Tomorrow', 1], ['Next week', 7]].forEach(([name, offset]) => {
      const chip = button('ws-dt-pop__chip', name);
      chip.addEventListener('click', () => {
        const d = new Date();
        pick(new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset));
      });
      quick.append(chip);
    });
    time.append(tLabel, hours, sep, minutes);

    const foot = el('div', 'ws-dt-pop__foot');
    const clr = button('ws-dt-pop__link', 'Clear');
    clr.addEventListener('click', () => { commit(null); close({ focus: true }); });
    const done = button('ws-btn ws-btn--solid ws-dt-pop__done', 'Done');
    done.addEventListener('click', () => close({ focus: true }));
    foot.append(clr, done);

    pop.append(head, grid, quick, time, foot);
    place();
  }

  function timeInput(label, initial, max, step) {
    const input = el('input', 'ws-dt-pop__num');
    input.inputMode = 'numeric';
    input.maxLength = 2;
    input.setAttribute('aria-label', label);
    input.value = pad(initial);
    const normalise = () => {
      const n = Math.min(max, Math.max(0, parseInt(input.value, 10) || 0));
      input.value = pad(n);
    };
    input.addEventListener('focus', () => input.select());
    input.addEventListener('blur', normalise);
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      event.stopPropagation();
      const n = parseInt(input.value, 10) || 0;
      const delta = event.key === 'ArrowUp' ? step : -step;
      input.value = pad((Math.round((n + delta) / step) * step + max + 1) % (max + 1));
      input.dispatchEvent(new Event('change'));
    });
    input.addEventListener('change', normalise);
    return input;
  }

  function shiftMonth(delta) {
    view = new Date(view.getFullYear(), view.getMonth() + delta, 1);
    const last = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
    focusDay = new Date(view.getFullYear(), view.getMonth(), Math.min(focusDay.getDate(), last));
    draw();
  }

  function onKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close({ focus: true });
      return;
    }
    const onDay = event.target.classList?.contains('ws-dt-pop__day');
    if (!onDay) return;
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (event.key in moves || event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault();
      if (event.key === 'PageUp' || event.key === 'PageDown') {
        shiftMonth(event.key === 'PageUp' ? -1 : 1);
      } else {
        focusDay = new Date(focusDay.getFullYear(), focusDay.getMonth(), focusDay.getDate() + moves[event.key]);
        view = new Date(focusDay.getFullYear(), focusDay.getMonth(), 1);
        draw();
      }
      pop.querySelector(`.ws-dt-pop__day[data-date="${serialise(focusDay).slice(0, 10)}"]`)?.focus();
    }
  }

  trigger.addEventListener('click', () => (pop ? close() : open()));
  clear.addEventListener('click', () => { commit(null); close(); trigger.focus(); });

  paint();
  return root;
}
