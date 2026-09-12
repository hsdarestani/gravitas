/* ==========================================================================
   GRAVITAS+ WORKSPACE  ·  NAVIGATION MODEL
   Three workspaces and one Home. The rail is the top level of the product,
   so it is the top level of this file too, and every other surface — the
   index tree, the breadcrumb, the command palette, the router — reads its
   shape from here rather than keeping a second copy.

   The three are split by the question each one answers.

     Core       · are we shipping?   Work with a deadline and an owner.
     Research   · what is true?      Projects, evidence, collaborators.
     Knowledge  · what do we know?   What we have learned and can reuse.

   That split is the whole navigation argument. A note about a paper you are
   reading to get better at your job is not the same object as a note
   attached to a client deliverable, even though both are "a note", and
   filing them in one list is what turns a knowledge base into a drawer.

   Every route the previous workspace published still resolves, so existing
   links and bookmarks keep working.
   ========================================================================== */

import { canOpenCore, isCoreAdmin } from './ws-platform.js';

/* The workspaces, in the order the rail offers them. Core comes first for
   the people who can open it, because they are the ones who live in it. */
export const WORKSPACES = {
  core: {
    id: 'core',
    name: 'Core Workspace',
    blurb: 'Internal team operations',
    long: 'Run Gravitas+: projects, tasks, content production, operating assets and priorities.',
    icon: 'space-core',
    home: '/workspace/core',
    note: 'Internal Gravitas+ workspace. Projects, execution, content and team planning. Visible only to members of the core team.',
  },
  research: {
    id: 'research',
    name: 'Research Workspace',
    blurb: 'Projects and scientific collaboration',
    long: 'Scientific research, client projects, secure data rooms, notes, datasets and researcher collaboration.',
    icon: 'space-research',
    home: '/workspace/research',
    note: 'Research collaboration workspace. Access is granted per project or item; private notes and files stay private until shared.',
  },
  kms: {
    id: 'kms',
    name: 'Knowledge Workspace',
    blurb: 'Learning and the knowledge base',
    long: 'Learn deliberately: the sources you are reading, the notes you have distilled, the recall that keeps them, and the skills they add up to.',
    icon: 'space-knowledge',
    home: '/workspace/kms',
    note: 'The knowledge management workspace. Everything here is learning: what you are reading, what you have written down, what you are rehearsing, and what it has made you able to do.',
  },
};

/* ---- Sections -----------------------------------------------------------
   `match` decides which entry is lit. It is a function rather than a prefix
   string because several routes belong to one entry: Files & Data Rooms
   also covers datasets, mind maps and anything shared with the reader.

   `space` on a tree section says which page space its branch opens. The
   page store is one store — one editor, one link graph, one search — but a
   tree section shows only the roots belonging to its own workspace, which
   keeps a Core meeting note out of the research tree without splitting the
   model into three incompatible copies of the same editor. */

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
    /* The backend has carried this section since the first Core build and
       the frontend never drew it, so the one operating asset the team has
       actually written was reachable only by typing its URL. It is a
       section rather than a page: a blueprint is the thing tasks and
       standards get cut from, which puts it upstream of both boards above
       it rather than beside them. */
    id: 'core-assets',
    label: 'Assets & Blueprints',
    icon: 'storage',
    path: '/workspace/core/assets',
    match: under('/workspace/core/assets'),
    children: [
      {
        id: 'core-asset-content-studio',
        label: 'Content Studio Blueprint',
        icon: 'content',
        path: '/workspace/core/assets/content-studio-blueprint',
        match: under('/workspace/core/assets/content-studio-blueprint'),
      },
    ],
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
    /* Core's own pages: meeting notes, decisions, and the draft of a
       standard before it has earned its way into a blueprint. Same editor
       and same link graph as every other note in the product, a different
       branch of the tree. */
    id: 'core-notes',
    label: 'Notes',
    icon: 'notes',
    path: '/workspace/core/notes',
    match: under('/workspace/core/notes'),
    tree: true,
    space: 'core',
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
    id: 'res-calendar',
    label: 'Calendar',
    icon: 'meeting',
    path: '/workspace/research/calendar',
    match: under('/workspace/research/calendar'),
  },
  {
    id: 'res-editor',
    label: 'Editor',
    icon: 'notes',
    path: '/workspace/research/editor',
    // Keep the former /notes URL as a first-class alias so existing links
    // continue to open the same Editor module.
    match: any(under('/workspace/research/editor'), under('/workspace/research/notes'), under('/workspace/page')),
    tree: true,
    space: 'research',
  },
  {
    id: 'res-folders',
    label: 'Folder',
    icon: 'files',
    path: '/workspace/research/folders',
    match: any(under('/workspace/research/folders'), under('/workspace/folder'), under('/workspace/research/files'), under('/workspace/research/datasets'), under('/workspace/research/mindmaps'), under('/workspace/shared')),
    children: [
      { id: 'res-files',    label: 'Files & Data Rooms', icon: 'files',    path: '/workspace/research/files',     match: under('/workspace/research/files') },
      { id: 'res-datasets', label: 'Datasets',           icon: 'datasets', path: '/workspace/research/datasets',  match: under('/workspace/research/datasets') },
      { id: 'res-maps',     label: 'Mind Maps',          icon: 'mindmap',  path: '/workspace/research/mindmaps',  match: under('/workspace/research/mindmaps') },
      { id: 'res-shared',   label: 'Shared with me',     icon: 'share',    path: '/workspace/shared',             match: under('/workspace/shared') },
    ],
  },
  {
    id: 'res-projects',
    label: 'Projects',
    icon: 'projects',
    path: '/workspace/research/projects',
    match: under('/workspace/research/projects'),
  },
  {
    id: 'res-tasks',
    label: 'Tasks',
    icon: 'tasks',
    path: '/workspace/research/tasks',
    match: under('/workspace/research/tasks'),
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

/* ---- Knowledge ----------------------------------------------------------
   These five are the learning loop, in order, and this is the only index in
   the product meant to be read as a sequence:

     Sources    what is coming in, and what has not been read yet
     Knowledge  what has been distilled into your own words
     Recall     what you are rehearsing so it is still there next month
     Skills     what all of it has made you able to do

   Learning Paths sits above the loop rather than inside it. It is the
   curriculum: the entry somebody opens when they do not know what to work
   on, which is most mornings, and the only screen here that can answer
   "what next" with one name instead of a list. */
export const KMS_SECTIONS = [
  {
    id: 'kms-overview',
    label: 'Overview',
    icon: 'overview',
    path: '/workspace/kms',
    match: exact('/workspace/kms'),
  },
  {
    id: 'kms-paths',
    label: 'Learning Paths',
    icon: 'planning',
    path: '/workspace/kms/paths',
    match: under('/workspace/kms/paths'),
  },
  {
    id: 'kms-sources',
    label: 'Sources',
    icon: 'files',
    path: '/workspace/kms/sources',
    match: under('/workspace/kms/sources'),
  },
  {
    id: 'kms-base',
    label: 'Knowledge Base',
    icon: 'notes',
    path: '/workspace/kms/base',
    match: under('/workspace/kms/base'),
    tree: true,
    space: 'kms',
  },
  {
    id: 'kms-recall',
    label: 'Recall & Review',
    icon: 'cycle',
    path: '/workspace/kms/recall',
    match: under('/workspace/kms/recall'),
  },
  {
    id: 'kms-skills',
    label: 'Skills',
    icon: 'target',
    path: '/workspace/kms/skills',
    match: under('/workspace/kms/skills'),
  },
];

/* ---- Area resolution ----------------------------------------------------
   One function, used by the rail, the index, the breadcrumb and the router,
   so those four can never disagree about where the reader is. */

export function areaOf(path) {
  const here = path.replace(/\/$/, '');
  if (here === '/workspace' || here === '/workspace/my-work') return 'home';
  if (here.startsWith('/workspace/core') || here.startsWith('/workspace/operating')) return 'core';
  if (here.startsWith('/workspace/kms')) return 'kms';
  return 'research';
}

export function sectionsFor(area) {
  const list = area === 'core' ? CORE_SECTIONS
    : area === 'kms' ? KMS_SECTIONS
      : RESEARCH_SECTIONS;
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

/* Which workspaces this reader may open. Research and Knowledge are always
   available; Core depends on membership. */
export function availableWorkspaces() {
  const out = [];
  if (canOpenCore()) out.push(WORKSPACES.core);
  out.push(WORKSPACES.research, WORKSPACES.kms);
  return out;
}

/* The page space a workspace writes into. One place to ask, so the editor,
   the tree, the palette and every "New note" button cannot disagree about
   where a new page lands. Home has no space of its own: a note made from
   Home goes to the knowledge base, which is the only space that is nobody's
   project and therefore the safe default. */
export function spaceOf(area) {
  if (area === 'core') return 'core';
  if (area === 'research') return 'research';
  return 'kms';
}

/* Where a page lives, said in words. The editor's breadcrumb and the search
   results use it, because "Correction log" alone does not tell you whether
   you are about to edit a team standard or your own reading note. */
export const SPACE_LABEL = {
  core: 'Core',
  research: 'Research',
  kms: 'Knowledge',
};

/* The notes screen each space opens from. Used by the editor to offer a way
   back that lands in the workspace the page belongs to rather than in
   whichever one the reader happened to come from. */
export const SPACE_HOME = {
  core: '/workspace/core/notes',
  research: '/workspace/research/editor',
  kms: '/workspace/kms/base',
};
