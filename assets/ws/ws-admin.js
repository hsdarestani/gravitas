import * as P from './ws-platform.js?v=20260914-5';

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

const label = (value) => P.label(value || '');
const date = (value) => P.formatDate(value);

function doc(host, title, subtitle = '') {
  host.innerHTML = '';
  const wrap = el('div', 'ws-doc ws-doc--wide fl-doc');
  const head = el('header', 'ws-doc__head fl-head');
  head.append(el('span', 'fl-eyebrow', 'CORE / PLATFORM ADMIN'));
  head.append(el('h1', 'ws-doc__title', title));
  if (subtitle) head.append(el('p', 'ws-doc__meta', subtitle));
  wrap.append(head);
  host.append(wrap);
  return wrap;
}

function loading(host, title) {
  const wrap = doc(host, title);
  const grid = el('div', 'fl-skeleton-grid');
  for (let i = 0; i < 7; i += 1) grid.append(el('div', 'fl-skeleton'));
  wrap.append(grid);
}

function action(text, handler, solid = false, tiny = false) {
  const button = el('button', `${solid ? 'ws-btn ws-btn--solid' : 'ws-btn'}${tiny ? ' ws-btn--tiny' : ''}`, text);
  button.type = 'button';
  button.addEventListener('click', handler);
  return button;
}

function link(go, text, href, solid = false) {
  return action(text, () => go(href), solid);
}

function badge(text, tone = '') {
  const node = el('span', 'v-badge fl-badge', text);
  if (tone) node.dataset.tone = tone;
  return node;
}

function metric(value, title, note = '') {
  const node = el('div', 'fl-metric');
  node.append(el('strong', 'fl-metric__value', String(value ?? 0)));
  node.append(el('span', 'fl-metric__title', title));
  if (note) node.append(el('small', 'fl-muted', note));
  return node;
}

function section(title, note = '') {
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

function fail(host, title, error, retry) {
  const wrap = doc(host, title);
  const node = empty('This administration view could not be loaded.', error?.message || 'The server did not return a usable response.');
  if (retry) node.append(action('Retry', retry, true));
  wrap.append(node);
}

function row({ title, meta = '', body = '', badges = [], onClick = null, actions = [] }) {
  const node = el(onClick ? 'button' : 'div', `fl-row${onClick ? ' fl-row--button' : ''}`);
  if (onClick) {
    node.type = 'button';
    node.addEventListener('click', onClick);
  }
  const main = el('div', 'fl-row__main');
  main.append(el('strong', null, title || 'Untitled'));
  if (meta) main.append(el('small', 'fl-muted', meta));
  if (body) main.append(el('p', 'fl-row__body', body));
  if (badges.length) {
    const strip = el('div', 'fl-badges');
    badges.filter(Boolean).forEach((item) => strip.append(badge(item)));
    main.append(strip);
  }
  node.append(main);
  if (actions.length) {
    const tools = el('div', 'fl-row__actions');
    actions.forEach((item) => tools.append(item));
    node.append(tools);
  }
  return node;
}

function field(labelText, control, hint = '') {
  const wrap = el('label', 'fl-field');
  wrap.append(el('span', 'fl-field__label', labelText), control);
  if (hint) wrap.append(el('small', 'fl-muted', hint));
  return wrap;
}

function input(value = '', type = 'text', placeholder = '') {
  const node = el('input', 'v-input fl-input');
  node.type = type;
  node.value = value ?? '';
  node.placeholder = placeholder;
  return node;
}

function textarea(value = '', rows = 4) {
  const node = el('textarea', 'v-input fl-input fl-textarea');
  node.value = value ?? '';
  node.rows = rows;
  return node;
}

function select(options, value) {
  const node = el('select', 'v-input fl-input');
  for (const [optionValue, text] of options) {
    const option = el('option', null, text);
    option.value = optionValue;
    option.selected = String(optionValue) === String(value ?? '');
    node.append(option);
  }
  return node;
}

function checkbox(checked, text) {
  const wrap = el('label', 'fl-check');
  const node = document.createElement('input');
  node.type = 'checkbox';
  node.checked = !!checked;
  wrap.append(node, el('span', null, text));
  return { wrap, input: node };
}

function statusLine() {
  return el('p', 'fl-form-status fl-muted');
}

function setStatus(node, text, tone = '') {
  node.textContent = text;
  if (tone) node.dataset.tone = tone;
  else node.removeAttribute('data-tone');
}

function slugify(value) {
  return String(value || '').toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export async function renderAdminOverview(host, { go }) {
  loading(host, 'Platform Admin');
  try {
    const [overview, deck] = await Promise.all([P.adminOverview(), P.adminDeck().catch(() => null)]);
    const wrap = doc(host, 'Platform Admin', 'Control access, public content, learning, research and Core execution from one place.');

    const metrics = el('div', 'fl-metrics');
    metrics.append(
      metric(overview.users.total, 'Accounts', `${overview.users.active_accounts} active`),
      metric(overview.lms.active_enrollments, 'Active learners', `${overview.lms.courses_published} published courses`),
      metric(overview.research.projects_total, 'Research projects'),
      metric(overview.shell.comments_pending, 'Comments pending'),
      metric(overview.shell.content_published, 'Published content'),
      metric(overview.activity_events, 'Audit events'),
    );
    wrap.append(metrics);

    const grid = el('div', 'fl-admin-grid');
    const surfaces = [
      ['Users & Access', 'Community identity, account status and independent Dashboard/LMS/Research/Core entitlements.', '/workspace/core/admin/users', `${overview.users.total} accounts`],
      ['Public Content', 'Articles, dossiers, learning paths, labs and translations published through Layer 1.', '/workspace/core/admin/content', `${overview.shell.content_draft} drafts`],
      ['Moderation', 'Review public comments without mixing them with private research discussions.', '/workspace/core/admin/moderation', `${overview.shell.comments_pending} pending`],
      ['LMS Admin', 'Course authoring, enrollment state, completion overrides and certificates.', '/workspace/core/admin/lms', `${overview.lms.courses_total} courses`],
      ['Research Admin', 'Project metadata, secure-room policy, membership and Nextcloud project access.', '/workspace/core/admin/research', `${overview.research.projects_total} projects`],
      ['Activity', 'Cross-layer audit trail for administrative and product events.', '/workspace/core/admin/activity', `${overview.activity_events} events`],
      ['Nextcloud Deck', 'Mirror canonical Core tasks into a native Deck execution board.', '/workspace/core/admin/deck', deck?.board ? 'Connected' : (deck?.configured ? 'Ready to initialize' : 'Not configured')],
    ];
    for (const [title, body, href, meta] of surfaces) {
      const card = el('button', 'fl-admin-card');
      card.type = 'button';
      card.append(el('span', 'fl-eyebrow', meta), el('strong', 'fl-admin-card__title', title), el('p', 'fl-muted', body));
      card.addEventListener('click', () => go(href));
      grid.append(card);
    }
    wrap.append(grid);

    const layers = section('Layer access state', 'Configured grants are not community roles. Core still requires actual Core membership.');
    for (const [key, value] of Object.entries(overview.layers || {})) {
      layers.body.append(row({ title: label(key), meta: `${value.enabled} enabled · ${value.configured} configured` }));
    }
    wrap.append(layers.box);
  } catch (error) {
    fail(host, 'Platform Admin', error, () => renderAdminOverview(host, { go }));
  }
}

export async function renderAdminUsers(host, { go }) {
  loading(host, 'Users & Access');
  try {
    const wrap = doc(host, 'Users & Access', 'Community role describes identity. Module grants authorize product layers independently.');
    const toolbar = el('div', 'fl-toolbar');
    const search = input('', 'search', 'Search name or email');
    const count = el('span', 'fl-muted');
    toolbar.append(search, count);
    wrap.append(toolbar);
    const box = section('Accounts');
    wrap.append(box.box);

    let timer = null;
    const load = async () => {
      box.body.innerHTML = '';
      box.body.append(el('div', 'fl-skeleton'));
      try {
        const data = await P.adminUsers(search.value.trim());
        box.body.innerHTML = '';
        count.textContent = `${data.returned} account${data.returned === 1 ? '' : 's'}`;
        if (!data.users.length) box.body.append(empty('No matching accounts', 'Try another name or email.'));
        for (const user of data.users) {
          const modules = Object.entries(user.modules || {}).filter(([, value]) => value.enabled).map(([key]) => label(key));
          box.body.append(row({
            title: user.name,
            meta: P.meta([user.email, label(user.community_role), label(user.community_status)]),
            badges: [user.account_active ? 'Account active' : 'Account disabled', ...modules],
            onClick: () => go(`/workspace/core/admin/users/${user.id}`),
          }));
        }
      } catch (error) {
        box.body.innerHTML = '';
        box.body.append(empty('Accounts could not be loaded', error?.message || 'Try again.'));
      }
    };
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(load, 220);
    });
    await load();
  } catch (error) {
    fail(host, 'Users & Access', error, () => renderAdminUsers(host, { go }));
  }
}

export async function renderAdminUser(host, id, { go }) {
  loading(host, 'Account');
  try {
    const data = await P.adminUser(id);
    const user = data.user;
    const wrap = doc(host, user.name, user.email);
    const form = el('form', 'fl-form');
    const grid = el('div', 'fl-form-grid');
    const role = select([
      ['member', 'Member'], ['learner', 'Learner'], ['researcher', 'Researcher'], ['team', 'Gravitas+ Team'],
    ], user.community_role);
    const status = select([['invited', 'Invited'], ['active', 'Active'], ['suspended', 'Suspended']], user.community_status);
    const active = checkbox(user.account_active, 'Account can sign in');
    grid.append(field('Community role', role, 'Descriptive identity; it does not authorize a layer.'), field('Community status', status), active.wrap);
    form.append(grid);

    const access = section('Product-layer access', 'Dashboard belongs to every active registered account. LMS and Research are independent. Core additionally requires Core workspace membership.');
    const controls = {};
    for (const module of ['lms', 'research', 'core']) {
      const current = user.modules?.[module] || {};
      const card = el('div', 'fl-access-card');
      const enabled = checkbox(current.enabled, `Enable ${label(module)}`);
      const level = select([
        ['view', 'View'], ['participate', 'Participate'], ['edit', 'Edit'], ['manage', 'Manage'],
      ], current.access_level || (module === 'core' ? 'edit' : 'participate'));
      card.append(enabled.wrap, field('Access level', level));
      let workspaceRole = null;
      if (module === 'core') {
        workspaceRole = select([['member', 'Member'], ['admin', 'Admin']], current.workspace_role === 'owner' ? 'admin' : (current.workspace_role || 'member'));
        card.append(field('Core membership role', workspaceRole, current.workspace_role === 'owner' ? 'Owner membership is preserved.' : 'Core grant alone never manufactures access.'));
      }
      controls[module] = { enabled: enabled.input, level, workspaceRole };
      access.body.append(card);
    }
    form.append(access.box);

    const line = statusLine();
    const buttons = el('div', 'fl-form-actions');
    const save = action('Save access', () => {}, true);
    save.type = 'submit';
    buttons.append(save, link(go, 'Back to users', '/workspace/core/admin/users'));
    form.append(buttons, line);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      save.disabled = true;
      setStatus(line, 'Saving…');
      const modules = {};
      for (const [module, control] of Object.entries(controls)) {
        modules[module] = {
          enabled: control.enabled.checked,
          access_level: control.level.value,
        };
        if (control.workspaceRole) modules[module].workspace_role = control.workspaceRole.value;
      }
      try {
        await P.adminUpdateUser(user.id, {
          community_role: role.value,
          community_status: status.value,
          account_active: active.input.checked,
          modules,
        });
        setStatus(line, 'Access saved.', 'ok');
        save.disabled = false;
      } catch (error) {
        setStatus(line, error?.message || 'Access was not saved.', 'bad');
        save.disabled = false;
      }
    });
    wrap.append(form);

    const activity = section('Account activity');
    if (!data.activity.length) activity.body.append(empty('No recorded activity', 'Cross-layer activity for this account appears here.'));
    for (const item of data.activity) activity.body.append(row({ title: label(item.action), meta: P.meta([label(item.layer), date(item.created_at)]), body: JSON.stringify(item.detail || {}) }));
    wrap.append(activity.box);
  } catch (error) {
    fail(host, 'Account', error, () => renderAdminUser(host, id, { go }));
  }
}

export async function renderAdminContent(host, { go }) {
  loading(host, 'Public Content');
  try {
    const data = await P.adminSiteContent();
    const wrap = doc(host, 'Public Content', 'Layer 1 editorial control for public articles, dossiers, learning paths and labs.');
    const toolbar = el('div', 'fl-toolbar');
    toolbar.append(link(go, 'New content', '/workspace/core/admin/content/new', true));
    wrap.append(toolbar);
    const box = section('Content');
    if (!data.items.length) box.body.append(empty('No CMS content yet', 'Create the first public content item.'));
    for (const item of data.items) {
      box.body.append(row({
        title: item.title,
        meta: P.meta([label(item.kind), label(item.status), item.published_at ? `Published ${date(item.published_at)}` : `Updated ${date(item.updated_at)}`]),
        badges: (item.translations || []).map((translation) => `${translation.locale.toUpperCase()} ${label(translation.status)}`),
        onClick: () => go(`/workspace/core/admin/content/${item.id}`),
      }));
    }
    wrap.append(box.box);
  } catch (error) {
    fail(host, 'Public Content', error, () => renderAdminContent(host, { go }));
  }
}

function translationBlock(locale, name, current = {}) {
  const block = el('fieldset', 'fl-fieldset');
  const legend = el('legend', null, name);
  const title = input(current.title || '');
  const summary = textarea(current.summary || '', 3);
  const body = textarea(current.body || '', 9);
  const status = select([['draft', 'Draft'], ['published', 'Published']], current.status || 'draft');
  block.append(legend, field('Title', title), field('Summary', summary), field('Body', body), field('Status', status));
  return { block, locale, title, summary, body, status };
}

export async function renderAdminContentEditor(host, id, { go }) {
  loading(host, id === 'new' ? 'New content' : 'Edit content');
  try {
    const current = id === 'new' ? null : (await P.adminSiteContentItem(id)).item;
    const wrap = doc(host, current ? current.title : 'New public content', 'English is the base version; German and Persian translations are managed alongside it.');
    const form = el('form', 'fl-form');
    const title = input(current?.title || '');
    const slug = input(current?.slug || '');
    const kind = select([['article', 'Article'], ['dossier', 'Dossier'], ['learning', 'Learning path'], ['lab', 'Lab / Interactive']], current?.kind || 'article');
    const status = select([['draft', 'Draft'], ['published', 'Published']], current?.status || 'draft');
    const summary = textarea(current?.summary || '', 4);
    const body = textarea(current?.body || '', 14);
    const grid = el('div', 'fl-form-grid');
    grid.append(field('Title', title), field('Slug', slug), field('Type', kind), field('Status', status));
    form.append(grid, field('Summary', summary), field('Body', body));
    let touchedSlug = !!current;
    slug.addEventListener('input', () => { touchedSlug = true; });
    title.addEventListener('input', () => { if (!touchedSlug) slug.value = slugify(title.value); });

    const translations = section('Translations', 'Leave a translation title empty to keep that locale unchanged/not created.');
    const byLocale = Object.fromEntries((current?.translations || []).map((item) => [item.locale, item]));
    const german = translationBlock('de', 'Deutsch', byLocale.de);
    const persian = translationBlock('fa', 'فارسی', byLocale.fa);
    translations.body.append(german.block, persian.block);
    form.append(translations.box);

    const line = statusLine();
    const save = action(current ? 'Save content' : 'Create content', () => {}, true);
    save.type = 'submit';
    const actions = el('div', 'fl-form-actions');
    actions.append(save, link(go, 'Back to content', '/workspace/core/admin/content'));
    form.append(actions, line);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      save.disabled = true;
      setStatus(line, 'Saving…');
      const localeRows = [german, persian]
        .filter((item) => item.title.value.trim())
        .map((item) => ({
          locale: item.locale,
          title: item.title.value.trim(),
          summary: item.summary.value,
          body: item.body.value,
          status: item.status.value,
        }));
      const payload = {
        title: title.value.trim(), slug: slug.value.trim(), kind: kind.value, status: status.value,
        summary: summary.value, body: body.value, translations: localeRows,
      };
      try {
        const result = current
          ? await P.adminUpdateSiteContent(current.id, payload)
          : await P.adminCreateSiteContent(payload);
        setStatus(line, 'Content saved.', 'ok');
        save.disabled = false;
        if (!current) go(`/workspace/core/admin/content/${result.item.id}`, { replace: true });
      } catch (error) {
        setStatus(line, error?.message || 'Content was not saved.', 'bad');
        save.disabled = false;
      }
    });
    wrap.append(form);
  } catch (error) {
    fail(host, 'Public Content', error, () => renderAdminContentEditor(host, id, { go }));
  }
}

export async function renderAdminModeration(host) {
  loading(host, 'Moderation');
  try {
    const wrap = doc(host, 'Moderation', 'Public comments are reviewed here. Private research discussion remains inside project ACLs.');
    const toolbar = el('div', 'fl-toolbar');
    const filter = select([['pending', 'Pending'], ['published', 'Published'], ['hidden', 'Hidden'], ['', 'All']], 'pending');
    toolbar.append(field('Status', filter));
    wrap.append(toolbar);
    const box = section('Comments');
    wrap.append(box.box);
    const load = async () => {
      box.body.innerHTML = '';
      box.body.append(el('div', 'fl-skeleton'));
      try {
        const data = await P.adminSiteComments({ status: filter.value });
        box.body.innerHTML = '';
        if (!data.comments.length) box.body.append(empty('No comments in this state', 'Choose another status or wait for new contributions.'));
        for (const item of data.comments) {
          const publish = action('Publish', async () => { await P.adminModerateComment(item.id, 'published'); load(); }, false, true);
          const hide = action('Hide', async () => { await P.adminModerateComment(item.id, 'hidden'); load(); }, false, true);
          box.body.append(row({
            title: item.author.name || item.author.email,
            meta: P.meta([item.content_key, label(item.status), date(item.created_at)]),
            body: item.body,
            actions: [publish, hide],
          }));
        }
      } catch (error) {
        box.body.innerHTML = '';
        box.body.append(empty('Comments could not be loaded', error?.message || 'Try again.'));
      }
    };
    filter.addEventListener('change', load);
    await load();
  } catch (error) {
    fail(host, 'Moderation', error, () => renderAdminModeration(host));
  }
}

function questionEditor(question = {}) {
  const wrap = el('div', 'fl-question-editor');
  const prompt = input(question.prompt || '');
  const choices = textarea(Array.isArray(question.choices) ? question.choices.map(String).join('\n') : '', 3);
  const correct = input(question.correct_answer ?? question.correct ?? '');
  const remove = action('Remove question', () => wrap.remove(), false, true);
  wrap.append(field('Question', prompt), field('Choices', choices, 'One choice per line. Leave empty for free text.'), field('Correct answer', correct, 'Numbers, true/false and quoted JSON values are preserved when possible.'), remove);
  return wrap;
}

function assessmentEditor(assessment = {}) {
  const wrap = el('div', 'fl-assessment-editor');
  const title = input(assessment.title || 'Final assessment');
  const passing = input(assessment.passing_score ?? 70, 'number');
  const attempts = input(assessment.max_attempts ?? 3, 'number');
  const required = checkbox(assessment.required_for_completion !== false, 'Required for completion');
  const questions = el('div', 'fl-stack');
  (assessment.questions || []).forEach((q) => questions.append(questionEditor(q)));
  if (!questions.children.length) questions.append(questionEditor());
  const add = action('Add question', () => questions.append(questionEditor()), false, true);
  const remove = action('Remove assessment', () => wrap.remove(), false, true);
  wrap.append(field('Assessment title', title), field('Passing score', passing), field('Max attempts', attempts), required.wrap, questions, add, remove);
  wrap._controls = { title, passing, attempts, required: required.input, questions };
  return wrap;
}

function lessonEditor(lesson = {}) {
  const wrap = el('div', 'fl-lesson-editor');
  const title = input(lesson.title || '');
  const kind = select([['article', 'Article'], ['video', 'Video'], ['file', 'File / download'], ['interactive', 'Interactive'], ['live', 'Live session']], lesson.kind || 'article');
  const summary = textarea(lesson.summary || '', 2);
  const body = textarea(lesson.body || '', 5);
  const url = input(lesson.content_url || '', 'url');
  const duration = input(lesson.duration_seconds || 0, 'number');
  const preview = checkbox(lesson.is_preview, 'Preview available before enrollment');
  const required = checkbox(lesson.is_required !== false, 'Required for completion');
  const published = checkbox(lesson.published !== false, 'Published lesson');
  const remove = action('Remove lesson', () => wrap.remove(), false, true);
  const grid = el('div', 'fl-form-grid');
  grid.append(field('Lesson title', title), field('Type', kind), field('Duration seconds', duration), field('Resource URL', url));
  wrap.append(grid, field('Summary', summary), field('Body', body), preview.wrap, required.wrap, published.wrap, remove);
  wrap._controls = { title, kind, summary, body, url, duration, preview: preview.input, required: required.input, published: published.input };
  return wrap;
}

function moduleEditor(module = {}) {
  const wrap = el('div', 'fl-module-editor');
  wrap.dataset.originalId = module.id || '';
  const title = input(module.title || '');
  const summary = textarea(module.summary || '', 2);
  const lessons = el('div', 'fl-stack');
  (module.lessons || []).forEach((lesson) => lessons.append(lessonEditor(lesson)));
  if (!lessons.children.length) lessons.append(lessonEditor());
  const assessments = el('div', 'fl-stack');
  const addLesson = action('Add lesson', () => lessons.append(lessonEditor()), false, true);
  const addAssessment = action('Add module assessment', () => assessments.append(assessmentEditor()), false, true);
  const remove = action('Remove module', () => wrap.remove(), false, true);
  wrap.append(field('Module title', title), field('Module summary', summary), el('h4', null, 'Lessons'), lessons, addLesson, el('h4', null, 'Module assessments'), assessments, addAssessment, remove);
  wrap._controls = { title, summary, lessons, assessments };
  return wrap;
}

function parseLiteral(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try { return JSON.parse(raw); } catch { return raw; }
}

function serializeAssessment(node) {
  const c = node._controls;
  const questions = [...c.questions.children].map((questionNode, index) => {
    const controls = questionNode.querySelectorAll('input, textarea');
    const prompt = controls[0].value.trim();
    const choices = controls[1].value.split('\n').map((item) => item.trim()).filter(Boolean).map(parseLiteral);
    const correct = parseLiteral(controls[2].value);
    return { id: `q${index + 1}`, prompt, choices, correct_answer: correct };
  }).filter((q) => q.prompt);
  return {
    title: c.title.value.trim(),
    passing_score: Number(c.passing.value || 70),
    max_attempts: Number(c.attempts.value || 3),
    required_for_completion: c.required.checked,
    published: true,
    questions,
  };
}

function serializeModule(node, position) {
  const c = node._controls;
  return {
    position,
    title: c.title.value.trim(),
    summary: c.summary.value,
    lessons: [...c.lessons.children].map((lessonNode, index) => {
      const lc = lessonNode._controls;
      return {
        position: index + 1,
        title: lc.title.value.trim(), kind: lc.kind.value, summary: lc.summary.value, body: lc.body.value,
        content_url: lc.url.value.trim(), duration_seconds: Number(lc.duration.value || 0),
        is_preview: lc.preview.checked, is_required: lc.required.checked, published: lc.published.checked,
      };
    }).filter((lesson) => lesson.title),
    assessments: [...c.assessments.children].map(serializeAssessment).filter((item) => item.title),
  };
}

function populateStructure(modulesHost, finalsHost, course) {
  const assessments = course?.assessments || [];
  for (const module of course?.modules || []) {
    const editor = moduleEditor(module);
    assessments.filter((item) => String(item.module_id) === String(module.id)).forEach((item) => editor._controls.assessments.append(assessmentEditor(item)));
    modulesHost.append(editor);
  }
  if (!modulesHost.children.length) modulesHost.append(moduleEditor());
  assessments.filter((item) => !item.module_id).forEach((item) => finalsHost.append(assessmentEditor(item)));
}

export async function renderAdminLms(host, { go }) {
  loading(host, 'LMS Admin');
  try {
    const [courses, enrollments] = await Promise.all([P.lmsCourses({ all: true }), P.adminLmsEnrollments()]);
    const wrap = doc(host, 'LMS Admin', 'Author courses and operate enrollment/completion/certificate state without changing Research access.');
    const metrics = el('div', 'fl-metrics');
    metrics.append(metric(courses.courses.length, 'Courses'), metric(enrollments.enrollments.filter((item) => item.status === 'active').length, 'Active enrollments'), metric(enrollments.enrollments.filter((item) => item.status === 'completed').length, 'Completed'));
    wrap.append(metrics);
    const toolbar = el('div', 'fl-toolbar');
    toolbar.append(link(go, 'New course', '/workspace/core/admin/lms/courses/new', true));
    wrap.append(toolbar);

    const courseBox = section('Courses');
    for (const course of courses.courses) courseBox.body.append(row({
      title: course.title,
      meta: P.meta([label(course.status), label(course.access_type), `${course.lesson_count} lessons`]),
      badges: [course.price ? `${course.price} ${course.currency}` : '', course.certificate_enabled ? 'Certificate' : ''],
      onClick: () => go(`/workspace/core/admin/lms/courses/${course.id}`),
    }));
    if (!courses.courses.length) courseBox.body.append(empty('No courses yet', 'Create the first course.'));
    wrap.append(courseBox.box);

    const enrollmentBox = section('Recent enrollments');
    for (const enrollment of enrollments.enrollments.slice(0, 20)) enrollmentBox.body.append(enrollmentAdminRow(enrollment, () => renderAdminLms(host, { go })));
    if (!enrollments.enrollments.length) enrollmentBox.body.append(empty('No enrollments yet', 'Learner enrollments and admin grants appear here.'));
    wrap.append(enrollmentBox.box);
  } catch (error) {
    fail(host, 'LMS Admin', error, () => renderAdminLms(host, { go }));
  }
}

function enrollmentAdminRow(enrollment, refresh) {
  const state = select([['active', 'Active'], ['paused', 'Paused'], ['completed', 'Completed'], ['revoked', 'Revoked']], enrollment.status);
  const save = action('Apply', async () => {
    save.disabled = true;
    try { await P.adminUpdateLmsEnrollment(enrollment.id, { status: state.value }); await refresh(); }
    catch { save.disabled = false; }
  }, false, true);
  const cert = enrollment.certificate
    ? action(enrollment.certificate.valid ? 'Revoke certificate' : 'Reissue certificate', async () => {
        cert.disabled = true;
        await P.adminUpdateLmsEnrollment(enrollment.id, { certificate: enrollment.certificate.valid ? 'revoke' : 'reissue' });
        await refresh();
      }, false, true)
    : null;
  return row({
    title: `${enrollment.user.name} · ${enrollment.course.title}`,
    meta: P.meta([enrollment.user.email, `${enrollment.progress_percent}%`, label(enrollment.access_source)]),
    badges: [label(enrollment.status), enrollment.certificate?.valid ? 'Certificate' : ''],
    actions: [state, save, cert].filter(Boolean),
  });
}

export async function renderAdminCourseEditor(host, id, { go }) {
  loading(host, id === 'new' ? 'New course' : 'Edit course');
  try {
    const course = id === 'new' ? null : (await P.lmsCourse(id)).course;
    const enrolled = course ? (await P.adminLmsEnrollments({ course_id: course.id })).enrollments : [];
    const locked = enrolled.length > 0;
    const wrap = doc(host, course?.title || 'New course', locked ? 'Course structure is locked after the first enrollment; metadata remains editable.' : 'Build modules, lessons and assessments in the same editor.');
    const form = el('form', 'fl-form');
    const title = input(course?.title || '');
    const slug = input(course?.slug || '');
    const summary = textarea(course?.summary || '', 3);
    const description = textarea(course?.description || '', 7);
    const accessType = select([['open', 'Open enrollment'], ['locked', 'Invite only'], ['paid', 'Paid']], course?.access_type || 'open');
    const status = select([['draft', 'Draft'], ['published', 'Published'], ['archived', 'Archived']], course?.status || 'draft');
    const price = input(course?.price || '', 'number');
    price.step = '0.01';
    const currency = input(course?.currency || 'EUR');
    const certEnabled = checkbox(course?.certificate_enabled !== false, 'Issue certificate on completion');
    const grid = el('div', 'fl-form-grid');
    grid.append(field('Title', title), field('Slug', slug), field('Access', accessType), field('Status', status), field('Price', price), field('Currency', currency));
    form.append(grid, field('Summary', summary), field('Description', description), certEnabled.wrap);
    let slugTouched = !!course;
    slug.addEventListener('input', () => { slugTouched = true; });
    title.addEventListener('input', () => { if (!slugTouched) slug.value = slugify(title.value); });

    const structure = section('Course structure', locked ? `${enrolled.length} enrollment(s) exist. Structural edits are disabled to protect learner progress.` : 'Modules contain lessons and optional assessments.');
    const modulesHost = el('div', 'fl-stack');
    const finalsHost = el('div', 'fl-stack');
    populateStructure(modulesHost, finalsHost, course);
    const addModule = action('Add module', () => modulesHost.append(moduleEditor()), false, true);
    const addFinal = action('Add final assessment', () => finalsHost.append(assessmentEditor()), false, true);
    structure.body.append(modulesHost, addModule, el('h3', null, 'Course assessments'), finalsHost, addFinal);
    if (locked) structure.body.querySelectorAll('input, textarea, select, button').forEach((control) => { control.disabled = true; });
    form.append(structure.box);

    if (course) {
      const access = section('Enrollment management', 'Grant a locked/open course directly to a registered account.');
      const userSearch = input('', 'search', 'Search account');
      const resultList = el('div', 'fl-stack');
      let timer = null;
      userSearch.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          resultList.innerHTML = '';
          if (userSearch.value.trim().length < 2) return;
          const data = await P.adminUsers(userSearch.value.trim());
          for (const user of data.users.slice(0, 8)) {
            const grant = action('Enroll', async () => {
              grant.disabled = true;
              try { await P.lmsEnroll(course.id, { user_id: user.id }); setStatus(enrollStatus, `${user.email} enrolled.`, 'ok'); }
              catch (error) { setStatus(enrollStatus, error?.message || 'Enrollment failed.', 'bad'); grant.disabled = false; }
            }, false, true);
            resultList.append(row({ title: user.name, meta: user.email, actions: [grant] }));
          }
        }, 200);
      });
      const enrollStatus = statusLine();
      access.body.append(userSearch, resultList, enrollStatus);
      form.append(access.box);
    }

    const line = statusLine();
    const save = action(course ? 'Save course' : 'Create course', () => {}, true);
    save.type = 'submit';
    const actions = el('div', 'fl-form-actions');
    actions.append(save, link(go, 'Back to LMS Admin', '/workspace/core/admin/lms'));
    form.append(actions, line);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      save.disabled = true;
      setStatus(line, 'Saving…');
      const payload = {
        title: title.value.trim(), slug: slug.value.trim(), summary: summary.value, description: description.value,
        access_type: accessType.value, status: status.value, currency: currency.value.trim() || 'EUR',
        certificate_enabled: certEnabled.input.checked,
      };
      if (accessType.value === 'paid') payload.price = price.value;
      else payload.price = price.value || null;
      if (!locked) {
        payload.modules = [...modulesHost.children].map((node, index) => serializeModule(node, index + 1)).filter((item) => item.title);
        payload.assessments = [...finalsHost.children].map(serializeAssessment).filter((item) => item.title);
      }
      try {
        const result = course ? await P.lmsUpdateCourse(course.id, payload) : await P.lmsCreateCourse(payload);
        setStatus(line, 'Course saved.', 'ok');
        save.disabled = false;
        if (!course) go(`/workspace/core/admin/lms/courses/${result.course.id}`, { replace: true });
      } catch (error) {
        setStatus(line, error?.message || 'Course was not saved.', 'bad');
        save.disabled = false;
      }
    });
    wrap.append(form);

    if (course && enrolled.length) {
      const enrollmentBox = section('Enrollments');
      for (const item of enrolled) enrollmentBox.body.append(enrollmentAdminRow(item, () => renderAdminCourseEditor(host, id, { go })));
      wrap.append(enrollmentBox.box);
    }
  } catch (error) {
    fail(host, 'LMS course', error, () => renderAdminCourseEditor(host, id, { go }));
  }
}

export async function renderAdminResearch(host, { go }) {
  loading(host, 'Research Admin');
  try {
    const data = await P.adminResearchProjects();
    const wrap = doc(host, 'Research Admin', 'Operate project policy and membership without making Core administrators Research participants.');
    const box = section('Projects');
    if (!data.projects.length) box.body.append(empty('No research projects', 'Projects created in the Research Workspace appear here.'));
    for (const project of data.projects) {
      box.body.append(row({
        title: project.title,
        meta: P.meta([project.owner.name, label(project.category), label(project.status), project.deadline ? `Due ${date(project.deadline)}` : '']),
        badges: [label(project.visibility), project.secure_data_room ? 'Secure data room' : ''],
        onClick: () => go(`/workspace/core/admin/research/${project.id}`),
      }));
    }
    wrap.append(box.box);
  } catch (error) {
    fail(host, 'Research Admin', error, () => renderAdminResearch(host, { go }));
  }
}

export async function renderAdminResearchProject(host, id, { go }) {
  loading(host, 'Research project');
  try {
    const data = await P.adminResearchProject(id);
    const project = data.project;
    const wrap = doc(host, project.title, 'Project metadata, confidentiality, membership and native Nextcloud access.');
    const form = el('form', 'fl-form');
    const title = input(project.title);
    const description = textarea(project.description, 5);
    const status = select([['intake', 'Intake'], ['active', 'Active'], ['review', 'Review'], ['delivered', 'Delivered'], ['on_hold', 'On hold'], ['closed', 'Closed']], project.status);
    const category = select([['internal', 'Internal research'], ['client', 'Client / revenue research'], ['community', 'Community research']], project.category);
    const visibility = select([['private', 'Private'], ['invite', 'Invite only'], ['community', 'Community'], ['public', 'Public']], project.visibility);
    const confidentiality = select([['internal', 'Internal'], ['confidential', 'Confidential'], ['restricted', 'Restricted data room'], ['public', 'Public']], project.confidentiality);
    const question = textarea(project.research_question, 4);
    const client = input(project.client_name || '');
    const deadline = input(project.deadline || '', 'date');
    const budget = input(project.budget || '', 'number');
    budget.step = '0.01';
    const currency = input(project.currency || 'EUR');
    const secure = checkbox(project.secure_data_room, 'Secure data room');
    const publicLinks = checkbox(project.allow_public_links, 'Allow public share links');
    const downloads = checkbox(project.allow_downloads, 'Allow downloads');
    const archived = checkbox(project.archived, 'Archive project');
    const grid = el('div', 'fl-form-grid');
    grid.append(field('Title', title), field('Status', status), field('Category', category), field('Visibility', visibility), field('Confidentiality', confidentiality), field('Client', client), field('Deadline', deadline), field('Budget', budget), field('Currency', currency));
    form.append(grid, field('Description', description), field('Research question', question), secure.wrap, publicLinks.wrap, downloads.wrap, archived.wrap);
    const line = statusLine();
    const save = action('Save project policy', () => {}, true);
    save.type = 'submit';
    const actions = el('div', 'fl-form-actions');
    actions.append(save, link(go, 'Open in Research Workspace', `/workspace/research/projects/${project.id}`), link(go, 'Back to Research Admin', '/workspace/core/admin/research'));
    form.append(actions, line);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      save.disabled = true;
      setStatus(line, 'Saving…');
      try {
        await P.adminUpdateResearchProject(project.id, {
          title: title.value.trim(), description: description.value, status: status.value, category: category.value,
          visibility: visibility.value, confidentiality: confidentiality.value, research_question: question.value,
          client_name: client.value, deadline: deadline.value || null, budget: budget.value || null, currency: currency.value || 'EUR',
          secure_data_room: secure.input.checked, allow_public_links: publicLinks.input.checked,
          allow_downloads: downloads.input.checked, archived: archived.input.checked,
        });
        setStatus(line, 'Project policy saved.', 'ok');
        save.disabled = false;
      } catch (error) {
        setStatus(line, error?.message || 'Project was not saved.', 'bad');
        save.disabled = false;
      }
    });
    wrap.append(form);

    const membership = section('Members & Nextcloud access', `${project.counts.members} members · ${project.counts.files} files · ${project.counts.folders} folders`);
    for (const member of project.members) {
      const tools = [];
      if (!member.project_owner) tools.push(action('Revoke', async () => {
        try {
          await P.adminUpdateResearchProject(project.id, { member: { action: 'revoke', user_id: member.user_id } });
          renderAdminResearchProject(host, id, { go });
        } catch (error) { setStatus(memberStatus, error?.message || 'Membership could not be revoked.', 'bad'); }
      }, false, true));
      membership.body.append(row({ title: member.name, meta: member.email, badges: [label(member.role)], actions: tools }));
    }
    const memberForm = el('form', 'fl-inline-form');
    const email = input('', 'email', 'Registered account email');
    const role = select([['viewer', 'Viewer'], ['editor', 'Editor'], ['owner', 'Project owner role']], 'viewer');
    const add = action('Grant project access', () => {}, true, true);
    add.type = 'submit';
    const memberStatus = statusLine();
    memberForm.append(email, role, add);
    memberForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      add.disabled = true;
      setStatus(memberStatus, 'Granting access…');
      try {
        await P.adminUpdateResearchProject(project.id, { member: { action: 'grant', email: email.value.trim(), role: role.value } });
        await renderAdminResearchProject(host, id, { go });
      } catch (error) {
        setStatus(memberStatus, error?.message || 'Access could not be granted.', 'bad');
        add.disabled = false;
      }
    });
    membership.body.append(memberForm, memberStatus);
    wrap.append(membership.box);

    const applications = section('Applications');
    if (!project.applications.length) applications.body.append(empty('No project applications', 'Community applications appear here when this project accepts them.'));
    for (const item of project.applications) applications.body.append(row({ title: item.name, meta: P.meta([item.email, label(item.status), date(item.created_at)]), badges: item.skills || [] }));
    wrap.append(applications.box);
  } catch (error) {
    fail(host, 'Research project', error, () => renderAdminResearchProject(host, id, { go }));
  }
}

export async function renderAdminActivity(host) {
  loading(host, 'Activity');
  try {
    const wrap = doc(host, 'Activity', 'Cross-layer audit stream. Administrative changes and product events stay attributable.');
    const toolbar = el('div', 'fl-toolbar');
    const layer = select([['', 'All layers'], ['shell', 'Shell'], ['dashboard', 'Dashboard'], ['lms', 'LMS'], ['research', 'Research'], ['core', 'Core']], '');
    toolbar.append(field('Layer', layer));
    wrap.append(toolbar);
    const box = section('Events');
    wrap.append(box.box);
    const load = async () => {
      box.body.innerHTML = '';
      box.body.append(el('div', 'fl-skeleton'));
      try {
        const data = await P.adminActivity({ layer: layer.value });
        box.body.innerHTML = '';
        if (!data.events.length) box.body.append(empty('No events', 'No audit events match this filter.'));
        for (const item of data.events) {
          box.body.append(row({
            title: label(item.action),
            meta: P.meta([label(item.layer), item.actor?.email || 'System', date(item.created_at)]),
            body: Object.keys(item.detail || {}).length ? JSON.stringify(item.detail) : '',
            badges: [item.subject_user?.email || '', item.object_type ? `${item.object_type} ${item.object_id}` : ''],
          }));
        }
      } catch (error) {
        box.body.innerHTML = '';
        box.body.append(empty('Activity could not be loaded', error?.message || 'Try again.'));
      }
    };
    layer.addEventListener('change', load);
    await load();
  } catch (error) {
    fail(host, 'Activity', error, () => renderAdminActivity(host));
  }
}

export async function renderAdminDeck(host) {
  loading(host, 'Nextcloud Deck');
  try {
    const data = await P.adminDeck();
    const wrap = doc(host, 'Nextcloud Deck', 'Gravitas remains the source of truth. Deck is the native execution surface for Core tasks.');
    const state = section('Connection');
    state.body.append(row({
      title: data.configured ? (data.available ? 'Deck adapter ready' : 'Deck unavailable') : 'Nextcloud credentials not configured',
      meta: data.board ? data.board.title : (data.error || 'The board will be created on the first sync.'),
      badges: [data.configured ? 'Configured' : 'Needs configuration', data.board ? `${data.task_count} canonical tasks` : ''],
    }));
    if (data.board?.url) {
      const open = el('a', 'ws-btn', 'Open Deck');
      open.href = data.board.url;
      open.target = '_blank';
      open.rel = 'noopener';
      state.body.append(open);
    }
    wrap.append(state.box);

    const explanation = section('Sync contract');
    explanation.body.append(
      row({ title: 'Canonical data', body: 'Task title, owner, status, priority, due date, description and definition of done originate in Gravitas.' }),
      row({ title: 'Native execution', body: 'Tasks are mirrored into Backlog, Active, Blocked and Done stacks in Nextcloud Deck.' }),
      row({ title: 'Safe reconciliation', body: 'Every card contains a stable Gravitas task marker. Deleted canonical tasks are archived in Deck instead of silently left live.' }),
    );
    wrap.append(explanation.box);

    const line = statusLine();
    const sync = action('Sync Core tasks to Deck', async () => {
      sync.disabled = true;
      setStatus(line, 'Reconciling Deck…');
      try {
        const result = await P.adminDeckSync();
        const c = result.changes;
        setStatus(line, `Synced ${result.tasks} tasks · ${c.created} created · ${c.updated} updated · ${c.moved} moved · ${c.archived} archived.`, 'ok');
        sync.disabled = false;
      } catch (error) {
        setStatus(line, error?.data?.detail || error?.message || 'Deck sync failed.', 'bad');
        sync.disabled = false;
      }
    }, true);
    sync.disabled = !data.configured;
    wrap.append(sync, line);
  } catch (error) {
    fail(host, 'Nextcloud Deck', error, () => renderAdminDeck(host));
  }
}
