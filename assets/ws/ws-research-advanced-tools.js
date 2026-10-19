/* Native, bounded project data connectors and analysis plugins. */
import * as P from './ws-platform.js?v=20261016-task1';

const node = (tag, text = '', cls = '') => {
  const e = document.createElement(tag); e.textContent = text;
  if (cls) e.className = cls;
  return e;
};
const action = (label, fn) => {
  const e = node('button', label, 'ws-btn'); e.type = 'button';
  e.addEventListener('click', fn); return e;
};
const choose = (label) => {
  const e = node('select', '', 'v-input');
  e.setAttribute('aria-label', label); return e;
};
const options = (select, entries) => {
  select.replaceChildren(...entries.map(e => {
    const option = node('option', e.label || e.id || e, '');
    option.value = e.id || e; return option;
  }));
};
const api = (id, path) => `/platform/projects/${id}/tools/${path}`;
const fail = error => String(error?.message || error || 'Unavailable').slice(0, 240);

export async function mountExternalDatasets(doc, projectId) {
  const box = node('section', '', 'fl-panel wc-card');
  const header = node('h2', 'External datasets', 'fl-panel__title wc-card__title');
  const body = node('div', '', 'fl-panel__body wc-card__body');
  box.append(header, body); doc.append(box);
  body.append(node('p', 'Read-only, approved datasets. Connection credentials stay on the server.'));
  try {
    const response = await P.call(api(projectId, 'external/datasets/'));
    if (!response.datasets?.length) {
      body.append(node('p', 'The server administrator has not approved any datasets yet.'));
      return;
    }
    const select = choose('Approved dataset');
    options(select, response.datasets);
    const result = node('div', '', 'ws-live-tool__history');
    const preview = action('Preview up to 50 rows', async () => {
      preview.disabled = true;
      result.textContent = 'Reading approved dataset…';
      try {
        const rows = await P.call(api(projectId, `external/datasets/${select.value}/rows/?limit=50`));
        result.replaceChildren();
        result.append(node('small', rows.columns.join(' · ')));
        for (const row of rows.rows || []) {
          const text = rows.columns.map(k => `${k}: ${row[k] ?? '—'}`).join(' · ');
          result.append(node('p', text.length > 500 ? text.slice(0, 500) + '…' : text));
        }
        if (!rows.rows?.length) result.append(node('p', 'No data returned.'));
      } catch (error) { result.textContent = fail(error); }
      preview.disabled = false;
    });
    body.append(select, preview, result);
  } catch (error) {
    body.append(node('small', error.status === 409
      ? 'Connect an approved external database from Project tools first.'
      : 'External datasets unavailable: ' + fail(error)));
  }
}

export async function renderBuiltinTools(doc, projectId, project) {
  const box = node('section', '', 'fl-panel wc-card');
  box.append(node('h2', 'Research tools', 'fl-panel__title wc-card__title'));
  const body = node('div', '', 'fl-panel__body wc-card__body');
  body.append(node('p', 'Approved, versioned analysis tools. No custom code is executed. Results are read-only.'));
  doc.append(box); box.append(body);
  try {
    const [catalog, tables] = await Promise.all([
      P.call(api(projectId, 'builtin/')),
      P.call(api(projectId, 'data/tables/')),
    ]);
    if (!tables.tables?.length) {
      body.append(node('small', 'First create a project data table in the Database tab.'));
      return;
    }
    for (const plugin of catalog.plugins || []) {
      const panel = node('div', '', 'ws-live-tool');
      panel.append(node('strong', plugin.name + ' · v' + plugin.version));
      panel.append(node('small', plugin.note));
      if (!plugin.selected) {
        panel.append(node('small', 'Enable this tool from Project tools first.'));
        body.append(panel);
        continue;
      }
      const table = choose('Data table');
      const column = choose('Numeric column');
      const target = choose('Target column');
      const factor = node('input', '', 'v-input');
      factor.type = 'number'; factor.step = 'any'; factor.value = '2';
      factor.setAttribute('aria-label', 'Scale factor');
      const columnWrap = node('label', 'Numeric column');
      columnWrap.append(column);
      const targetWrap = node('label', 'Target column');
      targetWrap.append(target);
      const tableWrap = node('label', 'Data table'); tableWrap.append(table);
      options(table, tables.tables.map(x => ({id: String(x.id), label: x.name})));
      const update = () => {
        const selected = tables.tables.find(x => String(x.id) === table.value);
        const numeric = (selected?.columns || []).filter(c => c.type === 'number').map(c => c.key);
        options(column, numeric);
        options(target, numeric);
      };
      table.addEventListener('change', update); update();
      panel.append(tableWrap, columnWrap);
      if (plugin.id === 'machine_learning') panel.append(targetWrap);
      if (plugin.id === 'compute') {
        const factorLabel = node('label', 'Factor'); factorLabel.append(factor);
        panel.append(factorLabel);
      }
      const result = node('pre', '', 'ws-live-tool__history');
      const run = action('Run ' + plugin.name, async () => {
        run.disabled = true;
        try {
          const payload = {table_id: Number(table.value), column: column.value};
          if (plugin.id === 'compute') payload.factor = Number(factor.value);
          if (plugin.id === 'machine_learning') {
            payload.feature = column.value; payload.target = target.value;
          }
          const answer = await P.call(api(projectId, `builtin/${plugin.id}/run/`), {
            method: 'POST', body: payload,
          });
          result.textContent = JSON.stringify(answer.result, null, 2);
        } catch (error) { result.textContent = 'Could not run: ' + fail(error); }
        run.disabled = false;
      });
      panel.append(run, result); body.append(panel);
    }
  } catch (error) {
    body.append(node('p', 'Tool catalog unavailable: ' + fail(error)));
  }
}
