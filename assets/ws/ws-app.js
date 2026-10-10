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

import * as notes from './ws-notes-store.js?v=20261011-r4';
import { fiveLayerRoute, renderFiveLayer, coreAdminEntry } from './ws-five-layer.js?v=20261011-r4';
import { renderNotesRoute, renderMirrorRoute, leaveNotes } from './ws-nextcloud-native.js?v=20261011-r4';
import * as P from './ws-platform.js?v=20261011-r4';
import { renderCoreTeam } from './ws-core-team.js?v=20261011-r4';
import { renderCoreContent } from './ws-core-content-actions.js?v=20261011-r4';
import * as views from './ws-views.js?v=20261011-r4';
import * as meetings from './ws-meetings.js?v=20261011-r4';
import * as assets from './ws-core-assets.js?v=20261011-r4';
import * as kms from './ws-kms-views.js?v=20261011-r4';
import * as library from './ws-library.js?v=20261011-r4';
import * as research from './ws-research.js?v=20261011-r4';
import {
  areaOf, sectionsFor, activeSection, titleFor,
  WORKSPACES, availableWorkspaces, spaceOf, SPACE_LABEL,
} from './ws-nav.js?v=20261011-r4';
import { renderDashboard, stopClock } from './ws-home.js?v=20261011-r4';
import { renderSettings, SETTINGS_SECTIONS, settingsSection } from './ws-settings.js?v=20261011-r4';
import { mountPalette, openPalette } from './ws-palette.js?v=20261011-r4';
import { installAssistant, askAssistant } from './ws-ai.js?v=20261011-r4';
import { installSelects } from './ws-select.js?v=20261011-r4';

const icon = (name, cls) => window.GravitasIcons.icon(name, cls || 'g-wi');
const $ = (sel, root = document) => root.querySelector(sel);
const cookie = (name) => {
  const hit = document.cookie.split('; ').find((row) => row.startsWith(name + '='));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : '';
};
const localDayKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

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
  dockTab: 'inbox',
  index: true,
  dock: true,
  openSections: new Set(),
  calMonth: new Date(),
  selectedDay: new Date(),
  // The note open in Notes, reported by the notebook, for the dock's backlinks.
  openNote: null,
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
/* ---- Where a pane stops being a column ----------------------------------
   These two widths are section 9 of ws.css, restated. The stylesheet decides
   whether a pane floats over the page; this file decides whether it may be
   open and whether that state is worth remembering. The two have to agree:
   when they drifted apart the dock toggle between 861 and 1100px flipped a
   pane the stylesheet had already made unreachable, so the button did
   nothing at every laptop width.

   Module scope rather than inside start(), because the rail and the dock
   read them too and they need the same answer. */
const NARROW = matchMedia('(max-width: 860px)');
const DOCK_FLOATS = matchMedia('(max-width: 1100px)');

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
  [/^\/workspace\/core\/meetings\/?$/,              () => ({ view: 'core-meetings' })],
  [/^\/workspace\/core\/content\/?$/,               () => ({ view: 'core-content' })],
  [/^\/workspace\/core\/notes\/?$/,                 () => ({ view: 'core-notes' })],
  [/^\/workspace\/core\/team\/?$/,                  () => ({ view: 'core-team' })],
  // The blueprint route is matched before the library it lives under, or the
  // library's own pattern would swallow it.
  [/^\/workspace\/core\/assets\/content-studio-blueprint\/?$/, () => ({ view: 'core-blueprint' })],
  [/^\/workspace\/core\/assets\/?$/,                () => ({ view: 'core-assets' })],
  [/^\/workspace\/operating(?:\/.*)?$/,             () => ({ view: 'core-planning' })],

  [/^\/workspace\/kms\/?$/,                         () => ({ view: 'kms' })],
  [/^\/workspace\/kms\/notes\/?$/,                  () => ({ view: 'notes' })],
  [/^\/workspace\/kms\/library\/?$/,                () => ({ view: 'kms-library' })],
  [/^\/workspace\/kms\/paths\/([^/]+)\/?$/,         (m) => ({ view: 'kms-path', id: m[1] })],
  [/^\/workspace\/kms\/paths\/?$/,                  () => ({ view: 'kms-paths' })],
  [/^\/workspace\/kms\/sources\/?$/,                () => ({ view: 'kms-sources' })],
  [/^\/workspace\/kms\/base\/?$/,                   () => ({ view: 'kms-base' })],
  [/^\/workspace\/kms\/recall\/?$/,                 () => ({ view: 'kms-recall' })],
  [/^\/workspace\/kms\/skills\/?$/,                 () => ({ view: 'kms-skills' })],

  [/^\/workspace\/research\/?$/,                    () => ({ view: 'research' })],
  [/^\/workspace\/research\/calendar\/?$/,          () => ({ view: 'research-calendar' })],
  [/^\/workspace\/research\/editor\/?$/,            () => ({ view: 'notes' })],
  [/^\/workspace\/research\/folders\/?$/,           () => ({ view: 'research-folders' })],
  [/^\/workspace\/research\/tasks\/?$/,             () => ({ view: 'research-tasks' })],
  [/^\/workspace\/research\/search\/?$/,            () => ({ view: 'research-search' })],
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
  [/^\/workspace\/settings(?:\/([a-z-]+))?\/?$/,   (m) => ({ view: 'settings', section: settingsSection(m[1]).id })],

  [/^\/workspace\/page\/([^/]+)\/?$/,               (m) => ({ view: 'editor', pageId: m[1] })],
];

/* The inverse of ws-nav's spaceOf. Kept next to the router because the
   router is the only place that has to go this way: from a page's space
   back to the workspace whose index should be open around it. */
const AREA_OF_SPACE = { core: 'core', research: 'research', kms: 'kms' };

/* Routes ws-five-layer.js draws: rail, index, crumbs and view. None of them
   is in ROUTES, so parse() turned each into Home and areaOf() into Research,
   and render() painted the Research index and the Home dashboard on them.
   ws-five-layer only installs once the platform bootstrap settles, so on
   every refresh of a Learning page the reader saw Research for that long,
   and again when start() finished and re-applied the route. The shell now
   keeps its hands off these routes: the first paint draws a neutral
   placeholder with the right workspace name, and later renders leave the
   index, the trail and the view to their owner. */
function fiveLayerOwns(path = location.pathname) {
  const kind = fiveLayerRoute(path.split(/[?#]/)[0])?.kind;
  return !!kind && kind !== 'redirect' && kind !== 'learning-legacy';
}

/* The Knowledge tools are drawn here but sit under ws-five-layer's Learning
   index, so that index and trail are its, not the Knowledge sections'. */
const learningIndexFor = (path = location.pathname) => fiveLayerRoute(path.split(/[?#]/)[0])?.kind === 'learning-legacy';

/* Daily work reports is drawn by ws-five-layer but listed in CORE_SECTIONS,
   so its index is the ordinary Core index and only the view is handed off.
   Treating its index as five-layer's too left the shell's last drawing in
   place: arriving from Tasks kept Tasks lit and the reports row dark. */
function shellDrawsIndex(path = location.pathname) {
  return /^\/workspace\/core\/work-reports(?:\/|$)/.test(path);
}

function fiveLayerName(path = location.pathname) {
  if (path.startsWith('/workspace/core/work-reports')) return 'Core';
  if (path.startsWith('/workspace/learning')) return 'Learning';
  if (path.startsWith('/workspace/core/admin')) return 'Platform Admin';
  if (path.startsWith('/workspace/research')) return 'Research';
  return 'Dashboard';
}

function renderHandoff() {
  if (!ui.booting) return;
  const name = fiveLayerName();
  if (!shellDrawsIndex()) {
    $('#ws-index-title').textContent = name;
    views.skeleton(4, $('#ws-index-body'));
    $('#ws-index-count').textContent = '';
  }
  const crumbs = $('#ws-crumbs');
  crumbs.innerHTML = '';
  crumbs.append(el('span', '', name));
  views.skeleton(3, $('#ws-view'));
}

function parse(path) {
  // Routes name paths; a query (?day=, ?task=) is for the screen to read.
  const bare = String(path).split(/[?#]/)[0];
  for (const [pattern, build] of ROUTES) {
    const match = bare.match(pattern);
    if (match) return build(match);
  }
  return { view: 'home' };
}

export function go(path, { replace = false } = {}) {
  // Public pages and paths leave the workspace shell rather than falling
  // through to its Home route.
  if (!String(path || '').startsWith('/workspace')) {
    location.href = path;
    return;
  }
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  dispatchEvent(new CustomEvent('ws:navigate'));
  apply(path);
}

async function apply(path) {
  const owned = fiveLayerRoute(String(path).split(/[?#]/)[0]);
  if (owned?.kind === 'redirect') {
    go(owned.to, { replace: true });
    return;
  }
  const route = parse(path);

  /* Core is refused rather than merely hidden. Someone can arrive on a Core
     URL from an old bookmark or a shared link without being a member, and
     the honest answer is to send them to the workspace they can open, not
     to render an empty Core screen. */
  if (areaOf(path).startsWith('core') && !P.canOpenCore() && P.platform.boot) {
    go('/workspace/dashboard', { replace: true });
    return;
  }
  if (areaOf(path) === 'research' && !P.canOpenResearch() && P.platform.boot) {
    go('/workspace/dashboard', { replace: true });
    return;
  }
  if (areaOf(path) === 'kms' && !P.canOpenLms() && P.platform.boot) {
    go('/workspace/dashboard', { replace: true });
    return;
  }

  ui.route = route;

  /* A page URL carries no workspace, so the area is read off the page
     itself. Without this, opening a Core meeting note from search dropped
     the reader into the Research index with none of its rows lit, and the
     rail claimed they had changed workspace. The page decides, because the
     page is the thing they asked for. */
  ui.area = areaOf(path);

  // Keep the section containing the current route open in the index.
  const { section } = activeSection(ui.area, path);
  if (section) ui.openSections.add(section.id);

  /* There is one place to write: Notes, where a note is Markdown in the
     reader's Nextcloud. The block page editor that used to open here had its
     own toolbar, its own save path and its own idea of a day, and readers
     kept landing in it from search, links and "New page". Every page URL
     now opens the same note in Notes; a [[link]] to a note that does not
     exist yet opens Notes on a new note with that title. */
  if (route.view === 'editor' && route.pageId) {
    // The note's space decides which notebook opens it, so ask the index.
    await notes.load();
    go(notePathFor(route.pageId), { replace: true });
    return;
  }

  render();
}

function notePathFor(pageId) {
  const id = decodeURIComponent(String(pageId));
  const day = /^journal-(\d{4}-\d{2}-\d{2})$/.exec(id)?.[1];
  if (day) return `/workspace/research/notes?day=${day}`;
  // A [[link]] to a page nobody had written yet was a phantom node; its
  // title is the part of the id after the prefix.
  if (id.startsWith('phantom-')) return `${notesPath('research')}?new=${encodeURIComponent(id.slice(8) || 'Untitled note')}`;
  const note = notes.find(id);
  if (note?.kind === 'journal' && note.journal_date) return `/workspace/research/notes?day=${note.journal_date}`;
  return `${notesPath(note?.space || 'research')}?note=${encodeURIComponent(id.replace(/^p-/, ''))}`;
}

function notesPath(space) {
  return space === 'core' ? '/workspace/core/notes' : space === 'kms' ? '/workspace/kms/notes' : '/workspace/research/notes';
}

/* ==========================================================================
   RAIL
   Home and the workspaces the reader may open. This is the top level of the
   platform, so it is the top level of the interface.
   ========================================================================== */

/* The rail holds the workspaces and nothing else. It used to grow Research's
   own modules (Journal, Editor, Folder, Projects, Tasks, Search) when the
   reader was inside Research; that model was retired, and ws-five-layer.js
   rebuilds the rail as Dashboard · Learning · Research · Core. But it only
   installs once the platform bootstrap settles, so this first paint is what
   the reader sees for the seconds before that, and drawing the retired model
   here flashed it on every refresh. This draws the same buttons, with the
   same icons and in the same order, so the hand-over is invisible. */
function railArea(path = location.pathname) {
  if (path.startsWith('/workspace/core') || path.startsWith('/workspace/operating')) return 'core';
  if (path.startsWith('/workspace/research') || path.startsWith('/workspace/people') || path.startsWith('/workspace/community') || path.startsWith('/workspace/shared')) return 'research';
  if (path.startsWith('/workspace/learning') || path.startsWith('/workspace/kms')) return 'learning';
  if (path.startsWith('/workspace/dashboard') || path === '/workspace' || path.startsWith('/workspace/my-work')) return 'dashboard';
  return '';
}

function renderRail() {
  const rail = $('#ws-rail');
  rail.innerHTML = '';

  const area = railArea();
  rail.append(railButton('dashboard', 'Dashboard', area === 'dashboard', () => go('/workspace/dashboard')));
  rail.append(el('div', 'ws-rail__rule'));

  if (P.canOpenLms() || area === 'learning') rail.append(railButton('space-knowledge', 'Learning', area === 'learning', () => go('/workspace/learning')));
  if (P.canOpenResearch() || area === 'research') rail.append(railButton('space-research', 'Research', area === 'research', () => go('/workspace/research')));
  if (P.canOpenCore() || area === 'core') rail.append(railButton('space-core', 'Core', area === 'core', () => go('/workspace/core')));

  rail.append(el('div', 'ws-rail__spacer'));

  /* Settings sits under Pulsar, at the foot of the rail, which is
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

/* A workspace button. The markup is the one ws-five-layer.js used when it
   rebuilt this rail, which is what the rail has looked like: a native title
   rather than the shell's tooltip, and the fl-rail-button class the rail's
   styles address. */
function railButton(mark, label, active, onClick) {
  const btn = document.createElement('button');
  btn.className = 'ws-rail__btn fl-rail-button';
  btn.type = 'button';
  btn.innerHTML = icon(mark);
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.dataset.fiveLayer = label.toLowerCase().replace(/\s+/g, '-');
  if (active) btn.setAttribute('aria-current', 'page');
  btn.addEventListener('click', onClick);
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
  // Dashboard, Learning and Admin draw their own index; so does the Learning
  // index the Knowledge tools sit under.
  if ((fiveLayerOwns() && !shellDrawsIndex()) || learningIndexFor()) return;
  const title = $('#ws-index-title');
  const body = $('#ws-index-body');
  const foot = $('#ws-index-count');
  body.innerHTML = '';

  /* Settings belongs to the account rather than to a workspace, so its
     index is its own: the sections of the screen, each one a route. The
     pane used to be hidden here and every form stacked in one column, which
     put the password two screens below the picture and notifications below
     that, with nothing on screen to say either was there. */
  if (ui.route?.view === 'settings') {
    title.textContent = 'Settings';
    const list = document.createElement('div');
    list.className = 'ws-tree';
    for (const section of SETTINGS_SECTIONS) {
      list.append(sectionRow({
        label: section.label,
        hint: section.hint,
        mark: section.icon,
        depth: 0,
        active: ui.route.section === section.id,
        onClick: () => go(section.path),
      }));
    }
    body.append(list);
    foot.textContent = P.platform.user?.email || '';
    return;
  }

  if (ui.area === 'home') {
    title.textContent = 'Workspaces';
    body.append(...availableWorkspaces().map(workspaceChoice));
    foot.textContent = P.platform.boot ? 'Signed in' : '';
    return;
  }

  title.textContent = ui.area === 'research' ? 'Research' : (WORKSPACES[ui.area]?.name || 'Workspace');

  /* Deliberately not role="tree". That role carries a full keyboard
     contract: up and down across the whole flattened tree, home and end,
     typeahead, one tab stop for the entire widget. Only expand and collapse
     are implemented here, and a role that promises the rest and delivers
     none of it is worse for a screen-reader user than plain buttons, which
     is what these are. The nav landmark and the labels carry the meaning. */
  const tree = document.createElement('div');
  tree.className = 'ws-tree';

  let lastGroup = '';
  for (const [sectionIndex, section] of sectionsFor(ui.area).entries()) {
    if (section.group && section.group !== lastGroup) {
      const groupLabel = el('div', 'ws-index-group', section.group);
      tree.append(groupLabel);
      lastGroup = section.group;
    }
    const isOpen = ui.openSections.has(section.id);
    const visibleChildren = (section.children || []).filter((child) => !child.when || child.when());
    const hasChildren = !!visibleChildren.length;
    const active = section.match(location.pathname);

    // The index row carries the short name (Tasks, Team); the trail and the
    // page title keep the full one.
    const row = sectionRow({
      label: section.menu || section.label,
      hint: section.hint,
      mark: section.icon,
      depth: 0,
      active: active && !visibleChildren.some((c) => c.match(location.pathname)),
      expandable: hasChildren,
      expanded: isOpen,
      onToggle: () => {
        ui.openSections.has(section.id) ? ui.openSections.delete(section.id) : ui.openSections.add(section.id);
        writePrefs({ openSections: [...ui.openSections] });
        renderIndex();
      },
      onClick: () => go(section.path),
      series: String((sectionIndex % 4) + 1),
    });
    tree.append(row);

    if (!isOpen || !hasChildren) continue;

    const group = document.createElement('div');
    group.className = 'ws-node__kids';
    group.style.setProperty('--depth', 0);

    for (const child of visibleChildren) {
      group.append(sectionRow({
        label: child.label,
        mark: child.icon,
        depth: 1,
        active: child.match(location.pathname),
        onClick: () => go(child.path),
      }));
    }

    tree.append(group);
  }

  body.append(tree);
  // Owners and admins reach Platform Admin from the top of the Core index.
  if (ui.area === 'core' && P.isCoreAdmin()) body.prepend(coreAdminEntry(go));
  foot.textContent = '';
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

/* `hint` is the one-line answer to "what is in here?" drawn under a
   section's name. The product is new to most people who open it, and a
   column of bare nouns — Assets, Planning, Opportunities — asks them to
   click each one to find out, which reads as a test rather than a welcome.
   The label keeps its own span so a long hint never wraps into the name. */
function sectionRow({ label, hint = '', mark, depth, active, expandable, expanded, onToggle, onClick, series = '' }) {
  const wrap = document.createElement('div');
  wrap.className = 'ws-node';
  if (expanded) wrap.setAttribute('data-open', '');
  if (hint) wrap.dataset.hinted = '';

  const row = document.createElement('button');
  row.className = 'ws-node__row';
  row.type = 'button';
  row.style.setProperty('--depth', depth);
  if (active) row.setAttribute('aria-current', 'page');
  if (series) row.dataset.series = series;

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
  if (hint) row.append(el('span', 'ws-node__hint', hint));
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

/* ==========================================================================
   DOCK
   ========================================================================== */

/* Notifications lead, and the dock opens on them at every load. They are the
   one tab whose contents change without the reader doing anything, so they
   are what the panel is for when it first appears; the others answer
   questions the reader brings. The tab picked during a visit holds until the
   next load and is deliberately not restored after it, since a remembered
   "Tasks" would hide new notifications behind a click every day. */
const DOCK_TABS = [
  { id: 'inbox',     label: 'Notifications' },
  { id: 'tasks',     label: 'Tasks' },
  { id: 'journal',   label: 'Calendar' },
  { id: 'links',     label: 'Links' },
];

function renderDock() {
  const tabs = $('#ws-dock-tabs');
  tabs.innerHTML = '';
  for (const tab of DOCK_TABS) {
    const btn = document.createElement('button');
    btn.className = 'ws-tab';
    btn.type = 'button';
    btn.textContent = tab.label;
    btn.dataset.tab = tab.id;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(ui.dockTab === tab.id));
    btn.addEventListener('click', () => {
      ui.dockTab = tab.id;
      renderDock();
      renderRail();
      if (tab.id === 'inbox') refreshInbox();
    });
    tabs.append(btn);
  }
  paintInboxBadges();

  const body = $('#ws-dock-body');
  body.innerHTML = '';

  if (ui.dockTab === 'journal') renderDockJournal(body);
  else if (ui.dockTab === 'links') renderDockLinks(body);
  else if (ui.dockTab === 'inbox') renderDockInbox(body);
  // Anything else, including 'assistant' saved by the dock that used to
  // hold Pulsar, falls back to Tasks.
  else renderDockTasks(body);
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
      sub: P.meta([P.label(task.priority), P.formatDate(task.due_date)]),
      // The card opens over the current screen; an edit there refreshes this
      // list from bootstrap, and the board too when it is what sits beneath.
      onClick: () => views.openCoreTask(task.id, {
        go,
        // Not awaited: the dialog waits on this after every save, and the
        // list beside it can catch up without holding the card.
        onTaskChange: () => {
          P.loadBootstrap().then(() => {
            if (location.pathname === '/workspace/core/tasks') render();
            else renderDock();
          }).catch(() => {});
        },
      }),
    }));
  }
  body.append(list);
}

/* Notifications are the reader's own feed: comments and mentions on their
   tasks, replies, mentions and likes on their site comments, comments on Core
   content cards, deadline reminders. They come from one table on the server,
   whatever wrote them, so there is one unread count and it is the server's.

   The list is fetched once the shell is signed in and then once a minute
   while the tab is visible, so the unread badge on the tab and on the panel
   toggle is right even when the panel is shut. A hidden tab does not poll:
   nobody reads a badge in a background tab, and it comes back up to date on
   the visibilitychange that brings it forward. A failure keeps whatever was
   last shown and says so only on the tab itself, because a badge that drops
   to zero on a network blip is a false "you are all caught up". */
const inbox = { rows: null, unread: 0, error: '', loading: null, timer: 0 };
const INBOX_POLL_MS = 60_000;

function refreshInbox() {
  if (!P.platform.user) return Promise.resolve();
  if (inbox.loading) return inbox.loading;
  inbox.loading = P.taskInAppNotifications()
    .then((data) => {
      inbox.rows = data.notifications || [];
      inbox.unread = Number(data.unread_count) || 0;
      inbox.error = '';
    })
    .catch((error) => {
      inbox.error = error?.message || 'Notifications could not be loaded.';
    })
    .finally(() => {
      inbox.loading = null;
      paintInboxBadges();
      if (ui.dockTab === 'inbox') {
        const body = $('#ws-dock-body');
        if (body) { body.innerHTML = ''; renderDockInbox(body); }
      }
    });
  return inbox.loading;
}

function startInbox() {
  if (!P.platform.user || inbox.timer) return;
  refreshInbox();
  inbox.timer = setInterval(() => {
    if (document.visibilityState === 'visible') refreshInbox();
  }, INBOX_POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshInbox();
  });
}

function paintInboxBadges() {
  const count = inbox.unread > 99 ? '99+' : String(inbox.unread);
  const tab = $('#ws-dock-tabs [data-tab="inbox"]');
  if (tab) {
    tab.querySelector('.ws-tab__count')?.remove();
    if (inbox.unread) tab.append(el('span', 'ws-tab__count', count));
    tab.setAttribute('aria-label', inbox.unread ? `Notifications, ${inbox.unread} unread` : 'Notifications');
  }
  const toggle = $('#ws-toggle-dock');
  if (toggle) toggle.toggleAttribute('data-unread', inbox.unread > 0);
}

function timeAgo(iso) {
  const then = new Date(iso);
  const seconds = Math.round((Date.now() - then.getTime()) / 1000);
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/* The body is written for email and Telegram as well, so it carries the task
   name again and an "Open task:" link. The panel shows the first two lines
   that are not either of those. */
function noticeSummary(notice) {
  return String(notice.body || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^Open (task|Gravitas\+):/.test(line) && !line.startsWith('Task: '))
    .slice(0, 2)
    .join(' · ');
}

function openNotice(notice) {
  if (!notice.read) {
    notice.read = true;
    inbox.unread = Math.max(0, inbox.unread - 1);
    paintInboxBadges();
    P.markTaskInAppNotificationsRead([notice.id], false).catch(() => {});
  }
  const raw = notice.payload?.url || (notice.task_id ? `/workspace/core/tasks?task=${notice.task_id}` : '');
  if (!raw) { renderDock(); return; }
  let target;
  try { target = new URL(raw, location.origin); } catch { renderDock(); return; }
  // Links are written with the public base URL so they work from an email.
  // Inside the shell only the path matters, which also keeps the preview
  // server on its own origin.
  const path = target.pathname + target.search;
  if (target.pathname.startsWith('/workspace')) go(path);
  else location.assign(path + target.hash);
}

function renderDockInbox(body) {
  if (!P.platform.user) {
    body.append(views.empty('Not connected', 'Notifications need a signed in session.'));
    return;
  }
  if (inbox.rows === null) {
    if (inbox.error) {
      body.append(views.empty('Notifications unavailable', inbox.error));
      const retry = el('button', 'ws-btn', 'Try again');
      retry.type = 'button';
      retry.style.margin = '0 12px';
      retry.addEventListener('click', () => { body.innerHTML = ''; views.skeleton(4, body); refreshInbox(); });
      body.append(retry);
    } else {
      views.skeleton(4, body);
      refreshInbox();
    }
    return;
  }

  /* An empty inbox says one thing once. It used to print "All caught up" as
     the list's head and "Nothing yet" as its body, two verdicts on the same
     empty list that read as a contradiction. */
  if (!inbox.rows.length && !inbox.error) {
    const clear = el('div', 'ws-inbox__clear');
    const mark = el('span', 'ws-inbox__clear-mark');
    mark.innerHTML = icon('inbox');
    clear.append(
      mark,
      el('p', 'ws-inbox__clear-title', 'All caught up'),
      el('p', 'ws-inbox__clear-body', 'Comments on your tasks, mentions, replies and deadline reminders land here.'),
    );
    body.append(clear);
    return;
  }

  const head = el('div', 'ws-inbox__head');
  head.append(el('span', 'ws-inbox__state', inbox.error
    ? 'Could not refresh'
    : (inbox.unread ? `${inbox.unread} unread` : 'All caught up')));
  if (inbox.unread) {
    const all = el('button', 'ws-inbox__all', 'Mark all read');
    all.type = 'button';
    all.addEventListener('click', async () => {
      all.disabled = true;
      try {
        await P.markTaskInAppNotificationsRead([], true);
        for (const row of inbox.rows) row.read = true;
        inbox.unread = 0;
        renderDock();
      } catch {
        all.disabled = false;
      }
    });
    head.append(all);
  }
  body.append(head);

  if (!inbox.rows.length) {
    body.append(views.empty('Nothing loaded', 'The inbox could not be reached. It refreshes on its own when the connection returns.'));
    return;
  }

  const list = el('div', 'ws-inbox');
  for (const notice of inbox.rows) {
    const item = el('button', 'ws-inbox__item');
    item.type = 'button';
    if (!notice.read) item.dataset.unread = '';
    const main = el('span', 'ws-inbox__main');
    main.append(el('span', 'ws-inbox__title', notice.title));
    const summary = noticeSummary(notice);
    if (summary) main.append(el('span', 'ws-inbox__body', summary));
    const time = el('time', 'ws-inbox__time', timeAgo(notice.created_at));
    time.dateTime = notice.created_at;
    main.append(time);
    item.append(el('span', 'ws-inbox__dot'), main);
    item.addEventListener('click', () => openNotice(notice));
    list.append(item);
  }
  body.append(list);
}

function renderDockJournal(body) {
  body.append(calendarEl());

  const days = [...writtenDays()].sort().reverse();
  const heading = el('p', 'ws-pane__title', 'Written days');
  heading.style.cssText = 'padding:12px 12px 4px;border-top:1px solid var(--g-hairline);margin-top:8px';
  body.append(heading);

  if (!days.length) {
    body.append(views.empty('No day notes yet', 'Pick a day above to write its note. Days that have one are underlined.'));
    return;
  }

  const list = document.createElement('div');
  list.className = 'ws-list';
  for (const day of days.slice(0, 12)) {
    const date = new Date(day + 'T00:00:00');
    list.append(views.row({
      title: date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
      onClick: () => openDay(date),
    }));
  }
  body.append(list);
}

/* Which notes point at the one open in Notes, by [[its title]]. */
async function renderDockLinks(body) {
  const open = ui.openNote;
  if (!open || !location.pathname.includes('/notes')) {
    body.append(views.empty('No note open', 'Open a note in Notes to see which notes link to it.'));
    return;
  }
  views.skeleton(3, body);
  await notes.load();
  body.innerHTML = '';
  const links = notes.backlinksTo(open.title, open.id);
  if (!links.length) {
    body.append(views.empty('No backlinks', `Nothing links to ${open.title} yet. Write [[${open.title}]] in another note to make one.`));
    return;
  }
  const list = document.createElement('div');
  list.className = 'ws-list';
  for (const link of links) {
    list.append(views.row({ title: link.title, sub: link.excerpt, onClick: () => go(notes.pathFor(link)) }));
  }
  body.append(list);
}

/* Every calendar opens a day the same way: as that day's note in Notes,
   which is Markdown in the reader's Nextcloud. There used to be a separate
   day editor here with its own save path; a day clicked twice could become
   two notes. Notes asks the server for the day, and the server answers with
   the note that already exists. */
function dayNotePath(date) {
  return `/workspace/research/notes?day=${localDayKey(date)}`;
}

function openDay(date) {
  ui.selectedDay = date;
  ui.calMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  go(dayNotePath(date));
}

/* Prefilled blocks become the Markdown a note is stored as, so a heading is
   a heading in Notes, in Nextcloud and in Obsidian. */
function blocksToMarkdown(blocks = []) {
  return (blocks || []).map((block) => {
    const text = String(block.text || '');
    switch (block.type) {
      case 'h2': return `## ${text}`;
      case 'h3': return `### ${text}`;
      case 'ul': return text.split('\n').map((line) => `- ${line}`).join('\n');
      case 'quote': return text.split('\n').map((line) => `> ${line}`).join('\n');
      case 'code': return `\`\`\`\n${text}\n\`\`\``;
      case 'equation': return `$$\n${text}\n$$`;
      default: return text;
    }
  }).join('\n\n').trim();
}

// Days written this session, reported by Notes, so the calendar marks a new
// day without waiting for the page index to be fetched again.
const notedDays = new Set();
const writtenDays = () => new Set([...notes.journalDays(), ...notedDays]);

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
  const written = writtenDays();
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
    if (written.has(localDayKey(date))) btn.setAttribute('data-has', '');
    btn.setAttribute('aria-pressed', String(date.toDateString() === ui.selectedDay.toDateString()));
    btn.setAttribute('aria-label', date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }));
    btn.addEventListener('click', () => openDay(date));
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
  if (fiveLayerOwns() || learningIndexFor()) return;
  const host = $('#ws-crumbs');
  host.innerHTML = '';

  const crumbs = [];
  if (ui.route?.view === 'settings') {
    // Settings belongs to the account, not to either workspace. Showing a
    // workspace in the trail here would claim these preferences are scoped
    // to it, and they are not.
    crumbs.push({ label: 'Home', path: '/workspace/my-work' });
    crumbs.push({ label: 'Settings', path: '/workspace/settings' });
    crumbs.push({ label: settingsSection(ui.route.section).label });
  } else if (ui.area === 'home') {
    crumbs.push({ label: 'Home' });
  } else {
    const workspace = WORKSPACES[ui.area];
    crumbs.push({ label: 'Home', path: '/workspace/my-work' });
    crumbs.push({ label: workspace.name, path: workspace.home });

    const { section, child } = activeSection(ui.area, location.pathname);
    if (section) crumbs.push({ label: section.label, path: section.path });
    if (child) crumbs.push({ label: child.label, path: child.path });

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
function viewContext() {
  return {
    go,
    booting: ui.booting,
    canCore: P.canOpenCore(),
    reload: () => start(),

    // Pulsar is the floating widget now, not a dock tab; this opens a new
    // conversation on the question there.
    openAssistant: (question) => askAssistant(question),

    // Notes
    area: ui.area,
    space: spaceOf(ui.area),

    /* Scoped by default to the workspace the reader is standing in. Passing
       no space returns every page, which only the palette wants: search is
       the one place where finding a page in another workspace is the point
       rather than a leak. */
    pages: (space) => notes.bySpace(space),
    pagesOnServer: () => true,
    pathOf: (id) => {
      const note = notes.find(id);
      return note ? (note.folder ? note.folder.split('/').join(' / ') : SPACE_LABEL[note.space] || 'Notes') : '';
    },
    notePath: (note) => notes.pathFor(note),
    when: relative,
    // Days open in Notes; the Research calendar only needs to know it went.
    openJournal: async (date) => {
      openDay(date);
      return { date: localDayKey(date) };
    },

    /* One creator for all three workspaces. It lands the page in the space
       the reader is in unless told otherwise, under that space's default
       root, and can pre-fill the blocks — which is what lets Sources open a
       distillation note with its headings already written instead of
       handing somebody a blank page at the exact moment the method matters.

       It returns the page, so a caller that needs the id (to link a source
       to it) does not have to guess it or re-read the tree. */
    newNote: async ({ space, title = 'Untitled note', blocks, open = true } = {}) => {
      const target = space || spaceOf(ui.area);
      let result;
      try {
        result = await P.call('/platform/nextcloud/notes/', {
          method: 'POST',
          body: { title, content: blocksToMarkdown(blocks), space: target },
        });
      } catch {
        return null;
      }
      const item = result?.item;
      if (!item) return null;
      const made = { id: String(item.id), title: item.title, space: target };
      if (open) go(`${notesPath(target)}?note=${made.id}`);
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

function paintPaneState() {
  const shell = $('#ws');
  if (!shell) return;
  shell.dataset.dock = ui.dock ? 'on' : 'off';
  shell.dataset.index = ui.index ? 'on' : 'off';
  const indexToggle = $('#ws-toggle-index');
  const dockToggle = $('#ws-toggle-dock');
  if (indexToggle) indexToggle.setAttribute('aria-pressed', String(ui.index));
  if (dockToggle) dockToggle.setAttribute('aria-pressed', String(ui.dock));
  shell.dataset.area = ui.area;
}

const NOTEBOOK_VIEWS = new Set(['notes', 'core-notes']);

function render() {
  paintPaneState();

  renderRail();
  renderCrumbs();
  renderIndex();
  renderDock();

  const host = $('#ws-view');

  /* Dashboard, Learning, Admin, Daily Work Reports and project pages are
     drawn by ws-five-layer, called from here. Before the account bootstrap
     answers every access check reads "no access", so until then the shell
     holds a placeholder rather than letting a screen redirect the reader. */
  if (fiveLayerOwns()) {
    stopClock();
    leaveNotes();
    if (ui.booting) renderHandoff();
    else renderFiveLayer(host, { go, renderNotesMirror: renderMirrorRoute });
    updateStatus();
    return;
  }

  /* Notes is drawn by ws-nextcloud-native.js, the notebook backed by
     Nextcloud. This router used to draw its own older Notes screen first —
     a list over the browser-only page store, with a warning that the page
     service was not deployed — and the notebook replaced it only when its
     data arrived, so every refresh showed the wrong screen for seconds. The
     router now leaves the notebook in place, or holds an empty pane for it. */
  if (NOTEBOOK_VIEWS.has(ui.route?.view)) {
    stopClock();
    if (!host.querySelector(':scope > .nc-notes')) host.replaceChildren();
    if (!ui.booting) renderNotesRoute(host);
    updateStatus();
    return;
  }
  leaveNotes();
  host.innerHTML = '';
  if (learningIndexFor() && !ui.booting) renderFiveLayer(host, { go });

  // The clock on the dashboard runs on an interval. Every path out of the
  // dashboard goes through here, so this is the one place that can promise
  // the timer is not left writing into a node no longer on the page.
  stopClock();

  const view = ui.route?.view || 'home';
  const ctx = viewContext();

  if (view === 'home') renderDashboard(host, ctx, 'home');
  else if (view === 'core') renderDashboard(host, ctx, 'core');
  else if (view === 'research') renderDashboard(host, ctx, 'research');
  else if (view === 'research-calendar') research.renderCalendar(host, ctx);
  else if (view === 'research-folders') research.renderFolders(host, ctx);
  else if (view === 'research-tasks') research.renderTasks(host, ctx);
  else if (view === 'research-search') research.renderSearch(host, ctx);
  else if (view === 'kms') kms.renderKmsOverview(host, ctx);
  else if (view === 'core-tasks') views.renderCoreTasks(host, ctx);
  else if (view === 'core-meetings') meetings.renderCoreMeetings(host, ctx);
  else if (view === 'core-content') renderCoreContent(host);
  else if (view === 'core-team') renderCoreTeam(host, ctx);
  else if (view === 'core-planning') views.renderCorePlanning(host, ctx);
  else if (view === 'core-assets') assets.renderCoreAssets(host, ctx);
  else if (view === 'core-blueprint') assets.renderContentStudioBlueprint(host, ctx);
  else if (view === 'kms-library') library.renderLibrary(host, ctx);
  else if (view === 'kms-paths') kms.renderKmsPaths(host, ctx);
  else if (view === 'kms-path') kms.renderKmsPath(host, ui.route.id, ctx);
  else if (view === 'kms-sources') kms.renderKmsSources(host, ctx);
  else if (view === 'kms-base') kms.renderKmsBase(host, ctx);
  else if (view === 'kms-recall') kms.renderKmsRecall(host, ctx);
  else if (view === 'kms-skills') kms.renderKmsSkills(host, ctx);
  else if (view === 'projects') research.renderProjects(host, ctx);
  else if (view === 'resources') views.renderResources(host, ui.route.kind);
  else if (view === 'mindmaps') views.renderMindMaps(host, ctx);
  else if (view === 'collaboration') views.renderCollaboration(host, ctx);
  else if (view === 'people') views.renderPeople(host, ctx);
  else if (view === 'community') views.renderCommunity(host, ctx);
  else if (view === 'shared') views.renderShared(host, ctx);
  else if (view === 'settings') renderSettings(host, ctx);

  updateStatus();
}

function updateStatus() {
  // Saving and word counts are the notebook's; the shell's bar says who is signed in.
  const save = $('#ws-save');
  if (save) save.hidden = true;
  const words = $('#ws-words');
  if (words) words.textContent = '';

  const mode = $('#ws-mode');
  if (P.platform.error === 'signed-out') {
    mode.textContent = 'Signed out';
    mode.title = 'Sign in to load your workspaces.';
  } else if (P.platform.boot) {
    const who = P.platform.boot.access.core ? 'Core and Research' : 'Research';
    mode.textContent = who;
    mode.title = `Signed in. Workspaces you can open: ${who}.`;
  } else if (!P.platform.settled) {
    /* Not yet an answer, so not yet a verdict. This branch used to fall
       through to "Offline / The platform did not answer" on the first paint,
       every time, which is the shell reporting a failure it has not observed —
       the one thing ui.booting exists to prevent. */
    mode.textContent = 'Connecting';
    mode.title = 'Loading your workspaces.';
  } else {
    mode.textContent = 'Offline';
    mode.title = 'The platform did not answer.';
  }

  const pages = $('#ws-pages-mode');
  if (pages) pages.textContent = '';
}

/* ==========================================================================
   PANE RESIZE
   ========================================================================== */

/* A grip also closes its pane: dragged well past the pane's minimum width,
   the pane dims to say it will close on release, and dragging back out
   cancels that. The threshold sits below the minimum rather than at it, so
   somebody narrowing a pane to its smallest width does not lose it by
   overshooting a few pixels. On close the width goes back to what it was
   when the drag began, so the toggle reopens the pane the reader had, not
   the sliver it was dragged down to. */
const CLOSE_BELOW = 0.5;

function wireGrip(grip, { variable, min, max, from, close }) {
  const read = () => parseInt(getComputedStyle(document.documentElement).getPropertyValue(variable), 10);
  const pane = grip.closest('.ws__index, .ws__dock');

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
    let closing = false;

    const move = (moveEvent) => {
      const delta = (moveEvent.clientX - startX) * (from === 'right' ? -1 : 1);
      const raw = startWidth + delta;
      closing = Boolean(close) && raw < min * CLOSE_BELOW;
      pane?.toggleAttribute('data-closing', closing);
      const width = Math.min(max, Math.max(min, raw));
      document.documentElement.style.setProperty(variable, width + 'px');
      publish();
    };
    const up = (upEvent) => {
      grip.releasePointerCapture(event.pointerId);
      grip.removeAttribute('data-active');
      pane?.removeAttribute('data-closing');
      $('#ws').removeAttribute('data-resizing');
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      if (closing && upEvent.type === 'pointerup') {
        document.documentElement.style.setProperty(variable, startWidth + 'px');
        publish();
        close();
        return;
      }
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
  installSelects();
  installAssistant({
    go,
    pulsarContext: () => {
      const area = railArea(location.pathname);
      const currentProjectId = ui.route?.view === 'project' ? ui.route.id : null;
      return {
        surface: area === 'core' ? 'core' : (area === 'learning' ? 'learning' : 'research'),
        project_id: currentProjectId || undefined,
        thread_id: 'primary',
      };
    },
  });

  const prefs = readPrefs();
  if (Array.isArray(prefs.openSections)) ui.openSections = new Set(prefs.openSections);
  if (typeof prefs.dock === 'boolean') ui.dock = prefs.dock;
  if (prefs['--ws-index-w']) document.documentElement.style.setProperty('--ws-index-w', prefs['--ws-index-w']);
  if (prefs['--ws-dock-w']) document.documentElement.style.setProperty('--ws-dock-w', prefs['--ws-dock-w']);

  /* Below 1100px the dock is an overlay over the page rather than a column
     beside it, and below 860px the index is too. An overlay starts closed:
     restoring a saved "open" on a phone puts a panel over the screen
     somebody asked for. Both are watched rather than read once, because a
     tablet rotating crosses these lines without a reload.

     closeOverlays dismisses whatever is floating and reports whether anything
     actually closed, so a caller can skip a redraw it does not need. */
  const closeOverlays = () => {
    let changed = false;
    if (NARROW.matches && ui.index) { ui.index = false; changed = true; }
    if (DOCK_FLOATS.matches && ui.dock) { ui.dock = false; changed = true; }
    return changed;
  };

  const applyWidth = () => {
    ui.index = NARROW.matches ? false : readPrefs().index !== false;
    ui.dock = DOCK_FLOATS.matches ? false : readPrefs().dock !== false;
    paintPaneState();
    renderDock();
  };
  NARROW.addEventListener('change', applyWidth);
  DOCK_FLOATS.addEventListener('change', applyWidth);

  /* Two overlays over one phone screen is one too many, so opening either
     closes the other. On a desktop both are columns and neither is in the
     other's way, which is why the exclusion is conditional rather than a
     rule of the shell. A width where a pane floats is also a width whose
     pane state is not worth remembering: the preference belongs to the
     machine the reader works on, not to the phone they checked it from.
     The toggles and the drag-to-close grips share these two, so a pane
     closed either way is remembered the same way. */
  const setIndex = (open) => {
    ui.index = open;
    if (ui.index && NARROW.matches) ui.dock = false;
    if (!NARROW.matches) writePrefs({ index: ui.index });
    paintPaneState();
  };
  const setDock = (open) => {
    ui.dock = open;
    if (ui.dock && NARROW.matches) ui.index = false;
    if (!DOCK_FLOATS.matches) writePrefs({ dock: ui.dock });
    paintPaneState();
    renderDock();
  };

  wireGrip($('#ws-grip-index'), { variable: '--ws-index-w', min: 200, max: 460, from: 'left', close: () => setIndex(false) });
  wireGrip($('#ws-grip-dock'), { variable: '--ws-dock-w', min: 260, max: 520, from: 'right', close: () => setDock(false) });

  $('#ws-toggle-index').addEventListener('click', () => setIndex(!ui.index));
  $('#ws-toggle-dock').addEventListener('click', () => setDock(!ui.dock));
  $('#ws-open-palette').addEventListener('click', () => openPalette());

  // The scrim is a pseudo-element on the shell, so a tap landing on the shell
  // itself rather than on a pane is a tap on the scrim.
  $('#ws').addEventListener('click', (event) => {
    if (event.target === $('#ws') && closeOverlays()) {
      paintPaneState();
      renderDock();
    }
  });

  /* Escape dismisses a floating pane, which is what every overlay on the web
     has taught people to expect. The palette is checked first: it is the
     overlay above these, it handles its own Escape, and closing the panel
     underneath at the same time would answer a keypress twice. */
  addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (document.querySelector('.ws-palette:not([hidden])')) return;
    if (closeOverlays()) {
      paintPaneState();
      renderDock();
    }
  });

  /* Navigating is the reader saying they are done with the panel they
     navigated from. render() follows from the route change itself, so this
     only has to set the state. */
  addEventListener('ws:navigate', closeOverlays);

  // Notes reports the note it shows, for the dock's backlinks.
  addEventListener('ws:note-open', (event) => {
    ui.openNote = event.detail?.id ? { id: String(event.detail.id), title: String(event.detail.title || '') } : null;
    if (ui.dockTab === 'links') renderDock();
  });

  // Notes reports the day it opened: the calendar shows it selected and marked.
  addEventListener('ws:journal-day', (event) => {
    const key = String(event.detail?.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
    notedDays.add(key);
    const date = new Date(key + 'T00:00:00');
    ui.selectedDay = date;
    ui.calMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    if (ui.dockTab === 'journal') renderDock();
  });

  // One router: back, forward and every module that navigates by popstate.
  addEventListener('popstate', () => apply(location.pathname + location.search));

  ui.index = !NARROW.matches && prefs.index !== false;
  ui.dock = !DOCK_FLOATS.matches && prefs.dock !== false;
  // An address that only redirects (/workspace, /workspace/kms) is replaced
  // before the first paint, so that paint is the destination, not Home.
  const redirect = fiveLayerRoute(location.pathname);
  if (redirect?.kind === 'redirect') history.replaceState({}, '', redirect.to);
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

  const memberOnly = !P.canOpenLms() && !P.canOpenResearch() && !P.canOpenCore();
  const shell = $('#ws');
  if (shell) shell.toggleAttribute('data-member-only', memberOnly);
  if (memberOnly) {
    ui.index = false;
    paintPaneState();
  }

  // The rail shows the profile picture, so it needs the profile. Fired
  // without awaiting: the shell must not wait on a decoration.
  P.myProfile().then((data) => { ui.profile = data.profile; renderRail(); }).catch(() => {});
  startInbox();

  if (P.platform.error === 'signed-out') {
    // Deliberately not a redirect. The old shell bounced to /login from
    // inside its fetch wrapper, which threw away whatever was open.
    render();
    return;
  }

  // Dashboard/LMS-only accounts do not use the editor tree. Avoid hydrating
  // Research/Space entirely for them: this both enforces the layer boundary
  // in the client and removes a large unnecessary startup request.
  if (!P.canOpenResearch() && !P.canOpenCore()) {
    const here = location.pathname;
    if (here.startsWith('/workspace/research') || here.startsWith('/workspace/operating') || here.startsWith('/workspace/core')) {
      history.replaceState({}, '', '/workspace/dashboard');
    }
    render();
    return;
  }

  /* The notes index feeds the calendar marks, search and the Knowledge Base.
     It is a local read, and it is awaited so those screens draw once rather
     than drawing empty and again. */
  await notes.load();

  mountPalette({
    go, platform: P,
    searchNotes: (query) => notes.search(query),
    notePath: (note) => notes.pathFor(note),
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
