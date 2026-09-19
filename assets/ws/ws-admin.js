import * as P from './ws-platform.js?v=20260919-advanced4';

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
    const wrap = doc(host, 'Platform Admin', 'Control access, Topics, learning, research and Core execution from one place.');

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
      ['Topics', 'Create and manage the Topic pages published across the public site.', '/workspace/core/admin/content', `${overview.shell.content_draft} drafts`],
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
  wrap.dataset.originalId = assessment.id || '';
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
  wrap.dataset.originalId = lesson.id || '';
  const title = input(lesson.title || '');
  const kind = select([
    ['article', 'Article'], ['video', 'Video'], ['audio', 'Audio'],
    ['file', 'File / download'], ['pdf', 'PDF'], ['document', 'Document'],
    ['dataset', 'Dataset'], ['embed', 'Embedded content'], ['lab', 'Interactive Lab'],
    ['interactive', 'Interactive'], ['live', 'Live session'],
  ], lesson.kind || 'article');
  const summary = textarea(lesson.summary || '', 2);
  const body = textarea(lesson.body || '', 5);
  const url = input(lesson.content_url || '', 'url');
  const duration = input(lesson.duration_seconds || 0, 'number');
  const labSlug = input(lesson.lab_slug || '');
  const providerKey = input(lesson.provider_key || '');
  const rule = lesson.access_rule && typeof lesson.access_rule === 'object' ? lesson.access_rule : {};
  const prerequisiteIds = input(
    Array.isArray(rule.requires_lesson_ids) ? rule.requires_lesson_ids.join(', ') : '',
    'text',
    'Lesson IDs, comma-separated',
  );
  const minimumProgress = input(rule.min_progress_percent ?? '', 'number', '0–100');
  minimumProgress.min = '0';
  minimumProgress.max = '100';
  const availableAfter = input(rule.available_after || '', 'text', '2026-10-01T09:00:00+02:00');
  const advancedRule = { ...rule };
  delete advancedRule.requires_lesson_ids;
  delete advancedRule.min_progress_percent;
  delete advancedRule.available_after;
  const accessRule = textarea(
    Object.keys(advancedRule).length ? JSON.stringify(advancedRule, null, 2) : '{}',
    3,
  );
  const preview = checkbox(lesson.is_preview, 'Preview available before enrollment');
  const required = checkbox(lesson.is_required !== false, 'Required for completion');
  const published = checkbox(lesson.published !== false, 'Published lesson');
  const remove = action('Remove lesson', () => wrap.remove(), false, true);
  const grid = el('div', 'fl-form-grid');
  grid.append(field('Lesson title', title), field('Type', kind), field('Duration seconds', duration), field('Resource / embed URL', url));
  wrap.append(
    grid,
    field('Summary', summary),
    field('Body', body),
    field('Lab slug', labSlug, 'For Lab lessons, reference an Interactive Lab slug.'),
    field('Provider key', providerKey, 'Optional Open edX/XBlock content key.'),
    el('h4', null, 'Content access & locks'),
    field('Prerequisite lesson IDs', prerequisiteIds, 'Learner must complete all listed lesson IDs first.'),
    field('Minimum course progress %', minimumProgress, 'Optional progress threshold before this lesson unlocks.'),
    field('Available after', availableAfter, 'Optional ISO date/time for scheduled release.'),
    field('Advanced access rule JSON', accessRule, 'Optional extra rule metadata; standard lock fields above are merged automatically.'),
    preview.wrap, required.wrap, published.wrap, remove,
  );
  wrap._controls = {
    title, kind, summary, body, url, duration, labSlug, providerKey,
    accessRule, prerequisiteIds, minimumProgress, availableAfter,
    preview: preview.input, required: required.input, published: published.input,
  };
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
    id: node.dataset.originalId ? Number(node.dataset.originalId) : undefined,
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
    id: node.dataset.originalId ? Number(node.dataset.originalId) : undefined,
    position,
    title: c.title.value.trim(),
    summary: c.summary.value,
    lessons: [...c.lessons.children].map((lessonNode, index) => {
      const lc = lessonNode._controls;
      let accessRule = {};
      try { accessRule = JSON.parse(lc.accessRule.value || '{}'); } catch {}
      const prerequisiteIds = lc.prerequisiteIds.value
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0);
      if (prerequisiteIds.length) accessRule.requires_lesson_ids = prerequisiteIds;
      else delete accessRule.requires_lesson_ids;
      if (lc.minimumProgress.value !== '') accessRule.min_progress_percent = Number(lc.minimumProgress.value);
      else delete accessRule.min_progress_percent;
      if (lc.availableAfter.value.trim()) accessRule.available_after = lc.availableAfter.value.trim();
      else delete accessRule.available_after;
      return {
        id: lessonNode.dataset.originalId ? Number(lessonNode.dataset.originalId) : undefined,
        position: index + 1,
        title: lc.title.value.trim(), kind: lc.kind.value, summary: lc.summary.value, body: lc.body.value,
        content_url: lc.url.value.trim(), duration_seconds: Number(lc.duration.value || 0),
        lab_slug: lc.labSlug.value.trim(), provider_key: lc.providerKey.value.trim(), access_rule: accessRule,
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

function safeJson(value, fallback) {
  try {
    const parsed = JSON.parse(String(value || ''));
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function registrationFieldEditor(spec = {}) {
  const wrap = el('div', 'fl-question-editor');
  const key = input(spec.key || '');
  const labelInput = input(spec.label || '');
  const type = select([
    ['text', 'Text'], ['number', 'Number'], ['textarea', 'Long text'],
    ['select', 'Select'], ['checkbox', 'Checkbox'],
  ], spec.type || 'text');
  const options = textarea(Array.isArray(spec.options) ? spec.options.join('\n') : '', 3);
  const help = input(spec.help || '');
  const required = checkbox(!!spec.required, 'Required');
  const remove = action('Remove field', () => wrap.remove(), false, true);
  const grid = el('div', 'fl-form-grid');
  grid.append(field('Key', key), field('Label', labelInput), field('Type', type), field('Help text', help));
  wrap.append(grid, field('Options', options, 'One option per line for Select fields.'), required.wrap, remove);
  wrap._controls = { key, label: labelInput, type, options, help, required: required.input };
  return wrap;
}

function serializeRegistrationFields(host) {
  return [...host.children].map((node) => {
    const c = node._controls;
    if (!c) return null;
    return {
      key: c.key.value.trim(),
      label: c.label.value.trim(),
      type: c.type.value,
      options: c.options.value.split('\n').map((item) => item.trim()).filter(Boolean),
      help: c.help.value.trim(),
      required: c.required.checked,
    };
  }).filter((item) => item?.key && item?.label);
}

function adminAnalyticsLessonRow(item) {
  const dwell = Number(item.dwell_seconds || 0);
  return row({
    title: item.lesson__title || 'Lesson',
    meta: P.meta([item.course__title, `${item.views || 0} views`, `${item.skips || 0} skips`, `${Math.round(dwell / 60)} min dwell`]),
    badges: [`${item.ai_uses || 0} AI`, `${item.lab_uses || 0} Lab`],
  });
}

function adminAnalyticsVisual(items = []) {
  const wrap = el('div', 'fl-analytics-bars');
  const rows = [...items]
    .sort((a, b) => Number(b.views || 0) - Number(a.views || 0))
    .slice(0, 10);
  const max = Math.max(1, ...rows.map((item) => Number(item.views || 0)));
  if (!rows.length) {
    wrap.append(empty('No visual activity yet', 'The chart appears after lesson views are tracked.'));
    return wrap;
  }
  for (const item of rows) {
    const line = el('div', 'fl-analytics-bar');
    const head = el('div', 'fl-analytics-bar__head');
    head.append(
      el('strong', null, item.lesson__title || 'Lesson'),
      el('span', 'fl-muted', `${item.views || 0} views · ${Math.round(Number(item.dwell_seconds || 0) / 60)} min · ${item.ai_uses || 0} AI · ${item.lab_uses || 0} Lab`),
    );
    const track = el('div', 'fl-analytics-bar__track');
    const fill = el('span', 'fl-analytics-bar__fill');
    fill.style.setProperty('--analytics-value', `${Math.max(3, Math.round((Number(item.views || 0) / max) * 100))}%`);
    track.append(fill);
    line.append(head, track);
    wrap.append(line);
  }
  return wrap;
}

async function renderLmsMetaAdmin(host, meta, refresh) {
  const box = section('Categories & tags', 'Taxonomy shared by the catalog, learning paths and Open edX mappings.');
  const cols = el('div', 'fl-columns');
  const categories = el('div', 'fl-stack');
  const tags = el('div', 'fl-stack');

  for (const item of meta.categories || []) {
    const remove = action('Delete', async () => {
      remove.disabled = true;
      try { await P.adminDeleteLmsMeta('category', item.id); await refresh(); } catch { remove.disabled = false; }
    }, false, true);
    categories.append(row({
      title: item.name,
      meta: P.meta([item.slug, item.active ? 'Active' : 'Inactive']),
      body: item.description,
      actions: [remove],
    }));
  }
  const categoryForm = el('form', 'fl-form');
  const catName = input('', 'text', 'Category name');
  const catSlug = input('', 'text', 'category-slug');
  const catAdd = action('Add category', () => {}, true); catAdd.type = 'submit';
  categoryForm.append(catName, catSlug, catAdd);
  categoryForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    catAdd.disabled = true;
    try {
      await P.adminSaveLmsMeta({ kind: 'category', name: catName.value.trim(), slug: catSlug.value.trim() || slugify(catName.value) });
      await refresh();
    } catch { catAdd.disabled = false; }
  });
  categories.append(categoryForm);

  for (const item of meta.tags || []) {
    const remove = action('Delete', async () => {
      remove.disabled = true;
      try { await P.adminDeleteLmsMeta('tag', item.id); await refresh(); } catch { remove.disabled = false; }
    }, false, true);
    tags.append(row({ title: item.name, meta: item.slug, actions: [remove] }));
  }
  const tagForm = el('form', 'fl-form');
  const tagName = input('', 'text', 'Tag name');
  const tagSlug = input('', 'text', 'tag-slug');
  const tagAdd = action('Add tag', () => {}, true); tagAdd.type = 'submit';
  tagForm.append(tagName, tagSlug, tagAdd);
  tagForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    tagAdd.disabled = true;
    try {
      await P.adminSaveLmsMeta({ kind: 'tag', name: tagName.value.trim(), slug: tagSlug.value.trim() || slugify(tagName.value) });
      await refresh();
    } catch { tagAdd.disabled = false; }
  });
  tags.append(tagForm);

  const categoryPanel = section('Categories');
  categoryPanel.body.append(categories);
  const tagPanel = section('Tags');
  tagPanel.body.append(tags);
  cols.append(categoryPanel.box, tagPanel.box);
  box.body.append(cols);
  host.append(box.box);
}

async function renderLearningPathsAdmin(host, paths, courses, refresh) {
  const box = section(
    'Learning paths',
    'Build learning paths as graph objects. Nodes may be courses, gates, milestones or choices; edges define completion and branching rules.',
  );

  const courseOptions = [['', 'Choose course'], ...(courses || []).map((item) => [item.id, item.title])];
  let nodeCounter = 0;

  const nodeEditor = (initial = {}) => {
    nodeCounter += 1;
    const card = el('div', 'v-panel fl-path-node');
    const nodeId = input(initial.id || ('node-' + nodeCounter), 'text', 'node-id');
    const nodeType = select([
      ['course', 'Course'],
      ['gate', 'Gate'],
      ['milestone', 'Milestone'],
      ['choice', 'Choice / branch'],
    ], initial.type || (initial.course_id ? 'course' : 'milestone'));
    const nodeTitle = input(initial.title || '', 'text', 'Node title');
    const nodeCourse = select(courseOptions, initial.course_id || '');
    const nodeDescription = textarea(initial.description || '', 2);
    const remove = action('Remove node', () => card.remove(), false, true);
    const grid = el('div', 'fl-form-grid');
    grid.append(
      field('Node ID', nodeId),
      field('Type', nodeType),
      field('Title', nodeTitle),
      field('Course', nodeCourse),
    );
    card.append(grid, field('Description', nodeDescription), remove);
    card._fields = { nodeId, nodeType, nodeTitle, nodeCourse, nodeDescription };
    return card;
  };

  const edgeEditor = (initial = {}) => {
    const card = el('div', 'v-panel fl-path-edge');
    const from = input(initial.from || '', 'text', 'from node ID');
    const to = input(initial.to || '', 'text', 'to node ID');
    const rule = select([
      ['complete', 'Complete source'],
      ['pass', 'Pass source assessment'],
      ['manual', 'Manual approval'],
      ['any', 'Any / informational'],
    ], initial.rule || 'complete');
    const edgeLabel = input(initial.label || '', 'text', 'Edge label / branch condition');
    const remove = action('Remove edge', () => card.remove(), false, true);
    const grid = el('div', 'fl-form-grid');
    grid.append(
      field('From', from),
      field('To', to),
      field('Rule', rule),
      field('Label', edgeLabel),
    );
    card.append(grid, remove);
    card._fields = { from, to, rule, edgeLabel };
    return card;
  };

  const serializeNodes = (hostNode) => [...hostNode.children].map((card) => {
    const f = card._fields;
    const type = f.nodeType.value;
    const payload = {
      id: f.nodeId.value.trim(),
      type,
      title: f.nodeTitle.value.trim(),
      description: f.nodeDescription.value,
    };
    if (type === 'course') payload.course_id = Number(f.nodeCourse.value || 0);
    return payload;
  });

  const serializeEdges = (hostNode) => [...hostNode.children].map((card) => {
    const f = card._fields;
    return {
      from: f.from.value.trim(),
      to: f.to.value.trim(),
      rule: f.rule.value,
      label: f.edgeLabel.value.trim(),
    };
  });

  const graphEditor = ({ initialNodes = [], initialEdges = [] } = {}) => {
    const wrapper = el('div', 'fl-stack');
    const nodesBox = section('Path nodes', 'Course nodes link to actual courses; gate, milestone and choice nodes model complex branching.');
    const nodeHost = el('div', 'fl-stack');
    for (const item of initialNodes) nodeHost.append(nodeEditor(item));
    if (!initialNodes.length) nodeHost.append(nodeEditor({ type: 'course' }));
    const addNode = action('Add node', () => nodeHost.append(nodeEditor()), false, true);
    nodesBox.body.append(nodeHost, addNode);

    const edgesBox = section('Path edges', 'Connect any nodes by ID. Multiple outgoing/incoming edges allow branching and convergence.');
    const edgeHost = el('div', 'fl-stack');
    for (const item of initialEdges) edgeHost.append(edgeEditor(item));
    const addEdge = action('Add edge', () => edgeHost.append(edgeEditor()), false, true);
    edgesBox.body.append(edgeHost, addEdge);

    wrapper.append(nodesBox.box, edgesBox.box);
    wrapper._graph = {
      nodes: () => serializeNodes(nodeHost),
      edges: () => serializeEdges(edgeHost),
    };
    return wrapper;
  };

  const form = el('form', 'fl-form');
  const title = input('', 'text', 'Path title');
  const slug = input('', 'text', 'path-slug');
  const summary = textarea('', 2);
  const status = select([['draft','Draft'],['published','Published']], 'draft');
  const graph = graphEditor();
  const add = action('Create learning path', () => {}, true); add.type = 'submit';
  const note = statusLine();
  const grid = el('div', 'fl-form-grid');
  grid.append(field('Title', title), field('Slug', slug), field('Status', status));
  form.append(grid, field('Summary', summary), graph, add, note);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    add.disabled = true;
    try {
      await P.lmsCreateLearningPath({
        title: title.value.trim(),
        slug: slug.value.trim() || slugify(title.value),
        summary: summary.value,
        status: status.value,
        nodes: graph._graph.nodes(),
        edges: graph._graph.edges(),
        payment_config: { enabled: false, provider: 'external' },
      });
      await refresh();
    } catch (error) {
      setStatus(note, error?.data?.error || error?.message || 'Path could not be created.', 'bad');
      add.disabled = false;
    }
  });
  box.body.append(form);

  for (const item of paths || []) {
    const edit = action('Edit graph', () => {
      const editor = el('form', 'fl-form');
      const s = textarea(item.summary || '', 2);
      const st = select([['draft','Draft'],['published','Published'],['archived','Archived']], item.status);
      const existingGraph = graphEditor({ initialNodes: item.nodes || [], initialEdges: item.edges || [] });
      const save = action('Save path', () => {}, true); save.type = 'submit';
      const line = statusLine();
      editor.append(field('Summary', s), field('Status', st), existingGraph, save, line);
      editor.addEventListener('submit', async (event) => {
        event.preventDefault();
        save.disabled = true;
        try {
          await P.lmsUpdateLearningPath(item.id, {
            summary: s.value,
            status: st.value,
            nodes: existingGraph._graph.nodes(),
            edges: existingGraph._graph.edges(),
          });
          await refresh();
        } catch (error) {
          setStatus(line, error?.data?.error || error?.message || 'Save failed.', 'bad');
          save.disabled = false;
        }
      });
      const rowNode = edit.closest('.fl-row');
      rowNode?.insertAdjacentElement('afterend', editor);
      edit.disabled = true;
    }, false, true);

    const remove = action('Delete', async () => {
      if (!confirm('Delete learning path “' + item.title + '”?')) return;
      remove.disabled = true;
      try { await P.lmsDeleteLearningPath(item.id); await refresh(); } catch { remove.disabled = false; }
    }, false, true);

    box.body.append(row({
      title: item.title,
      meta: P.meta([
        label(item.status),
        item.slug,
        (item.nodes || []).length + ' nodes',
        (item.edges || []).length + ' edges',
      ]),
      body: item.summary,
      actions: [edit, remove],
    }));
  }
  host.append(box.box);
}

export async function renderAdminLms(host, { go }) {
  loading(host, 'LMS Admin');
  try {
    const [courses, enrollments, meta, analytics, openedx, paths, repositories, payments] = await Promise.all([
      P.lmsCourses({ all: true }),
      P.adminLmsEnrollments(),
      P.adminLmsMeta(),
      P.adminLmsAnalytics(),
      P.adminOpenEdxStatus().catch(() => ({ openedx: { configured: false, reachable: false } })),
      P.lmsLearningPaths({ all: true }),
      P.adminLearningRepositories().catch(() => ({ repositories: [] })),
      P.adminCoursePayments().catch(() => ({ payments: [] })),
    ]);
    const wrap = doc(host, 'LMS Admin', 'Open edX-backed learning with Gravitas+ AI, Lab, source management, exports and analytics.');
    const metrics = el('div', 'fl-metrics');
    metrics.append(
      metric(courses.courses.length, 'Courses'),
      metric(enrollments.enrollments.filter((item) => item.status === 'active').length, 'Active enrollments'),
      metric(enrollments.enrollments.filter((item) => item.status === 'completed').length, 'Completed'),
      metric(analytics.summary?.by_kind?.['ai.use']?.count || 0, 'AI tutor uses'),
      metric(analytics.summary?.by_kind?.['lab.use']?.count || 0, 'Lab uses'),
    );
    wrap.append(metrics);

    const toolbar = el('div', 'fl-toolbar');
    toolbar.append(link(go, 'New course', '/workspace/core/admin/lms/courses/new', true));
    wrap.append(toolbar);

    const engine = section('Open edX engine', 'Tutor/Open edX runs as the standards-based learning engine; Gravitas+ remains the learner and admin experience.');
    const engineState = openedx.openedx || {};
    engine.body.append(row({
      title: engineState.reachable ? 'Open edX reachable' : 'Open edX not reachable yet',
      meta: P.meta([
        engineState.configured ? 'OAuth configured' : 'OAuth pending',
        openedx.lms_url || 'learn.gravitasplus.com',
        openedx.cms_url || 'studio.gravitasplus.com',
      ]),
      badges: [engineState.reachable ? 'Online' : 'Pending', engineState.oauth ? 'OAuth OK' : ''],
    }));
    const engineLinks = el('div', 'fl-form-actions');
    const lmsLink = el('a', 'ws-btn', 'Open learner LMS');
    lmsLink.href = openedx.lms_url || 'https://learn.gravitasplus.com';
    lmsLink.target = '_blank'; lmsLink.rel = 'noopener';
    const studioLink = el('a', 'ws-btn', 'Open Studio');
    studioLink.href = openedx.cms_url || 'https://studio.gravitasplus.com';
    studioLink.target = '_blank'; studioLink.rel = 'noopener';
    engineLinks.append(lmsLink, studioLink);
    engine.body.append(engineLinks);
    wrap.append(engine.box);

    const courseBox = section('Courses');
    for (const course of courses.courses) courseBox.body.append(row({
      title: course.title,
      meta: P.meta([
        label(course.status),
        label(course.access_type),
        label(course.provider || 'native'),
        course.category?.name || '',
        `${course.lesson_count} lessons`,
      ]),
      badges: [
        course.price ? `${course.price} ${course.currency}` : '',
        course.certificate_enabled ? 'Certificate' : '',
        ...(course.tags || []).slice(0, 3).map((item) => item.name),
      ],
      onClick: () => go(`/workspace/core/admin/lms/courses/${course.id}`),
    }));
    if (!courses.courses.length) courseBox.body.append(empty('No courses yet', 'Create the first course.'));
    wrap.append(courseBox.box);

    const paymentBox = section('Course payments', 'Track paid-course checkout attempts and grant access only after a payment is verified.');
    for (const item of payments.payments || []) {
      const state = select([
        ['pending', 'Pending'],
        ['paid', 'Paid / verified'],
        ['failed', 'Failed'],
        ['cancelled', 'Cancelled'],
        ['refunded', 'Refunded'],
      ], item.status || 'pending');
      const reference = input(item.external_reference || '', 'text', 'Provider reference');
      const applyPayment = action('Apply', async () => {
        applyPayment.disabled = true;
        try {
          await P.adminUpdateCoursePayment(item.id, {
            status: state.value,
            external_reference: reference.value.trim(),
          });
          await renderAdminLms(host, { go });
        } catch (error) {
          applyPayment.disabled = false;
          alert(error?.message || 'Payment status could not be updated.');
        }
      }, false, true);
      paymentBox.body.append(row({
        title: item.user_name + ' · ' + item.course_title,
        meta: P.meta([
          item.user_email,
          item.amount + ' ' + item.currency,
          label(item.provider),
          new Date(item.created_at).toLocaleString(),
        ]),
        body: item.verified_by ? 'Verified by ' + item.verified_by : '',
        badges: [label(item.status), item.external_reference || ''],
        actions: [state, reference, applyPayment],
      }));
    }
    if (!(payments.payments || []).length) {
      paymentBox.body.append(empty('No checkout attempts yet', 'Paid-course checkout attempts will appear here.'));
    }
    wrap.append(paymentBox.box);

    const reviewBox = section('Exercise repository review', 'Learner Git pushes appear here for instructor review. A new push automatically returns the item to Pending review.');
    for (const item of repositories.repositories || []) {
      const open = el('a', 'ws-btn ws-btn--tiny', 'Open repository');
      open.href = item.html_url || ('https://github.com/' + item.owner + '/' + item.repository);
      open.target = '_blank';
      open.rel = 'noopener';
      const reviewState = select([
        ['pending', 'Pending review'],
        ['needs_changes', 'Needs changes'],
        ['approved', 'Approved'],
      ], item.review_status || 'pending');
      const reviewNote = input(item.review_note || '', 'text', 'Review note');
      const apply = action('Save review', async () => {
        apply.disabled = true;
        try {
          await P.adminReviewLearningRepository(item.id, reviewState.value, reviewNote.value.trim());
          await renderAdminLms(host, { go });
        } catch (error) {
          apply.disabled = false;
          alert(error?.message || 'Review could not be saved.');
        }
      }, false, true);
      reviewBox.body.append(row({
        title: item.learner + ' · ' + item.course_title,
        meta: P.meta([
          item.lesson_title || 'Course exercise',
          item.owner + '/' + item.repository,
          item.branch,
          item.last_commit_sha ? item.last_commit_sha.slice(0, 10) : '',
        ]),
        body: item.review_note || '',
        badges: [label(item.review_status), item.reviewed_by ? 'Reviewed by ' + item.reviewed_by : ''],
        actions: [open, reviewState, reviewNote, apply],
      }));
    }
    if (!(repositories.repositories || []).length) {
      reviewBox.body.append(empty('No exercise repositories yet', 'Learner Git pushes will appear here for review.'));
    }
    wrap.append(reviewBox.box);

    const analyticsBox = section('Learning analytics', 'Filter by course and learner. Views, skips, dwell, AI and Lab usage remain attributable down to the lesson.');
    const analyticsFilters = el('div', 'fl-toolbar');
    const courseFilter = select([
      ['', 'All courses'],
      ...courses.courses.map((item) => [item.id, item.title]),
    ], '');
    const learnerSearch = input('', 'search', 'Filter learner');
    const clearLearner = action('Clear learner', () => {}, false, true);
    const selectedLearner = el('span', 'v-toolbar__count', 'All learners');
    const learnerResults = el('div', 'fl-stack');
    let learnerId = '';
    let learnerTimer = null;
    analyticsFilters.append(courseFilter, learnerSearch, clearLearner, selectedLearner);
    analyticsBox.body.append(analyticsFilters, learnerResults);

    const analyticsContent = el('div', 'fl-stack');
    analyticsBox.body.append(analyticsContent);
    const drawAnalytics = (payload) => {
      analyticsContent.innerHTML = '';
      const summaryMetrics = el('div', 'fl-metrics');
      summaryMetrics.append(
        metric(payload.summary?.enrollments || 0, 'Enrollments'),
        metric(payload.summary?.average_progress || 0, 'Average progress', '%'),
        metric(payload.summary?.by_kind?.['lesson.view']?.count || 0, 'Lesson views'),
        metric(payload.summary?.by_kind?.['lesson.skip']?.count || 0, 'Skips'),
        metric(Math.round((payload.summary?.by_kind?.['lesson.dwell']?.duration_seconds || 0) / 60), 'Dwell', 'minutes'),
        metric(payload.summary?.by_kind?.['ai.use']?.count || 0, 'AI uses'),
        metric(payload.summary?.by_kind?.['lab.use']?.count || 0, 'Lab uses'),
      );
      analyticsContent.append(summaryMetrics);

      const visual = section('Activity overview', 'Top lessons by views; dwell, AI and Lab usage stay visible beside each bar.');
      visual.body.append(adminAnalyticsVisual(payload.lessons || []));
      analyticsContent.append(visual.box);

      const learnerRows = section('Learner activity');
      for (const item of (payload.learners || []).slice(0, 100)) {
        learnerRows.body.append(row({
          title: `${item.name} · ${item.course}`,
          meta: P.meta([`${item.progress_percent}% progress`, `${item.views} views`, `${item.skips} skips`, `${Math.round(Number(item.dwell_seconds || 0) / 60)} min dwell`]),
          badges: [`${item.ai_uses} AI`, `${item.lab_uses} Lab`, label(item.status)],
        }));
      }
      if (!(payload.learners || []).length) learnerRows.body.append(empty('No learners in this filter', 'Change the course or learner filter.'));
      analyticsContent.append(learnerRows.box);

      const topLessons = section('Lesson activity');
      (payload.lessons || []).slice(0, 60).forEach((item) => topLessons.body.append(adminAnalyticsLessonRow(item)));
      if (!(payload.lessons || []).length) topLessons.body.append(empty('No tracked lesson activity yet', 'Views, dwell, skips, AI and Lab events will appear as learners use courses.'));
      analyticsContent.append(topLessons.box);
    };

    const reloadAnalytics = async () => {
      analyticsContent.innerHTML = '<div class="fl-skeleton"></div>';
      try {
        const payload = await P.adminLmsAnalytics({
          course_id: courseFilter.value,
          user_id: learnerId,
        });
        drawAnalytics(payload);
      } catch (error) {
        analyticsContent.innerHTML = '';
        analyticsContent.append(empty('Analytics unavailable', error?.message || 'Try again.'));
      }
    };
    courseFilter.addEventListener('change', reloadAnalytics);
    clearLearner.addEventListener('click', () => {
      learnerId = '';
      learnerSearch.value = '';
      selectedLearner.textContent = 'All learners';
      learnerResults.innerHTML = '';
      reloadAnalytics();
    });
    learnerSearch.addEventListener('input', () => {
      clearTimeout(learnerTimer);
      learnerTimer = setTimeout(async () => {
        learnerResults.innerHTML = '';
        const q = learnerSearch.value.trim();
        if (q.length < 2) return;
        try {
          const result = await P.adminUsers(q);
          for (const user of (result.users || []).slice(0, 8)) {
            const choose = action('Filter', () => {
              learnerId = String(user.id);
              selectedLearner.textContent = user.name || user.email;
              learnerResults.innerHTML = '';
              reloadAnalytics();
            }, false, true);
            learnerResults.append(row({ title: user.name, meta: user.email, actions: [choose] }));
          }
        } catch {}
      }, 180);
    });
    drawAnalytics(analytics);
    wrap.append(analyticsBox.box);

    await renderLmsMetaAdmin(wrap, meta, () => renderAdminLms(host, { go }));
    await renderLearningPathsAdmin(wrap, paths.paths || [], courses.courses || [], () => renderAdminLms(host, { go }));

    const enrollmentBox = section('Recent enrollments');
    for (const enrollment of enrollments.enrollments.slice(0, 30)) enrollmentBox.body.append(enrollmentAdminRow(enrollment, () => renderAdminLms(host, { go })));
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
    const [courseResult, meta] = await Promise.all([
      id === 'new' ? Promise.resolve({ course: null }) : P.lmsCourse(id),
      P.adminLmsMeta(),
    ]);
    const course = courseResult.course;
    const enrolled = course ? (await P.adminLmsEnrollments({ course_id: course.id })).enrollments : [];
    const mediaData = course
      ? await P.adminLearningAssets(course.id)
      : { assets: [], groups: [], folders: [], nextcloud: { state: 'unavailable' } };
    const assets = mediaData.assets || [];

    const wrap = doc(
      host,
      course?.title || 'New course',
      'Course Builder · safe live editing, Open edX mapping, media, access, instructors, forms, assessments and future payment policy.',
    );
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
    const certEnabled = checkbox(course?.certificate_enabled !== false, 'Issue Gravitas+ certificate on completion');

    const provider = select([['native', 'Gravitas native'], ['openedx', 'Open edX']], course?.provider || 'native');
    const openedxKey = input(course?.openedx_course_key || '');
    const openedxUrl = input(course?.openedx_launch_url || '', 'url');
    const openedxStudio = input(course?.openedx_studio_url || '', 'url');

    const category = select([
      ['', 'No category'],
      ...(meta.categories || []).map((item) => [item.id, item.name]),
    ], course?.category?.id || '');

    const tagSelect = el('select', 'v-input fl-input');
    tagSelect.multiple = true;
    tagSelect.size = Math.min(7, Math.max(3, (meta.tags || []).length || 3));
    const selectedTags = new Set((course?.tags || []).map((item) => String(item.id)));
    for (const item of meta.tags || []) {
      const option = el('option', null, item.name);
      option.value = item.id;
      option.selected = selectedTags.has(String(item.id));
      tagSelect.append(option);
    }

    const grid = el('div', 'fl-form-grid');
    grid.append(
      field('Title', title),
      field('Slug', slug),
      field('Access', accessType),
      field('Status', status),
      field('Price', price),
      field('Currency', currency),
      field('Provider', provider),
      field('Category', category),
    );
    form.append(grid, field('Summary', summary), field('Description', description), field('Tags', tagSelect), certEnabled.wrap);

    let slugTouched = !!course;
    slug.addEventListener('input', () => { slugTouched = true; });
    title.addEventListener('input', () => { if (!slugTouched) slug.value = slugify(title.value); });

    const openedx = section('Open edX mapping', 'Map this Gravitas+ course to an Open edX course run while keeping the Gravitas+ learner experience.');
    const openedxGrid = el('div', 'fl-form-grid');
    openedxGrid.append(
      field('Course key', openedxKey, 'Example: course-v1:Gravitas+Research101+2026'),
      field('Learner URL', openedxUrl),
      field('Studio URL', openedxStudio),
    );
    openedx.body.append(openedxGrid);
    if (course) {
      const validate = action('Validate Open edX mapping', async () => {
        validate.disabled = true;
        openedxStatus.textContent = 'Checking…';
        try {
          const result = await P.adminValidateOpenEdxCourse(course.id);
          openedxStatus.textContent = result.course_details?.course_name
            ? `Connected · ${result.course_details.course_name}`
            : 'Connected.';
          openedxStatus.dataset.tone = 'ok';
        } catch (error) {
          openedxStatus.textContent = error?.message || 'Open edX mapping is not reachable yet.';
          openedxStatus.dataset.tone = 'bad';
        } finally { validate.disabled = false; }
      });
      const openedxStatus = statusLine();
      openedx.body.append(validate, openedxStatus);
    }
    form.append(openedx.box);

    const instructorsBox = section('Instructors', 'Add multiple course instructors without changing their Research/Core access.');
    const instructorState = (course?.instructors || []).map((item) => ({
      user_id: item.user_id,
      name: item.name,
      email: item.email,
      role: item.role || 'instructor',
    }));
    const instructorList = el('div', 'fl-stack');
    const drawInstructors = () => {
      instructorList.innerHTML = '';
      for (const item of instructorState) {
        const role = select([['lead','Lead'],['instructor','Instructor'],['assistant','Teaching assistant']], item.role);
        role.addEventListener('change', () => { item.role = role.value; });
        const remove = action('Remove', () => {
          const index = instructorState.indexOf(item);
          if (index >= 0) instructorState.splice(index, 1);
          drawInstructors();
        }, false, true);
        instructorList.append(row({
          title: item.name || item.email,
          meta: item.email,
          actions: [role, remove],
        }));
      }
      if (!instructorState.length) instructorList.append(empty('No instructors assigned', 'Search registered accounts below.'));
    };
    drawInstructors();

    const instructorSearch = input('', 'search', 'Search instructor account');
    const instructorRole = select([['lead','Lead'],['instructor','Instructor'],['assistant','Teaching assistant']], 'instructor');
    const instructorResults = el('div', 'fl-stack');
    let instructorTimer = null;
    instructorSearch.addEventListener('input', () => {
      clearTimeout(instructorTimer);
      instructorTimer = setTimeout(async () => {
        instructorResults.innerHTML = '';
        const q = instructorSearch.value.trim();
        if (q.length < 2) return;
        try {
          const data = await P.adminUsers(q);
          for (const user of (data.users || []).slice(0, 8)) {
            const add = action('Add', () => {
              if (!instructorState.some((row) => String(row.user_id) === String(user.id))) {
                instructorState.push({
                  user_id: user.id,
                  name: user.name,
                  email: user.email,
                  role: instructorRole.value,
                });
                drawInstructors();
              }
            }, false, true);
            instructorResults.append(row({ title: user.name, meta: user.email, actions: [add] }));
          }
        } catch {}
      }, 180);
    });
    const instructorSearchRow = el('div', 'fl-form-grid');
    instructorSearchRow.append(instructorSearch, instructorRole);
    instructorsBox.body.append(instructorList, instructorSearchRow, instructorResults);
    form.append(instructorsBox.box);

    const profileBox = section('Enrollment & profile form', 'Define fields learners complete after enrollment. Required fields lock protected lessons until completed.');
    const registrationHost = el('div', 'fl-stack');
    for (const fieldSpec of course?.registration_schema || []) registrationHost.append(registrationFieldEditor(fieldSpec));
    const addRegistrationField = action('Add profile field', () => registrationHost.append(registrationFieldEditor()), false, true);
    profileBox.body.append(registrationHost, addRegistrationField);
    form.append(profileBox.box);

    const payment = section('Payment', 'Define the paid-course checkout policy. Enrollment is still granted only after a verified payment or an admin grant; a checkout link never creates a fake purchase.');
    const paymentConfig = course?.payment_config || {};
    const paymentEnabled = checkbox(!!paymentConfig.enabled, 'Checkout enabled');
    const paymentProvider = select([
      ['external','External checkout'],
      ['stripe','Stripe'],
      ['sumup','SumUp'],
    ], paymentConfig.provider || 'external');
    const paymentSku = input(paymentConfig.sku || '');
    const paymentCheckoutUrl = input(paymentConfig.checkout_url || '', 'url', 'https://checkout.example/…');
    const paymentWebhookSecret = input(paymentConfig.webhook_secret || '', 'password', 'Webhook secret');
    payment.body.append(
      paymentEnabled.wrap,
      field('Provider', paymentProvider),
      field('SKU / product key', paymentSku),
      field('Checkout URL', paymentCheckoutUrl, 'Supports {payment_id}, {course_id}, {user_email}, {amount}, and {currency} placeholders.'),
      field('Webhook secret', paymentWebhookSecret, course ? 'Provider/backend webhook: /api/lms/courses/' + course.id + '/payment-webhook/ · send X-Gravitas-Payment-Secret.' : 'Saved per course.'),
    );
    form.append(payment.box);

    const learningConfig = course?.learning_config || {};
    const behavior = section('Learning behavior', 'Configure tutoring, research tooling, collaboration, offline access and reproducible exercise workflows per course.');
    const aiEnabled = checkbox(learningConfig.ai_enabled !== false, 'AI Tutor enabled');
    const zoteroEnabled = checkbox(learningConfig.zotero_enabled !== false, 'Zotero/source management enabled');
    const labEnabled = checkbox(learningConfig.lab_enabled !== false, 'Interactive Lab enabled');
    const profileRequired = checkbox(learningConfig.require_profile_before_content !== false, 'Require profile form before protected content');
    const discussionsEnabled = checkbox(learningConfig.discussions_enabled !== false, 'Course discussion group enabled');
    const literatureEnabled = checkbox(learningConfig.literature_enabled !== false, 'Paper recommendations enabled (ORCID / arXiv / INSPIRE / Semantic Scholar)');
    const notebookEnabled = checkbox(learningConfig.notebook_enabled !== false, 'Notebook workspace enabled');
    const gitEnabled = checkbox(learningConfig.git_enabled !== false, 'Git/GitHub exercise push enabled');
    const socialEnabled = checkbox(learningConfig.social_publish_enabled !== false, 'Achievement publishing enabled');
    const pkmEnabled = checkbox(learningConfig.pkm_enabled !== false, 'PKM exports enabled');
    const offlineEnabled = checkbox(learningConfig.offline_enabled !== false, 'Limited offline read mode enabled');
    const guidanceMode = select([
      ['hint_only', 'Hints only · never reveal final answer'],
      ['guided', 'Guided · hints first, full answer only after effort/request'],
      ['full', 'Full explanations allowed'],
    ], learningConfig.ai_guidance_mode || 'guided');
    const instructorPrompt = textarea(learningConfig.ai_instructor_prompt || '', 4);
    const notebookRuntime = select([
      ['python', 'Python in browser + .ipynb export'],
      ['jupyter', 'Jupyter / Python'],
      ['mathematica', 'Mathematica / Wolfram kernel'],
    ], learningConfig.notebook_runtime || 'python');
    const notebookPackages = textarea(
      Array.isArray(learningConfig.notebook_packages) ? learningConfig.notebook_packages.join('\n') : '',
      3,
    );
    const jupyterUrl = input(learningConfig.jupyter_url || '', 'url', 'https://jupyter.example/…');
    const mathematicaUrl = input(learningConfig.mathematica_url || '', 'url', 'https://wolfram.example/…');
    const behaviorGrid = el('div', 'fl-form-grid');
    behaviorGrid.append(
      field('AI guidance mode', guidanceMode),
      field('Default notebook runtime', notebookRuntime),
      field('Jupyter runner URL', jupyterUrl),
      field('Mathematica / Wolfram runner URL', mathematicaUrl),
    );
    behavior.body.append(
      aiEnabled.wrap,
      behaviorGrid,
      field('Instructor AI guidance', instructorPrompt, 'Extra policy/instructions appended to the course tutor system prompt.'),
      zoteroEnabled.wrap,
      labEnabled.wrap,
      discussionsEnabled.wrap,
      literatureEnabled.wrap,
      notebookEnabled.wrap,
      field('Notebook packages', notebookPackages, 'One Python package per line. Stored in the reproducible environment spec.'),
      gitEnabled.wrap,
      socialEnabled.wrap,
      pkmEnabled.wrap,
      offlineEnabled.wrap,
      profileRequired.wrap,
    );
    form.append(behavior.box);

    const structure = section(
      'Course structure',
      enrolled.length
        ? `${enrolled.length} enrollment(s) exist. Stable IDs preserve learner progress while lessons and assessments are edited.`
        : 'Modules contain lessons, course media, Labs and optional assessments.',
    );
    const modulesHost = el('div', 'fl-stack');
    const finalsHost = el('div', 'fl-stack');
    populateStructure(modulesHost, finalsHost, course);
    const addModule = action('Add module', () => modulesHost.append(moduleEditor()), false, true);
    const addFinal = action('Add final assessment', () => finalsHost.append(assessmentEditor()), false, true);
    structure.body.append(modulesHost, addModule, el('h3', null, 'Course assessments'), finalsHost, addFinal);
    form.append(structure.box);

    if (course) {
      const currentGroups = (mediaData.groups || []).map((group) => {
        const current = (group.versions || []).find((item) => item.id === group.current_id) || (group.versions || [])[0];
        return { ...group, current };
      }).filter((group) => group.current);
      const maxUpload = mediaData.max_file_bytes ? P.formatBytes(mediaData.max_file_bytes) : 'configured server limit';
      const media = section(
        'Course media library',
        'Nextcloud-backed media with folders and version history. File types are unrestricted; each upload may be up to ' + maxUpload + '.',
      );

      const cloudState = mediaData.nextcloud?.state || 'unavailable';
      const cloudBar = el('div', 'v-note');
      cloudBar.dataset.tone = cloudState === 'live' ? 'good' : cloudState === 'partial' ? 'warn' : 'bad';
      cloudBar.append(document.createTextNode(
        cloudState === 'live'
          ? 'Nextcloud storage active · ' + (mediaData.nextcloud?.mountpoint || 'Gravitas Learning')
          : cloudState === 'partial'
            ? 'Nextcloud is active, but at least one older local file still needs migration.'
            : 'Nextcloud course-media storage is currently unavailable.',
      ));
      if (mediaData.nextcloud?.files_url) {
        const openCloud = el('a', 'ws-btn ws-btn--tiny', 'Open media in Nextcloud');
        openCloud.href = mediaData.nextcloud.files_url;
        openCloud.target = '_blank';
        openCloud.rel = 'noopener';
        openCloud.style.marginInlineStart = '10px';
        cloudBar.append(openCloud);
      }
      media.body.append(cloudBar);

      const assetList = el('div', 'fl-stack');
      const sortedGroups = [...currentGroups].sort((a, b) => {
        const folderCompare = String(a.folder_path || '').localeCompare(String(b.folder_path || ''));
        return folderCompare || String(a.title || '').localeCompare(String(b.title || ''));
      });
      let activeFolder = null;
      let folderHost = null;

      for (const group of sortedGroups) {
        const item = group.current;
        const folderKey = item.folder_path || '';
        if (folderKey !== activeFolder) {
          activeFolder = folderKey;
          const folderSection = el('section', 'fl-stack');
          folderSection.append(el('h3', null, folderKey || 'Root'));
          folderHost = el('div', 'fl-stack');
          folderSection.append(folderHost);
          assetList.append(folderSection);
        }

        const actions = [];
        const open = el('a', 'ws-btn ws-btn--tiny', item.kind === 'file' ? 'Download' : 'Open');
        open.href = item.kind === 'file' ? item.download_url : item.source_url;
        if (item.kind !== 'file') { open.target = '_blank'; open.rel = 'noopener'; }
        actions.push(open);

        if (item.kind === 'file') {
          const picker = input('', 'file');
          picker.hidden = true;
          picker.addEventListener('change', async () => {
            const picked = picker.files?.[0];
            if (!picked) return;
            const versionNote = prompt('Version note (optional):', '') || '';
            const body = new FormData();
            body.append('version_of_id', String(item.id));
            body.append('title', item.title);
            body.append('folder_path', item.folder_path || '');
            body.append('version_note', versionNote);
            body.append('file', picked);
            if (item.lesson_id) body.append('lesson_id', String(item.lesson_id));
            try {
              await P.adminUploadLearningAsset(course.id, body);
              await renderAdminCourseEditor(host, id, { go });
            } catch (error) {
              alert(error?.message || 'New version could not be uploaded.');
            }
          });
          media.body.append(picker);
          const newVersion = action('New version', () => picker.click(), false, true);
          actions.push(newVersion);
        }

        const edit = action('Rename / move', async () => {
          const nextTitle = prompt('Asset title:', item.title);
          if (nextTitle == null || !nextTitle.trim()) return;
          const nextFolder = prompt('Folder path:', item.folder_path || '');
          if (nextFolder == null) return;
          let sourceUrl = item.source_url || '';
          if (item.kind !== 'file') {
            const nextUrl = prompt('Source / embed URL:', sourceUrl);
            if (nextUrl == null || !nextUrl.trim()) return;
            sourceUrl = nextUrl.trim();
          }
          edit.disabled = true;
          try {
            await P.adminUpdateLearningAsset(item.id, {
              title: nextTitle.trim(),
              folder_path: nextFolder.trim(),
              source_url: sourceUrl,
              lesson_id: item.lesson_id || null,
              metadata: item.metadata || {},
            });
            await renderAdminCourseEditor(host, id, { go });
          } catch (error) {
            edit.disabled = false;
            alert(error?.message || 'Asset could not be updated.');
          }
        }, false, true);
        actions.push(edit);

        const remove = action('Delete current', async () => {
          if (!confirm('Delete current version of “' + item.title + '”? Older versions stay available.')) return;
          remove.disabled = true;
          try {
            await P.adminDeleteLearningAsset(item.id);
            await renderAdminCourseEditor(host, id, { go });
          } catch (error) {
            remove.disabled = false;
            alert(error?.message || 'Version could not be deleted.');
          }
        }, false, true);
        actions.push(remove);

        folderHost.append(row({
          title: item.title,
          meta: P.meta([
            label(item.kind),
            'v' + item.version,
            item.version_count + ' ' + (item.version_count === 1 ? 'version' : 'versions'),
            item.mime_type,
            item.size ? P.formatBytes(item.size) : '',
          ]),
          body: item.version_note || '',
          actions,
        }));

        if ((group.versions || []).length > 1) {
          const history = el('details', 'v-panel');
          const summary = el('summary', null, 'Version history · ' + group.versions.length);
          history.append(summary);
          const historyList = el('div', 'fl-stack');
          for (const version of group.versions) {
            const versionActions = [];
            if (version.kind === 'file') {
              const get = el('a', 'ws-btn ws-btn--tiny', 'Download v' + version.version);
              get.href = version.download_url;
              versionActions.push(get);
            }
            historyList.append(row({
              title: 'v' + version.version + ' · ' + (version.original_name || version.title),
              meta: P.meta([
                new Date(version.created_at).toLocaleString(),
                version.is_current ? 'Current' : '',
                version.size ? P.formatBytes(version.size) : '',
              ]),
              body: version.version_note || '',
              actions: versionActions,
            }));
          }
          history.append(historyList);
          folderHost.append(history);
        }
      }
      if (!currentGroups.length) assetList.append(empty('No course assets yet', 'Upload a file or register an external URL/embed.'));
      media.body.append(assetList);

      const assetForm = el('form', 'fl-form');
      const assetTitle = input('', 'text', 'Asset title');
      const assetKind = select([['file','File'],['url','URL'],['embed','Embed']], 'file');
      const assetFolder = input('', 'text', 'Folder, e.g. Week 1/Datasets');
      assetFolder.setAttribute('list', 'course-media-folders-' + course.id);
      const folderOptions = el('datalist');
      folderOptions.id = 'course-media-folders-' + course.id;
      for (const value of mediaData.folders || []) {
        const option = el('option');
        option.value = value;
        folderOptions.append(option);
      }
      const assetVersionNote = input('', 'text', 'Version note (optional)');
      const assetFile = input('', 'file');
      const assetUrl = input('', 'url', 'https://…');
      const lessonOptions = [['','Whole course']];
      for (const module of course.modules || []) for (const lesson of module.lessons || []) lessonOptions.push([lesson.id, module.title + ' · ' + lesson.title]);
      const assetLesson = select(lessonOptions, '');
      const assetSave = action('Add asset', () => {}, true); assetSave.type = 'submit';
      const assetStatus = statusLine();
      const mediaGrid = el('div', 'fl-form-grid');
      mediaGrid.append(assetTitle, assetFolder, assetKind, assetLesson);
      assetForm.append(mediaGrid, folderOptions, assetVersionNote, assetFile, assetUrl, assetSave, assetStatus);
      assetForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const body = new FormData();
        body.append('title', assetTitle.value.trim());
        body.append('folder_path', assetFolder.value.trim());
        body.append('version_note', assetVersionNote.value.trim());
        body.append('kind', assetKind.value);
        if (assetLesson.value) body.append('lesson_id', assetLesson.value);
        if (assetKind.value === 'file') {
          if (!assetFile.files?.[0]) { setStatus(assetStatus, 'Choose a file.', 'bad'); return; }
          body.append('file', assetFile.files[0]);
        } else {
          if (!assetUrl.value.trim()) { setStatus(assetStatus, 'Add a URL.', 'bad'); return; }
          body.append('source_url', assetUrl.value.trim());
        }
        assetSave.disabled = true;
        setStatus(assetStatus, 'Saving…');
        try {
          await P.adminUploadLearningAsset(course.id, body);
          await renderAdminCourseEditor(host, id, { go });
        } catch (error) {
          setStatus(assetStatus, error?.message || 'Asset could not be saved.', 'bad');
          assetSave.disabled = false;
        }
      });
      media.body.append(assetForm);
      form.append(media.box);

      const access = section('Enrollment management', 'Grant a course directly to a registered account.');
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

      const tagIds = [...tagSelect.selectedOptions].map((option) => Number(option.value));
      const payload = {
        title: title.value.trim(),
        slug: slug.value.trim(),
        summary: summary.value,
        description: description.value,
        access_type: accessType.value,
        status: status.value,
        currency: currency.value.trim() || 'EUR',
        certificate_enabled: certEnabled.input.checked,
        provider: provider.value,
        openedx_course_key: openedxKey.value.trim(),
        openedx_course_url: openedxUrl.value.trim(),
        openedx_studio_url: openedxStudio.value.trim(),
        category_id: category.value ? Number(category.value) : null,
        tag_ids: tagIds,
        instructors: instructorState.map((item) => ({ user_id: item.user_id, role: item.role })),
        registration_schema: serializeRegistrationFields(registrationHost),
        payment_config: {
          enabled: paymentEnabled.input.checked,
          provider: paymentProvider.value,
          sku: paymentSku.value.trim(),
          checkout_url: paymentCheckoutUrl.value.trim(),
          webhook_secret: paymentWebhookSecret.value.trim(),
          prepared: true,
        },
        learning_config: {
          ai_enabled: aiEnabled.input.checked,
          ai_guidance_mode: guidanceMode.value,
          ai_instructor_prompt: instructorPrompt.value,
          zotero_enabled: zoteroEnabled.input.checked,
          lab_enabled: labEnabled.input.checked,
          discussions_enabled: discussionsEnabled.input.checked,
          literature_enabled: literatureEnabled.input.checked,
          notebook_enabled: notebookEnabled.input.checked,
          notebook_runtime: notebookRuntime.value,
          notebook_packages: notebookPackages.value.split('\n').map((item) => item.trim()).filter(Boolean),
          jupyter_url: jupyterUrl.value.trim(),
          mathematica_url: mathematicaUrl.value.trim(),
          git_enabled: gitEnabled.input.checked,
          social_publish_enabled: socialEnabled.input.checked,
          pkm_enabled: pkmEnabled.input.checked,
          offline_enabled: offlineEnabled.input.checked,
          require_profile_before_content: profileRequired.input.checked,
        },
        modules: [...modulesHost.children].map((node, index) => serializeModule(node, index + 1)).filter((item) => item.title),
        assessments: [...finalsHost.children].map(serializeAssessment).filter((item) => item.title),
      };
      if (accessType.value === 'paid') payload.price = price.value;
      else payload.price = price.value || null;

      try {
        const result = course ? await P.lmsUpdateCourse(course.id, payload) : await P.lmsCreateCourse(payload);
        setStatus(line, 'Course saved.', 'ok');
        save.disabled = false;
        if (!course) go(`/workspace/core/admin/lms/courses/${result.course.id}`, { replace: true });
        else await renderAdminCourseEditor(host, id, { go });
      } catch (error) {
        setStatus(line, error?.data?.error || error?.message || 'Course was not saved.', 'bad');
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


/* ---- Support / Newsletter / Interactive Lab administration ------------- */

export async function renderAdminTickets(host) {
  loading(host, 'Support tickets');
  try {
    const data = await P.adminTickets();
    const wrap = doc(host, 'Support tickets', 'Member conversations with the Gravitas+ team. Only Core administrators can read or reply.');
    const layout = el('div', 'fl-columns');
    const list = section('Tickets');
    const detail = section('Conversation');
    layout.append(list.box, detail.box); wrap.append(layout);

    const openTicket = async (id) => {
      detail.body.innerHTML = '<div class="fl-skeleton"></div>';
      try {
        const result = await P.adminTicket(id);
        const ticket = result.ticket;
        detail.head.querySelector('.fl-panel__title').textContent = ticket.subject;
        detail.body.innerHTML = '';
        detail.body.append(row({
          title: ticket.member.name,
          meta: P.meta([ticket.member.email, label(ticket.status), label(ticket.priority), date(ticket.updated_at)]),
        }));
        for (const message of ticket.messages || []) {
          detail.body.append(row({
            title: message.is_team_reply ? 'Gravitas+ Team' : message.author,
            meta: date(message.created_at),
            body: message.body,
            badges: [message.is_team_reply ? 'Team reply' : 'Member'],
          }));
        }
        const form = el('form', 'fl-form');
        const reply = textarea('', 4); reply.placeholder = 'Reply to this ticket…';
        const status = select([
          ['open','Open'], ['waiting_member','Waiting for member'], ['waiting_team','Waiting for Gravitas+'],
          ['resolved','Resolved'], ['closed','Closed'],
        ], ticket.status);
        const send = action('Send reply', () => {}, true); send.type = 'submit';
        const saveStatus = action('Update status', async () => {
          saveStatus.disabled = true;
          try { await P.adminUpdateTicket(id, {status: status.value}); await openTicket(id); await reload(); }
          finally { saveStatus.disabled = false; }
        });
        const line = statusLine();
        form.append(field('Reply', reply), field('Status', status), el('div', 'fl-form-actions'), line);
        form.querySelector('.fl-form-actions').append(send, saveStatus);
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          if (!reply.value.trim()) { setStatus(line, 'Write a reply first.', 'bad'); return; }
          send.disabled = true; setStatus(line, 'Sending…');
          try { await P.adminReplyTicket(id, reply.value.trim()); await openTicket(id); await reload(); }
          catch (error) { setStatus(line, error?.message || 'Reply failed.', 'bad'); send.disabled = false; }
        });
        detail.body.append(form);
      } catch (error) {
        detail.body.innerHTML = '';
        detail.body.append(empty('Ticket could not be loaded', error?.message || 'Request failed.'));
      }
    };

    const reload = async () => {
      const fresh = await P.adminTickets();
      list.body.innerHTML = '';
      if (!(fresh.tickets || []).length) list.body.append(empty('No tickets', 'New member tickets will appear here.'));
      for (const ticket of fresh.tickets || []) {
        list.body.append(row({
          title: ticket.subject,
          meta: P.meta([ticket.member.name, label(ticket.status), date(ticket.updated_at)]),
          badges: [label(ticket.priority), String(ticket.message_count) + ' messages'],
          onClick: () => openTicket(ticket.id),
        }));
      }
    };
    await reload();
    if (data.tickets?.[0]) await openTicket(data.tickets[0].id);
  } catch (error) {
    fail(host, 'Support tickets', error, () => renderAdminTickets(host));
  }
}

export async function renderAdminNewsletter(host) {
  loading(host, 'Newsletter');
  try {
    const data = await P.adminNewsletter();
    const wrap = doc(host, 'Newsletter', 'Confirmed subscribers, delivery history and direct campaign sending.');
    const metrics = el('div', 'fl-metrics');
    metrics.append(metric(data.active_count, 'Active subscribers'), metric((data.campaigns || []).length, 'Recent campaigns'));
    wrap.append(metrics);

    const composer = section('Send newsletter', 'Each active subscriber receives a separate email; addresses are never exposed to other recipients.');
    const form = el('form', 'fl-form');
    const subject = input('', 'text', 'Email subject');
    const body = textarea('', 10); body.placeholder = 'Newsletter body…';
    const line = statusLine();
    const send = action('Send to active subscribers', () => {}, true); send.type = 'submit';
    form.append(field('Subject', subject), field('Message', body), send, line);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!subject.value.trim() || !body.value.trim()) { setStatus(line, 'Subject and message are required.', 'bad'); return; }
      if (!confirm(`Send this email to ${data.active_count} active subscribers?`)) return;
      send.disabled = true; setStatus(line, 'Sending…');
      try {
        const result = await P.adminSendNewsletter({subject: subject.value.trim(), body: body.value.trim()});
        setStatus(line, `Sent to ${result.sent_count} subscribers.`, 'ok');
        subject.value = ''; body.value = '';
      } catch (error) {
        setStatus(line, error?.message || 'Newsletter could not be sent.', 'bad'); send.disabled = false;
      }
    });
    composer.body.append(form); wrap.append(composer.box);

    const subscribers = section('Subscribers');
    if (!(data.subscribers || []).length) subscribers.body.append(empty('No subscribers yet', 'Confirmed website subscriptions appear here.'));
    for (const item of data.subscribers || []) {
      const toggle = action(item.active ? 'Deactivate' : 'Activate', async () => {
        toggle.disabled = true;
        try { await P.adminUpdateNewsletterSubscriber(item.id, !item.active); renderAdminNewsletter(host); }
        catch { toggle.disabled = false; }
      }, false, true);
      subscribers.body.append(row({
        title: item.email,
        meta: P.meta([item.source, date(item.created_at)]),
        badges: [item.active ? 'Active' : 'Inactive'],
        actions: [toggle],
      }));
    }
    wrap.append(subscribers.box);

    const campaigns = section('Recent campaigns');
    for (const item of data.campaigns || []) campaigns.body.append(row({
      title: item.subject, meta: P.meta([`${item.sent_count} sent`, item.created_by, date(item.created_at)]),
    }));
    if (!(data.campaigns || []).length) campaigns.body.append(empty('No campaigns sent yet', 'Sent newsletters will be logged here.'));
    wrap.append(campaigns.box);
  } catch (error) {
    fail(host, 'Newsletter', error, () => renderAdminNewsletter(host));
  }
}

export async function renderAdminLabs(host) {
  loading(host, 'Interactive Lab');
  try {
    const data = await P.adminLabs();
    const wrap = doc(host, 'Interactive Lab', 'Create sandboxed interactive experiments from one or more HTML/CSS/JavaScript files.');
    const editor = section('Lab editor', 'Published labs require index.html. Code runs in a sandbox on the public Lab page.');
    const list = section('Labs');
    wrap.append(editor.box, list.box);

    const drawEditor = (lab = null) => {
      editor.body.innerHTML = '';
      const form = el('form', 'fl-form');
      const title = input(lab?.title || '', 'text', 'Lab title');
      const slug = input(lab?.slug || '', 'text', 'my-lab');
      slug.disabled = !!lab;
      const summary = textarea(lab?.summary || '', 3);
      const duration = input(lab?.duration_text || '', 'text', '10 min');
      const state = select([['draft','Draft'],['published','Published']], lab?.status || 'draft');
      const existing = Object.fromEntries((lab?.files || []).map((file) => [file.name, file.content || '']));
      const index = textarea(existing['index.html'] || '<!doctype html>\n<html><head><meta charset="utf-8"><link rel="stylesheet" href="styles.css"></head><body>\n<h1>Interactive Lab</h1>\n<script src="app.js"><\/script></body></html>', 12);
      const css = textarea(existing['styles.css'] || '', 7);
      const js = textarea(existing['app.js'] || '', 10);
      const line = statusLine();
      const save = action(lab ? 'Save lab' : 'Create lab', () => {}, true); save.type = 'submit';
      const remove = lab ? action('Delete', async () => {
        if (!confirm(`Delete “${lab.title}”?`)) return;
        await P.adminDeleteLab(lab.id); await renderAdminLabs(host);
      }) : null;
      form.append(
        field('Title', title), field('Slug', slug, 'Lowercase letters, numbers and hyphens.'),
        field('Summary', summary), field('Duration', duration), field('Status', state),
        field('index.html', index), field('styles.css', css), field('app.js', js),
        el('div', 'fl-form-actions'), line,
      );
      form.querySelector('.fl-form-actions').append(save, ...(remove ? [remove] : []));
      form.addEventListener('submit', async (event) => {
        event.preventDefault(); save.disabled = true; setStatus(line, 'Saving…');
        const files = [{name:'index.html',content:index.value}];
        if (css.value.trim()) files.push({name:'styles.css',content:css.value});
        if (js.value.trim()) files.push({name:'app.js',content:js.value});
        const payload = {title:title.value.trim(), slug:slug.value.trim(), summary:summary.value.trim(), duration_text:duration.value.trim(), status:state.value, files};
        try {
          if (lab) await P.adminUpdateLab(lab.id, payload); else await P.adminCreateLab(payload);
          await renderAdminLabs(host);
        } catch (error) {
          setStatus(line, error?.message || 'Lab could not be saved.', 'bad'); save.disabled = false;
        }
      });
      editor.body.append(form);
    };

    const labs = data.labs || [];
    const newLab = action('New lab', () => drawEditor(null), true);
    list.head.append(newLab);
    if (!labs.length) list.body.append(empty('No managed labs yet', 'Create the first interactive object above.'));
    for (const lab of labs) {
      const open = el('a', 'ws-btn ws-btn--tiny', 'Open public');
      open.href = `/lab.html?lab=${encodeURIComponent(lab.slug)}`; open.target = '_blank';
      list.body.append(row({
        title: lab.title,
        meta: P.meta([lab.slug, label(lab.status), lab.duration_text, date(lab.updated_at)]),
        body: lab.summary,
        actions: [action('Edit', () => drawEditor(lab), false, true), open],
      }));
    }
    drawEditor(labs[0] || null);
  } catch (error) {
    fail(host, 'Interactive Lab', error, () => renderAdminLabs(host));
  }
}
