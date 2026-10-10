/* ==========================================================================
   GRAVITAS+ WORKSPACE  ·  RESEARCH · CREATING THINGS
   New project and New task, as the Research screens have always offered
   them: a short dialog for each from the overview and the task board, and
   the full filing form under the toolbar on Projects.

   These used to be painted onto the screens by two overlays,
   ws-task-deck-fixes.js and ws-space-integration.js, after the screens had
   drawn. The screens now insert them; the markup, wording and behaviour
   are the overlays' own, moved here unchanged.
   ========================================================================== */

import * as P from './ws-platform.js?v=20261011-r3';

let go = (path) => location.assign(path);

function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== '') node.textContent = text;
  return node;
}

function button(label, onClick, primary = false) {
  const node = el('button', primary ? 'ws-btn ws-btn--solid' : 'ws-btn', label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function field(label, input) {
  const wrap = el('label', 'ws-action-dialog__field');
  wrap.append(el('span', '', label), input);
  return wrap;
}

function input(type = 'text', { name = '', value = '', placeholder = '', required = false } = {}) {
  const node = el('input', 'v-input');
  node.type = type;
  node.name = name;
  node.value = value;
  node.placeholder = placeholder;
  node.required = required;
  return node;
}

function select(name, choices, value = '') {
  const node = el('select', 'v-input');
  node.name = name;
  for (const [key, label] of choices) {
    const option = el('option', '', label);
    option.value = key;
    option.selected = key === value;
    node.append(option);
  }
  return node;
}

function textarea(name, placeholder = '') {
  const node = el('textarea', 'v-input');
  node.name = name;
  node.placeholder = placeholder;
  return node;
}

function modal(title, build, submitLabel, onSubmit) {
  const layer = el('div', 'ws-action-dialog-layer');
  const dialog = el('section', 'ws-action-dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', title);
  const form = el('form', 'ws-action-dialog__body');

  const onKeydown = (event) => {
    if (event.key === 'Escape') dismiss();
  };
  const dismiss = () => {
    document.removeEventListener('keydown', onKeydown);
    layer.remove();
  };

  const head = el('div', 'ws-action-dialog__head');
  head.append(el('h2', '', title));
  const close = button('Close', dismiss);
  close.setAttribute('aria-label', 'Close');
  head.append(close);
  const grid = el('div', 'ws-action-dialog__grid');
  const fields = build(grid) || {};
  const error = el('p', 'ws-action-dialog__error');
  const actions = el('div', 'ws-action-dialog__actions');
  const cancel = button('Cancel', dismiss);
  const submit = button(submitLabel, () => {}, true);
  submit.type = 'submit';
  actions.append(cancel, submit);
  form.append(head, grid, error, actions);
  dialog.append(form);
  layer.append(dialog);
  document.body.append(layer);

  layer.addEventListener('pointerdown', (event) => {
    if (event.target === layer) dismiss();
  });
  document.addEventListener('keydown', onKeydown);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';
    submit.disabled = true;
    cancel.disabled = true;
    try {
      await onSubmit(fields, new FormData(form));
      dismiss();
    } catch (err) {
      error.textContent = err?.data?.error || err?.message || 'The action could not be completed.';
      submit.disabled = false;
      cancel.disabled = false;
    }
  });

  const firstField = form.querySelector('input:not([type="hidden"]), select, textarea, button');
  if (firstField) queueMicrotask(() => firstField.focus());
  return layer;
}

function openProjectCreator() {
  modal('New research project', (grid) => {
    const title = input('text', { name: 'title', placeholder: 'Project title', required: true });
    const category = select('category', [
      ['internal', 'Internal research'],
      ['client', 'Client project'],
      ['community', 'Community project'],
    ], 'internal');
    const description = textarea('description', 'Short scope or context');
    const question = textarea('research_question', 'Primary research question');
    grid.append(
      field('Project title', title),
      field('Category', category),
      field('Description', description),
      field('Research question', question),
    );
    return { title, category, description, question };
  }, 'Create project', async (_fields, data) => {
    const result = await P.call('/platform/projects/', {
      method: 'POST',
      body: {
        title: String(data.get('title') || '').trim(),
        category: data.get('category') || 'internal',
        visibility: 'private',
        description: String(data.get('description') || '').trim(),
        research_question: String(data.get('research_question') || '').trim(),
      },
    });
    go(`/workspace/research/projects/${result.project.id}`);
  });
}

async function openTaskCreator() {
  const data = await P.call('/platform/projects/');
  const projects = (data.projects || []).filter((project) => project.permissions?.can_edit);
  if (!projects.length) {
    return modal('New research task', (grid) => {
      const note = el('p', 'v-note', 'Create a Research project first, or ask for edit access to an existing project.');
      grid.append(note);
      return {};
    }, 'Open projects', async () => {
      go('/workspace/research/projects');
    });
  }

  modal('New research task', (grid) => {
    const project = select('project_id', projects.map((item) => [String(item.id), item.title]), String(projects[0].id));
    const title = input('text', { name: 'title', placeholder: 'Task title', required: true });
    const due = input('date', { name: 'due_date', required: true });
    const priority = select('priority', [
      ['p0', 'P0 · Critical'],
      ['p1', 'P1 · High'],
      ['p2', 'P2 · Normal'],
      ['p3', 'P3 · Low'],
    ], 'p2');
    const done = textarea('definition_of_done', 'What must be true for this task to be complete?');
    const description = textarea('description', 'Optional context');
    grid.append(
      field('Project', project),
      field('Task title', title),
      field('Due date', due),
      field('Priority', priority),
      field('Definition of done', done),
      field('Description', description),
    );
    return { project };
  }, 'Create task', async (fields, formData) => {
    const projectId = Number(formData.get('project_id') || fields.project.value);
    const result = await P.call(`/platform/projects/${projectId}/tasks/`, {
      method: 'POST',
      body: {
        title: String(formData.get('title') || '').trim(),
        due_date: formData.get('due_date'),
        priority: formData.get('priority') || 'p2',
        definition_of_done: String(formData.get('definition_of_done') || '').trim(),
        description: String(formData.get('description') || '').trim(),
        status: 'active',
      },
    });
    if (!result.task?.id) throw new Error('task_create_failed');
    go(`/workspace/research/projects/${projectId}/tasks`);
  });
}

/* The overview and the task board: New project (the short dialog) and New
   task, in their own row under the head. */
export function researchCreateBar({ go: navigate, withProject = true } = {}) {
  if (navigate) go = navigate;
  const bar = el('div', 'v-toolbar');
  bar.dataset.researchCreateActions = 'true';
  if (withProject) bar.append(button('New project', openProjectCreator, true));
  bar.append(button('New task', () => {
    openTaskCreator().catch((error) => {
      console.error('Research task creator failed', error);
    });
  }));
  return bar;
}

/* ---- Projects: the full form, filed in a Space category ---------------- */

function sAction(label, handler, solid = false) {
  const button = el('button', solid ? 'ws-btn ws-btn--solid' : 'ws-btn', label);
  button.type = 'button';
  if (handler) button.addEventListener('click', handler);
  return button;
}

function sInput(type = 'text', placeholder = '') {
  const node = el('input', 'v-input fl-input');
  node.type = type;
  node.placeholder = placeholder;
  return node;
}

function sTextarea(placeholder = '', rows = 4) {
  const node = el('textarea', 'v-input fl-input fl-textarea');
  node.placeholder = placeholder;
  node.rows = rows;
  return node;
}

function sSelect(options = []) {
  const node = el('select', 'v-input fl-input');
  options.forEach(([value, label]) => {
    const option = el('option', '', label);
    option.value = value;
    node.append(option);
  });
  return node;
}

function sField(label, control, hint = '') {
  const wrap = el('label', 'fl-field');
  wrap.append(el('span', 'fl-field__label', label), control);
  if (hint) wrap.append(el('small', 'fl-muted', hint));
  return wrap;
}

function flatten(nodes, depth = 0, out = []) {
  (nodes || []).forEach((node) => {
    out.push({ ...node, depth });
    flatten(node.children || [], depth + 1, out);
  });
  return out;
}

function fillCategorySelect(node, tree, selected = '') {
  node.innerHTML = '';
  const categories = flatten(tree || []).filter((item) => item.kind === 'category');
  categories.forEach((item) => {
    const option = el('option', '', `${'— '.repeat(Math.max(0, item.depth - 1))}${item.title}`);
    option.value = String(item.id);
    option.dataset.path = item.path || '';
    node.append(option);
  });
  const preferred = categories.find((item) => item.path === 'Space/Research/Projects') || categories[0];
  const value = selected || (preferred ? String(preferred.id) : '');
  if (value) node.value = value;
  return categories;
}

function fillCategoryParentSelect(node, tree) {
  node.innerHTML = '';
  const choices = flatten(tree || []).filter((item) => ['subspace', 'category'].includes(item.kind));
  choices.forEach((item) => {
    const option = el('option', '', `${'— '.repeat(item.depth)}${item.title}`);
    option.value = String(item.id);
    option.dataset.path = item.path || '';
    node.append(option);
  });
  const preferred = choices.find((item) => item.path === 'Space/Research') || choices[0];
  if (preferred) node.value = String(preferred.id);
  return choices;
}

function statusLine() {
  const node = el('p', 'v-note space-status');
  node.hidden = true;
  return node;
}

function setStatus(node, text, tone = '') {
  node.hidden = !text;
  node.textContent = text;
  if (tone) node.dataset.tone = tone;
  else delete node.dataset.tone;
}

export function spaceProjectToolbar(head, { go: navigate, onCreated } = {}) {
  if (navigate) go = navigate;

  const tools = el('div', 'v-toolbar research-action-toolbar space-project-toolbar');
  tools.dataset.spaceProjectActions = '1';
  const create = sAction('New project', null, true);
  const line = statusLine();
  tools.append(create);
  // New task shares this row, as it did when another module moved it here.
  const newTask = button('New task', () => {
    openTaskCreator().catch((error) => {
      console.error('Research task creator failed', error);
    });
  });
  newTask.dataset.researchCreateActions = 'true';
  tools.append(newTask);
  tools.append(line);
  head.insertAdjacentElement('afterend', tools);

  let formBox = null;
  create.addEventListener('click', async () => {
    if (formBox) {
      formBox.remove();
      formBox = null;
      return;
    }
    create.disabled = true;
    setStatus(line, 'Loading Space categories…');
    let treeData;
    try {
      treeData = await P.call('/platform/space/tree/');
    } catch (error) {
      setStatus(line, error.message === 'cloud_unavailable'
        ? 'Space is temporarily unavailable in Nextcloud.'
        : 'Space categories could not be loaded.', 'bad');
      create.disabled = false;
      return;
    }
    create.disabled = false;
    setStatus(line, '');

    formBox = el('section', 'v-panel fl-panel space-project-form');
    const panelHead = el('div', 'v-panel__head fl-panel__head');
    const copy = el('div');
    copy.append(el('h2', 'v-panel__title fl-panel__title', 'Create research project'));
    copy.append(el('p', 'fl-muted', 'Choose where the project is filed in your Space. Shared project files continue to use the protected Team Folder.'));
    panelHead.append(copy);
    const body = el('div', 'v-panel__body fl-panel__body');
    const form = el('form', 'fl-form');

    const title = sInput('text', 'Project title');
    title.required = true;
    const projectType = sSelect([
      ['internal', 'Internal research'],
      ['client', 'Client / revenue'],
      ['community', 'Community research'],
    ]);
    const visibility = sSelect([
      ['private', 'Private'],
      ['invite', 'Invite only'],
      ['community', 'Community'],
      ['public', 'Public'],
    ]);
    const parentCategory = sSelect();
    fillCategorySelect(parentCategory, treeData.tree);
    const question = sTextarea('Research question', 3);
    const description = sTextarea('Short project description', 4);
    const clientName = sInput('text', 'Client name');
    const requesterName = sInput('text', 'Requester name');
    const requesterEmail = sInput('email', 'requester@example.com');
    const deadline = sInput('date');
    const confidentiality = sSelect([
      ['internal', 'Internal'],
      ['restricted', 'Restricted'],
      ['public', 'Public'],
    ]);
    const compensation = sInput('text', 'Compensation / commercial terms');
    const skills = sInput('text', 'Python, biology, statistics');

    const flags = el('div', 'space-project-flags');
    const makeCheck = (label, checked = false) => {
      const wrap = el('label', 'fl-check');
      const control = sInput('checkbox');
      control.checked = checked;
      wrap.append(control, el('span', '', label));
      flags.append(wrap);
      return control;
    };
    const applicationOpen = makeCheck('Applications open');
    const secureRoom = makeCheck('Secure data room');
    const allowLinks = makeCheck('Allow public links');
    const allowDownloads = makeCheck('Allow downloads', true);

    const categoryMaker = el('section', 'space-category-maker');
    const categoryTitle = sInput('text', 'New category name');
    const categoryParent = sSelect();
    fillCategoryParentSelect(categoryParent, treeData.tree);
    const categoryStatus = statusLine();
    const addCategory = sAction('Create category', async () => {
      if (!categoryTitle.value.trim()) {
        setStatus(categoryStatus, 'Category name is required.', 'bad');
        categoryTitle.focus();
        return;
      }
      addCategory.disabled = true;
      setStatus(categoryStatus, 'Creating category…');
      const wanted = categoryTitle.value.trim();
      try {
        await P.call('/platform/space/tree/', {
          method: 'POST',
          body: { title: wanted, kind: 'category', parent_id: categoryParent.value },
        });
      } catch (error) {
        // A cloud failure may happen after the DB node was persisted. Refetch
        // before reporting failure so the user never creates the same category
        // twice just because WebDAV was briefly unavailable.
        if (error.message !== 'cloud_unavailable') {
          setStatus(categoryStatus, error.message.replaceAll('_', ' '), 'bad');
        }
      }
      try {
        treeData = await P.call('/platform/space/tree/');
        const categories = fillCategorySelect(parentCategory, treeData.tree);
        fillCategoryParentSelect(categoryParent, treeData.tree);
        const created = categories.find((item) => item.title.toLowerCase() === wanted.toLowerCase());
        if (created) {
          parentCategory.value = String(created.id);
          categoryTitle.value = '';
          setStatus(categoryStatus, `Category “${created.title}” is ready.`, 'ok');
        } else {
          setStatus(categoryStatus, 'Category could not be confirmed. Try again when Nextcloud is available.', 'bad');
        }
      } catch {
        setStatus(categoryStatus, 'Category was saved but the Space tree could not be refreshed.', 'bad');
      }
      addCategory.disabled = false;
    });
    const makerHead = el('div', 'space-category-maker__head');
    makerHead.append(el('strong', '', 'Need another parent category?'), el('span', 'fl-muted', 'Create it here without leaving the project form.'));
    const makerGrid = el('div', 'space-category-maker__grid');
    makerGrid.append(sField('Name', categoryTitle), sField('Inside', categoryParent));
    categoryMaker.append(makerHead, makerGrid, addCategory, categoryStatus);

    const topGrid = el('div', 'fl-form-grid');
    topGrid.append(
      sField('Title', title),
      sField('Project type', projectType, 'Business/research classification — not the filesystem folder.'),
      sField('Visibility', visibility),
      sField('Parent category', parentCategory, 'The project .md file and same-name folder are created here.'),
      sField('Deadline', deadline),
      sField('Confidentiality', confidentiality),
    );
    const peopleGrid = el('div', 'fl-form-grid');
    peopleGrid.append(sField('Client', clientName), sField('Requester', requesterName), sField('Requester email', requesterEmail));
    form.append(topGrid, sField('Research question', question), sField('Description', description), peopleGrid,
      sField('Required skills', skills, 'Comma-separated'), sField('Compensation', compensation), flags, categoryMaker);

    const submit = sAction('Create project', null, true);
    submit.type = 'submit';
    const cancel = sAction('Cancel', () => { formBox?.remove(); formBox = null; });
    const formStatus = statusLine();
    const actions = el('div', 'fl-form-actions');
    actions.append(submit, cancel);
    form.append(actions, formStatus);
    body.append(form);
    formBox.append(panelHead, body);
    tools.insertAdjacentElement('afterend', formBox);
    title.focus();

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!title.value.trim()) {
        setStatus(formStatus, 'Project title is required.', 'bad');
        title.focus();
        return;
      }
      if (!parentCategory.value) {
        setStatus(formStatus, 'Choose or create a parent category first.', 'bad');
        return;
      }
      submit.disabled = true;
      setStatus(formStatus, 'Creating project and filing it in Space…');
      try {
        await P.call('/platform/projects/', {
          method: 'POST',
          body: {
            title: title.value.trim(),
            category: projectType.value,
            visibility: visibility.value,
            space_category_id: Number(parentCategory.value),
            research_question: question.value.trim(),
            description: description.value.trim(),
            client_name: clientName.value.trim(),
            requester_name: requesterName.value.trim(),
            requester_email: requesterEmail.value.trim(),
            deadline: deadline.value || null,
            confidentiality: confidentiality.value,
            compensation_text: compensation.value.trim(),
            required_skills: skills.value.split(',').map((item) => item.trim()).filter(Boolean),
            application_open: applicationOpen.checked,
            secure_data_room: secureRoom.checked,
            allow_public_links: allowLinks.checked,
            allow_downloads: allowDownloads.checked,
          },
        });
        setStatus(formStatus, 'Project created. Refreshing…', 'ok');
        setTimeout(() => onCreated?.(), 250);
      } catch (error) {
        const messages = {
          invalid_space_category: 'That parent category is no longer available. Refresh the Space tree.',
          title_required: 'Project title is required.',
          invalid_visibility: 'Choose a valid visibility.',
        };
        setStatus(formStatus, messages[error.message] || error.message.replaceAll('_', ' '), 'bad');
        submit.disabled = false;
      }
    });
  });
  return tools;
}
