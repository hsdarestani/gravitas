import { call } from './ws-platform.js?v=20261016-task1&patch=20261027reliability1';

const CENTER = '/workspace/core/releases';
const EDITOR = '/workspace/core/visual-editor';
const API = '/release-center/';
const stylesheet = '/assets/ws/ws-release-center.css';
const stateLabels = {
  draft: 'Draft', submitted: 'Submitted', awaiting_validation: 'Awaiting validation',
  ready_for_qa: 'Ready for QA', in_review: 'In review', changes_requested: 'Changes requested',
  approved: 'Approved', released: 'Rehearsed', rejected: 'Rejected', rolled_back: 'Restored',
};
const actions = {
  draft: [['submit', 'Submit for review']],
  submitted: [['validate', 'Start validation']],
  awaiting_validation: [['ready', 'Ready for QA']],
  ready_for_qa: [['review', 'Start review']],
  in_review: [['approve', 'Approve'], ['corrections', 'Request corrections'], ['reject', 'Reject']],
  approved: [['rehearse', 'Publish to isolated preview'], ['rehearse_application', 'Deploy to isolated release target']],
  released: [['restore', 'Draft a restoration'], ['rollback_application', 'Roll back isolated release']],
};

function node(tag, value, attrs = {}) {
  const el = document.createElement(tag);
  if (value != null) el.textContent = value;
  for (const [key, val] of Object.entries(attrs)) el.setAttribute(key, val);
  return el;
}

function link(label, href) {
  return node('a', label, {href, class: 'g-btn g-btn--secondary g-btn--sm'});
}

function button(label, handler, primary = false) {
  const el = node('button', label, {type: 'button', class: `g-btn g-btn--${primary ? 'primary' : 'secondary'} g-btn--sm`});
  el.addEventListener('click', handler);
  return el;
}

function field(label, input) {
  const el = node('label', label, {class: 'gq-release-field'});
  el.append(input);
  return el;
}

function status(message) {
  return node('p', message, {role: 'status', 'aria-live': 'polite', class: 'gq-release-status'});
}

function shell(host, heading, description, target) {
  if (!document.querySelector(`link[href="${stylesheet}"]`)) {
    document.head.append(node('link', null, {rel: 'stylesheet', href: stylesheet}));
  }
  const main = node('section', null, {class: 'gq-release'});
  const header = node('header', null, {class: 'gq-release-header'});
  const headingGroup = node('div');
  headingGroup.append(node('h1', heading), node('p', description));
  header.append(headingGroup, link(target === EDITOR ? 'Visual Editor' : 'Release Center', target));
  main.append(header);
  host.replaceChildren(main);
  return main;
}

async function perform(control, message, work) {
  control.disabled = true;
  message.textContent = 'Saving…';
  try {
    await work();
  } catch (error) {
    message.textContent = error?.data?.error || error.message || 'The request could not be saved.';
  } finally {
    control.disabled = false;
  }
}

function selection(items, value) {
  const select = node('select');
  for (const [key, label] of items) select.append(node('option', label, {value: key}));
  select.value = value ?? items[0]?.[0] ?? '';
  return select;
}

function compare(change, section) {
  if (change.kind !== 'visual') {
    if (change.pr) section.append(link(`GitHub PR #${change.pr}`, `https://github.com/hsdarestani/gravitas/pull/${change.pr}`));
    if (change.sha) section.append(node('p', `Proposed commit ${change.sha}`));
    if (change.previous_sha) section.append(node('p', `Previous commit ${change.previous_sha}`));
    return;
  }
  const table = node('table', null, {class: 'gq-release-compare'});
  const head = node('thead');
  const headers = node('tr');
  for (const label of ['Property', 'Previous', 'Proposed']) headers.append(node('th', label, {scope: 'col'}));
  head.append(headers);
  table.append(head);
  const body = node('tbody');
  for (const [key, value] of Object.entries(change.after)) {
    const row = node('tr');
    row.append(node('th', key.replaceAll('_', ' '), {scope: 'row'}), node('td', change.before[key]), node('td', value));
    body.append(row);
  }
  table.append(body);
  section.append(table, link('Open draft preview', `/api${API}visual/${change.page}/preview/?change=${change.id}`));
  if (change.state === 'released' || change.state === 'rolled_back') {
    section.append(link('Open isolated publication', `/api${API}visual/${change.page}/preview/?target=rehearsal`));
  }
}

async function details(id, holder, capabilities, userId, refresh) {
  holder.replaceChildren(status('Loading change…'));
  try {
    const {change} = await call(`${API}changes/${id}/`);
    const heading = node('h2', change.title);
    const label = stateLabels[change.state] || change.state;
    holder.replaceChildren(heading, node('p', `Change #${change.id} · Revision ${change.revision} · ${label} · ${change.author}`));
    if (change.description) holder.append(node('p', change.description));
    if (change.task) holder.append(node('p', `Development task #${change.task}`));
    if (change.affected) holder.append(node('p', `Affected: ${change.affected}`));
    if (change.source_reference) holder.append(node('p', `Source reference: ${change.source_reference}`));
    if (change.acceptance) holder.append(node('p', change.acceptance));
    compare(change, holder);
    const actorIsAuthor = userId === change.author_id;
    const message = status('');
    const note = node('textarea', null, {rows: '2', maxlength: '2000'});
    const controls = node('div', null, {class: 'gq-release-actions'});
    const ciRun = node('input', null, {inputmode: 'numeric', pattern: '[0-9]+', maxlength: '16'});
    if (change.kind === 'development' && (change.sha || ['development','github'].includes(change.source)) && change.state === 'awaiting_validation' && capabilities.review && !actorIsAuthor) {
      holder.append(field('Successful Platform CI run ID', ciRun));
    }
    for (const [action, text] of actions[change.state] || []) {
      const isolated = action === 'rehearse_application' || action === 'rollback_application';
      const visible = action === 'submit' ? capabilities.author && actorIsAuthor :
        action === 'rehearse' ? capabilities.rehearse && change.kind === 'visual' :
        action === 'restore' ? capabilities.author && change.kind === 'visual' :
        isolated ? capabilities.isolated_application && capabilities.rehearse && !actorIsAuthor &&
          change.kind === 'development' && change.sha && change.previous_sha :
        capabilities.review && !actorIsAuthor;
      if (!visible) continue;
      const control = button(text, () => perform(control, message, async () => {
        const {change: updated} = await call(`${API}changes/${id}/`, {
          method: 'POST', body: {sequence: change.sequence, action, note: note.value,
            ...(ciRun.value ? {ci_run:Number(ciRun.value)} : {})},
        });
        await refresh(updated.id);
      }), action === 'approve' || action === 'submit');
      controls.append(control);
    }
    if (controls.children.length) holder.append(field('Review or validation note', note), controls, message);
    if (actorIsAuthor && capabilities.author && change.kind === 'visual' &&
        !['released', 'rolled_back', 'scheduled', 'releasing'].includes(change.state)) {
      holder.append(link('Revise in Visual Editor', `${EDITOR}?change=${change.id}`));
    }
    const history = node('details');
    history.append(node('summary', 'Review history and versions'));
    const events = node('ol');
    for (const event of change.history) {
      const evidence = event.evidence.revision ? ` · ${event.evidence.target} · ${event.evidence.revision}` : '';
      events.append(node('li', `${event.action.replaceAll('_', ' ')} · revision ${event.revision} · ${event.actor__username} · ${new Date(event.created_at).toLocaleString()}${evidence}${event.evidence.note ? ` — ${event.evidence.note}` : ''}`));
    }
    history.append(events);
    for (const version of change.versions) {
      const revision = node('details');
      revision.append(node('summary', `Revision ${version.number} · ${version.author__username}`));
      if (change.kind === 'visual') {
        const comparison = node('div');
        compare({...change, ...version.payload}, comparison);
        comparison.querySelectorAll('a').forEach(el => el.remove());
        revision.append(comparison);
      } else revision.append(node('p', version.payload.title));
      history.append(revision);
    }
    holder.append(history);
  } catch (error) {
    holder.replaceChildren(status(error?.data?.error || error.message));
  }
}

function developmentForm(container, refresh) {
  const box = node('details');
  box.append(node('summary', 'Register development change'));
  const title = node('input', null, {maxlength: '220', required: ''});
  const description = node('textarea', null, {maxlength: '4000', rows: '4'});
  const source = selection([
    ['development','Development task'], ['github','GitHub pull request'], ['cms','CMS'],
    ['essay','Essay'], ['lab','Lab'], ['configuration','Configuration'], ['feature_flag','Feature flag'],
  ]);
  const sourceRef = node('input', null, {maxlength:'500'});
  const affected = node('input', null, {maxlength:'1000'});
  const pr = node('input', null, {type: 'number', min: '1'});
  const task = node('input', null, {type: 'number', min: '1'});
  const sha = node('input', null, {maxlength: '40'});
  const previous = node('input', null, {maxlength: '40'});
  const message = status('');
  const submit = button('Save draft', () => perform(submit, message, async () => {
    const {change} = await call(API + 'changes/', {method: 'POST', body: {
      kind: 'development', title: title.value, description: description.value,
      source: source.value, source_reference: sourceRef.value, affected: affected.value,
      pr: pr.value ? Number(pr.value) : null, task: task.value ? Number(task.value) : null,
      sha: sha.value, previous_sha: previous.value,
    }});
    box.open = false;
    await refresh(change.id);
  }), true);
  box.append(field('Title', title), field('Requested change', description), field('Change source', source),
    field('Canonical source reference', sourceRef), field('Affected pages or entities', affected),
    field('GitHub pull request number', pr), field('Existing development task ID', task),
    field('Exact proposed SHA', sha), field('Previous SHA', previous), submit, message);
  container.append(box);
}

export async function renderReleaseCenter(host) {
  const main = shell(host, 'Release Center', 'Register, compare and review staging changes.', EDITOR);
  const changes = node('div', null, {class: 'gq-release-list', 'aria-label': 'Changes'});
  const inspector = node('article', null, {class: 'gq-release-panel'});
  const split = node('div', null, {class: 'gq-release-split'});
  split.append(changes, inspector);
  try {
    let initial = true;
    async function refresh(selected) {
      const data = await call(API + 'changes/');
      const table = node('ul');
      for (const item of data.changes) {
        const option = button(`#${item.id} · ${item.title}`, () => details(item.id, inspector, data.capabilities, data.user_id, refresh));
        const row = node('li');
        row.append(option, node('small', stateLabels[item.state] || item.state));
        table.append(row);
      }
      changes.replaceChildren(table);
      if (!data.changes.length) changes.append(status('No visible changes yet.'));
      if (initial) {
        main.append(node('p', 'Production release authority requires independent activation.', {class: 'gq-release-notice'}));
        if (data.capabilities.author) developmentForm(main, refresh);
        main.append(split);
        initial = false;
      }
      if (selected || data.changes.length) {
        await details(selected || data.changes[0].id, inspector, data.capabilities, data.user_id, refresh);
      } else inspector.replaceChildren(status('Select a change to inspect its revision.'));
    }
    await refresh();
    const operational = status('Checking environment health…');
    main.insertBefore(operational, changes.parentElement);
    try {
      const evidence = await call(API + 'status/');
      operational.textContent = `Staging ${evidence.staging_health} · revision ${evidence.staging?.revision || 'unverified'} · Production ${evidence.production_health} · revision unverified`;
    } catch {
      operational.textContent = 'Environment status is temporarily unavailable.';
    }
  } catch (error) {
    main.append(status(error?.data?.error || error.message));
  }
}

export async function renderVisualEditor(host) {
  const main = shell(host, 'Visual Editor', 'Select an element and prepare a versioned staging draft.', CENTER);
  const message = status('Loading editable pages…');
  main.append(message);
  try {
    const catalog = await call(API + 'visual/');
    const params = new URLSearchParams(location.search);
    const changeId = params.get('change');
    const change = /^\d+$/.test(changeId || '') ? (await call(`${API}changes/${changeId}/`)).change : null;
    if (change && change.kind !== 'visual') throw Error('Select a visual change.');
    const pageSelect = selection(catalog.pages.map(page => [page.id, page.label]), change?.page || params.get('page') || 'home');
    if (!pageSelect.value) pageSelect.value = 'home';
    pageSelect.disabled = Boolean(change);
    const widths = selection([['360','Mobile 360'],['390','Mobile 390'],['768','Tablet 768'],['1024','Desktop 1024'],['1440','Desktop 1440']], '1440');
    const theme = selection([['dark','Dark'],['light','Light']], document.documentElement.dataset.theme || 'dark');
    const toolbar = node('div', null, {class: 'gq-release-actions'});
    toolbar.append(field('Page', pageSelect), field('Preview width', widths), field('Preview theme', theme));
    const layout = node('div', null, {class: 'gq-visual-layout'});
    const viewport = node('div', null, {class: 'gq-visual-viewport'});
    const frame = node('iframe', null, {sandbox: 'allow-same-origin', title: 'Editable page preview'});
    const panel = node('aside', null, {class: 'gq-release-panel'});
    viewport.append(frame);
    layout.append(viewport, panel);
    main.append(toolbar, layout);
    const title = node('input', null, {maxlength:'220'});
    title.value = change?.title || '';
    const description = node('textarea', null, {maxlength:'4000', rows:'3'});
    description.value = change?.description || '';
    let edits = {...(change?.after || {})}, undo = [], redo = [], active = '', originals = new Map();
    const hierarchy = selection([]);
    let loadedPage = pageSelect.value;
    const property = node('div');
    const history = node('div', null, {class:'gq-release-actions'});
    history.append(button('Undo', () => replay(undo, redo)), button('Redo', () => replay(redo, undo)));
    panel.append(node('h2', 'Inspector'), field('Element or property', hierarchy), property, history,
      field('Change title', title), field('Description and acceptance context', description));

    function replay(from, to) {
      if (!from.length) return;
      to.push(edits);
      edits = from.pop();
      draw();
      inspect(active);
    }

    function draw() {
      const doc = frame.contentDocument;
      if (!doc) return;
      for (const [id, baseline] of originals) {
        const target = doc.querySelector(`[data-visual-field="${id}"]`);
        if (!target) continue;
        if (id === 'description') target.content = edits[id] ?? baseline.value;
        else if (id === 'cta_link') target.setAttribute('href', edits[id] ?? baseline.value);
        else if (id === 'hero_spacing') target.dataset.visualSpacing = edits[id] ?? baseline.value;
        else if (id in edits) target.textContent = edits[id];
        else target.replaceChildren(...baseline.children.map(el => el.cloneNode(true)));
      }
    }

    function inspect(id) {
      const data = catalog.pages.find(page => page.id === pageSelect.value);
      const spec = data?.fields.find(field => field.id === id);
      if (!spec || !originals.has(id)) return;
      active = id;
      hierarchy.value = id;
      const doc = frame.contentDocument;
      doc.querySelectorAll('[data-visual-selected]').forEach(el => el.removeAttribute('data-visual-selected'));
      doc.querySelector(`[data-visual-field="${id}"]`)?.setAttribute('data-visual-selected', '');
      const baseline = originals.get(id).value;
      const previous = change?.before?.[id] ?? baseline;
      const options = spec.type === 'link' ? catalog.links : spec.type === 'spacing' ? ['standard','compact','roomy'] : null;
      const input = options ? selection(options.map(value => [value, value]), edits[id] ?? baseline) :
        node('textarea', null, {rows:'3', maxlength:String(spec.limit)});
      if (!options) input.value = edits[id] ?? baseline;
      input.disabled = !catalog.capabilities.author;
      input.addEventListener('input', () => {
        undo.push({...edits});
        redo = [];
        if (input.value === baseline) {
          delete edits[id];
        } else edits = {...edits, [id]:input.value};
        draw();
      });
      property.replaceChildren(node('p', `Current value: ${previous}`), field('Proposed value', input));
    }

    function loadPage() {
      loadedPage = pageSelect.value;
      const page = catalog.pages.find(row => row.id === loadedPage);
      hierarchy.replaceChildren(...page.fields.map(spec => node('option', spec.label, {value:spec.id})));
      active = page.fields.find(spec => spec.id === 'heading').id;
      const url = `/api${API}visual/${page.id}/preview/?target=rehearsal`;
      frame.src = url;
      message.textContent = '';
    }

    frame.addEventListener('load', () => {
      const doc = frame.contentDocument;
      if (!doc?.querySelector('[data-visual-field]')) {
        message.textContent = 'The page preview is unavailable.';
        return;
      }
      originals = new Map([...doc.querySelectorAll('[data-visual-field]')].map(el => {
        const id = el.dataset.visualField;
        const value = id === 'description' ? el.content : id === 'cta_link' ? el.getAttribute('href') :
          id === 'hero_spacing' ? (el.dataset.visualSpacing || 'standard') : el.textContent.trim().replace(/\s+/g, ' ');
        return [id, {value, children:[...el.childNodes].map(child => child.cloneNode(true))}];
      }));
      doc.documentElement.dataset.theme = theme.value;
      doc.documentElement.dataset.visualPreview = '';
      doc.addEventListener('click', event => {
        event.preventDefault();
        const id = event.target.closest('[data-visual-field]')?.dataset.visualField;
        if (id) inspect(id);
        else message.textContent = 'This element needs a development change. Use Release Center to register the request.';
      });
      draw();
      inspect(active);
    });
    const resize = () => { frame.style.width = widths.value + 'px'; };
    resize();
    widths.addEventListener('change', resize);
    theme.addEventListener('change', () => { frame.contentDocument.documentElement.dataset.theme = theme.value; });
    hierarchy.addEventListener('change', () => inspect(hierarchy.value));
    pageSelect.addEventListener('change', () => {
      if (Object.keys(edits).length && !window.confirm('Discard unsaved edits and open another page?')) {
        pageSelect.value = loadedPage;
        return;
      }
      edits = {}; undo = []; redo = [];
      loadPage();
    });
    if (catalog.capabilities.author) {
      for (const [label, submit] of [['Save draft', false], ['Save and submit', true]]) {
        const control = button(label, () => perform(control, message, async () => {
          const response = await call(change ? `${API}changes/${change.id}/` : API + 'changes/', {
            method: change ? 'PATCH' : 'POST', body: {
              kind:'visual', page:pageSelect.value, title:title.value, description:description.value,
              edits, ...(change ? {sequence:change.sequence, acceptance:change.acceptance, risk:change.risk} : {}),
            },
          });
          if (submit) await call(`${API}changes/${response.change.id}/`, {
            method:'POST', body:{sequence:response.change.sequence, action:'submit'},
          });
          location.assign(CENTER);
        }), submit);
        panel.append(control);
      }
    }
    loadPage();
  } catch (error) {
    message.textContent = error?.data?.error || error.message;
  }
}
