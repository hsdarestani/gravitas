/* Project tool selection is a configuration request, never proof of an
   external connection. A project owner chooses the tools here; later provider
   setup remains a separate authenticated step. Keep it small enough to reuse
   unchanged in both Research project creators and project settings. */

export function projectIntegrationPicker(catalog = [], selected = [], requested = []) {
  const section = document.createElement('section');
  section.className = 'ws-tool-picker';
  const heading = document.createElement('div');
  heading.className = 'ws-tool-picker__head';
  const title = document.createElement('strong');
  title.textContent = 'Project tools';
  const note = document.createElement('small');
  note.textContent = 'Choose what this project needs. Connections are set up later.';
  heading.append(title, note);
  const list = document.createElement('div');
  list.className = 'ws-tool-picker__list';
  const active = new Set(Array.isArray(selected) ? selected : []);
  const controls = [];
  for (const tool of catalog) {
    if (!tool || !tool.id) continue;
    const item = document.createElement('label');
    item.className = 'ws-tool-picker__item';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = active.has(tool.id);
    check.value = tool.id;
    const copy = document.createElement('span');
    const label = document.createElement('strong');
    label.textContent = tool.name;
    const desc = document.createElement('small');
    desc.textContent = tool.description;
    copy.append(label, desc);
    item.append(check, copy);
    list.append(item);
    controls.push(check);
  }
  const requestLabel = document.createElement('label');
  requestLabel.className = 'ws-tool-picker__request';
  const requestTitle = document.createElement('span');
  requestTitle.textContent = 'Other tool requests (optional)';
  const other = document.createElement('textarea');
  other.className = 'v-input';
  other.rows = 2;
  other.maxLength = 750;
  other.placeholder = 'e.g. microscopy viewer, custom analysis tool';
  other.value = Array.isArray(requested) ? requested.join(', ') : '';
  const helper = document.createElement('small');
  helper.textContent = 'Tool names only. Do not paste credentials or access tokens.';
  requestLabel.append(requestTitle, other, helper);
  section.append(heading, list, requestLabel);
  return {
    element: section,
    selected: () => controls.filter(item => item.checked).map(item => item.value),
    requested: () => other.value.split(/[,\n]/).map(item => item.trim()).filter(Boolean),
  };
}
