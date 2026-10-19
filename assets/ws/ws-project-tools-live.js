/* Native Research project tools: API-backed, ACL-scoped and truthful states.
   The UI never labels a mere selection as connected. Git is public read-only,
   Database is a private managed table store, and Lab Journal uses the same
   canonical experiment records shown by the Research project.
*/
import * as P from './ws-platform.js?v=20261016-task1';

const node = (tag, className = '', value = '') => {
  const item = document.createElement(tag);
  if (className) item.className = className;
  item.textContent = value;
  return item;
};
const btn = (label, handler) => {
  const control = node('button', 'ws-btn', label);
  control.type = 'button';
  control.addEventListener('click', handler);
  return control;
};
const field = (name, value = '', type = 'text') => {
  const item = document.createElement('input');
  item.className = 'v-input';
  item.type = type;
  item.value = value === null ? '' : String(value);
  item.placeholder = name;
  item.setAttribute('aria-label', name);
  return item;
};
const say = (container, message) => { container.textContent = message || ''; };
const safe = (value) => String(value || '').slice(0, 240);
const toolName = id => ({
  git: 'Git', database: 'Database', lab_journal: 'Lab Journal',
  data_analysis: 'Data Analysis', compute: 'Compute', machine_learning: 'Machine Learning',
})[id] || id;

export async function mountProjectTools(host, projectId, project) {
  const selected = Array.isArray(project.selected_integrations) ? project.selected_integrations : [];
  if (!selected.length) return;
  say(host, 'Checking project tools…');
  try {
    const result = await P.call(`/platform/projects/${projectId}/tools/status/`);
    host.replaceChildren();
    for (const id of selected) {
      const state = result.integrations?.[id] || { state: 'setup_required' };
      const card = node('section', 'ws-live-tool');
      const header = node('div', 'ws-live-tool__heading');
      header.append(node('strong', '', toolName(id)));
      const badge = node('small', '', ({
        ready: 'Ready',
        last_verified: 'Verified previously',
        setup_required: 'Setup required',
      })[state.state] || 'Setup required');
      badge.dataset.state = state.state;
      header.append(badge);
      card.append(header);
      if (id === 'database') {
        card.append(node('small', '', 'Private managed tables · ' + (state.table_count || 0) + ' tables'));
        card.append(btn('Open project data', () => location.assign(`/workspace/research/projects/${projectId}/database`)));
      } else if (id === 'lab_journal') {
        card.append(node('small', '', 'Experiment logs are stored with the project · ' + (state.experiment_count || 0) + ' experiments'));
        card.append(btn('Open lab journal', () => location.assign(`/workspace/research/projects/${projectId}/experiments`)));
      } else if (id === 'git') {
        if (state.repository) {
          card.append(node('small', '', state.repository + ' · public read-only'));
          if (state.verified_at) card.append(node('small', '', 'Last checked: ' + new Date(state.verified_at).toLocaleString()));
          const commits = btn('Show recent commits', async () => {
            commits.disabled = true;
            const output = node('div', 'ws-live-tool__history', 'Loading commits…');
            card.append(output);
            try {
              const response = await P.call(`/platform/projects/${projectId}/tools/git/commits/`);
              output.replaceChildren();
              if (!response.commits?.length) output.append(node('p', '', 'No recent commits found.'));
              for (const item of response.commits || []) {
                output.append(node('p', '', `${item.sha.slice(0, 8)} · ${safe(item.message)} · ${safe(item.author)}`));
              }
            } catch (error) { say(output, 'Could not check GitHub: ' + safe(error.message)); }
            commits.disabled = false;
          });
          card.append(commits);
          if (project.permissions?.can_manage) {
            card.append(btn('Disconnect', async () => {
              try {
                await P.call(`/platform/projects/${projectId}/tools/git/`, { method: 'DELETE' });
                await mountProjectTools(host, projectId, project);
              } catch (error) { card.append(node('p', 'v-note', safe(error.message))); }
            }));
          }
        }
        if (project.permissions?.can_manage) {
          const form = node('form', 'ws-live-tool__form');
          const repository = field('GitHub owner/repository', state.repository || '');
          repository.required = true;
          const submit = node('button', 'ws-btn ws-btn--solid', state.repository ? 'Change repository' : 'Connect public repository');
          submit.type = 'submit';
          const status = node('small');
          form.append(repository, submit, status);
          form.addEventListener('submit', async event => {
            event.preventDefault(); submit.disabled = true;
            say(status, 'Verifying public GitHub repository…');
            try {
              await P.call(`/platform/projects/${projectId}/tools/git/`, {
                method: 'POST', body: { repository: repository.value.trim() },
              });
              await mountProjectTools(host, projectId, project);
            } catch (error) {
              say(status, 'Verification failed: ' + safe(error.message));
            } finally { submit.disabled = false; }
          });
          card.append(form, node('small', '', 'Public GitHub repositories only. No credentials are stored.'));
        }
      } else {
        card.append(node('small', '', 'Plugin adapter not yet configured.'));
      }
      host.append(card);
    }
  } catch (error) {
    say(host, 'Tools are temporarily unavailable: ' + safe(error.message));
  }
}

function parseColumns(raw) {
  return raw.split(',').map(value => value.trim()).filter(Boolean).map(value => {
    const [key, type] = value.split(':').map(part => part.trim().toLowerCase());
    return { key, type: type || 'text' };
  });
}
function dataForm(columns, existing = {}) {
  const controls = {};
  const grid = node('div', 'ws-live-tool__row-form');
  for (const col of columns) {
    const wrap = node('label');
    wrap.append(node('small', '', col.key));
    const control = field(col.key, existing[col.key] ?? '', col.type === 'date' ? 'date' : col.type === 'number' ? 'number' : 'text');
    if (col.type === 'number') control.step = 'any';
    if (col.type === 'boolean') {
      control.type = 'checkbox';
      control.checked = existing[col.key] === true;
    }
    controls[col.key] = control;
    wrap.append(control);
    grid.append(wrap);
  }
  return {
    element: grid,
    values: () => Object.fromEntries(columns.map(col => {
      const control = controls[col.key];
      let value = control.value;
      if (col.type === 'boolean') value = control.checked;
      else if (value === '') value = null;
      else if (col.type === 'number') value = Number(value);
      return [col.key, value];
    })),
  };
}

export async function renderProjectDatabase(doc, projectId, project) {
  const section = node('section', 'fl-panel wc-card ws-project-database');
  section.append(node('h2', 'fl-panel__title wc-card__title', 'Project database'));
  const body = node('div', 'fl-panel__body wc-card__body');
  body.append(node('p', 'fl-muted', 'Project-private structured data, saved in GraviQuest. No raw SQL or external database access.'));
  section.append(body); doc.append(section);
  if (!project.selected_integrations?.includes('database')) {
    body.append(node('p', 'v-note', 'Enable Database under Project tools in Overview first.'));
    return;
  }
  const status = node('p', 'v-note');
  body.append(status);
  let currentTableId = null;
  const list = node('div', 'ws-db-tables');
  const rows = node('div', 'ws-db-rows');
  body.append(list, rows);
  const loadRows = async table => {
    currentTableId = table.id;
    rows.replaceChildren(node('h3', '', table.name), node('small', '', table.columns.map(c => c.key + ' (' + c.type + ')').join(' · ')));
    const response = await P.call(`/platform/projects/${projectId}/tools/data/tables/${table.id}/rows/`);
    if (!response.rows?.length) rows.append(node('p', 'fl-muted', 'No records yet.'));
    const tableNode = node('div', 'ws-db-records');
    for (const row of response.rows || []) {
      const box = node('div', 'ws-db-record');
      const values = table.columns.map(c => `${c.key}: ${row.values[c.key] ?? '—'}`).join(' · ');
      box.append(node('p', '', values));
      if (project.permissions?.can_edit) {
        const editor = dataForm(table.columns, row.values);
        const edit = btn('Edit', () => { box.replaceChildren(editor.element, save, cancel); });
        const save = btn('Save', async () => {
          save.disabled = true;
          try {
            await P.call(`/platform/projects/${projectId}/tools/data/tables/${table.id}/rows/${row.id}/`, {
              method: 'PATCH', body: { values: editor.values(), expected_revision: row.revision },
            });
            await loadRows(table);
          } catch (error) { say(status, 'Save rejected: ' + safe(error.message)); save.disabled = false; }
        });
        const cancel = btn('Cancel', () => loadRows(table));
        box.append(edit);
      }
      tableNode.append(box);
    }
    rows.append(tableNode);
    if (project.permissions?.can_edit) {
      const form = node('form', 'ws-live-tool__form');
      const creator = dataForm(table.columns);
      const submit = node('button', 'ws-btn ws-btn--solid', 'Add record');
      submit.type = 'submit';
      form.append(creator.element, submit);
      form.addEventListener('submit', async event => {
        event.preventDefault(); submit.disabled = true;
        try {
          await P.call(`/platform/projects/${projectId}/tools/data/tables/${table.id}/rows/`, {
            method: 'POST', body: { values: creator.values() },
          });
          say(status, '');
          await loadRows(table);
        } catch (error) { say(status, 'Record not saved: ' + safe(error.message)); submit.disabled = false; }
      });
      rows.append(form);
    }
  };
  const reload = async () => {
    list.replaceChildren();
    const response = await P.call(`/platform/projects/${projectId}/tools/data/tables/`);
    if (!response.tables?.length) list.append(node('p', 'fl-muted', 'No data tables yet.'));
    for (const table of response.tables || []) {
      list.append(btn(`${table.name} (${table.row_count || 0})`, () => loadRows(table).catch(error => say(status, safe(error.message)))));
    }
    const active = response.tables?.find(table => table.id === currentTableId);
    if (active) await loadRows(active);
  };
  if (project.permissions?.can_edit) {
    const form = node('form', 'ws-live-tool__form');
    const name = field('Table name');
    name.required = true; name.maxLength = 120;
    const columns = field('Columns: sample:text, count:number, date:date');
    columns.required = true; columns.value = 'sample:text, value:number';
    const create = node('button', 'ws-btn ws-btn--solid', 'Create table');
    create.type = 'submit';
    form.append(name, columns, create);
    form.addEventListener('submit', async event => {
      event.preventDefault(); create.disabled = true;
      try {
        await P.call(`/platform/projects/${projectId}/tools/data/tables/`, {
          method: 'POST', body: { name: name.value.trim(), columns: parseColumns(columns.value) },
        });
        name.value = '';
        say(status, 'Table created.');
        await reload();
      } catch (error) { say(status, 'Table not created: ' + safe(error.message)); }
      create.disabled = false;
    });
    body.insertBefore(form, list);
  }
  try { await reload(); } catch (error) { say(status, 'Database unavailable: ' + safe(error.message)); }
}

export function mountExperimentJournal(body, projectId, experiment, project) {
  if (!project.selected_integrations?.includes('lab_journal')) return;
  const panel = node('section', 'ws-live-tool');
  const open = btn('View lab journal', async () => {
    open.disabled = true;
    const listing = node('div', 'ws-live-tool__history', 'Loading…');
    panel.append(listing);
    const reload = async () => {
      try {
        const response = await P.call(`/platform/projects/${projectId}/experiments/${experiment.id}/journal/`);
        listing.replaceChildren();
        if (!response.entries?.length) listing.append(node('p', 'fl-muted', 'No journal entries yet.'));
        for (const entry of response.entries || []) {
          listing.append(node('p', '', `${entry.kind} · ${safe(entry.author)} · ${new Date(entry.created_at).toLocaleString()}`));
          listing.append(node('p', 'fl-prose', entry.body));
        }
      } catch (error) { say(listing, 'Could not load entries: ' + safe(error.message)); }
    };
    await reload();
    if (project.permissions?.can_edit) {
      const form = node('form', 'ws-live-tool__form');
      const kind = node('select', 'v-input');
      for (const type of ['note', 'method', 'observation', 'result']) {
        const option = node('option', '', type); option.value = type; kind.append(option);
      }
      const note = document.createElement('textarea');
      note.className = 'v-input'; note.placeholder = 'Dated experiment observation or result'; note.rows = 3;
      note.required = true; note.maxLength = 10000;
      const submit = node('button', 'ws-btn ws-btn--solid', 'Add journal entry'); submit.type = 'submit';
      const status = node('small');
      form.append(kind, note, submit, status);
      form.addEventListener('submit', async event => {
        event.preventDefault(); submit.disabled = true;
        try {
          await P.call(`/platform/projects/${projectId}/experiments/${experiment.id}/journal/`, {
            method: 'POST', body: { kind: kind.value, body: note.value },
          });
          note.value = ''; say(status, 'Entry recorded. History is append-only.');
          await reload();
        } catch (error) { say(status, 'Could not save: ' + safe(error.message)); }
        submit.disabled = false;
      });
      panel.append(form);
    }
  });
  panel.append(open);
  body.append(panel);
}
