import * as P from './ws-platform.js?v=20260914-7';

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

function panel(title, note = '') {
  const box = el('section', 'fl-panel');
  const head = el('div', 'fl-panel__head');
  const text = el('div');
  text.append(el('h2', 'fl-panel__title', title));
  if (note) text.append(el('p', 'fl-muted', note));
  head.append(text);
  const body = el('div', 'fl-panel__body');
  box.append(head, body);
  return { box, body, head };
}

function empty(title, copy) {
  const node = el('div', 'fl-state');
  node.append(el('strong', null, title), el('p', 'fl-muted', copy));
  return node;
}

function badge(text) {
  return el('span', 'v-badge fl-badge', text);
}

function progress(value) {
  const number = Math.max(0, Math.min(100, Number(value) || 0));
  const wrap = el('div', 'fl-progress');
  const bar = el('span', 'fl-progress__bar');
  bar.style.setProperty('--progress', `${number}%`);
  wrap.append(bar, el('small', 'fl-progress__text', `${number.toFixed(number % 1 ? 1 : 0)}%`));
  return wrap;
}

function row({ title, meta = '', body = '', tags = [], onClick = null }) {
  const node = el(onClick ? 'button' : 'div', `fl-row${onClick ? ' fl-row--button' : ''}`);
  if (onClick) {
    node.type = 'button';
    node.addEventListener('click', onClick);
  }
  const main = el('div', 'fl-row__main');
  main.append(el('strong', null, title || 'Untitled'));
  if (meta) main.append(el('small', 'fl-muted', meta));
  if (body) main.append(el('p', 'fl-row__body', body));
  if (tags.filter(Boolean).length) {
    const strip = el('div', 'fl-badges');
    tags.filter(Boolean).forEach((item) => strip.append(badge(item)));
    main.append(strip);
  }
  node.append(main);
  return node;
}

function metric(value, title) {
  const node = el('div', 'fl-metric');
  node.append(el('strong', 'fl-metric__value', String(value ?? 0)), el('span', 'fl-metric__title', title));
  return node;
}

export async function renderMemberProgress(host, { go }) {
  host.innerHTML = '';
  const doc = el('div', 'ws-doc ws-doc--wide fl-doc');
  const head = el('header', 'ws-doc__head fl-head');
  head.append(el('h1', 'ws-doc__title', 'Progress'));
  head.append(el('p', 'ws-doc__meta', 'Your public learning paths, LMS courses and research participation in one account view.'));
  doc.append(head);
  const skeleton = el('div', 'fl-skeleton-grid');
  for (let i = 0; i < 5; i += 1) skeleton.append(el('div', 'fl-skeleton'));
  doc.append(skeleton);
  host.append(doc);

  try {
    const data = await P.memberDashboard();
    skeleton.remove();

    const metrics = el('div', 'fl-metrics');
    metrics.append(
      metric(data.public_paths?.in_progress || 0, 'Public paths in progress'),
      metric(data.public_paths?.completed || 0, 'Public paths completed'),
      metric(data.learning?.active || 0, 'LMS courses active'),
      metric(data.learning?.completed || 0, 'LMS courses completed'),
      metric(data.research?.projects || 0, 'Research projects'),
    );
    doc.append(metrics);

    const publicPaths = panel('Public learning paths', 'Progress started on the public Gravitas+ site follows your account here.');
    const paths = data.public_paths?.items || [];
    if (!paths.length) publicPaths.body.append(empty('No public path progress yet', 'Open a learning path on the public site and complete a step to start tracking it.'));
    for (const item of paths) {
      const node = row({
        title: item.title,
        meta: `${item.done_count} of ${item.total} steps`,
        tags: [item.completed ? 'Completed' : 'In progress'],
        onClick: () => {
          if (item.url) location.href = item.url;
        },
      });
      node.querySelector('.fl-row__main').append(progress(item.progress_percent));
      publicPaths.body.append(node);
    }
    doc.append(publicPaths.box);

    const learning = panel('LMS learning', data.learning?.access ? 'Course access enabled.' : 'No LMS entitlement is currently enabled.');
    const enrollments = data.learning?.enrollments || [];
    if (!enrollments.length) learning.body.append(empty('No course progress yet', 'Course enrollments are independent from Research access.'));
    for (const item of enrollments) {
      const node = row({
        title: item.course_title,
        meta: P.meta([P.label(item.status), item.completed_at ? `Completed ${P.formatDate(item.completed_at)}` : '']),
        tags: [item.certificate?.valid ? 'Certificate' : ''],
        onClick: () => go(`/workspace/learning/courses/${item.course_id}`),
      });
      node.querySelector('.fl-row__main').append(progress(item.progress_percent));
      learning.body.append(node);
    }
    doc.append(learning.box);

    const research = panel('Research participation', data.research?.access ? 'Project-level access stays authoritative.' : 'No Research entitlement is currently enabled.');
    const projects = data.research?.recent || [];
    if (!projects.length) research.body.append(empty('No research projects yet', 'Research access does not depend on course enrollment.'));
    for (const item of projects) {
      research.body.append(row({
        title: item.title,
        meta: P.meta([P.label(item.role), P.label(item.status), item.deadline ? `Due ${P.formatDate(item.deadline)}` : '']),
        body: item.description,
        tags: [item.secure_data_room ? 'Secure data room' : ''],
        onClick: () => go(`/workspace/research/projects/${item.id}`),
      }));
    }
    doc.append(research.box);
  } catch (error) {
    skeleton.remove();
    doc.append(empty('Progress could not be loaded', error?.message || 'The platform did not return a usable response.'));
  }
}
