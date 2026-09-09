/* ==========================================================================
   GRAVITAS+ WORKSPACE  ·  COMMAND PALETTE
   Search and every action that has a keyboard route, in one surface.

   It does not animate. Not the box, not the backdrop, not the list. This
   is the single most-repeated interaction in the whole workspace, opened
   dozens of times a day by somebody who already knows what they are going
   to type, and at that frequency a 150ms entrance is not polish: it is a
   150ms delay between the intent and the field, felt every single time.
   Raycast ships no open animation for exactly this reason. Everything else
   in this workspace animates; this is the one place where the right amount
   of motion is none.
   ========================================================================== */

import { availableWorkspaces, sectionsFor } from './ws-nav.js';

const icon = (name) => window.GravitasIcons.icon(name, 'g-wi');

let root = null;
let input = null;
let list = null;
let context = null;
let options = [];
let cursor = 0;
let restoreFocus = null;

/* ---- Actions ------------------------------------------------------------
   Static commands. Pages are searched separately and always rank above
   these when the query matches a title, because a name typed in full is an
   unambiguous request for that page. */

function actions() {
  const page = context.currentPage();
  return [
    {
      group: 'Actions',
      label: 'New page',
      hint: 'Ctrl N',
      icon: 'plus',
      run: async () => {
        const made = await context.api.createPage({ title: 'Untitled', parent: page?.parent || null });
        context.go(`/workspace/page/${made.id}`);
      },
    },
    {
      group: 'Actions',
      label: "Open today's journal",
      hint: 'Ctrl J',
      icon: 'meeting',
      run: async () => {
        const journal = await context.api.openJournal(new Date());
        context.go(`/workspace/page/${journal.id}`);
      },
    },
    {
      group: 'Actions',
      label: 'New task from selection',
      hint: 'Ctrl T',
      icon: 'tasks',
      run: async () => {
        const text = String(getSelection() || '').trim();
        // No selection means no task. Creating an empty one and asking the
        // reader to name it afterwards is a worse outcome than saying no.
        if (!text) return { toast: 'Select some text in a page first.' };

        // Tasks are Core objects and live on the server. There is no local
        // task store on purpose: a second list that only this browser can see
        // would look exactly like the real one and silently disagree with it.
        if (!context.platform.canOpenCore()) {
          return { toast: 'Tasks live in the Core workspace, which this account cannot open.' };
        }
        try {
          await context.platform.call('/operating/tasks/', { method: 'POST', body: { title: text } });
        } catch {
          return { toast: 'The task was not created. The server did not accept it.' };
        }
        context.go('/workspace/core/tasks');
      },
    },
    {
      group: 'Actions',
      label: 'Switch theme',
      icon: 'theme',
      run: () => {
        // Goes through the header control rather than setting the attribute
        // directly, so aria-pressed on that button stays true to the state.
        document.getElementById('ws-theme')?.click();
      },
    },
    ...destinations(),
  ];
}

/* Every section of both workspaces, flattened, and prefixed with the
   workspace it belongs to. Two workspaces have an Overview and a Projects
   each, so an unprefixed list would offer the reader two identical rows and
   no way to tell which is which. Built from the same nav table the index
   tree uses, so a section added there appears here without a second edit. */
function destinations() {
  const out = [{
    group: 'Go to',
    label: 'Home',
    icon: 'home',
    run: () => context.go('/workspace/my-work'),
  }];

  for (const workspace of availableWorkspaces()) {
    for (const section of sectionsFor(workspace.id)) {
      out.push({
        group: 'Go to',
        label: `${workspace.name.replace(' Workspace', '')}: ${section.label}`,
        icon: section.icon,
        run: () => context.go(section.path),
      });
      for (const child of section.children || []) {
        out.push({
          group: 'Go to',
          label: `${workspace.name.replace(' Workspace', '')}: ${child.label}`,
          icon: child.icon,
          run: () => context.go(child.path),
        });
      }
    }
  }
  return out;
}

function compute(query) {
  const q = query.trim().toLowerCase();

  const pages = context.api.search(query).map((hit) => ({
    group: 'Pages',
    label: hit.title,
    hint: hit.hint,
    icon: 'notes',
    run: () => context.go(`/workspace/page/${hit.id}`),
  }));

  // Grouped explicitly rather than by however the array above happens to be
  // ordered. Relying on declaration order printed the "Actions" heading
  // twice the moment an action was added below the navigation entries.
  const GROUP_ORDER = ['Actions', 'Go to'];
  const commands = actions()
    .filter((action) => !q || action.label.toLowerCase().includes(q))
    .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));

  // With no query the palette is a menu, so commands lead. With a query it
  // is a search, so pages lead.
  return q ? [...pages, ...commands] : [...commands, ...pages.slice(0, 5)];
}

/* ---- Rendering ---------------------------------------------------------- */

function draw() {
  list.innerHTML = '';

  if (!options.length) {
    const none = document.createElement('div');
    none.className = 'ws-empty';
    none.style.padding = '28px 16px';

    const title = document.createElement('p');
    title.className = 'ws-empty__title';
    title.textContent = 'No matches';

    const body = document.createElement('p');
    body.className = 'ws-empty__body';
    body.textContent = 'Nothing here goes by that name. Press Enter on a different spelling, or Escape to close.';

    none.append(title, body);
    list.append(none);
    return;
  }

  let lastGroup = null;

  options.forEach((option, index) => {
    if (option.group !== lastGroup) {
      lastGroup = option.group;
      const heading = document.createElement('p');
      heading.className = 'ws-palette__group';
      heading.textContent = option.group;
      list.append(heading);
    }

    const row = document.createElement('button');
    row.className = 'ws-opt';
    row.type = 'button';
    row.id = 'ws-opt-' + index;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(index === cursor));
    if (index === cursor) row.setAttribute('data-active', '');

    const mark = document.createElement('span');
    mark.className = 'ws-opt__icon';
    mark.innerHTML = icon(option.icon || 'notes');

    const label = document.createElement('span');
    label.className = 'ws-opt__label';
    label.textContent = option.label;

    row.append(mark, label);

    if (option.hint) {
      const hint = document.createElement('span');
      hint.className = 'ws-opt__hint';
      hint.textContent = option.hint;
      row.append(hint);
    }

    // Pointer movement, not hover, sets the cursor. With :hover the mouse
    // resting where the list happens to redraw would fight the keyboard for
    // the highlight, and two highlighted rows is worse than a stale one.
    row.addEventListener('pointermove', () => {
      if (cursor === index) return;
      cursor = index;
      paintCursor();
    });
    row.addEventListener('click', () => choose(index));

    list.append(row);
  });

  paintCursor();
}

function paintCursor() {
  const rows = list.querySelectorAll('.ws-opt');
  rows.forEach((row, index) => {
    row.toggleAttribute('data-active', index === cursor);
    row.setAttribute('aria-selected', String(index === cursor));
  });
  input.setAttribute('aria-activedescendant', 'ws-opt-' + cursor);
  rows[cursor]?.scrollIntoView({ block: 'nearest' });
}

async function choose(index) {
  const option = options[index];
  if (!option) return;
  close();
  const result = await option.run();
  if (result?.toast) announce(result.toast);
}

/* A single live region rather than a toast system. There is exactly one
   transient message in this app, and a library for one message is a
   dependency bought at full price for nothing. */
function announce(text) {
  let region = document.getElementById('ws-announce');
  if (!region) {
    region = document.createElement('div');
    region.id = 'ws-announce';
    region.setAttribute('role', 'status');
    region.style.cssText =
      'position:fixed;left:50%;bottom:44px;transform:translateX(-50%);z-index:1000;' +
      'padding:8px 14px;border-radius:6px;font-size:13px;' +
      'background:var(--g-surface-raised);color:var(--g-text);' +
      'border:1px solid var(--g-border);box-shadow:var(--g-shadow);' +
      'opacity:0;transition:opacity 180ms cubic-bezier(.16,1,.3,1)';
    document.body.append(region);
  }
  region.textContent = text;
  requestAnimationFrame(() => { region.style.opacity = '1'; });
  clearTimeout(announce.timer);
  announce.timer = setTimeout(() => { region.style.opacity = '0'; }, 3200);
}

/* ---- Open and close ----------------------------------------------------- */

export function openPalette(prefill = '') {
  if (!root) return;
  restoreFocus = document.activeElement;
  root.hidden = false;
  input.value = prefill;
  options = compute(prefill);
  cursor = 0;
  draw();
  input.focus();
  input.select();
}

function close() {
  if (!root || root.hidden) return;
  root.hidden = true;
  // Focus goes back where it came from. Dropping it on <body> means the next
  // Tab starts from the top of the page, which loses anyone's place.
  restoreFocus?.focus?.();
  restoreFocus = null;
}

/* ---- Mount -------------------------------------------------------------- */

export function mountPalette(ctx) {
  context = ctx;

  root = document.createElement('div');
  root.className = 'ws-palette';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Command palette');

  const box = document.createElement('div');
  box.className = 'ws-palette__box';

  input = document.createElement('input');
  input.className = 'ws-palette__input';
  input.type = 'text';
  input.placeholder = 'Search pages, or type a command';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', 'ws-palette-list');

  list = document.createElement('div');
  list.className = 'ws-palette__list';
  list.id = 'ws-palette-list';
  list.setAttribute('role', 'listbox');

  const foot = document.createElement('div');
  foot.className = 'ws-palette__foot';
  foot.innerHTML =
    '<span><kbd>↑</kbd><kbd>↓</kbd> move</span>' +
    '<span><kbd>Enter</kbd> run</span>' +
    '<span><kbd>Esc</kbd> close</span>';

  box.append(input, list, foot);
  root.append(box);
  document.body.append(root);

  input.addEventListener('input', () => {
    options = compute(input.value);
    cursor = 0;
    draw();
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      cursor = (cursor + 1) % Math.max(1, options.length);   // wraps: a list you can loop is faster than one you cannot
      paintCursor();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      cursor = (cursor - 1 + options.length) % Math.max(1, options.length);
      paintCursor();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(cursor);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });

  // Click outside closes. The test is the backdrop itself, not a bounding
  // box check, so a click that starts inside the box and drags out while
  // selecting text does not close it.
  root.addEventListener('pointerdown', (event) => {
    if (event.target === root) close();
  });

  // Focus trap. Two stops only, so it is a wrap rather than a loop over a
  // list of focusables that changes on every keystroke.
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    input.focus();
  });

  addEventListener('keydown', globalKeys);
}

function globalKeys(event) {
  const mod = event.metaKey || event.ctrlKey;
  if (!mod) return;

  const key = event.key.toLowerCase();

  if (key === 'k') {
    event.preventDefault();
    root.hidden ? openPalette() : close();
    return;
  }

  // The rest only fire when the palette is closed, so Ctrl N inside the
  // search field does not create a page behind the reader's back.
  if (!root.hidden) return;

  if (key === 'n') { event.preventDefault(); runByLabel('New page'); }
  else if (key === 'j') { event.preventDefault(); runByLabel("Open today's journal"); }
  else if (key === 't') { event.preventDefault(); runByLabel('New task from selection'); }
}

async function runByLabel(label) {
  const found = actions().find((action) => action.label === label);
  if (!found) return;
  const result = await found.run();
  if (result?.toast) announce(result.toast);
}
