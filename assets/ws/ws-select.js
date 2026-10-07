/* ==========================================================================
   GRAVITAS+ WORKSPACE  ·  SELECT
   One Gravitas-styled option list for every <select> in the workspace.

   The list a browser draws for <select> belongs to the operating system: on
   Windows it opened as a white-on-blue strip as wide as the control, in no
   colour or type the rest of the workspace uses, and CSS cannot reach it
   outside the newest Chromium. So the list is drawn here.

   The first attempt wrapped each <select> in a custom button. That needed a
   call at every one of the dozens of places a <select> is built, changed the
   DOM those places lay out with CSS, and left the button showing a stale
   label whenever code set `.value` directly. So this version replaces only
   the popup. The native <select> stays visible as the closed control, with
   its own styling, layout and value; a mousedown or opening key on it is
   intercepted at the document and our list opens beneath it instead.
   Choosing an entry sets `selectedIndex` and fires bubbling `input` and
   `change`, so every caller keeps working without knowing this exists, and
   a <select> rendered tomorrow is covered without being registered.

   Left native on purpose: multi-selects and size>1 lists, which have no
   popup, and touch input, where the phone's own picker is the better tool.

   The list is a `popover` so it sits in the top layer: a <select> inside a
   modal <dialog> would otherwise open its list underneath the dialog.
   ========================================================================== */

const icon = (name, cls) => window.GravitasIcons?.icon(name, cls) || '';
const canPopover = typeof HTMLElement !== 'undefined'
  && typeof HTMLElement.prototype.showPopover === 'function';
const OPEN_KEYS = new Set(['Enter', ' ', 'ArrowDown', 'ArrowUp']);

let current = null;
let lastPointer = 'mouse';
let seq = 0;

const eligible = (node) => node instanceof HTMLSelectElement
  && !node.multiple && !(node.size > 1) && !node.disabled
  && !node.closest('[data-native-select]');

function close({ refocus = false } = {}) {
  if (!current) return;
  const { select, pop } = current;
  current = null;
  select.removeAttribute('aria-expanded');
  select.removeAttribute('aria-activedescendant');
  select.classList.remove('is-ws-select-open');
  if (canPopover) { try { pop.hidePopover(); } catch { /* already gone */ } }
  pop.remove();
  if (refocus) select.focus({ preventScroll: true });
}

function highlight(index) {
  if (!current) return;
  const rows = current.rows;
  if (!rows.length) return;
  let next = Math.max(0, Math.min(rows.length - 1, index));
  // Step over disabled rows in the direction of travel.
  const step = next >= current.active ? 1 : -1;
  while (rows[next] && rows[next].getAttribute('aria-disabled') === 'true') next += step;
  if (!rows[next]) return;
  current.active = next;
  rows.forEach((row, i) => row.classList.toggle('is-active', i === next));
  current.select.setAttribute('aria-activedescendant', rows[next].id);
  rows[next].scrollIntoView({ block: 'nearest' });
}

function choose(rowIndex) {
  if (!current) return;
  const { select, rows } = current;
  const row = rows[rowIndex];
  close({ refocus: true });
  if (!row || row.getAttribute('aria-disabled') === 'true') return;
  const index = Number(row.dataset.index);
  if (select.selectedIndex === index) return;
  select.selectedIndex = index;
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function place() {
  if (!current) return;
  const { select, pop } = current;
  const box = select.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  pop.style.minWidth = `${Math.round(box.width)}px`;
  pop.style.maxWidth = `${Math.max(box.width, Math.min(360, vw - 32))}px`;
  const below = vh - box.bottom - 12;
  const above = box.top - 12;
  const up = below < 180 && above > below;
  pop.style.maxHeight = `${Math.min(320, Math.max(120, up ? above : below))}px`;
  const height = pop.offsetHeight;
  const width = pop.offsetWidth;
  const left = Math.max(8, Math.min(box.left, vw - width - 8));
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(up ? box.top - height - 6 : box.bottom + 6)}px`;
  pop.classList.toggle('is-up', up);
}

function open(select) {
  if (current?.select === select) return;
  close();
  const id = `ws-select-${++seq}`;
  const pop = document.createElement('div');
  pop.className = 'ws-select-pop';
  pop.id = id;
  pop.setAttribute('role', 'listbox');
  const name = select.getAttribute('aria-label') || select.labels?.[0]?.textContent?.trim();
  if (name) pop.setAttribute('aria-label', name);
  if (canPopover) pop.popover = 'manual';

  const rows = [];
  const addOption = (option) => {
    if (option.hidden) return;
    const row = document.createElement('div');
    row.className = 'ws-select-pop__option';
    row.id = `${id}-${option.index}`;
    row.dataset.index = String(option.index);
    row.setAttribute('role', 'option');
    const selected = option.index === select.selectedIndex;
    row.setAttribute('aria-selected', String(selected));
    if (option.disabled || option.parentElement?.disabled) row.setAttribute('aria-disabled', 'true');
    const text = document.createElement('span');
    text.textContent = option.textContent;
    row.append(text);
    if (selected) row.insertAdjacentHTML('beforeend', icon('check', 'g-wi ws-select-pop__check'));
    const rowIndex = rows.length;
    row.addEventListener('click', () => choose(rowIndex));
    row.addEventListener('pointermove', () => { if (current && current.active !== rowIndex) highlight(rowIndex); });
    rows.push(row);
    pop.append(row);
  };
  for (const child of select.children) {
    if (child instanceof HTMLOptGroupElement) {
      const head = document.createElement('div');
      head.className = 'ws-select-pop__group';
      head.setAttribute('role', 'presentation');
      head.textContent = child.label;
      pop.append(head);
      for (const option of child.children) if (option instanceof HTMLOptionElement) addOption(option);
    } else if (child instanceof HTMLOptionElement) {
      addOption(child);
    }
  }
  if (!rows.length) return;
  // Keep focus on the <select> while the list is clicked.
  pop.addEventListener('pointerdown', (event) => event.preventDefault());

  (canPopover ? document.body : (select.closest('dialog') || document.body)).append(pop);
  if (canPopover) pop.showPopover();
  current = { select, pop, rows, active: -1, typed: '', typedAt: 0 };
  select.setAttribute('aria-expanded', 'true');
  select.setAttribute('aria-controls', id);
  select.classList.add('is-ws-select-open');
  place();
  const chosen = rows.findIndex((row) => row.getAttribute('aria-selected') === 'true');
  highlight(chosen < 0 ? 0 : chosen);
}

function jump(key) {
  const now = Date.now();
  current.typed = now - current.typedAt > 700 ? key : current.typed + key;
  current.typedAt = now;
  const { rows, active } = current;
  for (let step = 1; step <= rows.length; step += 1) {
    const index = (active + step) % rows.length;
    if (rows[index].textContent.trim().toLowerCase().startsWith(current.typed)) {
      highlight(index);
      return;
    }
  }
}

export function installSelects() {
  if (document.documentElement.dataset.wsSelects) return;
  document.documentElement.dataset.wsSelects = '1';

  document.addEventListener('pointerdown', (event) => {
    lastPointer = event.pointerType || 'mouse';
    if (current && !current.pop.contains(event.target) && event.target !== current.select) close();
  }, true);

  document.addEventListener('mousedown', (event) => {
    const select = event.target instanceof Element && event.target.closest('select');
    if (!eligible(select) || lastPointer === 'touch' || event.button !== 0) return;
    event.preventDefault();
    select.focus({ preventScroll: true });
    if (current?.select === select) close();
    else open(select);
  }, true);

  document.addEventListener('keydown', (event) => {
    const select = event.target;
    if (!eligible(select)) return;
    const { key } = event;
    if (current?.select !== select) {
      if (OPEN_KEYS.has(key) || (event.altKey && key === 'ArrowDown')) {
        event.preventDefault();
        open(select);
      }
      return;
    }
    if (key === 'ArrowDown') { event.preventDefault(); highlight(current.active + 1); }
    else if (key === 'ArrowUp') { event.preventDefault(); highlight(current.active - 1); }
    else if (key === 'Home' || key === 'PageUp') { event.preventDefault(); highlight(0); }
    else if (key === 'End' || key === 'PageDown') { event.preventDefault(); highlight(current.rows.length - 1); }
    else if (key === 'Enter' || key === ' ') { event.preventDefault(); choose(current.active); }
    else if (key === 'Escape') { event.preventDefault(); event.stopPropagation(); close({ refocus: true }); }
    else if (key === 'Tab') close();
    else if (key.length === 1 && /\S/.test(key) && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      jump(key.toLowerCase());
    }
  }, true);

  document.addEventListener('focusout', (event) => {
    if (current && event.target === current.select) {
      setTimeout(() => { if (current && document.activeElement !== current.select) close(); });
    }
  });
  // A list pinned to a control that has moved is worse than no list.
  document.addEventListener('scroll', (event) => {
    if (current && !current.pop.contains(event.target)) close();
  }, true);
  window.addEventListener('resize', () => close());
  window.addEventListener('hashchange', () => close());
}
