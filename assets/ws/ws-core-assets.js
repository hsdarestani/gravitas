/* ==========================================================================
   GRAVITAS+ WORKSPACE  ·  CORE · ASSETS
   Shared team files live here. The visible Assets page is deliberately a
   simple upload folder backed by the Core team's Nextcloud Team Folder.

   The legacy Content Studio Blueprint detail view is kept below so old direct
   links continue to resolve, but it is no longer presented as part of Assets.
   ========================================================================== */

import * as P from './ws-platform.js?v=20260918-access3';
import { el, panel, row } from './ws-views.js';

const icon = (name) => window.GravitasIcons.icon(name, 'g-wi');


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

export function renderCoreAssets(host) {
  host.innerHTML = '';
  const doc = el('div', 'ws-doc ws-doc--wide');
  host.append(doc);

  const head = el('header', 'ws-doc__head');
  head.append(el('h1', 'ws-doc__title', 'Assets'));
  head.append(el('p', 'ws-doc__meta', 'Shared Core team files with folders and explicit version history, synchronized to the team Nextcloud folder.'));
  doc.append(head);

  const library = panel('Team assets');
  library.body.append(el('div', 'fl-skeleton'));
  doc.append(library);
  renderLiveAssetLibrary(library.body);
}

function assetFolderLabel(value) {
  return value || 'Root';
}

async function uploadAssetVersion(base, file, note = '') {
  const body = new FormData();
  body.append('title', base.title);
  body.append('folder_path', base.folder_path || '');
  body.append('version_of_id', String(base.id));
  body.append('version_note', note);
  body.append('visible_to_all_core', '1');
  body.append('file', file);
  return P.uploadCoreAsset(body);
}

async function renderLiveAssetLibrary(host) {
  try {
    const data = await P.coreAssets();
    host.innerHTML = '';

    const cloudState = data.nextcloud?.state || 'unavailable';
    const cloudBar = el('div', 'v-note');
    cloudBar.dataset.tone = cloudState === 'live' ? 'good' : (cloudState === 'partial' ? 'warn' : 'bad');
    const cloudText = cloudState === 'live'
      ? 'Nextcloud sync active · ' + (data.nextcloud?.mountpoint || 'Gravitas Assets')
      : cloudState === 'partial'
        ? 'Nextcloud is connected, but one or more older local assets still need to finish syncing.'
        : 'Nextcloud is currently unavailable. Existing files remain listed, but new uploads are paused.';
    cloudBar.append(document.createTextNode(cloudText));
    if (data.nextcloud?.files_url) {
      const openCloud = el('a', 'ws-btn ws-btn--tiny', 'Open in Nextcloud');
      openCloud.href = data.nextcloud.files_url;
      openCloud.target = '_blank';
      openCloud.rel = 'noopener';
      openCloud.style.marginInlineStart = '10px';
      cloudBar.append(openCloud);
    }
    host.append(cloudBar);

    const form = el('form', 'fl-form');
    const uploadGrid = el('div', 'fl-form-grid');
    const title = el('input', 'v-input fl-input');
    title.placeholder = 'Display name (optional for one file)';
    const folder = el('input', 'v-input fl-input');
    folder.placeholder = 'Folder, e.g. Brand/Logos';
    folder.setAttribute('list', 'core-asset-folders');
    const folderOptions = el('datalist');
    folderOptions.id = 'core-asset-folders';
    for (const value of data.folders || []) {
      const option = document.createElement('option');
      option.value = value;
      folderOptions.append(option);
    }
    uploadGrid.append(title, folder);
    const file = el('input', 'v-input fl-input');
    file.type = 'file';
    file.multiple = true;
    const submit = el('button', 'ws-btn ws-btn--solid', 'Upload files');
    submit.type = 'submit';
    submit.disabled = cloudState === 'unavailable';
    const note = el('p', 'v-note');
    form.append(uploadGrid, folderOptions, file, submit, note);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const files = [...(file.files || [])];
      if (!files.length) {
        note.textContent = 'Choose one or more files to upload.';
        note.dataset.tone = 'bad';
        return;
      }
      submit.disabled = true;
      note.dataset.tone = '';
      try {
        for (let index = 0; index < files.length; index += 1) {
          const current = files[index];
          note.textContent = 'Uploading ' + (index + 1) + ' of ' + files.length + '…';
          const body = new FormData();
          const displayTitle = files.length === 1 && title.value.trim() ? title.value.trim() : current.name;
          body.append('title', displayTitle);
          body.append('folder_path', folder.value.trim());
          body.append('visible_to_all_core', '1');
          body.append('file', current);
          await P.uploadCoreAsset(body);
        }
        await renderLiveAssetLibrary(host);
      } catch (error) {
        note.textContent = error?.message === 'file_size_invalid'
          ? 'One of the files is too large.'
          : error?.message === 'nextcloud_unavailable'
            ? 'Nextcloud is temporarily unavailable. Upload is paused.'
            : (error?.message || 'Upload failed.');
        note.dataset.tone = 'bad';
        submit.disabled = false;
      }
    });
    host.append(form);

    const groups = [...(data.groups || [])].sort((a, b) => {
      const folderCompare = String(a.folder_path || '').localeCompare(String(b.folder_path || ''));
      return folderCompare || String(a.title || '').localeCompare(String(b.title || ''));
    });
    if (!groups.length) {
      host.append(el('p', 'v-note', 'This folder is empty.'));
      return;
    }

    let activeFolder = null;
    let folderHost = null;
    for (const group of groups) {
      const current = group.versions.find((item) => item.id === group.current_id) || group.versions[0];
      if (!current) continue;
      const folderKey = group.folder_path || '';
      if (folderKey !== activeFolder) {
        activeFolder = folderKey;
        const section = el('section', 'g-stack g-stack--sm');
        section.append(el('h3', null, assetFolderLabel(folderKey)));
        folderHost = el('div', 'g-stack g-stack--sm');
        section.append(folderHost);
        host.append(section);
      }

      const actions = el('div', 'v-row__actions');
      if (current.kind === 'file') {
        const download = el('a', 'ws-btn ws-btn--tiny', 'Download');
        download.href = current.download_url;
        actions.append(download);

        if (current.can_edit) {
          const versionInput = document.createElement('input');
          versionInput.type = 'file';
          versionInput.hidden = true;
          versionInput.addEventListener('change', async () => {
            const picked = versionInput.files?.[0];
            if (!picked) return;
            const versionNote = prompt('Version note (optional):', '') || '';
            try {
              await uploadAssetVersion(current, picked, versionNote);
              await renderLiveAssetLibrary(host);
            } catch (error) {
              alert(error?.message || 'New version could not be uploaded.');
            }
          });
          host.append(versionInput);
          const newVersion = el('button', 'ws-btn ws-btn--tiny', 'New version');
          newVersion.type = 'button';
          newVersion.addEventListener('click', () => versionInput.click());
          actions.append(newVersion);
        }
      } else if (current.source_url) {
        const open = el('a', 'ws-btn ws-btn--tiny', 'Open URL');
        open.href = current.source_url;
        open.target = '_blank';
        open.rel = 'noopener';
        actions.append(open);
      }

      if (current.can_edit) {
        const edit = el('button', 'ws-btn ws-btn--tiny', 'Rename / move');
        edit.type = 'button';
        edit.addEventListener('click', async () => {
          const nextTitle = prompt('Display name:', current.title);
          if (nextTitle == null || !nextTitle.trim()) return;
          const nextFolder = prompt('Folder path:', current.folder_path || '') ?? (current.folder_path || '');
          try {
            await P.updateCoreAsset(current.id, { title: nextTitle.trim(), folder_path: nextFolder.trim() });
            await renderLiveAssetLibrary(host);
          } catch (error) {
            alert(error?.message || 'Asset could not be updated.');
          }
        });
        actions.append(edit);

        const remove = el('button', 'ws-btn ws-btn--tiny', 'Delete current');
        remove.type = 'button';
        remove.addEventListener('click', async () => {
          if (!confirm('Delete current version of “' + current.title + '”? Older versions stay available.')) return;
          remove.disabled = true;
          try {
            await P.deleteCoreAsset(current.id);
            await renderLiveAssetLibrary(host);
          } catch (error) {
            remove.disabled = false;
            alert(error?.message || 'Version could not be deleted.');
          }
        });
        actions.append(remove);
      }

      const badges = [
        'v' + current.version,
        current.version_count + (current.version_count === 1 ? ' version' : ' versions'),
        current.file_size ? P.formatBytes(current.file_size) : '',
        current.storage_backend === 'nextcloud' ? 'Nextcloud' : '',
        current.uploader,
      ].filter(Boolean);

      folderHost.append(row({
        title: current.title,
        sub: current.version_note || current.original_name || current.source_url || '',
        badges,
        action: actions,
      }));

      if (group.versions.length > 1) {
        const history = el('details', 'v-panel');
        const historySummary = document.createElement('summary');
        historySummary.textContent = 'Version history · ' + group.versions.length;
        history.append(historySummary);
        const historyList = el('div', 'g-stack g-stack--xs');
        for (const version of group.versions) {
          const versionActions = el('div', 'v-row__actions');
          if (version.kind === 'file') {
            const get = el('a', 'ws-btn ws-btn--tiny', 'Download v' + version.version);
            get.href = version.download_url;
            versionActions.append(get);
          }
          historyList.append(row({
            title: 'v' + version.version + ' · ' + version.original_name,
            sub: version.version_note || '',
            badges: [new Date(version.created_at).toLocaleString(), version.uploader, version.is_current ? 'Current' : ''].filter(Boolean),
            action: versionActions,
          }));
        }
        history.append(historyList);
        folderHost.append(history);
      }
    }
  } catch (error) {
    host.innerHTML = '';
    const note = el('div', 'ws-alert');
    note.append(
      el('strong', 'ws-alert__title', 'Asset folder unavailable'),
      el('p', '', error?.message || 'Could not load team assets.'),
    );
    host.append(note);
  }
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

  const back = el('button', 'v-back', 'Assets');
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

/* The inspector is where the blueprint stops being a diagram. It explains
   scope and ownership and can hand the question to Plusar; task creation
   deliberately stays in Tasks & Execution. */
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

  /* Task creation intentionally does not live in the blueprint. */
  const discuss = el('button', 'ws-btn', 'Ask about this section');
  discuss.type = 'button';
  discuss.addEventListener('click', () => {
    ctx.openAssistant(`In the Content Studio Blueprint, what should section ${section.n}, ${section.title}, cover, and what is the risk if ${section.owner} leaves it vague?`);
  });

  actions.append(discuss);
  host.append(actions);
}

function metaCell(label, value) {
  const cell = el('div', 'v-inspector__cell');
  cell.append(el('span', null, label));
  cell.append(el('b', null, value));
  return cell;
}
