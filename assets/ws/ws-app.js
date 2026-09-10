/* ==========================================================================
   GRAVITAS+ WORKSPACE  ·  SHELL
   Home plus three workspaces — Core, Research and Knowledge — in a three
   pane shell.

   The structure is the platform's own: same sections, same routes, same
   access rules, same backend. The old shell put a flat list of links in a
   sidebar and rebuilt the page under it; this one puts the sections in an
   index tree beside a document pane, with a command palette over the top,
   which is the shape the reference mockups asked for.

   Two things are added rather than restyled. Core's Assets & Blueprints
   section, which the backend has always served and no screen ever drew, and
   the Knowledge workspace, which is where learning happens: sources,
   distilled notes, a recall queue and the skills they add up to.

   Rendering is direct DOM work, no framework and no build step, which is the
   repository's standing constraint. The discipline that makes that
   survivable: every view owns one container and redraws it whole from state.
   ========================================================================== */

import * as api from './ws-api.js';
import * as P from './ws-platform.js';
import * as views from './ws-views.js';
import * as assets from './ws-core-assets.js';
import * as kms from './ws-kms-views.js';
import {
  areaOf, sectionsFor, activeSection, titleFor,
  WORKSPACES, availableWorkspaces, spaceOf,
} from './ws-nav.js';
import { renderDashboard, stopClock } from './ws-home.js';
import { renderSettings } from './ws-settings.js';
import { mountPalette, openPalette } from './ws-palette.js';
import { mountAssistant, focusAssistant, askAssistant } from './ws-ai.js';

const icon = (name, cls) => window.GravitasIcons.icon(name, cls || 'g-wi');
const $ = (sel, root = document) => root.querySelector(sel);

const ui = {
  /* True until the platform has answered for the first time.
     The shell used to paint before bootstrap resolved, which meant Home ran
     its "could not load your workspaces" branch and the rail drew without
     Core, because neither had any data yet. On a fast connection that was a
     flash; on a slow one it sat there looking like a failure until something
     else forced a redraw. Views read this and show their loading state
     instead of their failure state. A screen that does not know yet must
     never claim that something went wrong. */
  booting: true,
  area: 'home',
  route: null,
  dockTab: 'tasks',
  index: true,
  dock: true,
  openSections: new Set(),
  openNodes: new Set(['dossiers', 'd-cu', 'method', 'journal', 'c-decisions', 'c-standards', 'k-concepts', 'k-methods']),
  nodes: [],
  page: null,
  pagesById: {},
  save: 'saved',
  calMonth: new Date(),
  selectedDay: new Date(),
};

/* ---- Layout memory ------------------------------------------------------
   Per person, so it lives in this browser. Every access is wrapped: a
   browser set to block site data throws on read rather than returning null,
   and an unguarded read there takes the whole shell down. */

const PREFS = 'gravitas.ws.prefs.v5';
const readPrefs = () => {
  try { return JSON.parse(localStorage.getItem(PREFS) || '{}'); } catch { return {}; }
};
const writePrefs = (patch) => {
  try { localStorage.setItem(PREFS, JSON.stringify({ ...readPrefs(), ...patch })); } catch { /* optional */ }
};

/* ==========================================================================
   ROUTING
   Real paths. Every route the previous workspace published still resolves to
   the same screen, so links and bookmarks keep working.
   ========================================================================== */

const ROUTES = [
  [/^\/workspace\/?$/,                              () => ({ view: 'home' })],
  [/^\/workspace\/my-work\/?$/,                     () => ({ view: 'home' })],

  [/^\/workspace\/core\/?$/,                        () => ({ view: 'core' })],
  [/^\/workspace\/core\/tasks\/?$/,                 () => ({ view: 'core-tasks' })],
  [/^\/workspace\/core\/content\/?$/,               () => ({ view: 'core-content' })],
  [/^\/workspace\/core\/notes\/?$/,                 () => ({ view: 'core-notes' })],
  [/^\/workspace\/core\/team\/?$/,                  () => ({ view: 'core-team' })],
  // The blueprint route is matched before the library it lives under, or the
  // library's own pattern would swallow it.
  [/^\/workspace\/core\/assets\/content-studio-blueprint\/?$/, () => ({ view: 'core-blueprint' })],
  [/^\/workspace\/core\/assets\/?$/,                () => ({ view: 'core-assets' })],
  [/^\/workspace\/operating(?:\/.*)?$/,             () => ({ view: 'core-planning' })],

  [/^\/workspace\/kms\/?$/,                         () => ({ view: 'kms' })],
  [/^\/workspace\/kms\/paths\/([^/]+)\/?$/,         (m) => ({ view: 'kms-path', id: m[1] })],
  [/^\/workspace\/kms\/paths\/?$/,                  () => ({ view: 'kms-paths' })],
  [/^\/workspace\/kms\/sources\/?$/,                () => ({ view: 'kms-sources' })],
  [/^\/workspace\/kms\/base\/?$/,                   () => ({ view: 'kms-base' })],
  [/^\/workspace\/kms\/recall\/?$/,                 () => ({ view: 'kms-recall' })],
  [/^\/workspace\/kms\/skills\/?$/,                 () => ({ view: 'kms-skills' })],

  [/^\/workspace\/research\/?$/,                    () => ({ view: 'research' })],
  [/^\/workspace\/research\/projects\/(\d+)\/?$/,   (m) => ({ view: 'project', id: m[1] })],
  [/^\/workspace\/research\/projects\/?$/,          () => ({ view: 'projects' })],
  [/^\/workspace\/research\/files\/?$/,             () => ({ view: 'resources', kind: 'file' })],
  [/^\/workspace\/research\/datasets\/?$/,          () => ({ view: 'resources', kind: 'dataset' })],
  [/^\/workspace\/research\/mindmaps\/?$/,          () => ({ view: 'mindmaps' })],
  [/^\/workspace\/research\/notes\/?$/,             () => ({ view: 'notes' })],
  [/^\/workspace\/research\/nextcloud\/?$/,         () => ({ view: 'collaboration' })],

  [/^\/workspace\/people\/?$/,                      () => ({ view: 'people' })],
  [/^\/workspace\/community\/?$/,                   () => ({ view: 'community' })],
  [/^\/workspace\/shared\/?$/,                      () => ({ view: 'shared' })],
  [/^\/workspace\/settings\/?$/,                    () => ({ view: 'settings' })],

  [/^\/workspace\/page\/([^/]+)\/?$/,               (m) => ({ view: 'editor', pageId: m[1] })],
  [/^\/workspace\/folder\/([^/]+)\/?$/,             (m) => ({ view: 'folder', folderId: m[1] })],
];

/* The inverse of ws-nav's spaceOf. Kept next to the router because the
   router is the only place that has to go this way: from a page's space
   back to the workspace whose index should be open around it. */
const AREA_OF_SPACE = { core: 'core', research: 'research', kms: 'kms' };

function parse(path) {
  for (const [pattern, build] of ROUTES) {
    const match = path.match(pattern);
    if (match) return build(match);
  }
  return { view: 'home' };
}

export function go(path, { replace = false } = {}) {
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  dispatchEvent(new CustomEvent('ws:navigate'));
  apply(path);
}

async function apply(path) {
  const route = parse(path);

  /* Core is refused rather than merely hidden. Someone can arrive on a Core
     URL from an old bookmark or a shared link without being a member, and
     the honest answer is to send them to the workspace they can open, not
     to render an empty Core screen. */
  if (areaOf(path).startsWith('core') && !P.canOpenCore() && P.platform.boot) {
    go('/workspace/research', { replace: true });
    return;
  }

  ui.route = route;
  ui.pageId = route.pageId || null;
  ui.folderId = route.folderId || null;

  /* A page URL carries no workspace, so the area is read off the page
     itself. Without this, opening a Core meeting note from search dropped
     the reader into the Research index with none of its rows lit, and the
     rail claimed they had changed workspace. The page decides, because the
     page is the thing they asked for. */
  ui.area = areaOf(path);
  const held = route.pageId || route.folderId;
  if (held) ui.area = AREA_OF_SPACE[api.spaceOfNode(ui.nodes, held)] || ui.area;

  // Keep the section containing the current route open in the index.
  const { section } = activeSection(ui.area, path);
  if (section) ui.openSections.add(section.id);

  if (route.view === 'editor' && route.pageId) {
    ui.page = await api.page(route.pageId);
    if (!ui.page) {
      const node = ui.nodes.find((n) => n.id === route.pageId);
      ui.page = node ? await api.createPage({ title: node.title, parent: node.parent }) : null;
    }
  }

  render();
}

/* ==========================================================================
   RAIL
   Home and the workspaces the reader may open. This is the top level of the
   platform, so it is the top level of the interface.
   ========================================================================== */

function renderRail() {
  const rail = $('#ws-rail');
  rail.innerHTML = '';

  const home = railButton('home', 'Home', ui.area === 'home', () => go('/workspace/my-work'));
  rail.append(home);

  rail.append(el('div', 'ws-rail__rule'));

  for (const workspace of availableWorkspaces()) {
    rail.append(railButton(
      workspace.icon,
      workspace.name,
      ui.area === workspace.id,
      () => go(workspace.home),
    ));
  }

  rail.append(el('div', 'ws-rail__spacer'));

  rail.append(railButton('mindmap', 'Assistant', ui.dock && ui.dockTab === 'assistant', () => {
    ui.dock = true;
    ui.dockTab = 'assistant';
    writePrefs({ dock: true, dockTab: 'assistant' });
    render();
    focusAssistant();
  }));

  /* Settings sits under the Assistant, at the foot of the rail, which is
     where every desktop tool of this shape puts the account. It shows the
     profile picture rather than a gear when there is one: a face is easier
     to find than another 16px line drawing in a column of line drawings,
     and it doubles as confirmation that the picture actually saved. */
  const settings = document.createElement('button');
  settings.className = 'ws-rail__btn ws-rail__btn--account';
  settings.type = 'button';
  settings.setAttribute('aria-label', 'Settings');
  if (ui.area === 'settings' || ui.route?.view === 'settings') settings.setAttribute('aria-current', 'page');

  const avatar = ui.profile?.avatar;
  if (avatar) {
    const img = document.createElement('img');
    img.src = avatar;
    img.alt = '';
    settings.append(img);
  } else {
    /* The initial, not a padlock and not a gear. A padlock says security and
       a gear says preferences; this button is the account, and the initial is
       what the picture will replace once one is set, so the shape of the slot
       does not change when it fills. */
    const who = P.platform.user;
    const initial = ((who?.name || who?.email || 'G').trim()[0] || 'G').toUpperCase();
    settings.append(el('span', 'ws-rail__initial', initial));
  }
  settings.addEventListener('click', () => go('/workspace/settings'));
  attachTip(settings, 'Settings');
  rail.append(settings);
}

function railButton(mark, label, active, onClick) {
  const btn = document.createElement('button');
  btn.className = 'ws-rail__btn';
  btn.type = 'button';
  btn.innerHTML = icon(mark);
  btn.setAttribute('aria-label', label);
  if (active) btn.setAttribute('aria-current', 'page');
  btn.addEventListener('click', onClick);
  attachTip(btn, label);
  return btn;
}

/* Tooltip. The first waits, so brushing past the rail does not fire it; once
   one is open the rest are instant, because by then the reader has asked for
   labels and the delay is only a tax on them. */
let tipTimer = 0;
let tipRecent = false;
let tipRecentTimer = 0;

function attachTip(host, text) {
  const tip = document.createElement('span');
  tip.className = 'ws-tip';
  tip.textContent = text;
  tip.setAttribute('role', 'tooltip');
  host.append(tip);

  const show = () => {
    if (tipRecent) tip.setAttribute('data-instant', '');
    tip.setAttribute('data-open', '');
    tipRecent = true;
    clearTimeout(tipRecentTimer);
  };
  const hide = () => {
    clearTimeout(tipTimer);
    tip.removeAttribute('data-open');
    tip.removeAttribute('data-instant');
    clearTimeout(tipRecentTimer);
    tipRecentTimer = setTimeout(() => { tipRecent = false; }, 600);
  };

  host.addEventListener('pointerenter', () => {
    clearTimeout(tipTimer);
    if (tipRecent) show(); else tipTimer = setTimeout(show, 400);
  });
  host.addEventListener('pointerleave', hide);
  host.addEventListener('focus', show);
  host.addEventListener('blur', hide);
  host.addEventListener('click', hide);
}

/* ==========================================================================
   INDEX
   The current workspace's sections, as a tree. Pages expands into the page
   tree in place, which is what keeps the knowledge base inside the workspace
   it belongs to instead of beside it.
   ========================================================================== */

function renderIndex() {
  const title = $('#ws-index-title');
  const body = $('#ws-index-body');
  const foot = $('#ws-index-count');
  body.innerHTML = '';

  if (ui.area === 'home') {
    title.textContent = 'Workspaces';
    body.append(...availableWorkspaces().map(workspaceChoice));
    foot.textContent = P.platform.boot ? 'Signed in' : '';
    return;
  }

  title.textContent = WORKSPACES[ui.area]?.name || 'Workspace';

  /* Deliberately not role="tree". That role carries a full keyboard
     contract: up and down across the whole flattened tree, home and end,
     typeahead, one tab stop for the entire widget. Only expand and collapse
     are implemented here, and a role that promises the rest and delivers
     none of it is worse for a screen-reader user than plain buttons, which
     is what these are. The nav landmark and the labels carry the meaning. */
  const tree = document.createElement('div');
  tree.className = 'ws-tree';

  for (const section of sectionsFor(ui.area)) {
    const isOpen = ui.openSections.has(section.id);
    const hasChildren = !!(section.children?.length || section.tree);
    const active = section.match(location.pathname);

    const row = sectionRow({
      label: section.label,
      mark: section.icon,
      depth: 0,
      active: active && !(section.children || []).some((c) => c.match(location.pathname)),
      expandable: hasChildren,
      expanded: isOpen,
      onToggle: () => {
        ui.openSections.has(section.id) ? ui.openSections.delete(section.id) : ui.openSections.add(section.id);
        writePrefs({ openSections: [...ui.openSections] });
        renderIndex();
      },
      onClick: () => go(section.path),
    });
    tree.append(row);

    if (!isOpen || !hasChildren) continue;

    const group = document.createElement('div');
    group.className = 'ws-node__kids';
    group.style.setProperty('--depth', 0);

    for (const child of section.children || []) {
      group.append(sectionRow({
        label: child.label,
        mark: child.icon,
        depth: 1,
        active: child.match(location.pathname),
        onClick: () => go(child.path),
      }));
    }

    // A tree section expands into its own branch of the page store rather
    // than into more links, and only into its own: `space` is what keeps a
    // Core standard out of the knowledge base without needing three editors.
    if (section.tree) group.append(...pageBranch(null, 1, section.space));

    tree.append(group);
  }

  body.append(tree);

  /* The count describes the branch that is open, not the whole store. It
     read "26 pages" under the research tree while showing eleven of them,
     which is the sort of small lie that makes a person stop trusting the
     rest of the numbers on the screen. */
  const openTree = sectionsFor(ui.area).find((section) => section.tree && ui.openSections.has(section.id));
  if (openTree) {
    const mine = ui.nodes.filter((node) => api.spaceOfNode(ui.nodes, node.id) === openTree.space);
    const pages = mine.filter((node) => !node.phantom).length;
    const phantoms = mine.filter((node) => node.phantom).length;
    foot.textContent = phantoms
      ? `${pages} pages · ${phantoms} linked, not written`
      : `${pages} pages`;
  } else {
    foot.textContent = '';
  }
}

/* Home's workspace list.

   This used to be a two-line `sectionRow` carrying the workspace glyph, which
   put the same three marks twice on one screen: once in the rail, once again
   two centimetres to the right, at a size small enough to read as decoration
   rather than as a mark. Repeating an icon beside itself teaches the reader
   nothing the rail has not already said.

   So the index drops the glyph and says the part the rail cannot: the name at
   full weight, the sentence explaining what the workspace is for underneath,
   wrapped rather than truncated. The rail is the icon, this is the label. */
function workspaceChoice(workspace) {
  const row = document.createElement('button');
  row.className = 'ws-space';
  row.type = 'button';
  row.append(
    el('span', 'ws-space__name', workspace.name),
    el('span', 'ws-space__blurb', workspace.blurb),
  );
  row.addEventListener('click', () => go(workspace.home));
  return row;
}

function sectionRow({ label, mark, depth, active, expandable, expanded, onToggle, onClick }) {
  const wrap = document.createElement('div');
  wrap.className = 'ws-node';
  if (expanded) wrap.setAttribute('data-open', '');

  const row = document.createElement('button');
  row.className = 'ws-node__row';
  row.type = 'button';
  row.style.setProperty('--depth', depth);
  if (active) row.setAttribute('aria-current', 'page');

  /* The twist expands, the row navigates. A row that only expands costs two
     clicks to reach anything you actually wanted to read.

     It is a real button rather than a span with a click handler, so it is
     reachable by keyboard and announces its state. aria-expanded lives here,
     on the control that does the expanding; it was on the wrapping div,
     where it is not a permitted attribute and told assistive software
     nothing. Nested buttons are invalid HTML, so the twist is a sibling of
     the row rather than a child, positioned over its left end. */
  const twist = document.createElement(expandable ? 'button' : 'span');
  twist.className = 'ws-node__twist' + (expandable ? '' : ' ws-node__twist--leaf');
  twist.innerHTML = icon('chevron');
  twist.style.setProperty('--depth', depth);
  if (expandable) {
    twist.type = 'button';
    twist.setAttribute('aria-expanded', String(!!expanded));
    twist.setAttribute('aria-label', `${expanded ? 'Collapse' : 'Expand'} ${label}`);
    twist.addEventListener('click', (event) => { event.stopPropagation(); onToggle(); });
  }

  const glyph = document.createElement('span');
  glyph.className = 'ws-node__icon';
  glyph.innerHTML = icon(mark);

  const text = document.createElement('span');
  text.className = 'ws-node__label';
  text.textContent = label;

  row.append(glyph, text);
  row.addEventListener('click', onClick);
  // Arrow keys still expand from the row, which is where the hand already is.
  row.addEventListener('keydown', (event) => {
    if (!expandable) return;
    if (event.key === 'ArrowRight' && !expanded) { event.preventDefault(); onToggle(); }
    if (event.key === 'ArrowLeft' && expanded) { event.preventDefault(); onToggle(); }
  });

  wrap.append(twist, row);
  return wrap;
}

/* ---- The page tree ------------------------------------------------------ */

/* `space` is only consulted at the top of a branch. Below the roots every
   node has already been filtered by its ancestor, and re-testing each child
   would walk the parent chain once per row for no new answer. */
function pageBranch(parentId, depth, space) {
  return ui.nodes
    .filter((node) => node.parent === parentId)
    .filter((node) => !space || parentId !== null || api.spaceOfNode(ui.nodes, node.id) === space)
    .map((node) => pageNode(node, depth));
}

function pageNode(node, depth) {
  const kids = ui.nodes.filter((n) => n.parent === node.id);
  const open = ui.openNodes.has(node.id);

  const wrap = document.createElement('div');
  wrap.className = 'ws-node';
  if (open) wrap.setAttribute('data-open', '');

  const row = document.createElement('button');
  row.className = 'ws-node__row';
  row.type = 'button';
  row.style.setProperty('--depth', depth);
  if (node.phantom) {
    row.setAttribute('data-phantom', '');
    row.title = `${node.title} is linked from another page but has no file yet. Opening it creates one.`;
  }
  if (node.id === ui.pageId || node.id === ui.folderId) row.setAttribute('aria-current', 'page');

  // A button, and a sibling of the row rather than a child: see sectionRow.
  const twist = document.createElement(kids.length ? 'button' : 'span');
  twist.className = 'ws-node__twist' + (kids.length ? '' : ' ws-node__twist--leaf');
  twist.innerHTML = icon('chevron');
  twist.style.setProperty('--depth', depth);
  if (kids.length) {
    twist.type = 'button';
    twist.setAttribute('aria-expanded', String(open));
    twist.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} ${node.title}`);
    twist.addEventListener('click', (event) => {
      event.stopPropagation();
      ui.openNodes.has(node.id) ? ui.openNodes.delete(node.id) : ui.openNodes.add(node.id);
      writePrefs({ openNodes: [...ui.openNodes] });
      renderIndex();
    });
  }

  const glyph = document.createElement('span');
  glyph.className = 'ws-node__icon';
  glyph.innerHTML = icon(node.kind === 'folder' ? 'projects' : node.kind === 'journal' ? 'meeting' : 'notes');

  const text = document.createElement('span');
  text.className = 'ws-node__label';
  text.textContent = node.title;

  row.append(glyph, text);
  row.addEventListener('click', () => {
    if (node.kind === 'folder') {
      ui.openNodes.add(node.id);
      go(`/workspace/folder/${node.id}`);
    } else {

      go(`/workspace/page/${node.id}`);
    }
  });
  row.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight' && kids.length && !open) { event.preventDefault(); ui.openNodes.add(node.id); renderIndex(); }
    if (event.key === 'ArrowLeft' && open) { event.preventDefault(); ui.openNodes.delete(node.id); renderIndex(); }
  });

  wrap.append(twist, row);

  if (kids.length && open) {
    const group = document.createElement('div');
    group.className = 'ws-node__kids';
    group.style.setProperty('--depth', depth);
    group.append(...pageBranch(node.id, depth + 1));
    wrap.append(group);
  }
  return wrap;
}

/* ==========================================================================
   EDITOR
   contenteditable per block. One big contenteditable is less code and much
   worse: the browser then owns block structure, and every paste becomes an
   argument about what markup it may leave behind.
   ========================================================================== */

function renderEditor(host) {
  if (!ui.page) {
    host.append(views.empty('Nothing open', 'Pick a page from the index, or press Command K to search everything.'));
    return;
  }

  const doc = document.createElement('article');
  doc.className = 'ws-doc';

  const head = document.createElement('header');
  head.className = 'ws-doc__head';

  const title = document.createElement('h1');
  title.className = 'ws-doc__title';
  title.contentEditable = 'plaintext-only';
  title.spellcheck = false;
  title.textContent = ui.page.title;
  title.setAttribute('role', 'textbox');
  title.setAttribute('aria-label', 'Page title');
  title.addEventListener('blur', () => {
    const next = title.textContent.trim();
    if (next && next !== ui.page.title) {
      ui.page.title = next;
      const node = ui.nodes.find((n) => n.id === ui.page.id);
      if (node) node.title = next;
      queueSave();
      renderIndex();
      renderCrumbs();
    } else {
      title.textContent = ui.page.title;   // an empty title is refused, quietly
    }
  });
  title.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); title.blur(); }
  });

  const meta = document.createElement('p');
  meta.className = 'ws-doc__meta';
  meta.textContent = `${crumbPath(ui.page.id).join(' / ')} · edited ${relative(ui.page.updated)}`;

  head.append(title, meta);
  doc.append(head);

  for (const block of ui.page.blocks) doc.append(blockEl(block));
  host.append(doc);
}

function blockEl(block) {
  const wrap = document.createElement('div');
  wrap.className = 'ws-block';
  wrap.dataset.id = block.id;

  const gutter = document.createElement('div');
  gutter.className = 'ws-block__gutter';
  const add = document.createElement('button');
  add.className = 'ws-ibtn';
  add.type = 'button';
  add.innerHTML = icon('plus');
  add.setAttribute('aria-label', 'Add a block below');
  add.addEventListener('click', () => insertAfter(block.id));
  gutter.append(add);
  wrap.append(gutter);

  const body = document.createElement('div');
  body.className = 'ws-block__body';

  if (block.type === 'attach') {
    body.append(attachmentEl(block));
    wrap.append(body);
    return wrap;
  }

  if (block.type === 'code') {
    const label = document.createElement('div');
    label.className = 'ws-block__lang';
    label.textContent = block.lang || 'text';

    const copy = document.createElement('button');
    copy.className = 'ws-btn ws-btn--tiny';
    copy.type = 'button';
    copy.textContent = 'Copy';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(block.text);
        copy.textContent = 'Copied';
      } catch {
        copy.textContent = 'Blocked';   // never a false success
      }
      setTimeout(() => { copy.textContent = 'Copy'; }, 1400);
    });
    label.append(copy);

    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = block.text;
    code.contentEditable = 'plaintext-only';
    code.spellcheck = false;
    code.addEventListener('input', () => { block.text = code.textContent; queueSave(); });
    pre.append(code);

    body.append(label, pre);
    wrap.append(body);
    return wrap;
  }

  const tag = block.type === 'h2' ? 'h2' : block.type === 'h3' ? 'h3' : block.type === 'ul' ? 'ul' : 'p';

  if (tag === 'ul') {
    const list = document.createElement('ul');
    for (const line of block.text.split('\n')) {
      const item = document.createElement('li');
      item.contentEditable = 'plaintext-only';
      renderInline(item, line);
      list.append(item);
    }
    list.addEventListener('input', () => {
      block.text = [...list.children].map((li) => li.textContent).join('\n');
      queueSave();
    });
    body.append(list);
  } else {
    const node = document.createElement(tag);
    node.contentEditable = 'plaintext-only';
    node.spellcheck = tag === 'p';
    renderInline(node, block.text);
    node.addEventListener('input', () => { block.text = node.textContent; queueSave(); });
    // Links are re-rendered on blur only: doing it per keystroke moves the
    // caret out from under whoever is typing.
    node.addEventListener('blur', () => renderInline(node, block.text));
    node.addEventListener('focus', () => { node.textContent = block.text; });
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); insertAfter(block.id); }
      else if (event.key === 'Backspace' && !block.text && ui.page.blocks.length > 1) {
        event.preventDefault(); removeBlock(block.id);
      }
    });
    body.append(node);
  }

  wrap.append(body);
  return wrap;
}

/* [[Page name]] becomes a link. Deliberately the wiki syntax: people already
   type it, and it survives a copy into any plain text tool. */
function renderInline(host, text) {
  host.textContent = '';
  const pattern = /\[\[([^\]]+)\]\]/g;
  let last = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) host.append(text.slice(last, match.index));

    const name = match[1];
    const target = api.resolveLink(name);
    const link = document.createElement('a');
    link.className = 'ws-link';
    link.textContent = name;
    link.contentEditable = 'false';
    link.href = target.id ? `/workspace/page/${target.id}` : '#';
    if (target.phantom) {
      link.setAttribute('data-phantom', '');
      link.title = `${name} has no file yet. Opening it creates one.`;
    }
    link.addEventListener('click', (event) => {
      event.preventDefault();
      if (target.id) { go(`/workspace/page/${target.id}`); return; }
      api.createPage({ title: name, parent: ui.page?.parent || null }).then((made) => {
        ui.nodes.push({ id: made.id, title: made.title, kind: 'note', parent: made.parent, phantom: false });
        go(`/workspace/page/${made.id}`);
      });
    });
    host.append(link);
    last = pattern.lastIndex;
  }

  if (last < text.length) host.append(text.slice(last));
  if (!text) host.append(document.createElement('br'));
}

function insertAfter(id) {
  const at = ui.page.blocks.findIndex((block) => block.id === id);
  const made = { id: 'b-' + Math.random().toString(36).slice(2, 9), type: 'p', text: '' };
  ui.page.blocks.splice(at + 1, 0, made);
  queueSave();
  render();
  requestAnimationFrame(() => $(`.ws-block[data-id="${made.id}"] [contenteditable]`)?.focus());
}

function removeBlock(id) {
  const at = ui.page.blocks.findIndex((block) => block.id === id);
  ui.page.blocks.splice(at, 1);
  queueSave();
  render();
  requestAnimationFrame(() => {
    const previous = ui.page.blocks[Math.max(0, at - 1)];
    const node = $(`.ws-block[data-id="${previous.id}"] [contenteditable]`);
    if (!node) return;
    node.focus();
    // Caret to the end, so backspacing through blocks feels continuous.
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
}

function attachmentEl(block) {
  const card = document.createElement('div');
  card.className = 'ws-attach';
  card.append(el('span', 'ws-attach__kind', block.kind || 'FILE'));
  card.append(el('span', 'ws-attach__name', block.text));
  card.append(el('span', 'ws-attach__meta', block.meta || ''));
  return card;
}

/* Debounced save. The status bar is told the truth at each step. A save
   indicator that only ever says "saved" is decoration. */
let saveTimer = 0;

function queueSave() {
  setSave('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await api.savePage(ui.page.id, { title: ui.page.title, blocks: ui.page.blocks });
      setSave(api.state.mode === 'server' ? 'saved' : 'offline');
    } catch {
      setSave('error');
    }
  }, 700);
}

function setSave(next) {
  ui.save = next;
  const node = $('#ws-save');
  if (!node) return;
  node.dataset.state = next;
  node.textContent = {
    saved: 'Saved', saving: 'Saving', error: 'Not saved', offline: 'Saved in this browser',
  }[next];
}

/* ==========================================================================
   PAGES AND FOLDERS
   ========================================================================== */

function renderFolder(host) {
  const folder = ui.nodes.find((node) => node.id === ui.folderId);
  const kids = ui.nodes.filter((node) => node.parent === ui.folderId);

  const doc = document.createElement('div');
  doc.className = 'ws-doc';
  doc.append(el('h1', 'ws-doc__title', folder ? folder.title : 'Folder'));
  doc.append(el('p', 'ws-doc__meta', `${kids.length} item${kids.length === 1 ? '' : 's'}`));

  if (!kids.length) {
    doc.append(views.empty('Empty folder', 'Nothing has been filed here yet.'));
  } else {
    const list = views.panel(folder ? folder.title : 'Contents');
    for (const kid of kids) {
      list.body.append(views.row({
        title: kid.title,
        sub: kid.phantom ? 'Linked, no file yet' : P.label(kid.kind),
        onClick: () => go(kid.kind === 'folder' ? `/workspace/folder/${kid.id}` : `/workspace/page/${kid.id}`),
      }));
    }
    doc.append(list);
  }
  host.append(doc);
}

/* ==========================================================================
   DOCK
   ========================================================================== */

const DOCK_TABS = [
  { id: 'tasks',     label: 'Tasks' },
  { id: 'journal',   label: 'Journal' },
  { id: 'links',     label: 'Links' },
  { id: 'assistant', label: 'Assistant' },
];

function renderDock() {
  const tabs = $('#ws-dock-tabs');
  tabs.innerHTML = '';
  for (const tab of DOCK_TABS) {
    const btn = document.createElement('button');
    btn.className = 'ws-tab';
    btn.type = 'button';
    btn.textContent = tab.label;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(ui.dockTab === tab.id));
    btn.addEventListener('click', () => {
      ui.dockTab = tab.id;
      writePrefs({ dockTab: tab.id });
      renderDock();
      renderRail();
    });
    tabs.append(btn);
  }

  const body = $('#ws-dock-body');
  body.innerHTML = '';

  if (ui.dockTab === 'tasks') renderDockTasks(body);
  else if (ui.dockTab === 'journal') renderDockJournal(body);
  else if (ui.dockTab === 'links') renderDockLinks(body);
  else mountAssistant(body, { go, currentPage: () => ui.page });
}

/* Tasks in the dock are the real ones assigned to this reader, from
   bootstrap. It is the same list Home shows, which is deliberate: the panel
   is a persistent view of that list, not a second one that can disagree. */
function renderDockTasks(body) {
  const boot = P.platform.boot;
  if (!boot) {
    body.append(views.empty('Not connected', 'Your assigned tasks need a signed in session.'));
    return;
  }
  if (!P.canOpenCore()) {
    body.append(views.empty('No task list', 'Tasks live in the Core workspace, which this account cannot open.'));
    return;
  }
  const tasks = boot.my_work.tasks || [];
  if (!tasks.length) {
    body.append(views.empty('Nothing open', 'Tasks assigned to you appear here.'));
    return;
  }

  const list = document.createElement('div');
  list.className = 'ws-list';
  for (const task of tasks) {
    list.append(views.row({
      title: task.title,
      sub: P.meta([P.label(task.priority), P.formatDate(task.due_date), task.initiative]),
      onClick: () => go('/workspace/core/tasks'),
    }));
  }
  body.append(list);
}

function renderDockJournal(body) {
  body.append(calendarEl());

  const days = api.journalDays().sort().reverse();
  const heading = el('p', 'ws-pane__title', 'Written days');
  heading.style.cssText = 'padding:12px 12px 4px;border-top:1px solid var(--g-hairline);margin-top:8px';
  body.append(heading);

  if (!days.length) {
    body.append(views.empty('No entries yet', 'Pick a day above to start its page. Days that have one are underlined.'));
    return;
  }

  const list = document.createElement('div');
  list.className = 'ws-list';
  for (const day of days.slice(0, 12)) {
    const date = new Date(day + 'T00:00:00');
    list.append(views.row({
      title: date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
      onClick: () => go(`/workspace/page/${api.journalId(date)}`),
    }));
  }
  body.append(list);
}

async function renderDockLinks(body) {
  if (!ui.page) {
    body.append(views.empty('No page open', 'Backlinks show which pages point at the one you are reading.'));
    return;
  }
  views.skeleton(3, body);
  const links = await api.backlinks(ui.page.id);
  body.innerHTML = '';

  if (!links.length) {
    body.append(views.empty('No backlinks', `Nothing links to ${ui.page.title} yet. Write [[${ui.page.title}]] in another page to make one.`));
    return;
  }
  const list = document.createElement('div');
  list.className = 'ws-list';
  for (const link of links) {
    list.append(views.row({ title: link.title, sub: link.excerpt, onClick: () => go(`/workspace/page/${link.id}`) }));
  }
  body.append(list);
}

/* Monday first. The workspace is used from Germany, where the week does not
   start on Sunday, and a calendar that disagrees with the wall is worse than
   no calendar. */
function calendarEl() {
  const wrap = el('div', 'ws-cal');
  const head = el('div', 'ws-cal__head');
  head.append(el('span', 'ws-cal__month',
    ui.calMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })));

  const step = (delta, label) => {
    const btn = document.createElement('button');
    btn.className = 'ws-ibtn';
    btn.type = 'button';
    btn.setAttribute('aria-label', label);
    btn.innerHTML = icon('chevron');
    if (delta < 0) btn.style.transform = 'rotate(180deg)';
    btn.addEventListener('click', () => {
      ui.calMonth = new Date(ui.calMonth.getFullYear(), ui.calMonth.getMonth() + delta, 1);
      renderDock();
    });
    return btn;
  };
  head.append(step(-1, 'Previous month'), step(1, 'Next month'));

  const grid = el('div', 'ws-cal__grid');
  for (const day of ['M', 'T', 'W', 'T', 'F', 'S', 'S']) grid.append(el('span', 'ws-cal__dow', day));

  const year = ui.calMonth.getFullYear();
  const month = ui.calMonth.getMonth();
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;   // Monday first
  const start = new Date(year, month, 1 - lead);
  const written = new Set(api.journalDays());
  const today = new Date().toDateString();

  for (let i = 0; i < 42; i += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);

    /* Days from the neighbouring months hold the grid's shape and nothing
       else, so they are empty spans. Dimmed enough to sit behind this month
       they fall under the contrast floor for interactive text, and clicking
       "31 August" while reading September is a trap rather than a shortcut.
       The blank cell still shows which weekday the month starts and ends on. */
    if (date.getMonth() !== month) {
      const filler = el('span', 'ws-cal__day');
      filler.setAttribute('data-out', '');
      filler.setAttribute('aria-hidden', 'true');
      grid.append(filler);
      continue;
    }

    const btn = document.createElement('button');
    btn.className = 'ws-cal__day';
    btn.type = 'button';
    btn.textContent = date.getDate();
    if (date.toDateString() === today) btn.setAttribute('data-today', '');
    if (written.has(date.toISOString().slice(0, 10))) btn.setAttribute('data-has', '');
    btn.setAttribute('aria-pressed', String(date.toDateString() === ui.selectedDay.toDateString()));
    btn.setAttribute('aria-label', date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }));
    btn.addEventListener('click', async () => {
      ui.selectedDay = date;
      const journal = await api.openJournal(date);
      if (!ui.nodes.some((node) => node.id === journal.id)) {
        ui.nodes.push({ id: journal.id, title: journal.title, kind: 'journal', parent: 'journal', phantom: false });
      }
      go(`/workspace/page/${journal.id}`);
    });
    grid.append(btn);
  }

  wrap.append(head, grid);
  return wrap;
}

/* ==========================================================================
   SHARED
   ========================================================================== */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function crumbNodes(id) {
  const out = [];
  let node = ui.nodes.find((n) => n.id === id);
  while (node) {
    out.unshift(node);
    node = ui.nodes.find((n) => n.id === node.parent);
  }
  return out;
}

const crumbPath = (id) => crumbNodes(id).map((node) => node.title);

function relative(stamp) {
  if (!stamp) return 'never';
  const seconds = (Date.now() - new Date(stamp)) / 1000;
  if (seconds < 90) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(stamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* The breadcrumb is Home / Workspace / Section, which is the platform's real
   hierarchy. Inside Pages it continues into the page's own path. */
function renderCrumbs() {
  const host = $('#ws-crumbs');
  host.innerHTML = '';

  const crumbs = [];
  if (ui.route?.view === 'settings') {
    // Settings belongs to the account, not to either workspace. Showing a
    // workspace in the trail here would claim these preferences are scoped
    // to it, and they are not.
    crumbs.push({ label: 'Home', path: '/workspace/my-work' });
    crumbs.push({ label: 'Settings' });
  } else if (ui.area === 'home') {
    crumbs.push({ label: 'Home' });
  } else {
    const workspace = WORKSPACES[ui.area];
    crumbs.push({ label: 'Home', path: '/workspace/my-work' });
    crumbs.push({ label: workspace.name, path: workspace.home });

    const { section, child } = activeSection(ui.area, location.pathname);
    if (section) crumbs.push({ label: section.label, path: section.path });
    if (child) crumbs.push({ label: child.label, path: child.path });

    const pageId = ui.pageId || ui.folderId;
    if (pageId) for (const node of crumbNodes(pageId)) crumbs.push({ label: node.title });
  }

  crumbs.forEach((crumb, index) => {
    if (index) host.append(el('span', 'ws-crumbs__sep', '/'));

    if (index === crumbs.length - 1 || !crumb.path) {
      host.append(el('span', index === crumbs.length - 1 ? 'ws-crumbs__here' : 'ws-crumbs__plain', crumb.label));
      return;
    }
    const link = document.createElement('a');
    link.href = crumb.path;
    link.textContent = crumb.label;
    link.addEventListener('click', (event) => { event.preventDefault(); go(crumb.path); });
    host.append(link);
  });
}

/* ==========================================================================
   RENDER
   ========================================================================== */

/* Everything a view is allowed to reach outside itself, in one object.
   Views get this rather than importing the shell, which keeps the direction
   of dependency one way: the shell knows about views, views do not know
   about the shell. */
/* Where a new page lands in each workspace. The first root of that space in
   the tree, with a named preference where the space has an obvious inbox —
   research notes belong under Dossiers, knowledge under Concepts. If the
   space has no roots at all the page is created as a root itself, which is
   the only outcome that cannot lose it. */
const PREFERRED_ROOT = { research: 'dossiers', core: 'c-meetings', kms: 'k-concepts' };

function defaultRoot(space) {
  const wanted = PREFERRED_ROOT[space];
  if (ui.nodes.some((node) => node.id === wanted)) return wanted;
  const root = ui.nodes.find((node) => !node.parent && api.spaceOfNode(ui.nodes, node.id) === space);
  return root ? root.id : null;
}

function viewContext() {
  return {
    go,
    booting: ui.booting,
    canCore: P.canOpenCore(),
    reload: () => start(),

    openAssistant: (question) => {
      ui.dock = true;
      ui.dockTab = 'assistant';
      writePrefs({ dock: true, dockTab: 'assistant' });
      render();
      askAssistant(question);
    },

    // Notes
    area: ui.area,
    space: spaceOf(ui.area),

    /* Scoped by default to the workspace the reader is standing in. Passing
       no space returns every page, which only the palette wants: search is
       the one place where finding a page in another workspace is the point
       rather than a leak. */
    pages: (space) => Object.values(ui.pagesById)
      .filter((page) => !space || api.spaceOfNode(ui.nodes, page.id) === space)
      .sort((a, b) => (b.updated || '').localeCompare(a.updated || '')),

    pagesOnServer: () => api.state.mode === 'server',
    pathOf: (id) => crumbPath(id).join(' / '),
    when: relative,

    /* One creator for all three workspaces. It lands the page in the space
       the reader is in unless told otherwise, under that space's default
       root, and can pre-fill the blocks — which is what lets Sources open a
       distillation note with its headings already written instead of
       handing somebody a blank page at the exact moment the method matters.

       It returns the page, so a caller that needs the id (to link a source
       to it) does not have to guess it or re-read the tree. */
    newNote: async ({ space, title = 'Untitled', parent, blocks, open = true } = {}) => {
      const target = space || spaceOf(ui.area);
      const root = parent || defaultRoot(target);
      const made = await api.createPage({ title, parent: root, space: target });
      if (!made) return null;

      if (blocks?.length) {
        const filled = blocks.map((block) => ({
          id: 'b-' + Math.random().toString(36).slice(2, 9),
          type: block.type || 'p',
          text: block.text || '',
        }));
        Object.assign(made, await api.savePage(made.id, { blocks: filled }) || {});
      }

      ui.nodes.push({ id: made.id, title: made.title, kind: 'note', parent: made.parent, phantom: false });
      ui.pagesById[made.id] = made;
      if (open) go(`/workspace/page/${made.id}`);
      else renderIndex();
      return made;
    },

    // Settings
    onProfileChange: (profile) => { ui.profile = profile; renderRail(); },
    refreshTheme: () => {
      $('#ws-theme').setAttribute(
        'aria-pressed',
        String(document.documentElement.getAttribute('data-theme') === 'light'),
      );
    },
  };
}

function render() {
  const shell = $('#ws');
  shell.dataset.dock = ui.dock ? 'on' : 'off';
  // Settings has nothing to navigate, so the index closes for it rather
  // than showing a workspace tree beside preferences that belong to neither.
  shell.dataset.index = ui.index && ui.route?.view !== 'settings' ? 'on' : 'off';
  shell.dataset.area = ui.area;

  renderRail();
  renderCrumbs();
  renderIndex();
  renderDock();

  const host = $('#ws-view');
  host.innerHTML = '';

  // The clock on the dashboard runs on an interval. Every path out of the
  // dashboard goes through here, so this is the one place that can promise
  // the timer is not left writing into a node no longer on the page.
  stopClock();

  const view = ui.route?.view || 'home';
  const ctx = viewContext();

  if (view === 'home') renderDashboard(host, ctx, 'home');
  else if (view === 'core') renderDashboard(host, ctx, 'core');
  else if (view === 'research') renderDashboard(host, ctx, 'research');
  else if (view === 'kms') kms.renderKmsOverview(host, ctx);
  else if (view === 'core-tasks') views.renderCoreTasks(host, ctx);
  else if (view === 'core-content') views.renderCoreContent(host, ctx);
  else if (view === 'core-team') views.renderCoreTeam(host, ctx);
  else if (view === 'core-planning') views.renderCorePlanning(host, ctx);
  else if (view === 'core-notes') views.renderCoreNotes(host, ctx);
  else if (view === 'core-assets') assets.renderCoreAssets(host, ctx);
  else if (view === 'core-blueprint') assets.renderContentStudioBlueprint(host, ctx);
  else if (view === 'kms-paths') kms.renderKmsPaths(host, ctx);
  else if (view === 'kms-path') kms.renderKmsPath(host, ui.route.id, ctx);
  else if (view === 'kms-sources') kms.renderKmsSources(host, ctx);
  else if (view === 'kms-base') kms.renderKmsBase(host, ctx);
  else if (view === 'kms-recall') kms.renderKmsRecall(host, ctx);
  else if (view === 'kms-skills') kms.renderKmsSkills(host, ctx);
  else if (view === 'projects') views.renderResearchProjects(host, ctx);
  else if (view === 'project') views.renderResearchProject(host, ui.route.id, ctx);
  else if (view === 'resources') views.renderResources(host, ui.route.kind);
  else if (view === 'mindmaps') views.renderMindMaps(host, ctx);
  else if (view === 'collaboration') views.renderCollaboration(host, ctx);
  else if (view === 'people') views.renderPeople(host, ctx);
  else if (view === 'community') views.renderCommunity(host, ctx);
  else if (view === 'shared') views.renderShared(host, ctx);
  else if (view === 'settings') renderSettings(host, ctx);
  else if (view === 'notes') views.renderNotes(host, ctx);
  else if (view === 'editor') renderEditor(host);
  else if (view === 'folder') renderFolder(host);

  updateStatus();
}

function updateStatus() {
  /* Save state, word count and the pages-storage note belong to the editor.
     On a Core dashboard there is no page open, and a status bar reading
     "Saved" beside somebody else's project list is claiming something about
     data it has nothing to do with. */
  const editing = ui.route?.view === 'editor' && !!ui.page;

  const save = $('#ws-save');
  save.hidden = !editing;
  if (editing) setSave(ui.save);

  const words = editing
    ? ui.page.blocks.reduce((sum, block) => sum + (block.text || '').split(/\s+/).filter(Boolean).length, 0)
    : 0;
  $('#ws-words').textContent = editing ? `${words} words` : '';

  const mode = $('#ws-mode');
  if (P.platform.error === 'signed-out') {
    mode.textContent = 'Signed out';
    mode.title = 'Sign in to load your workspaces.';
  } else if (P.platform.boot) {
    const who = P.platform.boot.access.core ? 'Core and Research' : 'Research';
    mode.textContent = who;
    mode.title = `Signed in. Workspaces you can open: ${who}.`;
  } else {
    mode.textContent = 'Offline';
    mode.title = 'The platform did not answer.';
  }

  const pages = $('#ws-pages-mode');
  if (pages) {
    pages.textContent = editing && api.state.mode !== 'server' ? 'Pages: this browser' : '';
    pages.title = api.state.reason;
  }
}

/* ==========================================================================
   PANE RESIZE
   ========================================================================== */

function wireGrip(grip, { variable, min, max, from }) {
  const read = () => parseInt(getComputedStyle(document.documentElement).getPropertyValue(variable), 10);

  grip.tabIndex = 0;
  grip.setAttribute('role', 'separator');
  grip.setAttribute('aria-orientation', 'vertical');
  grip.setAttribute('aria-valuemin', String(min));
  grip.setAttribute('aria-valuemax', String(max));

  // A focusable separator is a range widget, so it has to report its
  // position. Without aria-valuenow a screen reader announces a handle with
  // no value and no bounds, which is worse than announcing nothing.
  const publish = () => {
    const width = read();
    grip.setAttribute('aria-valuenow', String(width));
    grip.setAttribute('aria-valuetext', `${width} pixels`);
  };
  publish();

  grip.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    grip.setPointerCapture(event.pointerId);
    grip.setAttribute('data-active', '');
    $('#ws').setAttribute('data-resizing', '');

    const startX = event.clientX;
    const startWidth = read();

    const move = (moveEvent) => {
      const delta = (moveEvent.clientX - startX) * (from === 'right' ? -1 : 1);
      const width = Math.min(max, Math.max(min, startWidth + delta));
      document.documentElement.style.setProperty(variable, width + 'px');
      publish();
    };
    const up = () => {
      grip.releasePointerCapture(event.pointerId);
      grip.removeAttribute('data-active');
      $('#ws').removeAttribute('data-resizing');
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      writePrefs({ [variable]: read() + 'px' });
    };

    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });

  // Keyboard resize, because a handle that only takes a pointer is a pane
  // width nobody on a keyboard can change.
  grip.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const step = (event.shiftKey ? 40 : 12) * (event.key === 'ArrowRight' ? 1 : -1) * (from === 'right' ? -1 : 1);
    const width = Math.min(max, Math.max(min, read() + step));
    document.documentElement.style.setProperty(variable, width + 'px');
    publish();
    writePrefs({ [variable]: width + 'px' });
  });
}

/* ==========================================================================
   THEME
   Same control and same two marks as the public site, so the workspace and
   gravitasplus.com switch theme with the same button.
   ========================================================================== */

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem('gravitas-theme'); } catch { /* denied */ }
  const system = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  const current = saved || system;
  document.documentElement.setAttribute('data-theme', current);

  const toggle = $('#ws-theme');
  toggle.setAttribute('aria-pressed', String(current === 'light'));
  toggle.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    toggle.setAttribute('aria-pressed', String(next === 'light'));
    try { localStorage.setItem('gravitas-theme', next); } catch { /* denied */ }
  });
}

/* ==========================================================================
   BOOT
   ========================================================================== */

export async function start() {
  initTheme();

  const prefs = readPrefs();
  if (Array.isArray(prefs.openSections)) ui.openSections = new Set(prefs.openSections);
  if (Array.isArray(prefs.openNodes)) ui.openNodes = new Set(prefs.openNodes);
  if (typeof prefs.dockTab === 'string') ui.dockTab = prefs.dockTab;
  if (typeof prefs.dock === 'boolean') ui.dock = prefs.dock;
  if (prefs['--ws-index-w']) document.documentElement.style.setProperty('--ws-index-w', prefs['--ws-index-w']);
  if (prefs['--ws-dock-w']) document.documentElement.style.setProperty('--ws-dock-w', prefs['--ws-dock-w']);

  /* Below 860px the index is an overlay rather than a column, so it starts
     closed: opening on load would put a navigation tree over the screen
     somebody asked for. Watched rather than read once, because a tablet
     rotating crosses this line without a reload. */
  const narrow = matchMedia('(max-width: 860px)');
  const applyWidth = (matches) => {
    ui.index = matches ? false : readPrefs().index !== false;
    render();
  };
  narrow.addEventListener('change', (event) => applyWidth(event.matches));

  wireGrip($('#ws-grip-index'), { variable: '--ws-index-w', min: 200, max: 460, from: 'left' });
  wireGrip($('#ws-grip-dock'), { variable: '--ws-dock-w', min: 260, max: 520, from: 'right' });

  $('#ws-toggle-index').addEventListener('click', () => {
    ui.index = !ui.index;
    if (!narrow.matches) writePrefs({ index: ui.index });
    render();
  });
  $('#ws-toggle-dock').addEventListener('click', () => {
    ui.dock = !ui.dock;
    writePrefs({ dock: ui.dock });
    render();
  });
  $('#ws-open-palette').addEventListener('click', () => openPalette());

  // The scrim is a pseudo-element on the shell, so a tap landing on the shell
  // itself rather than on a pane is a tap on the scrim.
  $('#ws').addEventListener('click', (event) => {
    if (event.target === $('#ws') && narrow.matches && ui.index) { ui.index = false; render(); }
  });
  addEventListener('ws:navigate', () => {
    if (narrow.matches && ui.index) ui.index = false;
  });

  addEventListener('popstate', () => apply(location.pathname));

  ui.index = !narrow.matches && prefs.index !== false;
  ui.route = parse(location.pathname);
  ui.area = areaOf(location.pathname);

  // One paint before the network, so the shell is on screen immediately.
  // ui.booting is still true, so the views draw skeletons rather than
  // conclusions about data that has not arrived.
  render();

  // The platform first: the rail, the index and the access rules all depend
  // on it, and it decides whether Core exists for this reader at all.
  await P.loadBootstrap();
  ui.booting = false;

  // The rail shows the profile picture, so it needs the profile. Fired
  // without awaiting: the shell must not wait on a decoration.
  P.myProfile().then((data) => { ui.profile = data.profile; renderRail(); }).catch(() => {});

  if (P.platform.error === 'signed-out') {
    // Deliberately not a redirect. The old shell bounced to /login from
    // inside its fetch wrapper, which threw away whatever was open.
    render();
    return;
  }

  await api.boot();
  ui.nodes = await api.tree();
  ui.pagesById = {};
  for (const node of ui.nodes) {
    if (node.kind === 'folder' || node.phantom) continue;
    const body = await api.page(node.id);
    if (body) ui.pagesById[node.id] = body;
  }

  mountPalette({
    go, api, platform: P,
    nodes: () => ui.nodes,
    currentPage: () => ui.page,
    // The palette can be opened from anywhere, so it asks rather than
    // assumes: a page made with Ctrl N in the Knowledge workspace belongs
    // to the knowledge base, not to whichever tree happens to be default.
    newNote: (options) => viewContext().newNote(options),
    space: () => spaceOf(ui.area),
  });

  const path = location.pathname.replace(/\/$/, '');
  if (path === '/workspace') go('/workspace/my-work', { replace: true });
  else apply(location.pathname);
}
