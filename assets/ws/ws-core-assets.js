/* ==========================================================================
   GRAVITAS+ WORKSPACE  ·  CORE · ASSETS & BLUEPRINTS
   The section the backend has always exposed and the frontend never drew.

   What an asset is here. Not a file and not a document: a reusable operating
   system for one part of the company, versioned, owned, and upstream of the
   work it produces. The Content Studio Blueprint is the first one. Its whole
   purpose is to be cut into tasks, which is why every section on this screen
   ends in a way to do exactly that rather than in a download button.

   Why this replaces assets/core-blueprints.js. That file painted the same
   material into the pre-v4 shell with its own zoom control, its own
   fullscreen mode and a pannable canvas. The canvas was the problem: it made
   a sixteen-item list into a map you had to navigate, and the one question
   anybody actually arrives with — which section is mine, and what do I do
   with it — needed three gestures to answer. The content is preserved
   exactly; the navigation is a list and an inspector.
   ========================================================================== */

import * as P from './ws-platform.js';
import { el, panel, row, stats } from './ws-views.js';

const icon = (name) => window.GravitasIcons.icon(name, 'g-wi');

const BLUEPRINT_PATH = '/workspace/core/assets/content-studio-blueprint';

/* ---- The blueprint ------------------------------------------------------
   Sixteen sections, unchanged from the approval draft. `band` says where a
   section sits in the operating picture rather than what colour it is:
   `flow` sections happen in order and each one hands to the next, `support`
   sections are consulted by all of them, and `governance` binds every one.

   The eleven `flow` ids, in this order, are the lifecycle. It is written out
   once, here, rather than derived by filtering, because the order is an
   editorial decision — repurposing after measurement, not before — and a
   filter would silently lose it the day somebody reorders the array. */

export const SECTIONS = [
  { id: 'strategy',     n: '01', title: 'Content Strategy & Objectives',        short: 'Strategy',            owner: 'Ahmad',            band: 'flow',       desc: 'Defines why Gravitas+ creates content, who it is for, which themes matter, and what success should look like.', scope: ['Purpose & North Star', 'Audience & pillars', 'Strategic value'] },
  { id: 'formats',      n: '02', title: 'Content Types & Formats',              short: 'Types & Formats',     owner: 'Ahmad + Kiarash',  band: 'support',    desc: 'Defines the content formats Gravitas+ can produce and when each format should be used across channels.', scope: ['Format catalogue', 'Use case by format', 'Channel fit'] },
  { id: 'discovery',    n: '03', title: 'Idea & Content Discovery',             short: 'Discovery',           owner: 'Ahmad',            band: 'flow',       desc: 'Creates a repeatable way to find, capture and prioritise strong content ideas from signals, questions and opportunities.', scope: ['Signals & sources', 'Idea intake', 'Prioritisation'] },
  { id: 'research',     n: '04', title: 'Research & Scientific Validation',     short: 'Research',            owner: 'Sajad',           band: 'flow',       desc: 'Turns an approved idea into evidence-backed material and checks scientific accuracy before production moves forward.', scope: ['Research process', 'Evidence standard', 'Scientific validation'] },
  { id: 'planning',     n: '05', title: 'Content Planning',                     short: 'Planning',            owner: 'Ahmad',            band: 'flow',       desc: 'Converts the idea and research into a clear brief, required resources, production approach and expected deliverables.', scope: ['Brief', 'Resources', 'Production plan'] },
  { id: 'production',   n: '06', title: 'Content Production',                   short: 'Production',          owner: 'Kiarash + Ahmad',  band: 'flow',       desc: 'Creates the actual content through writing, recording, visual production and assembly.', scope: ['Writing & script', 'Recording / build', 'Revision loop'], note: 'Shared section ownership. Each task created inside Production must have exactly one named owner.' },
  { id: 'design',       n: '07', title: 'Design & Content Experience',          short: 'Design & Experience', owner: 'Kiarash',          band: 'support',    desc: 'Defines how content looks and feels, including visual language, templates, hierarchy and interactive presentation.', scope: ['Visual language', 'Templates', 'Interactive experience'] },
  { id: 'review',       n: '08', title: 'Review & Quality Control',             short: 'Review',              owner: 'Sajad',           band: 'flow',       desc: 'Checks scientific correctness, clarity and quality, then gives the final content approval before release.', scope: ['Scientific review', 'Editorial quality', 'Approval logic'] },
  { id: 'publishing',   n: '09', title: 'Publishing',                           short: 'Publish',             owner: 'Kiarash',          band: 'flow',       desc: 'Prepares the approved asset for release with the correct format, metadata, presentation and publishing checklist.', scope: ['Publishing checklist', 'Metadata & SEO', 'Final release'] },
  { id: 'distribution', n: '10', title: 'Distribution',                         short: 'Distribution',        owner: 'Ahmad',            band: 'flow',       desc: 'Decides where, when and how published content is distributed so it reaches the right audience across channels.', scope: ['Channels', 'Timing', 'Cross-distribution'] },
  { id: 'measurement',  n: '11', title: 'Measurement & Learning',               short: 'Measure',             owner: 'Kiarash',          band: 'flow',       desc: 'Tracks performance, captures what worked or failed, and feeds practical learning back into the next content cycle.', scope: ['KPIs', 'Analytics', 'Learning loop'] },
  { id: 'repurposing',  n: '12', title: 'Repurposing & Content Atomisation',    short: 'Repurpose',           owner: 'Ahmad',            band: 'flow',       desc: 'Turns strong existing content into smaller or adapted assets for new formats, channels and future reuse.', scope: ['Derivative assets', 'Format conversion', 'Reuse logic'] },
  { id: 'archive',      n: '13', title: 'Content Archive & Knowledge Integration', short: 'Archive',          owner: 'Hossein',          band: 'flow',       desc: 'Stores final assets, source material and lessons in a searchable system so future work can reuse the knowledge.', scope: ['Asset library', 'Knowledge links', 'Version history'] },
  { id: 'operations',   n: '14', title: 'Content Operations & Workflow',        short: 'Content Ops',         owner: 'Hossein',          band: 'support',    desc: 'Defines statuses, ownership rules, dependencies and how the whole content process is represented inside the Core Workspace.', scope: ['Statuses & ownership', 'Dependencies', 'Workspace implementation'] },
  { id: 'ai',           n: '15', title: 'AI & Automation',                      short: 'AI & Automation',     owner: 'Hossein',          band: 'support',    desc: 'Defines where AI or automation can accelerate the workflow and where human judgment or review must remain mandatory.', scope: ['Assistive AI', 'Automation points', 'Human review boundaries'] },
  { id: 'governance',   n: '16', title: 'Content Risk & Governance',            short: 'Risk & Governance',   owner: 'Hossein + Sajad', band: 'governance', desc: 'Sets the cross-cutting rules for scientific risk, copyright, AI use, corrections, accountability and content ownership.', scope: ['Scientific risk', 'Copyright & AI use', 'Corrections & ownership'] },
];

const LIFECYCLE = [
  'strategy', 'discovery', 'research', 'planning', 'production',
  'review', 'publishing', 'distribution', 'measurement', 'repurposing', 'archive',
];

const find = (id) => SECTIONS.find((section) => section.id === id);

/* ==========================================================================
   THE LIBRARY
   ========================================================================== */

export function renderCoreAssets(host, ctx) {
  host.innerHTML = '';
  const doc = el('div', 'ws-doc ws-doc--wide');
  host.append(doc);

  const head = el('header', 'ws-doc__head');
  head.append(el('h1', 'ws-doc__title', 'Assets & Blueprints'));
  head.append(el('p', 'ws-doc__meta', 'System-level operating assets the company owns. Versioned, owned, and upstream of the work they produce.'));
  doc.append(head);

  doc.append(stats([
    ['System assets', 1],
    ['In approval', 1],
    ['Sections drafted', SECTIONS.length],
    ['Current release', 'v0.2'],
  ]));

  const columns = el('div', 'v-columns v-columns--top');

  const library = panel('Asset library');
  library.body.append(assetCard(ctx));
  columns.append(library);

  /* What "in approval" means, said once, on the screen where somebody first
     meets the word. A blueprint that is approved binds work; one that is not
     is a proposal, and the difference decides whether you are allowed to cut
     tasks from it this week. */
  const phase = panel('What happens next');
  phase.body.append(stepRow('01', 'Approve scope and ownership', 'The team confirms what each section means and who owns it. This is where the blueprint is now.', true));
  phase.body.append(stepRow('02', 'Cut sections into tasks', 'Each approved section becomes tasks in Tasks & Execution. Every task names exactly one owner.', false));
  phase.body.append(stepRow('03', 'Commit deadlines', 'Owners confirm dates they believe, and execution starts against the cycle.', false));

  const note = el('p', 'v-note');
  note.dataset.tone = 'warn';
  note.textContent = 'Nothing is cut into tasks before step one finishes. A blueprint that produces work while its sections are still being argued about produces the argument twice.';
  phase.body.append(note);
  columns.append(phase);

  doc.append(columns);
}

function assetCard(ctx) {
  const card = el('button', 'v-asset');
  card.type = 'button';
  card.addEventListener('click', () => ctx.go(BLUEPRINT_PATH));

  const mark = el('span', 'v-asset__icon');
  mark.innerHTML = icon('content');

  const body = el('span', 'v-asset__body');
  body.append(el('strong', null, 'Content Studio Blueprint'));
  body.append(el('span', 'v-asset__long', 'The operating architecture of Gravitas+ content: strategy and discovery through research, production, publishing, learning and governance.'));

  const badges = el('span', 'v-badges');
  for (const text of ['GSA-001', 'Blueprint', 'v0.2', 'Team approval', '16 sections']) {
    badges.append(el('span', 'v-badge', text));
  }
  body.append(badges);

  const arrow = el('span', 'v-workspace__go');
  arrow.innerHTML = icon('arrow');

  card.append(mark, body, arrow);
  return card;
}

function stepRow(number, title, body, current) {
  const node = el('div', 'v-step');
  if (current) node.dataset.current = 'true';
  node.append(el('b', 'v-step__n', number));
  const main = el('div', 'v-step__main');
  main.append(el('strong', null, title));
  main.append(el('small', null, body));
  node.append(main);
  return node;
}

/* ==========================================================================
   THE BLUEPRINT
   A list and an inspector, not a canvas. The lifecycle reads top to bottom
   as eleven numbered stages; the four sections that serve every stage sit
   beside it rather than in the sequence, because putting them in the
   sequence is what made the previous version claim that Design happens
   after Production.
   ========================================================================== */

export function renderContentStudioBlueprint(host, ctx) {
  host.innerHTML = '';
  const doc = el('div', 'ws-doc ws-doc--wide');
  host.append(doc);

  const back = el('button', 'v-back', 'Assets & Blueprints');
  back.type = 'button';
  back.addEventListener('click', () => ctx.go('/workspace/core/assets'));
  doc.append(back);

  const head = el('header', 'ws-doc__head');
  head.append(el('h1', 'ws-doc__title', 'Content Studio Blueprint'));
  head.append(el('p', 'ws-doc__meta', 'Approval draft. Confirm what each section means and who owns it, before any of it becomes work.'));
  doc.append(head);

  const chips = el('div', 'v-badges v-badges--lead');
  for (const text of ['GSA-001', 'v0.2', 'Team approval', 'Scope: Core', `${SECTIONS.length} sections`]) {
    chips.append(el('span', 'v-badge', text));
  }
  doc.append(chips);

  /* The split: the map on the left, one section under the glass on the
     right. The inspector is sticky, so choosing the eleventh stage does not
     scroll its detail off the top of the screen. */
  const split = el('div', 'v-split');
  const left = el('div', 'v-split__main');
  const right = el('aside', 'v-split__aside');
  split.append(left, right);

  let selected = 'strategy';
  const inspector = el('div', 'v-inspector');
  right.append(inspector);

  const select = (id) => {
    selected = id;
    for (const node of left.querySelectorAll('[data-section]')) {
      node.toggleAttribute('aria-current', node.dataset.section === id);
    }
    drawInspector(inspector, find(id), ctx);
  };

  /* ---- Lifecycle ------------------------------------------------------- */
  const flow = el('section', 'v-panel');
  const flowHead = el('div', 'v-panel__head');
  flowHead.append(el('h2', null, 'The lifecycle'));
  flowHead.append(el('span', 'v-panel__note', 'Eleven stages, in order. Each one hands to the next.'));
  flow.append(flowHead);

  const stages = el('ol', 'v-flow');
  LIFECYCLE.forEach((id, at) => stages.append(stageEl(find(id), at + 1, select)));
  flow.append(stages);
  left.append(flow);

  /* ---- Support and governance ------------------------------------------ */
  const support = panel('Consulted by every stage');
  for (const id of ['formats', 'design', 'operations', 'ai']) {
    support.body.append(sideEl(find(id), select));
  }
  left.append(support);

  const governance = panel('Binding on every stage');
  governance.body.append(sideEl(find('governance'), select));
  const govNote = el('p', 'v-note');
  govNote.textContent = 'Governance is the only section that can stop a release after approval. That is what makes it a band rather than a stage.';
  governance.body.append(govNote);
  left.append(governance);

  select(selected);
  doc.append(split);

  /* ---- The full ledger -------------------------------------------------- */
  const ledger = panel('All sections and owners');
  for (const section of SECTIONS) {
    ledger.body.append(row({
      title: `${section.n} · ${section.title}`,
      sub: section.desc,
      badges: [section.owner, section.band === 'flow' ? 'Lifecycle' : section.band === 'support' ? 'Support' : 'Governance'],
      onClick: () => {
        select(section.id);
        inspector.scrollIntoView({ behavior: 'smooth', block: 'center' });
      },
    }));
  }
  doc.append(ledger);
}

/* Numbered by position in the lifecycle, not by section number. Numbering
   these by section number produced a column reading 01, 03, 04, 05, 06, 08 —
   because sections 02 and 07 are support rather than stages — under a
   heading that promised eleven stages in order, which reads as a list with
   pieces missing. The section number is still shown, small, beside the
   owner, so the ledger below and the inspector beside it can still be found
   from here. */
function stageEl(section, position, select) {
  const node = el('li', 'v-stage');
  node.dataset.section = section.id;

  const button = el('button', 'v-stage__hit');
  button.type = 'button';
  button.addEventListener('click', () => select(section.id));

  button.append(el('span', 'v-stage__n', String(position).padStart(2, '0')));
  const main = el('span', 'v-stage__main');
  main.append(el('strong', null, section.short));
  main.append(el('small', null, section.desc));
  button.append(main);

  const owner = el('span', 'v-stage__owner');
  owner.append(el('span', 'v-stage__ref', `§${section.n}`));
  owner.append(document.createTextNode(section.owner));
  button.append(owner);

  node.append(button);
  return node;
}

function sideEl(section, select) {
  const node = el('button', 'v-row');
  node.type = 'button';
  node.dataset.section = section.id;
  node.addEventListener('click', () => select(section.id));

  const main = el('div', 'v-row__main');
  main.append(el('strong', null, `${section.n} · ${section.short}`));
  main.append(el('small', null, section.desc));
  node.append(main);
  node.append(el('span', 'v-stage__owner', section.owner));
  return node;
}

/* The inspector is where the blueprint stops being a diagram. Everything a
   reader can do with a section is here: read what it covers, argue with it,
   or turn it into work. */
function drawInspector(host, section, ctx) {
  host.innerHTML = '';

  host.append(el('p', 'v-inspector__kicker', `Section ${section.n}`));
  host.append(el('h3', 'v-inspector__title', section.title));
  host.append(el('p', 'v-inspector__desc', section.desc));

  if (section.note) {
    const note = el('p', 'v-note');
    note.dataset.tone = 'warn';
    note.textContent = section.note;
    host.append(note);
  }

  host.append(el('p', 'v-inspector__label', 'This section covers'));
  const scope = el('ul', 'v-inspector__scope');
  for (const item of section.scope) scope.append(el('li', null, item));
  host.append(scope);

  const meta = el('div', 'v-inspector__meta');
  meta.append(metaCell('Owner', section.owner));
  meta.append(metaCell('State', 'Approval pending'));
  host.append(meta);

  const actions = el('div', 'v-inspector__actions');

  /* Cutting a section into tasks is the point of the whole asset, so it is
     the primary action on every section rather than a menu item somewhere.
     It writes a real task through the operating API; if that fails the
     reader is told, and nothing local pretends otherwise. */
  const cut = el('button', 'ws-btn ws-btn--solid', 'Cut into a task');
  cut.type = 'button';
  cut.addEventListener('click', async () => {
    cut.disabled = true;
    cut.textContent = 'Creating…';
    try {
      await P.call('/operating/tasks/', {
        method: 'POST',
        body: { title: `${section.title} — define and own`, description: section.desc },
      });
      ctx.go('/workspace/core/tasks');
    } catch {
      cut.disabled = false;
      cut.textContent = 'Cut into a task';
      const failed = el('p', 'v-note');
      failed.dataset.tone = 'bad';
      failed.textContent = 'The task was not created. The server did not accept it, and nothing was changed.';
      actions.after(failed);
    }
  });

  const discuss = el('button', 'ws-btn', 'Ask about this section');
  discuss.type = 'button';
  discuss.addEventListener('click', () => {
    ctx.openAssistant(`In the Content Studio Blueprint, what should section ${section.n}, ${section.title}, cover, and what is the risk if ${section.owner} leaves it vague?`);
  });

  actions.append(cut, discuss);
  host.append(actions);
}

function metaCell(label, value) {
  const cell = el('div', 'v-inspector__cell');
  cell.append(el('span', null, label));
  cell.append(el('b', null, value));
  return cell;
}
