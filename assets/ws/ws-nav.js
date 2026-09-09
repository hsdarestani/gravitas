/* ==========================================================================
   GRAVITAS+ WORKSPACE  ·  NAVIGATION MODEL
   Two workspaces, one Home. This is the structure the platform already had
   and it is preserved exactly: same areas, same routes, same access rules.
   What changed is only how it is presented, from a sidebar of flat links to
   the index tree the rest of the shell uses.

   Every route below is one the previous workspace published, so existing
   links and bookmarks still resolve.
   ========================================================================== */

import { canOpenCore, isCoreAdmin } from './ws-platform.js';

/* The two workspaces, in the order they are offered. Core comes first for
   the people who can open it, because they are the ones who live in it. */
export const WORKSPACES = {
  core: {
    id: 'core',
    name: 'Core Workspace',
    blurb: 'Internal team operations',
    long: 'Run Gravitas+: projects, tasks, content production and operating priorities.',
    icon: 'overview',
    home: '/workspace/core',
    note: 'Internal Gravitas+ workspace. Projects, execution, content and team planning. Visible only to members of the core team.',
  },
  research: {
    id: 'research',
    name: 'Research Workspace',
    blurb: 'Projects and scientific collaboration',
    long: 'Scientific research, client projects, secure data rooms, notes, datasets and researcher collaboration.',
    icon: 'collaboration',
    home: '/workspace/research',
    note: 'Research collaboration workspace. Access is granted per project or item; private notes and files stay private until shared.',
  },
};

/* ---- Sections -----------------------------------------------------------
   `match` decides which entry is lit. It is a function rather than a prefix
   string because several routes belong to one entry: Files & Data Rooms
   also covers datasets, mind maps and anything shared with the reader. */

const exact = (path) => (here) => here.replace(/\/$/, '') === path;
const under = (path) => (here) => here === path || here.startsWith(path + '/');
const any = (...tests) => (here) => tests.some((test) => test(here));

export const CORE_SECTIONS = [
  {
    id: 'core-overview',
    label: 'Overview',
    icon: 'overview',
    path: '/workspace/core',
    match: exact('/workspace/core'),
  },
  {
    id: 'core-tasks',
    label: 'Tasks & Execution',
    icon: 'tasks',
    path: '/workspace/core/tasks',
    match: under('/workspace/core/tasks'),
  },
  {
    id: 'core-content',
    label: 'Content Pipeline',
    icon: 'content',
    path: '/workspace/core/content',
    match: under('/workspace/core/content'),
  },
  {
    id: 'core-planning',
    label: 'Planning & Projects',
    icon: 'planning',
    path: '/workspace/operating',
    match: under('/workspace/operating'),
    children: [
      { id: 'op-initiatives', label: 'Initiatives', icon: 'target', path: '/workspace/operating/initiatives', match: under('/workspace/operating/initiatives') },
      { id: 'op-cycles',      label: 'Cycles',      icon: 'cycle',  path: '/workspace/operating/cycles',      match: under('/workspace/operating/cycles') },
    ],
  },
  {
    id: 'core-team',
    label: 'Team & Access',
    icon: 'team',
    path: '/workspace/core/team',
    match: under('/workspace/core/team'),
    // Owners and admins only. The server refuses the data either way; this
    // keeps the entry out of the tree rather than offering a dead end.
    when: isCoreAdmin,
  },
];

export const RESEARCH_SECTIONS = [
  {
    id: 'res-overview',
    label: 'Overview',
    icon: 'overview',
    path: '/workspace/research',
    match: exact('/workspace/research'),
  },
  {
    id: 'res-projects',
    label: 'Projects',
    icon: 'projects',
    path: '/workspace/research/projects',
    match: under('/workspace/research/projects'),
  },
  {
    id: 'res-library',
    label: 'Files & Data Rooms',
    icon: 'files',
    path: '/workspace/research/files',
    match: any(under('/workspace/research/files'), under('/workspace/shared')),
    children: [
      { id: 'res-datasets', label: 'Datasets',  icon: 'datasets', path: '/workspace/research/datasets', match: under('/workspace/research/datasets') },
      { id: 'res-maps',     label: 'Mind Maps', icon: 'mindmap',  path: '/workspace/research/mindmaps', match: under('/workspace/research/mindmaps') },
      { id: 'res-shared',   label: 'Shared with me', icon: 'share', path: '/workspace/shared',          match: under('/workspace/shared') },
    ],
  },
  {
    /* Notes is the knowledge base: the tree, the editor, the journal and the
       backlinks. It sits inside Research because that is whose work it is,
       and it expands into the page tree rather than into more links. */
    id: 'res-pages',
    label: 'Notes',
    icon: 'notes',
    path: '/workspace/research/notes',
    match: any(under('/workspace/research/notes'), under('/workspace/page'), under('/workspace/folder')),
    tree: true,
  },
  {
    id: 'res-collab',
    label: 'Collaboration',
    icon: 'collaboration',
    path: '/workspace/research/nextcloud',
    match: any(under('/workspace/research/nextcloud'), under('/workspace/people'), under('/workspace/community')),
    children: [
      { id: 'res-people',    label: 'Researchers',    icon: 'team',     path: '/workspace/people',    match: under('/workspace/people') },
      { id: 'res-community', label: 'Opportunities',  icon: 'planning', path: '/workspace/community', match: under('/workspace/community') },
    ],
  },
];

/* ---- Area resolution ----------------------------------------------------
   One function, used by the rail, the index, the breadcrumb and the router,
   so those four can never disagree about where the reader is. */

export function areaOf(path) {
  const here = path.replace(/\/$/, '');
  if (here === '/workspace' || here === '/workspace/my-work') return 'home';
  if (here.startsWith('/workspace/core') || here.startsWith('/workspace/operating')) return 'core';
  return 'research';
}

export function sectionsFor(area) {
  const list = area === 'core' ? CORE_SECTIONS : RESEARCH_SECTIONS;
  return list.filter((section) => !section.when || section.when());
}

/* Walks the section tree and returns the deepest entry that matches, so a
   child lights its own row and its parent stays open around it. */
export function activeSection(area, path) {
  for (const section of sectionsFor(area)) {
    for (const child of section.children || []) {
      if (child.match(path)) return { section, child };
    }
    if (section.match(path)) return { section, child: null };
  }
  return { section: null, child: null };
}

/* The label the breadcrumb and the document heading use. Derived from the
   same section table, so a renamed section is renamed everywhere at once. */
export function titleFor(area, path) {
  if (area === 'home') return 'Home';
  const { section, child } = activeSection(area, path);
  return child?.label || section?.label || 'Overview';
}

/* Which workspaces this reader may open. Research is always available;
   Core depends on membership. */
export function availableWorkspaces() {
  const out = [];
  if (canOpenCore()) out.push(WORKSPACES.core);
  out.push(WORKSPACES.research);
  return out;
}
