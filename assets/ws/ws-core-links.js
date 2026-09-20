import * as P from './ws-platform.js?v=20260914-7';

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

function panel(title, note = '') {
  const box = el('section', 'fl-panel wc-card');
  const head = el('div', 'fl-panel__head wc-card__head');
  const text = el('div');
  text.append(el('h2', 'fl-panel__title wc-card__title', title));
  if (note) text.append(el('p', 'fl-muted', note));
  head.append(text);
  const body = el('div', 'fl-panel__body wc-card__body');
  box.append(head, body);
  return { box, body, head };
}

function option(value, text) {
  const node = el('option', null, text);
  node.value = value;
  return node;
}

function input(type = 'text', placeholder = '') {
  const node = el('input', 'v-input fl-input');
  node.type = type;
  node.placeholder = placeholder;
  return node;
}

function select() {
  return el('select', 'v-input fl-input');
}

function button(text, handler, solid = false) {
  const node = el('button', solid ? 'ws-btn ws-btn--solid' : 'ws-btn', text);
  node.type = 'button';
  node.addEventListener('click', handler);
  return node;
}

function empty(title, body) {
  const node = el('div', 'fl-state');
  node.append(el('strong', null, title), el('p', 'fl-muted', body));
  return node;
}

function row(link, onRemove) {
  const node = el('div', 'fl-row wc-item');
  const main = el('div', 'fl-row__main wc-item__main');
  main.append(el('strong', 'wc-item__title', link.title));
  main.append(el('small', 'fl-muted wc-item__meta', `${P.label(link.target_type)} · ${P.label(link.relation)}`));
  const tools = el('div', 'fl-row__actions');
  tools.append(button('Remove link', onRemove));
  node.append(main, tools);
  return node;
}

function taskTitle(task) {
  return `${task.title}${task.owner?.name ? ` · ${task.owner.name}` : ''}`;
}

export async function renderCoreLinks(host) {
  host.innerHTML = '';
  const doc = el('div', 'ws-doc ws-doc--wide fl-doc');
  const head = el('header', 'ws-doc__head fl-head');
  head.append(el('span', 'fl-eyebrow', 'CORE / TRACEABILITY'));
  head.append(el('h1', 'ws-doc__title', 'Cross-layer task links'));
  head.append(el('p', 'ws-doc__meta', 'Connect one canonical Core task to the Research project, LMS course or lesson, public-site content, or production item it belongs to.'));
  doc.append(head);
  host.append(doc);

  const loading = el('div', 'fl-skeleton-grid');
  for (let i = 0; i < 5; i += 1) loading.append(el('div', 'fl-skeleton'));
  doc.append(loading);

  try {
    const [taskData, researchData, courseData, siteData, workData] = await Promise.all([
      P.operatingTasks(),
      P.adminResearchProjects(),
      P.lmsCourses({ all: true }),
      P.adminSiteContent(),
      P.content(),
    ]);
    loading.remove();

    const tasks = taskData.tasks || [];
    const sources = {
      'research-project': (researchData.projects || []).map((item) => ({ id: item.id, title: item.title })),
      course: (courseData.courses || []).map((item) => ({ id: item.id, title: item.title })),
      lesson: [],
      'public-content': (siteData.items || []).map((item) => ({ id: item.id, title: item.title })),
      'content-work': (workData.items || []).map((item) => ({ id: item.id, title: item.title })),
    };

    // Course detail carries lessons, so fetch them once and flatten them into
    // the same target picker. A failed single course must not hide the rest.
    const courseDetails = await Promise.allSettled((courseData.courses || []).map((course) => P.lmsCourse(course.id)));
    courseDetails.forEach((result) => {
      if (result.status !== 'fulfilled') return;
      const course = result.value.course;
      for (const module of course.modules || []) {
        for (const lesson of module.lessons || []) {
          sources.lesson.push({ id: lesson.id, title: `${course.title} / ${module.title} / ${lesson.title}` });
        }
      }
    });

    const editor = panel('Link a task', 'A link is a relationship, not a copy. Removing it never deletes either object.');
    const form = el('div', 'fl-form');
    const taskSelect = select();
    taskSelect.append(option('', 'Choose Core task'));
    tasks.forEach((task) => taskSelect.append(option(String(task.id), taskTitle(task))));

    const typeSelect = select();
    [
      ['research-project', 'Research project'],
      ['course', 'LMS course'],
      ['lesson', 'LMS lesson'],
      ['public-content', 'Public-site content'],
      ['content-work', 'Content pipeline item'],
    ].forEach(([value, text]) => typeSelect.append(option(value, text)));

    const targetSelect = select();
    const relation = input('text', 'Relation, e.g. supports / produces / requires');
    relation.value = 'related';
    const status = el('p', 'fl-form-status fl-muted');
    const save = button('Create link', async () => {
      if (!taskSelect.value || !targetSelect.value) {
        status.textContent = 'Choose both a task and a target.';
        status.dataset.tone = 'bad';
        return;
      }
      save.disabled = true;
      status.textContent = 'Linking…';
      status.removeAttribute('data-tone');
      try {
        await P.call(`/operating/tasks/${taskSelect.value}/links/`, {
          method: 'POST',
          body: {
            target_type: typeSelect.value,
            target_id: Number(targetSelect.value),
            relation: relation.value.trim() || 'related',
          },
        });
        status.textContent = 'Link created.';
        status.dataset.tone = 'ok';
        await drawLinks();
      } catch (error) {
        status.textContent = error?.message || 'The link could not be created.';
        status.dataset.tone = 'bad';
      } finally {
        save.disabled = false;
      }
    }, true);

    const refill = () => {
      targetSelect.innerHTML = '';
      targetSelect.append(option('', 'Choose target'));
      for (const item of sources[typeSelect.value] || []) targetSelect.append(option(String(item.id), item.title));
    };
    typeSelect.addEventListener('change', refill);
    refill();

    const grid = el('div', 'fl-form-grid');
    grid.append(taskSelect, typeSelect, targetSelect, relation);
    form.append(grid, save, status);
    editor.body.append(form);
    doc.append(editor.box);

    const existing = panel('Links on selected task');
    doc.append(existing.box);

    const drawLinks = async () => {
      existing.body.innerHTML = '';
      if (!taskSelect.value) {
        existing.body.append(empty('Choose a task', 'Its cross-layer relationships will appear here.'));
        return;
      }
      existing.body.append(el('div', 'fl-skeleton'));
      try {
        const data = await P.call(`/operating/tasks/${taskSelect.value}/links/`);
        existing.body.innerHTML = '';
        if (!(data.links || []).length) {
          existing.body.append(empty('No links yet', 'Use the form above to connect this task to another layer.'));
          return;
        }
        for (const item of data.links) {
          existing.body.append(row(item, async () => {
            await P.call(`/operating/tasks/${taskSelect.value}/links/`, {
              method: 'DELETE', body: { link_id: item.id },
            });
            await drawLinks();
          }));
        }
      } catch (error) {
        existing.body.innerHTML = '';
        existing.body.append(empty('Links could not be loaded', error?.message || 'Try again.'));
      }
    };
    taskSelect.addEventListener('change', drawLinks);
    await drawLinks();
  } catch (error) {
    loading.remove();
    doc.append(empty('Cross-layer links could not be loaded', error?.message || 'The platform did not return a usable response.'));
  }
}
