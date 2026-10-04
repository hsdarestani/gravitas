/* ==========================================================================
   GRAVITAS+ WORKSPACE  ·  PLATFORM ADMIN
   Users & Access, Moderation, Newsletter, Support tickets, Interactive Lab,
   LMS, Research, Activity and Nextcloud Deck. Topics live in
   ws-topic-admin.js, Links in ws-core-links.js, the Mirror in
   ws-nextcloud-native.js; all four draw with ws-admin-kit.js.

   This module was rebuilt for one reason: it looked like a different
   product from the workspace it sits in. Every screen was a stack of
   full-width boxes in the old `fl-` vocabulary, forms put a hint under one
   field and pushed its row out of line, each product layer on an account
   became its own card around a full-width select, the save button sat
   under a screen of controls, LMS Admin was one scroll eleven cards long,
   and audit detail was printed as raw JSON.

   What changed is presentation only. Every route, request and payload is
   the one the screens sent before; the server stays the only judge of what
   an administrator may do. What the screens do now:

     - open with the shared page head and, where there is something to
       count, the Dashboard's tile row;
     - lay their cards on the twelve-column bento, side by side where the
       content is short, instead of stacking everything at full width;
     - split pages that are really several tools (LMS, a course) into the
       course screen's tabs, kept in the URL hash;
     - give on/off settings a switch row, product grants a grant row, and
       every long form a save bar that stays in reach.
   ========================================================================== */

import * as P from './ws-platform.js?v=20260919-planning1';
import * as K from './ws-admin-kit.js?v=20261002-admin1';
import { courseCover } from './ws-course-cover.js?v=20261001-cover1';

const { el, label, C } = K;
const date = (value) => P.formatDate(value);
const action = (text, handler, solid = false, tiny = false) => K.button(text, handler, { solid, tiny });
const link = (go, text, href, solid = false) => K.link(go, text, href, { solid });

/* A card on the bento. Named `section` because that is what each block of
   an admin screen is, and the tests that pin which blocks exist read it. */
function section(title, note = '', span = 12, actions = []) {
  return K.card({ title, note, span, actions });
}

function statusLine() { return K.status(); }
const setStatus = K.setStatus;

const ADMIN = '/workspace/core/admin';

/* ==========================================================================
   OVERVIEW
   ========================================================================== */

export async function renderAdminOverview(host, { go }) {
  K.loading(host, 'Platform Admin', { tiles: 6 });
  try {
    const [overview, deck] = await Promise.all([P.adminOverview(), P.adminDeck().catch(() => null)]);
    const wrap = K.page(host, {
      title: 'Platform Admin',
      meta: 'Accounts and access, the public site, learning, research and Core execution — one place to run the platform.',
      actions: [link(go, 'Users & access', `${ADMIN}/users`, true), link(go, 'Activity', `${ADMIN}/activity`)],
    });

    const users = overview.users || {};
    const lms = overview.lms || {};
    const research = overview.research || {};
    const shell = overview.shell || {};
    const tiles = [
      K.tile({ value: users.total, label: 'Accounts', icon: 'team', featured: true, part: users.active_accounts, total: users.total, onClick: () => go(`${ADMIN}/users`) }),
      K.tile({ value: lms.active_enrollments, label: 'Active learners', icon: 'course', note: `${lms.courses_published || 0} published courses`, onClick: () => go(`${ADMIN}/lms`) }),
      K.tile({ value: research.projects_total, label: 'Research projects', icon: 'space-research', note: 'Across every workspace', onClick: () => go(`${ADMIN}/research`) }),
      K.tile({ value: shell.comments_pending, label: 'Comments pending', icon: 'moderation', note: shell.comments_pending ? 'Waiting for review' : 'Nothing waiting', onClick: () => go(`${ADMIN}/moderation`) }),
      K.tile({ value: shell.content_published, label: 'Published content', icon: 'topic', note: `${shell.content_draft || 0} drafts`, onClick: () => go(`${ADMIN}/content`) }),
      K.tile({ value: overview.activity_events, label: 'Audit events', icon: 'activity', note: 'All layers', onClick: () => go(`${ADMIN}/activity`) }),
    ];

    const surfaces = section('Administration', 'Every tool in Platform Admin, with what is waiting in it.', 8);
    const entries = [
      ['Users & Access', 'Identity, account status and per-layer grants', `${ADMIN}/users`, 'team', `${users.total || 0} accounts`],
      ['Topics', 'Topic pages published across the public site', `${ADMIN}/content`, 'topic', `${shell.content_draft || 0} drafts`],
      ['Moderation', 'Public comments, kept apart from private research discussion', `${ADMIN}/moderation`, 'moderation', shell.comments_pending ? [`${shell.comments_pending} pending`, 'warn'] : 'Clear'],
      ['LMS', 'Courses, enrollments, analytics, paths and payments', `${ADMIN}/lms`, 'course', `${lms.courses_total || 0} courses`],
      ['Research', 'Project policy, secure rooms and membership', `${ADMIN}/research`, 'space-research', `${research.projects_total || 0} projects`],
      ['Activity', 'Cross-layer audit trail', `${ADMIN}/activity`, 'activity', `${overview.activity_events || 0} events`],
      ['Nextcloud Deck', 'Core tasks mirrored to a native Deck board', `${ADMIN}/deck`, 'board',
        deck?.board ? ['Connected', 'ok'] : deck?.configured ? ['Ready to initialize', 'warn'] : ['Not configured', 'bad']],
    ];
    surfaces.body.append(K.list(entries.map(([title, meta, href, mark, state], index) => K.row({
      title, meta, onClick: () => go(href),
      lead: K.avatar(title, { mark, series: (index % 4) + 1 }),
      badges: [Array.isArray(state) ? K.badge(state[0], state[1]) : K.badge(state)],
    }))));

    const layers = section('Layer access', 'Enabled grants out of configured ones. A grant is not a community role, and Core still needs Core membership.', 4);
    const bars = el('div', 'adm-list');
    for (const [key, value] of Object.entries(overview.layers || {})) {
      const line = el('button', 'adm-row');
      line.type = 'button';
      const bar = el('div', 'adm-bar');
      const head = el('div', 'adm-bar__head');
      head.append(el('strong', null, LAYER_NAMES[key] || label(key)), el('span', null, `${value.enabled} of ${value.configured} enabled`));
      const share = value.configured ? Math.round((value.enabled / value.configured) * 100) : 0;
      bar.append(head, C.meter(share));
      line.append(bar);
      line.addEventListener('click', () => go(key === 'lms' ? `${ADMIN}/lms` : key === 'research' ? `${ADMIN}/research` : key === 'core' ? '/workspace/core/team' : `${ADMIN}/users`));
      bars.append(line);
    }
    if (!bars.childElementCount) bars.append(K.empty('No layer grants are configured yet.'));
    layers.body.append(bars);

    wrap.append(K.tiles(tiles), K.bento([surfaces.box, layers.box]));
  } catch (error) {
    K.failure(host, 'Platform Admin', error, () => renderAdminOverview(host, { go }));
  }
}

/* ==========================================================================
   USERS & ACCESS
   ========================================================================== */

const MODULES = [
  ['lms', 'LMS', 'course', 'Courses, enrollment and certificates.'],
  ['research', 'Research', 'space-research', 'Research projects this account can see or join.'],
  ['core', 'Core', 'space-core', 'Core operations. Also needs a Core workspace membership.'],
];

function moduleBadges(user) {
  return MODULES
    .filter(([key]) => user.modules?.[key]?.enabled)
    .map(([, name]) => K.badge(name));
}

export async function renderAdminUsers(host, { go }) {
  K.loading(host, 'Users & Access', { tiles: 0, cards: [12] });
  try {
    const wrap = K.page(host, {
      title: 'Users & Access',
      meta: 'Community role describes who someone is. Grants decide which product layers they can open, one layer at a time.',
    });
    const box = section('Accounts');
    let users = [];
    let filter = '';
    const counter = el('span', 'adm-count');
    const listHost = el('div');

    const draw = () => {
      const shown = users.filter((user) => !filter
        || (filter === 'disabled' ? !user.account_active : user.community_status === filter));
      counter.textContent = `${shown.length} of ${users.length} account${users.length === 1 ? '' : 's'}`;
      if (!shown.length) {
        listHost.replaceChildren(K.empty(users.length ? 'No account in this filter.' : 'No matching accounts. Try another name or email.'));
        return;
      }
      listHost.replaceChildren(K.list(shown.map((user, index) => K.row({
        title: user.name || user.email,
        meta: P.meta([user.email, label(user.community_role)]),
        lead: K.avatar(user.name || user.email, { series: (index % 4) + 1 }),
        badges: [
          ...moduleBadges(user),
          user.account_active ? K.stateBadge(user.community_status) : K.badge('Sign-in off', 'bad'),
        ],
        onClick: () => go(`${ADMIN}/users/${user.id}`),
      }))));
    };

    const load = async (query = '') => {
      listHost.replaceChildren(el('div', 'fl-skeleton adm-skeleton'));
      try {
        const data = await P.adminUsers(query);
        users = data.users || [];
        draw();
      } catch (error) {
        listHost.replaceChildren(K.empty(error?.message || 'Accounts could not be loaded.', [action('Retry', () => load(query))]));
      }
    };

    const finder = K.search('Search name or email', load);
    const states = K.choices([['', 'All'], ['active', 'Active'], ['invited', 'Invited'], ['suspended', 'Suspended'], ['disabled', 'Sign-in off']], '', (value) => { filter = value; draw(); });
    box.body.append(K.toolbar([finder.wrap, states], [counter]), listHost);
    wrap.append(K.bento([box.box]));
    await load();
  } catch (error) {
    K.failure(host, 'Users & Access', error, () => renderAdminUsers(host, { go }));
  }
}

export async function renderAdminUser(host, id, { go }) {
  K.loading(host, 'Account', { tiles: 0, cards: [8, 4] });
  try {
    const data = await P.adminUser(id);
    const user = data.user;
    const wrap = K.page(host, {
      title: user.name || user.email,
      meta: P.meta([user.email, label(user.community_role), label(user.community_status)]),
      actions: [link(go, 'All users', `${ADMIN}/users`)],
    });

    const form = el('form', 'adm-form');

    /* Product layers ---------------------------------------------------- */
    const access = section('Product-layer access', 'Each layer is granted on its own. Turning one off keeps its level, so turning it back on restores it.', 8);
    const grants = el('div', 'adm-grants');
    const dashboard = el('div', 'adm-grant adm-grant--static');
    const dashText = el('div', 'adm-grant__text');
    dashText.append(el('span', 'adm-grant__name', 'Dashboard'), el('span', 'adm-grant__hint', 'Belongs to every active registered account.'));
    dashboard.append(K.avatar('Dashboard', { mark: 'dashboard', series: 1 }), dashText, el('span', 'adm-grant__level', 'Always on'), el('span'));
    grants.append(dashboard);

    const controls = {};
    MODULES.forEach(([module, name, mark, hint], index) => {
      const current = user.modules?.[module] || {};
      const line = el('div', 'adm-grant');
      const text = el('div', 'adm-grant__text');
      text.append(el('span', 'adm-grant__name', name), el('span', 'adm-grant__hint', hint));
      const level = K.select([
        ['view', 'View'], ['participate', 'Participate'], ['edit', 'Edit'], ['manage', 'Manage'],
      ], current.access_level || (module === 'core' ? 'edit' : 'participate'));
      level.classList.add('adm-grant__level');
      level.setAttribute('aria-label', `${name} access level`);
      const enabled = el('input', 'adm-toggle');
      enabled.type = 'checkbox';
      enabled.setAttribute('role', 'switch');
      enabled.setAttribute('aria-label', `Enable ${name}`);
      enabled.checked = !!current.enabled;
      line.append(K.avatar(name, { mark, series: index + 2 }), text, level, enabled);

      let workspaceRole = null;
      if (module === 'core') {
        workspaceRole = K.select([['member', 'Member'], ['admin', 'Admin']], current.workspace_role === 'owner' ? 'admin' : (current.workspace_role || 'member'));
        workspaceRole.setAttribute('aria-label', 'Core membership role');
        const extra = el('div', 'adm-grant__extra');
        extra.append(
          el('span', 'adm-grant__hint', current.workspace_role === 'owner'
            ? 'Core membership role. Owner membership is preserved.'
            : 'Core membership role. A Core grant alone never manufactures access.'),
          workspaceRole,
        );
        line.append(extra);
      }
      const sync = () => line.toggleAttribute('data-off', !enabled.checked);
      enabled.addEventListener('change', sync);
      sync();
      controls[module] = { enabled, level, workspaceRole };
      grants.append(line);
    });
    access.body.append(grants);

    /* Identity ---------------------------------------------------------- */
    const identity = section('Account', 'Who this person is in the community, and whether they can sign in at all.', 4);
    const role = K.select([
      ['member', 'Member'], ['learner', 'Learner'], ['researcher', 'Researcher'], ['team', 'Gravitas+ Team'],
    ], user.community_role);
    const status = K.select([['invited', 'Invited'], ['active', 'Active'], ['suspended', 'Suspended']], user.community_status);
    const active = K.toggle(user.account_active, 'Account can sign in', 'Off blocks sign-in without deleting anything.');
    identity.body.append(
      K.fields([
        K.field('Community role', role, 'Descriptive identity; it does not authorize a layer.'),
        K.field('Community status', status),
      ], 1),
      K.switches([active]),
    );

    const line = statusLine();
    const save = action('Save access', null, true);
    save.type = 'submit';
    form.append(K.bento([access.box, identity.box]), K.foot([save, link(go, 'Cancel', `${ADMIN}/users`)], line));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      save.disabled = true;
      setStatus(line, 'Saving…');
      const modules = {};
      for (const [module, control] of Object.entries(controls)) {
        modules[module] = { enabled: control.enabled.checked, access_level: control.level.value };
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
      } catch (error) {
        setStatus(line, error?.message || 'Access was not saved.', 'bad');
      } finally {
        save.disabled = false;
      }
    });
    wrap.append(form);

    const activity = section('Account activity', 'Cross-layer events recorded for this account.');
    if (!data.activity.length) activity.body.append(K.empty('No recorded activity yet.'));
    else activity.body.append(K.list(data.activity.map((item) => activityRow(item))));
    wrap.append(K.bento([activity.box]));
  } catch (error) {
    K.failure(host, 'Account', error, () => renderAdminUser(host, id, { go }));
  }
}

function activityRow(item, { withActor = false } = {}) {
  const node = K.row({
    title: label(item.action),
    meta: P.meta([LAYER_NAMES[item.layer] || label(item.layer), withActor ? (item.actor?.email || 'System') : '', date(item.created_at)]),
    lead: K.avatar(item.layer, { mark: LAYER_MARKS[item.layer] || 'activity', series: LAYER_SERIES[item.layer] || 1 }),
    badges: [
      item.subject_user?.email ? K.badge(item.subject_user.email) : null,
      item.object_type ? K.badge(`${item.object_type} ${item.object_id ?? ''}`.trim()) : null,
    ],
  });
  const detail = K.kv(item.detail);
  if (detail) node.querySelector('.adm-row__main').append(detail);
  return node;
}

const LAYER_NAMES = { shell: 'Public site', dashboard: 'Dashboard', lms: 'LMS', research: 'Research', core: 'Core' };
const LAYER_MARKS = { shell: 'topic', dashboard: 'dashboard', lms: 'course', research: 'space-research', core: 'space-core' };
const LAYER_SERIES = { shell: 1, dashboard: 2, lms: 3, research: 4, core: 1 };

/* ==========================================================================
   MODERATION
   ========================================================================== */

export async function renderAdminModeration(host) {
  K.loading(host, 'Moderation', { tiles: 0, cards: [12] });
  try {
    const wrap = K.page(host, {
      title: 'Moderation',
      meta: 'Public comments are reviewed here. Private research discussion stays inside its project and never appears on this list.',
    });
    let current = 'pending';
    const box = section('Comments');
    const counter = el('span', 'adm-count');
    const filter = K.choices([['pending', 'Pending'], ['published', 'Published'], ['hidden', 'Hidden'], ['', 'All']], current, (value) => { current = value; load(); });
    const line = statusLine();
    const listHost = el('div');
    box.body.append(K.toolbar([filter], [line, counter]), listHost);
    wrap.append(K.bento([box.box]));

    const moderate = async (item, state, buttons) => {
      buttons.forEach((button) => { button.disabled = true; });
      try {
        await P.adminModerateComment(item.id, state);
        setStatus(line, state === 'published' ? 'Comment published.' : 'Comment hidden.', 'ok');
        await load();
      } catch (error) {
        setStatus(line, error?.message || 'The comment was not changed.', 'bad');
        buttons.forEach((button) => { button.disabled = false; });
      }
    };

    const load = async () => {
      listHost.replaceChildren(el('div', 'fl-skeleton adm-skeleton'));
      try {
        const data = await P.adminSiteComments({ status: current });
        const comments = data.comments || [];
        counter.textContent = `${comments.length} comment${comments.length === 1 ? '' : 's'}`;
        if (!comments.length) {
          listHost.replaceChildren(K.empty('No comments in this state.'));
          return;
        }
        listHost.replaceChildren(K.list(comments.map((item, index) => {
          const buttons = [];
          const publish = action('Publish', () => moderate(item, 'published', buttons), false, true);
          const hide = action('Hide', () => moderate(item, 'hidden', buttons), false, true);
          if (item.status !== 'published') buttons.push(publish);
          if (item.status !== 'hidden') buttons.push(hide);
          return K.row({
            title: item.author?.name || item.author?.email || 'Anonymous',
            meta: P.meta([item.content_key, date(item.created_at)]),
            body: item.body,
            lead: K.avatar(item.author?.name || item.author?.email, { series: (index % 4) + 1 }),
            badges: [K.stateBadge(item.status)],
            actions: buttons,
          });
        })));
      } catch (error) {
        listHost.replaceChildren(K.empty(error?.message || 'Comments could not be loaded.', [action('Retry', load)]));
      }
    };
    await load();
  } catch (error) {
    K.failure(host, 'Moderation', error, () => renderAdminModeration(host));
  }
}

/* ==========================================================================
   COURSE BUILDER PARTS
   A module holds lessons and assessments, an assessment holds questions.
   Each editor keeps its controls on `_controls`, so serializing reads named
   fields instead of counting inputs in document order.
   ========================================================================== */

function questionEditor(question = {}) {
  const wrap = K.sub('Question');
  const prompt = K.input(question.prompt || '', 'text', 'What is being asked?');
  const choices = K.textarea(Array.isArray(question.choices) ? question.choices.map(String).join('\n') : '', 3);
  const correct = K.input(question.correct_answer ?? question.correct ?? '');
  wrap.head.querySelector('.adm-sub__tools').append(K.button('Remove', () => wrap.remove(), { tiny: true, danger: true }));
  wrap.append(K.fields([
    K.field('Question', prompt, '', { wide: true }),
    K.field('Choices', choices, 'One choice per line. Leave empty for free text.'),
    K.field('Correct answer', correct, 'Numbers, true/false and quoted JSON values are preserved when possible.'),
  ], 2));
  wrap.classList.add('adm-question');
  wrap._controls = { prompt, choices, correct };
  return wrap;
}

function assessmentEditor(assessment = {}) {
  const wrap = K.sub(assessment.title || 'Assessment', { meta: assessment.id ? `#${assessment.id}` : 'new' });
  wrap.dataset.originalId = assessment.id || '';
  const title = K.input(assessment.title || 'Final assessment');
  const passing = K.input(assessment.passing_score ?? 70, 'number');
  const attempts = K.input(assessment.max_attempts ?? 3, 'number');
  const required = K.toggle(assessment.required_for_completion !== false, 'Required for completion');
  const questions = K.stack();
  (assessment.questions || []).forEach((q) => questions.append(questionEditor(q)));
  if (!questions.children.length) questions.append(questionEditor());
  const add = K.button('Add question', () => questions.append(questionEditor()), { tiny: true });
  add.classList.add('adm-add');
  wrap.head.querySelector('.adm-sub__tools').append(K.button('Remove assessment', () => wrap.remove(), { tiny: true, danger: true }));
  wrap.append(
    K.fields([K.field('Assessment title', title), K.field('Passing score', passing), K.field('Max attempts', attempts)]),
    K.switches([required]),
    questions, add,
  );
  wrap._controls = { title, passing, attempts, required: required.input, questions };
  return wrap;
}

function lessonEditor(lesson = {}) {
  const wrap = K.sub(lesson.title || 'New lesson', { meta: lesson.id ? `#${lesson.id}` : '' });
  wrap.dataset.originalId = lesson.id || '';
  const title = K.input(lesson.title || '');
  title.addEventListener('input', () => { wrap.titleNode.firstChild.nodeValue = title.value || 'New lesson'; });
  const kind = K.select([
    ['article', 'Article'], ['video', 'Video'], ['audio', 'Audio'],
    ['file', 'File / download'], ['pdf', 'PDF'], ['document', 'Document'],
    ['dataset', 'Dataset'], ['embed', 'Embedded content'], ['lab', 'Interactive Lab'],
    ['interactive', 'Interactive'], ['live', 'Live session'],
  ], lesson.kind || 'article');
  const summary = K.textarea(lesson.summary || '', 2);
  const body = K.textarea(lesson.body || '', 5);
  const url = K.input(lesson.content_url || '', 'url', 'https://…');
  const duration = K.input(lesson.duration_seconds || 0, 'number');
  const labSlug = K.input(lesson.lab_slug || '');
  const providerKey = K.input(lesson.provider_key || '');
  const rule = lesson.access_rule && typeof lesson.access_rule === 'object' ? lesson.access_rule : {};
  const prerequisiteIds = K.input(
    Array.isArray(rule.requires_lesson_ids) ? rule.requires_lesson_ids.join(', ') : '',
    'text',
    'Lesson IDs, comma-separated',
  );
  const minimumProgress = K.input(rule.min_progress_percent ?? '', 'number', '0–100');
  minimumProgress.min = '0';
  minimumProgress.max = '100';
  const availableAfter = K.input(rule.available_after || '', 'text', '2026-10-01T09:00:00+02:00');
  const advancedRule = { ...rule };
  delete advancedRule.requires_lesson_ids;
  delete advancedRule.min_progress_percent;
  delete advancedRule.available_after;
  const accessRule = K.textarea(Object.keys(advancedRule).length ? JSON.stringify(advancedRule, null, 2) : '{}', 3, '', { code: true });
  const preview = K.toggle(lesson.is_preview, 'Preview available before enrollment');
  const required = K.toggle(lesson.is_required !== false, 'Required for completion');
  const published = K.toggle(lesson.published !== false, 'Published lesson');
  wrap.head.querySelector('.adm-sub__tools').append(...K.orderTools(wrap, 'Remove lesson'));

  const locks = el('details', 'adm-details');
  locks.append(el('summary', null, 'Content access & locks'), K.fields([
    K.field('Prerequisite lesson IDs', prerequisiteIds, 'Learner must complete all listed lesson IDs first.'),
    K.field('Minimum course progress %', minimumProgress, 'Optional progress threshold before this lesson unlocks.'),
    K.field('Available after', availableAfter, 'Optional ISO date/time for scheduled release.'),
    K.field('Advanced access rule JSON', accessRule, 'Optional extra rule metadata; standard lock fields above are merged automatically.', { wide: true }),
  ], 2));
  if (prerequisiteIds.value || minimumProgress.value || availableAfter.value) locks.open = true;

  wrap.append(
    K.fields([K.field('Lesson title', title), K.field('Type', kind), K.field('Duration seconds', duration), K.field('Resource / embed URL', url)], 2),
    K.fields([
      K.field('Summary', summary),
      K.field('Body', body),
      K.field('Lab slug', labSlug, 'For Lab lessons, reference an Interactive Lab slug.'),
      K.field('Provider key', providerKey, 'Optional Open edX/XBlock content key.'),
    ], 2),
    locks,
    K.switches([preview, required, published]),
  );
  wrap.classList.add('adm-lesson');
  wrap._controls = {
    title, kind, summary, body, url, duration, labSlug, providerKey,
    accessRule, prerequisiteIds, minimumProgress, availableAfter,
    preview: preview.input, required: required.input, published: published.input,
  };
  return wrap;
}

function moduleEditor(module = {}) {
  const wrap = K.sub(module.title || 'New module', { meta: module.id ? `#${module.id}` : '' });
  wrap.dataset.originalId = module.id || '';
  const title = K.input(module.title || '');
  title.addEventListener('input', () => { wrap.titleNode.firstChild.nodeValue = title.value || 'New module'; });
  const summary = K.textarea(module.summary || '', 2);
  const lessons = K.stack();
  (module.lessons || []).forEach((lesson) => lessons.append(lessonEditor(lesson)));
  if (!lessons.children.length) lessons.append(lessonEditor());
  const assessments = K.stack();
  const addLesson = K.button('Add lesson', () => lessons.append(lessonEditor()), { tiny: true });
  const addAssessment = K.button('Add module assessment', () => assessments.append(assessmentEditor()), { tiny: true });
  wrap.head.querySelector('.adm-sub__tools').append(...K.orderTools(wrap, 'Remove module'));
  wrap.append(
    K.fields([K.field('Module title', title), K.field('Module summary', summary)], 2),
    K.heading('Lessons'), lessons, K.cardActions([addLesson]),
    K.heading('Module assessments'), assessments, K.cardActions([addAssessment]),
  );
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
    const q = questionNode._controls;
    const prompt = q.prompt.value.trim();
    const choices = q.choices.value.split('\n').map((item) => item.trim()).filter(Boolean).map(parseLiteral);
    const correct = parseLiteral(q.correct.value);
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

function registrationFieldEditor(spec = {}) {
  const wrap = K.sub(spec.label || 'Profile field');
  const key = K.input(spec.key || '', 'text', 'field_key');
  const labelInput = K.input(spec.label || '');
  const type = K.select([
    ['text', 'Text'], ['number', 'Number'], ['textarea', 'Long text'],
    ['select', 'Select'], ['checkbox', 'Checkbox'],
  ], spec.type || 'text');
  const options = K.textarea(Array.isArray(spec.options) ? spec.options.join('\n') : '', 3);
  const help = K.input(spec.help || '');
  const required = K.toggle(!!spec.required, 'Required');
  wrap.head.querySelector('.adm-sub__tools').append(...K.orderTools(wrap, 'Remove field'));
  wrap.append(
    K.fields([K.field('Key', key), K.field('Label', labelInput), K.field('Type', type), K.field('Help text', help)]),
    K.field('Options', options, 'One option per line for Select fields.'),
    K.switches([required]),
  );
  wrap._controls = { key, label: labelInput, type, options, help, required: required.input };
  return wrap;
}

function serializeRegistrationFields(hostNode) {
  return [...hostNode.children].map((node) => {
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

/* ==========================================================================
   LMS ADMIN
   Six tools that used to be one scroll: courses and the engine, analytics,
   learning paths, taxonomy, payments with repository review, enrollments.
   ========================================================================== */

function adminAnalyticsLessonRow(item) {
  const dwell = Number(item.dwell_seconds || 0);
  return K.row({
    title: item.lesson__title || 'Lesson',
    meta: P.meta([item.course__title, `${item.views || 0} views`, `${item.skips || 0} skips`, `${Math.round(dwell / 60)} min dwell`]),
    badges: [`${item.ai_uses || 0} AI`, `${item.lab_uses || 0} Lab`],
  });
}

function adminAnalyticsVisual(items = []) {
  const wrap = el('div', 'adm-bars');
  const rows = [...items].sort((a, b) => Number(b.views || 0) - Number(a.views || 0)).slice(0, 10);
  const max = Math.max(1, ...rows.map((item) => Number(item.views || 0)));
  if (!rows.length) {
    wrap.append(K.empty('No visual activity yet. The chart appears after lesson views are tracked.'));
    return wrap;
  }
  rows.forEach((item, index) => {
    const line = el('div', 'adm-bar');
    line.dataset.series = String((index % 4) + 1);
    const head = el('div', 'adm-bar__head');
    head.append(
      el('strong', null, item.lesson__title || 'Lesson'),
      el('span', null, `${item.views || 0} views · ${Math.round(Number(item.dwell_seconds || 0) / 60)} min · ${item.ai_uses || 0} AI · ${item.lab_uses || 0} Lab`),
    );
    line.append(head, C.meter(Math.round((Number(item.views || 0) / max) * 100)));
    wrap.append(line);
  });
  return wrap;
}

function renderLmsMetaAdmin(meta, refresh) {
  const taxonomy = (kind, title, items, describe) => {
    const box = section(title, kind === 'category' ? 'Used by the catalog, learning paths and Open edX mappings.' : 'Free labels shown on course cards.', 6);
    const rows = items.map((item) => {
      const remove = K.button('Delete', async () => {
        remove.disabled = true;
        try { await P.adminDeleteLmsMeta(kind, item.id); await refresh(); } catch { remove.disabled = false; }
      }, { tiny: true, danger: true });
      return K.row({ title: item.name, meta: describe(item), body: item.description || '', actions: [remove] });
    });
    box.body.append(rows.length ? K.list(rows) : K.empty(`No ${kind === 'category' ? 'categories' : 'tags'} yet.`));
    const name = K.input('', 'text', kind === 'category' ? 'Category name' : 'Tag name');
    const slug = K.input('', 'text', kind === 'category' ? 'category-slug' : 'tag-slug');
    name.addEventListener('input', () => { if (!slug.dataset.touched) slug.value = K.slugify(name.value); });
    slug.addEventListener('input', () => { slug.dataset.touched = '1'; });
    const add = K.button(kind === 'category' ? 'Add category' : 'Add tag', async () => {
      if (!name.value.trim()) return;
      add.disabled = true;
      try {
        await P.adminSaveLmsMeta({ kind, name: name.value.trim(), slug: slug.value.trim() || K.slugify(name.value) });
        await refresh();
      } catch { add.disabled = false; }
    }, { solid: true });
    box.body.append(K.fields([K.field('Name', name), K.field('Slug', slug)]), K.cardActions([add]));
    return box.box;
  };
  return K.bento([
    taxonomy('category', 'Categories', meta.categories || [], (item) => P.meta([item.slug, item.active ? 'Active' : 'Inactive'])),
    taxonomy('tag', 'Tags', meta.tags || [], (item) => item.slug),
  ]);
}

function renderLearningPathsAdmin(paths, courses, refresh) {
  const courseOptions = [['', 'Choose course'], ...(courses || []).map((item) => [item.id, item.title])];
  let nodeCounter = 0;

  const nodeEditor = (initial = {}) => {
    nodeCounter += 1;
    const card = K.sub(initial.title || initial.id || 'Node');
    const nodeId = K.input(initial.id || ('node-' + nodeCounter), 'text', 'node-id');
    const nodeType = K.select([
      ['course', 'Course'],
      ['gate', 'Gate'],
      ['milestone', 'Milestone'],
      ['choice', 'Choice / branch'],
    ], initial.type || (initial.course_id ? 'course' : 'milestone'));
    const nodeTitle = K.input(initial.title || '', 'text', 'Node title');
    const nodeCourse = K.select(courseOptions, initial.course_id || '');
    const nodeDescription = K.textarea(initial.description || '', 2);
    card.head.querySelector('.adm-sub__tools').append(K.button('Remove node', () => card.remove(), { tiny: true, danger: true }));
    card.append(
      K.fields([K.field('Node ID', nodeId), K.field('Type', nodeType), K.field('Title', nodeTitle), K.field('Course', nodeCourse)]),
      K.field('Description', nodeDescription),
    );
    card._fields = { nodeId, nodeType, nodeTitle, nodeCourse, nodeDescription };
    return card;
  };

  const edgeEditor = (initial = {}) => {
    const card = K.sub('Edge', { meta: initial.from ? `${initial.from} → ${initial.to}` : '' });
    const from = K.input(initial.from || '', 'text', 'from node ID');
    const to = K.input(initial.to || '', 'text', 'to node ID');
    const rule = K.select([
      ['complete', 'Complete source'],
      ['pass', 'Pass source assessment'],
      ['manual', 'Manual approval'],
      ['any', 'Any / informational'],
    ], initial.rule || 'complete');
    const edgeLabel = K.input(initial.label || '', 'text', 'Edge label / branch condition');
    card.head.querySelector('.adm-sub__tools').append(K.button('Remove edge', () => card.remove(), { tiny: true, danger: true }));
    card.append(K.fields([K.field('From', from), K.field('To', to), K.field('Rule', rule), K.field('Label', edgeLabel)]));
    card._fields = { from, to, rule, edgeLabel };
    return card;
  };

  const serializeNodes = (hostNode) => [...hostNode.children].map((card) => {
    const f = card._fields;
    const type = f.nodeType.value;
    const payload = { id: f.nodeId.value.trim(), type, title: f.nodeTitle.value.trim(), description: f.nodeDescription.value };
    if (type === 'course') payload.course_id = Number(f.nodeCourse.value || 0);
    return payload;
  });

  const serializeEdges = (hostNode) => [...hostNode.children].map((card) => {
    const f = card._fields;
    return { from: f.from.value.trim(), to: f.to.value.trim(), rule: f.rule.value, label: f.edgeLabel.value.trim() };
  });

  const graphEditor = ({ initialNodes = [], initialEdges = [] } = {}) => {
    const nodesBox = section('Path nodes', 'Course nodes link to actual courses; gate, milestone and choice nodes model branching.', 6);
    const nodeHost = K.stack();
    for (const item of initialNodes) nodeHost.append(nodeEditor(item));
    if (!initialNodes.length) nodeHost.append(nodeEditor({ type: 'course' }));
    nodesBox.body.append(nodeHost, K.cardActions([K.button('Add node', () => nodeHost.append(nodeEditor()), { tiny: true })]));

    const edgesBox = section('Path edges', 'Connect nodes by ID. Several outgoing or incoming edges make branches and convergence.', 6);
    const edgeHost = K.stack();
    for (const item of initialEdges) edgeHost.append(edgeEditor(item));
    if (!initialEdges.length) edgeHost.append(K.empty('No edges yet. A single node needs none.'));
    edgesBox.body.append(edgeHost, K.cardActions([K.button('Add edge', () => {
      edgeHost.querySelector('.adm-empty')?.remove();
      edgeHost.append(edgeEditor());
    }, { tiny: true })]));

    const wrapper = K.bento([nodesBox.box, edgesBox.box]);
    wrapper._graph = {
      nodes: () => serializeNodes(nodeHost),
      edges: () => serializeEdges(edgeHost).filter((edge) => edge.from || edge.to),
    };
    return wrapper;
  };

  const pathForm = ({ item = null } = {}) => {
    const form = el('form', 'adm-form');
    const title = K.input(item?.title || '', 'text', 'Path title');
    const slug = K.input(item?.slug || '', 'text', 'path-slug');
    const summary = K.textarea(item?.summary || '', 2);
    const status = K.select([['draft', 'Draft'], ['published', 'Published'], ...(item ? [['archived', 'Archived']] : [])], item?.status || 'draft');
    if (item) { title.disabled = true; slug.disabled = true; }
    else title.addEventListener('input', () => { if (!slug.dataset.touched) slug.value = K.slugify(title.value); });
    slug.addEventListener('input', () => { slug.dataset.touched = '1'; });
    const graph = graphEditor({ initialNodes: item?.nodes || [], initialEdges: item?.edges || [] });
    const save = action(item ? 'Save path' : 'Create learning path', null, true);
    save.type = 'submit';
    const note = statusLine();
    form.append(
      K.fields([K.field('Title', title), K.field('Slug', slug), K.field('Status', status)]),
      K.field('Summary', summary),
      graph,
      K.cardActions([save], note),
    );
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      save.disabled = true;
      setStatus(note, 'Saving…');
      try {
        if (item) {
          await P.lmsUpdateLearningPath(item.id, {
            summary: summary.value, status: status.value,
            nodes: graph._graph.nodes(), edges: graph._graph.edges(),
          });
        } else {
          await P.lmsCreateLearningPath({
            title: title.value.trim(),
            slug: slug.value.trim() || K.slugify(title.value),
            summary: summary.value,
            status: status.value,
            nodes: graph._graph.nodes(),
            edges: graph._graph.edges(),
            payment_config: { enabled: false, provider: 'external' },
          });
        }
        await refresh();
      } catch (error) {
        setStatus(note, error?.data?.error || error?.message || 'Path could not be saved.', 'bad');
        save.disabled = false;
      }
    });
    return form;
  };

  const box = section(
    'Learning paths',
    'Paths are graphs: nodes are courses, gates, milestones or choices; edges define completion and branching.',
    12,
  );
  const editorHost = el('div');
  const open = (item) => {
    const editor = section(item ? `Edit · ${item.title}` : 'New learning path', '', 12, [K.button('Close', () => editorHost.replaceChildren(), { tiny: true })]);
    editor.body.append(pathForm({ item }));
    editorHost.replaceChildren(K.bento([editor.box]));
    editorHost.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const newButton = K.button('New learning path', () => open(null), { solid: true, tiny: true });
  const tools = el('div');
  tools.append(newButton);
  box.head.append(tools);

  const rows = (paths || []).map((item) => {
    const edit = K.button('Edit graph', () => open(item), { tiny: true });
    const remove = K.button('Delete', async () => {
      if (!confirm('Delete learning path “' + item.title + '”?')) return;
      remove.disabled = true;
      try { await P.lmsDeleteLearningPath(item.id); await refresh(); } catch { remove.disabled = false; }
    }, { tiny: true, danger: true });
    return K.row({
      title: item.title,
      meta: P.meta([item.slug, (item.nodes || []).length + ' nodes', (item.edges || []).length + ' edges']),
      body: item.summary,
      lead: K.avatar(item.title, { mark: 'path', series: 3 }),
      badges: [K.stateBadge(item.status)],
      actions: [edit, remove],
    });
  });
  box.body.append(rows.length ? K.list(rows) : K.empty('No learning paths yet.', [K.button('Create the first path', () => open(null), { tiny: true })]));
  const out = el('div', 'adm-stack');
  out.append(K.bento([box.box]), editorHost);
  return out;
}

function enrollmentAdminRow(enrollment, refresh) {
  const state = K.select([['active', 'Active'], ['paused', 'Paused'], ['completed', 'Completed'], ['revoked', 'Revoked']], enrollment.status);
  state.setAttribute('aria-label', 'Enrollment status');
  const save = action('Apply', async () => {
    save.disabled = true;
    try { await P.adminUpdateLmsEnrollment(enrollment.id, { status: state.value }); await refresh(); }
    catch { save.disabled = false; }
  }, false, true);
  const cert = enrollment.certificate
    ? action(enrollment.certificate.valid ? 'Revoke certificate' : 'Reissue certificate', async () => {
        cert.disabled = true;
        try {
          await P.adminUpdateLmsEnrollment(enrollment.id, { certificate: enrollment.certificate.valid ? 'revoke' : 'reissue' });
          await refresh();
        } catch { cert.disabled = false; }
      }, false, true)
    : null;
  return K.row({
    title: `${enrollment.user.name} · ${enrollment.course.title}`,
    meta: P.meta([enrollment.user.email, `${enrollment.progress_percent}%`, label(enrollment.access_source)]),
    lead: K.avatar(enrollment.user.name || enrollment.user.email),
    badges: [K.stateBadge(enrollment.status), enrollment.certificate?.valid ? K.badge('Certificate', 'accent') : null],
    actions: [state, save, cert].filter(Boolean),
  });
}

function lmsAnalytics(courses, analytics) {
  const box = section('Learning analytics', 'Filter by course, lesson, learner and date. Views, skips, dwell, AI and Lab usage stay attributable down to the lesson.');
  const courseFilter = K.select([['', 'All courses'], ...courses.map((item) => [item.id, item.title])], '');
  const lessonFilter = K.select([['', 'All lessons']], '');
  const dateFrom = K.input('', 'date');
  const dateTo = K.input('', 'date');
  const learnerFinder = K.search('Filter learner', () => {}, 0);
  const learnerSearch = learnerFinder.input;
  const clearLearner = K.button('Clear', null, { tiny: true });
  const selectedLearner = K.badge('All learners');
  const learnerResults = el('div');
  let learnerId = '';
  let learnerTimer = null;
  box.body.append(
    K.fields([
      K.field('Course', courseFilter), K.field('Lesson', lessonFilter),
      K.field('From', dateFrom), K.field('To', dateTo),
    ]),
    K.toolbar([learnerFinder.wrap, selectedLearner, clearLearner]),
    learnerResults,
  );

  const content = el('div', 'adm-stack');
  const drawAnalytics = (payload) => {
    const selectedLesson = lessonFilter.value;
    lessonFilter.innerHTML = '';
    const allLessons = el('option', null, 'All lessons');
    allLessons.value = '';
    lessonFilter.append(allLessons);
    for (const item of payload.lesson_options || []) {
      const option = el('option', null, item.course + ' · ' + item.module + ' · ' + item.title);
      option.value = item.id;
      lessonFilter.append(option);
    }
    if ([...lessonFilter.options].some((option) => option.value === selectedLesson)) lessonFilter.value = selectedLesson;

    const kinds = payload.summary?.by_kind || {};
    const tiles = K.tiles([
      K.tile({ value: payload.summary?.enrollments || 0, label: 'Enrollments', icon: 'team', featured: true, note: 'In this filter' }),
      K.tile({ value: `${Math.round(Number(payload.summary?.average_progress) || 0)}%`, label: 'Average progress', icon: 'progress', note: 'Across enrollments' }),
      K.tile({ value: kinds['lesson.view']?.count || 0, label: 'Lesson views', icon: 'overview', note: `${kinds['lesson.skip']?.count || 0} skips` }),
      K.tile({ value: Math.round((kinds['lesson.dwell']?.duration_seconds || 0) / 60), label: 'Dwell', icon: 'cycle', note: 'minutes' }),
      K.tile({ value: kinds['ai.use']?.count || 0, label: 'AI uses', icon: 'pulsar', note: 'Tutor questions' }),
      K.tile({ value: kinds['lab.use']?.count || 0, label: 'Lab uses', icon: 'lab', note: 'Interactive sessions' }),
    ]);

    const visual = section('Activity overview', 'Top lessons by views; dwell, AI and Lab usage stay visible beside each bar.', 12);
    visual.body.append(adminAnalyticsVisual(payload.lessons || []));

    const learnerRows = section('Learner activity', 'First hundred learners in this filter.', 6);
    const learners = (payload.learners || []).slice(0, 100).map((item) => K.row({
      title: `${item.name} · ${item.course}`,
      meta: P.meta([`${item.progress_percent}% progress`, `${item.views} views`, `${item.skips} skips`, `${Math.round(Number(item.dwell_seconds || 0) / 60)} min dwell`]),
      badges: [`${item.ai_uses} AI`, `${item.lab_uses} Lab`, K.stateBadge(item.status)],
    }));
    learnerRows.body.append(learners.length ? K.list(learners) : K.empty('No learners in this filter.'));

    const topLessons = section('Lesson activity', 'Views, dwell, skips, AI and Lab per lesson.', 6);
    const lessons = (payload.lessons || []).slice(0, 60).map(adminAnalyticsLessonRow);
    topLessons.body.append(lessons.length ? K.list(lessons) : K.empty('No tracked lesson activity yet.'));

    content.replaceChildren(tiles, K.bento([visual.box, learnerRows.box, topLessons.box]));
  };

  const reloadAnalytics = async () => {
    content.replaceChildren(el('div', 'fl-skeleton adm-skeleton'));
    try {
      const payload = await P.adminLmsAnalytics({
        course_id: courseFilter.value,
        lesson_id: lessonFilter.value,
        user_id: learnerId,
        from: dateFrom.value ? dateFrom.value + 'T00:00:00' : '',
        to: dateTo.value ? dateTo.value + 'T23:59:59' : '',
      });
      drawAnalytics(payload);
    } catch (error) {
      content.replaceChildren(K.empty(error?.message || 'Analytics unavailable.'));
    }
  };
  courseFilter.addEventListener('change', () => { lessonFilter.value = ''; reloadAnalytics(); });
  lessonFilter.addEventListener('change', reloadAnalytics);
  dateFrom.addEventListener('change', reloadAnalytics);
  dateTo.addEventListener('change', reloadAnalytics);
  clearLearner.addEventListener('click', () => {
    learnerId = '';
    learnerSearch.value = '';
    selectedLearner.textContent = 'All learners';
    learnerResults.replaceChildren();
    reloadAnalytics();
  });
  learnerSearch.addEventListener('input', () => {
    clearTimeout(learnerTimer);
    learnerTimer = setTimeout(async () => {
      learnerResults.replaceChildren();
      const q = learnerSearch.value.trim();
      if (q.length < 2) return;
      try {
        const result = await P.adminUsers(q);
        learnerResults.append(K.list((result.users || []).slice(0, 8).map((user) => K.row({
          title: user.name, meta: user.email,
          lead: K.avatar(user.name || user.email),
          actions: [K.button('Filter', () => {
            learnerId = String(user.id);
            selectedLearner.textContent = user.name || user.email;
            learnerResults.replaceChildren();
            reloadAnalytics();
          }, { tiny: true })],
        }))));
      } catch {}
    }, 180);
  });
  drawAnalytics(analytics);
  return [K.bento([box.box]), content];
}

export async function renderAdminLms(host, { go }) {
  K.loading(host, 'LMS Admin', { tiles: 5 });
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
    const refresh = () => renderAdminLms(host, { go });
    const engineState = openedx.openedx || {};
    const lmsUrl = openedx.lms_url || 'https://learn.gravitasplus.com';
    const studioUrl = openedx.cms_url || 'https://studio.gravitasplus.com';
    const wrap = K.page(host, {
      title: 'LMS Admin',
      meta: 'Open edX-backed learning with Gravitas+ AI, Lab, source management, exports and analytics.',
      actions: [
        link(go, 'New course', `${ADMIN}/lms/courses/new`, true),
        K.anchor('Open learner LMS', lmsUrl),
        K.anchor('Open Studio', studioUrl),
      ],
    });

    const all = enrollments.enrollments || [];
    const pendingPayments = (payments.payments || []).filter((item) => item.status === 'pending').length;
    const pendingReviews = (repositories.repositories || []).filter((item) => (item.review_status || 'pending') === 'pending').length;
    wrap.append(K.tiles([
      K.tile({ value: courses.courses.length, label: 'Courses', icon: 'course', featured: true, note: `${courses.courses.filter((c) => c.status === 'published').length} published` }),
      K.tile({ value: all.filter((item) => item.status === 'active').length, label: 'Active enrollments', icon: 'team', note: `${all.length} in total` }),
      K.tile({ value: all.filter((item) => item.status === 'completed').length, label: 'Completed', icon: 'certificate', note: `${all.filter((item) => item.certificate?.valid).length} with certificate` }),
      K.tile({ value: analytics.summary?.by_kind?.['ai.use']?.count || 0, label: 'AI tutor uses', icon: 'pulsar', note: 'All courses' }),
      K.tile({ value: analytics.summary?.by_kind?.['lab.use']?.count || 0, label: 'Lab uses', icon: 'lab', note: 'All courses' }),
    ]));

    const build = (key) => {
      if (key === 'courses') {
        const engine = section('Open edX engine', 'Tutor/Open edX is the standards-based engine; Gravitas+ stays the learner and admin experience.', 4);
        engine.body.append(
          K.cardActions([
            K.badge(engineState.reachable ? 'Reachable' : 'Not reachable yet', engineState.reachable ? 'ok' : 'warn'),
            K.badge(engineState.configured ? 'OAuth configured' : 'OAuth pending', engineState.configured ? '' : 'warn'),
            engineState.oauth ? K.badge('OAuth OK', 'ok') : null,
          ]),
          K.defs([['Learner', lmsUrl.replace(/^https?:\/\//, '')], ['Studio', studioUrl.replace(/^https?:\/\//, '')]]),
          K.cardActions([K.anchor('Open learner LMS', lmsUrl, { tiny: true }), K.anchor('Open Studio', studioUrl, { tiny: true })]),
        );
        const courseBox = section('Courses', 'Open a course to edit it in the Course Builder.', 8, [link(go, 'New course', `${ADMIN}/lms/courses/new`)]);
        courseBox.head.querySelector('.ws-btn')?.classList.add('ws-btn--tiny');
        const rows = courses.courses.map((course, index) => K.row({
          title: course.title,
          meta: P.meta([label(course.access_type), label(course.provider || 'native'), course.category?.name || '', `${course.lesson_count} lessons`]),
          lead: K.avatar(course.title, { mark: 'course', series: (index % 4) + 1 }),
          badges: [
            K.stateBadge(course.status),
            course.price ? K.badge(`${course.price} ${course.currency}`) : null,
            course.certificate_enabled ? K.badge('Certificate') : null,
            ...(course.tags || []).slice(0, 2).map((item) => K.badge(item.name)),
          ],
          onClick: () => go(`${ADMIN}/lms/courses/${course.id}`),
        }));
        courseBox.body.append(rows.length ? K.list(rows) : K.empty('No courses yet.', [link(go, 'Create the first course', `${ADMIN}/lms/courses/new`)]));
        return [K.bento([courseBox.box, engine.box])];
      }

      if (key === 'analytics') return lmsAnalytics(courses.courses, analytics);
      if (key === 'paths') return [renderLearningPathsAdmin(paths.paths || [], courses.courses || [], refresh)];
      if (key === 'taxonomy') {
        return [renderLmsMetaAdmin(meta, refresh)];
      }

      if (key === 'commerce') {
        const paymentBox = section('Course payments', 'Paid-course checkout attempts. Access is granted only after a payment is verified.', 12);
        const paymentRows = (payments.payments || []).map((item) => {
          const state = K.select([
            ['pending', 'Pending'], ['paid', 'Paid / verified'], ['failed', 'Failed'], ['cancelled', 'Cancelled'], ['refunded', 'Refunded'],
          ], item.status || 'pending');
          state.setAttribute('aria-label', 'Payment status');
          const reference = K.input(item.external_reference || '', 'text', 'Provider reference');
          reference.setAttribute('aria-label', 'Provider reference');
          const applyPayment = action('Apply', async () => {
            applyPayment.disabled = true;
            try {
              await P.adminUpdateCoursePayment(item.id, { status: state.value, external_reference: reference.value.trim() });
              await refresh();
            } catch (error) {
              applyPayment.disabled = false;
              alert(error?.message || 'Payment status could not be updated.');
            }
          }, false, true);
          return K.row({
            title: item.user_name + ' · ' + item.course_title,
            meta: P.meta([item.user_email, item.amount + ' ' + item.currency, label(item.provider), date(item.created_at)]),
            body: item.verified_by ? 'Verified by ' + item.verified_by : '',
            badges: [K.stateBadge(item.status)],
            actions: [state, reference, applyPayment],
          });
        });
        paymentBox.body.append(paymentRows.length ? K.list(paymentRows) : K.empty('No checkout attempts yet.'));

        const reviewBox = section('Exercise repository review', 'Learner Git pushes for instructor review. A new push returns the item to Pending review.', 12);
        const reviewRows = (repositories.repositories || []).map((item) => {
          const open = K.anchor('Open repository', item.html_url || ('https://github.com/' + item.owner + '/' + item.repository), { tiny: true });
          const reviewState = K.select([
            ['pending', 'Pending review'], ['needs_changes', 'Needs changes'], ['approved', 'Approved'],
          ], item.review_status || 'pending');
          reviewState.setAttribute('aria-label', 'Review status');
          const reviewNote = K.input(item.review_note || '', 'text', 'Review note');
          reviewNote.setAttribute('aria-label', 'Review note');
          const apply = action('Save review', async () => {
            apply.disabled = true;
            try {
              await P.adminReviewLearningRepository(item.id, reviewState.value, reviewNote.value.trim());
              await refresh();
            } catch (error) {
              apply.disabled = false;
              alert(error?.message || 'Review could not be saved.');
            }
          }, false, true);
          return K.row({
            title: item.learner + ' · ' + item.course_title,
            meta: P.meta([item.lesson_title || 'Course exercise', item.owner + '/' + item.repository, item.branch, item.last_commit_sha ? item.last_commit_sha.slice(0, 10) : '']),
            body: item.review_note || '',
            badges: [K.stateBadge(item.review_status || 'pending'), item.reviewed_by ? K.badge('Reviewed by ' + item.reviewed_by) : null],
            actions: [open, reviewState, reviewNote, apply],
          });
        });
        reviewBox.body.append(reviewRows.length ? K.list(reviewRows) : K.empty('No exercise repositories yet. Learner Git pushes will appear here.'));
        return [K.bento([paymentBox.box, reviewBox.box])];
      }

      const enrollmentBox = section('Recent enrollments', 'The thirty most recent enrollments and admin grants.');
      const rows = all.slice(0, 30).map((item) => enrollmentAdminRow(item, refresh));
      enrollmentBox.body.append(rows.length ? K.list(rows) : K.empty('No enrollments yet.'));
      return [K.bento([enrollmentBox.box])];
    };

    wrap.append(K.tabs([
      ['courses', 'Courses'],
      ['analytics', 'Analytics'],
      ['paths', 'Learning paths'],
      ['taxonomy', 'Categories & tags'],
      ['commerce', `Payments & review${pendingPayments + pendingReviews ? ` · ${pendingPayments + pendingReviews}` : ''}`],
      ['enrollments', 'Enrollments'],
    ], build, { name: 'LMS administration' }));
  } catch (error) {
    K.failure(host, 'LMS Admin', error, () => renderAdminLms(host, { go }));
  }
}

/* ==========================================================================
   COURSE COVER
   The picture is cropped to 16:9 from the centre and resized to 1280×720
   here, in the browser, then sent as a JPEG data URI — the same route the
   researcher avatar takes, because this deployment has no file storage for
   it. Lowering the quality until it fits keeps every upload under the
   server's cap, so a large phone photo is shrunk rather than refused.

   It saves on its own PATCH the moment a file is chosen, not with the rest
   of the course form: a 300 KB image riding along on every structure save
   would make each of those saves slower for nothing.
   ========================================================================== */

const COVER_W = 1280;
const COVER_H = 720;
const COVER_BUDGET = 700 * 1024;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be read as an image.')); };
    img.src = url;
  });
}

async function coverDataUri(file) {
  const img = await loadImage(file);
  const canvas = document.createElement('canvas');
  canvas.width = COVER_W;
  canvas.height = COVER_H;
  const context = canvas.getContext('2d');
  const scale = Math.max(COVER_W / img.naturalWidth, COVER_H / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  context.fillStyle = '#003049';
  context.fillRect(0, 0, COVER_W, COVER_H);
  context.drawImage(img, (COVER_W - w) / 2, (COVER_H - h) / 2, w, h);
  let uri = '';
  for (const quality of [0.86, 0.78, 0.7, 0.6, 0.5]) {
    uri = canvas.toDataURL('image/jpeg', quality);
    if (uri.length * 0.75 < COVER_BUDGET) return uri;
  }
  return uri;
}

function courseCoverEditor(course) {
  const box = section(
    'Cover image',
    'Shown on the course page, in the catalog and in My learning. Cropped to 16:9 and resized to 1280×720. Without one, the course gets a generated Gravitas+ cover.',
    12,
  );
  if (!course) {
    box.body.append(K.empty('Save the course first; the cover can be added once it exists.'));
    return box.box;
  }
  let current = course;
  const layout = el('div', 'adm-cover flc-cover-edit');
  const preview = el('div', 'adm-cover__preview flc-cover-edit__preview');
  const draw = () => {
    preview.replaceChildren(courseCover(current, 'flc-cover'));
    preview.dataset.generated = current.cover_url ? 'false' : 'true';
  };
  const file = el('input');
  file.type = 'file';
  file.accept = 'image/png,image/jpeg,image/webp';
  file.hidden = true;
  const status = statusLine();
  const upload = action(current.cover_url ? 'Replace image' : 'Upload image', () => file.click(), true);
  const remove = action('Use the generated cover', async () => {
    remove.disabled = true;
    setStatus(status, 'Removing…');
    try {
      const result = await P.lmsUpdateCourse(course.id, { cover_image: '' });
      current = { ...current, cover_url: result.course?.cover_url || '' };
      draw();
      remove.hidden = true;
      upload.textContent = 'Upload image';
      setStatus(status, 'The generated cover is shown again.', 'ok');
    } catch (error) {
      setStatus(status, error?.message || 'The cover could not be removed.', 'bad');
    } finally {
      remove.disabled = false;
    }
  });
  remove.hidden = !current.cover_url;
  file.addEventListener('change', async () => {
    const chosen = file.files?.[0];
    file.value = '';
    if (!chosen) return;
    if (!/^image\/(png|jpeg|webp)$/.test(chosen.type)) {
      setStatus(status, 'Use a PNG, JPEG or WebP image.', 'bad');
      return;
    }
    upload.disabled = true;
    setStatus(status, 'Preparing the image…');
    try {
      const uri = await coverDataUri(chosen);
      setStatus(status, 'Uploading…');
      const result = await P.lmsUpdateCourse(course.id, { cover_image: uri });
      current = { ...current, cover_url: result.course?.cover_url || '' };
      draw();
      remove.hidden = !current.cover_url;
      upload.textContent = 'Replace image';
      setStatus(status, 'Cover saved.', 'ok');
    } catch (error) {
      setStatus(status, error?.message || 'The cover could not be saved.', 'bad');
    } finally {
      upload.disabled = false;
    }
  });
  const controls = el('div', 'adm-cover__controls');
  controls.append(C.note('PNG, JPEG or WebP. Pick an image that still reads when small: one clear subject, little text.'), K.cardActions([upload, remove]), status, file);
  layout.append(preview, controls);
  draw();
  box.body.append(layout);
  return box.box;
}

/* ==========================================================================
   COURSE BUILDER
   One form across seven tabs. The tabs are built eagerly and only hidden,
   because submit reads every control on every tab. Media and direct
   enrollment act immediately on their own buttons, so they are not nested
   forms inside the course form.
   ========================================================================== */

export async function renderAdminCourseEditor(host, id, { go }) {
  K.loading(host, id === 'new' ? 'New course' : 'Course', { tiles: 0, cards: [8, 4] });
  try {
    const [courseResult, meta] = await Promise.all([
      id === 'new' ? Promise.resolve({ course: null, live_course: null, revision: null }) : P.lmsCourseAuthoring(id),
      P.adminLmsMeta(),
    ]);
    const course = courseResult.course;
    const liveCourse = courseResult.live_course || course;
    const revision = courseResult.revision || null;
    const enrolled = course ? (await P.adminLmsEnrollments({ course_id: course.id })).enrollments : [];
    const mediaData = course
      ? await P.adminLearningAssets(course.id)
      : { assets: [], groups: [], folders: [], nextcloud: { state: 'unavailable' } };
    const reload = () => renderAdminCourseEditor(host, id, { go });

    const wrap = K.page(host, {
      title: course?.title || 'New course',
      meta: course
        ? P.meta([
            `Live · ${label(liveCourse?.status || course.status)}`,
            revision ? (revision.state === 'scheduled' ? 'Changes scheduled' : 'Unpublished changes') : 'No unpublished changes',
            label(course.access_type),
            `${enrolled.length} enrollment${enrolled.length === 1 ? '' : 's'}`,
          ])
        : 'Course Builder — create the course first, then review a draft before publishing.',
      actions: [
        link(go, 'LMS Admin', `${ADMIN}/lms`),
        course && liveCourse?.status === 'published' ? link(go, 'View live course', `/workspace/learning/courses/${course.id}`) : null,
      ],
    });
    const form = el('form', 'adm-form');

    /* Details ------------------------------------------------------------- */
    const title = K.input(course?.title || '');
    const slug = K.input(course?.slug || '');
    const summary = K.textarea(course?.summary || '', 3);
    const description = K.textarea(course?.description || '', 7);
    const accessType = K.select([['open', 'Open enrollment'], ['locked', 'Invite only'], ['paid', 'Paid']], course?.access_type || 'open');
    const status = K.select([['draft', 'Draft'], ['published', 'Published'], ['archived', 'Archived']], liveCourse?.status || course?.status || 'draft');
    if (course) status.disabled = true;
    const price = K.input(course?.price || '', 'number');
    price.step = '0.01';
    const currency = K.input(course?.currency || 'EUR');
    const certEnabled = K.toggle(course?.certificate_enabled !== false, 'Issue Gravitas+ certificate on completion');
    const provider = K.select([['native', 'Gravitas native'], ['openedx', 'Open edX']], course?.provider || 'native');
    const openedxKey = K.input(course?.openedx_course_key || '');
    const openedxUrl = K.input(course?.openedx_launch_url || '', 'url');
    const openedxStudio = K.input(course?.openedx_studio_url || '', 'url');
    const category = K.select([['', 'No category'], ...(meta.categories || []).map((item) => [item.id, item.name])], course?.category?.id || '');
    const tagSelect = el('select', 'v-input');
    tagSelect.multiple = true;
    tagSelect.size = Math.min(7, Math.max(3, (meta.tags || []).length || 3));
    const selectedTags = new Set((course?.tags || []).map((item) => String(item.id)));
    for (const item of meta.tags || []) {
      const option = el('option', null, item.name);
      option.value = item.id;
      option.selected = selectedTags.has(String(item.id));
      tagSelect.append(option);
    }
    let slugTouched = !!course;
    slug.addEventListener('input', () => { slugTouched = true; });
    title.addEventListener('input', () => { if (!slugTouched) slug.value = K.slugify(title.value); });

    const details = section('Course', 'What learners see in the catalog and on the course page.', 8);
    details.body.append(
      K.fields([K.field('Title', title), K.field('Slug', slug)], 2),
      K.field('Summary', summary),
      K.field('Description', description),
    );
    const publishing = section('Publishing & access', 'Status, who can enroll and what it costs.', 4);
    publishing.body.append(
      K.fields([
        K.field('Live status', status, course ? 'Publishing is controlled below; editing never changes the learner-facing course.' : 'New courses begin as drafts.'),
        K.field('Access', accessType),
        K.field('Price', price), K.field('Currency', currency),
        K.field('Category', category), K.field('Provider', provider),
        K.field('Tags', tagSelect, 'Ctrl/⌘-click to choose several.', { wide: true }),
      ], 2),
      K.switches([certEnabled]),
    );

    const showCourseDraftPreview = (payload) => {
      const modal = el('div', 'course-draft-preview');
      const frame = el('div', 'course-draft-preview__frame');
      const head = el('div', 'course-draft-preview__head');
      head.append(
        el('div', null, ''),
        K.button('Close preview', () => modal.remove(), { tiny: true }),
      );
      const titleBox = head.firstElementChild;
      titleBox.append(
        el('small', 'fl-muted', 'INSTRUCTOR PREVIEW · NOT LIVE'),
        el('h2', null, payload.title || 'Untitled course'),
        payload.summary ? el('p', 'fl-muted', payload.summary) : document.createTextNode(''),
      );
      const body = el('div', 'course-draft-preview__body');
      if (payload.description) body.append(el('p', 'course-draft-preview__description', payload.description));
      const structurePreview = el('div', 'course-draft-preview__structure');
      for (const [moduleIndex, module] of (payload.modules || []).entries()) {
        const moduleNode = el('section', 'course-draft-preview__module');
        moduleNode.append(
          el('small', 'fl-muted', `MODULE ${moduleIndex + 1}`),
          el('h3', null, module.title || 'Untitled module'),
        );
        if (module.summary) moduleNode.append(el('p', 'fl-muted', module.summary));
        const lessons = el('div', 'course-draft-preview__lessons');
        for (const [lessonIndex, lesson] of (module.lessons || []).entries()) {
          const lessonNode = el('article', 'course-draft-preview__lesson');
          lessonNode.append(
            el('span', 'course-draft-preview__lesson-index', String(lessonIndex + 1).padStart(2, '0')),
            el('div', null, ''),
          );
          lessonNode.lastElementChild.append(
            el('strong', null, lesson.title || 'Untitled lesson'),
            el('small', 'fl-muted', P.meta([label(lesson.kind), lesson.published === false ? 'Hidden' : '', lesson.is_preview ? 'Free preview' : ''])),
          );
          lessons.append(lessonNode);
        }
        if (!(module.lessons || []).length) lessons.append(K.empty('No lessons in this module.'));
        moduleNode.append(lessons);
        structurePreview.append(moduleNode);
      }
      if (!(payload.modules || []).length) structurePreview.append(K.empty('No modules yet.'));
      body.append(structurePreview);
      frame.append(head, body);
      modal.append(frame);
      modal.addEventListener('click', (event) => { if (event.target === modal) modal.remove(); });
      document.body.append(modal);
    };

    const publishingWorkflow = section(
      'Draft, preview & publish',
      course
        ? 'All edits stay in an instructor draft. Preview the complete draft, then publish now or choose an automatic publish time.'
        : 'Create this course as a draft first. Publishing controls appear after it exists.',
      12,
    );
    const workflowStatus = statusLine();
    let scheduleAt = null;
    let previewDraft = null;
    let publishNow = null;
    let schedulePublish = null;
    if (course) {
      scheduleAt = K.input('', 'datetime-local');
      if (revision?.scheduled_for) {
        const scheduled = new Date(revision.scheduled_for);
        const local = new Date(scheduled.getTime() - scheduled.getTimezoneOffset() * 60000);
        scheduleAt.value = local.toISOString().slice(0, 16);
      }
      previewDraft = K.button('Preview changes', () => showCourseDraftPreview(collectCoursePayload()), { tiny: true });
      publishNow = K.button('Publish now', async () => {
        if (!confirm('Publish the current draft to learners now?')) return;
        publishNow.disabled = true;
        schedulePublish.disabled = true;
        setStatus(workflowStatus, 'Saving draft…');
        try {
          await P.lmsUpdateCourse(course.id, collectCoursePayload());
          setStatus(workflowStatus, 'Publishing…');
          await P.lmsPublishCourseRevision(course.id);
          setStatus(workflowStatus, 'Published.', 'ok');
          await reload();
        } catch (error) {
          setStatus(workflowStatus, error?.data?.error || error?.message || 'Course could not be published.', 'bad');
          publishNow.disabled = false;
          schedulePublish.disabled = false;
        }
      }, { solid: true, tiny: true });
      schedulePublish = K.button('Schedule publish', async () => {
        if (!scheduleAt.value) {
          setStatus(workflowStatus, 'Choose a publish date and time.', 'bad');
          return;
        }
        const scheduledFor = new Date(scheduleAt.value);
        if (Number.isNaN(scheduledFor.getTime()) || scheduledFor <= new Date()) {
          setStatus(workflowStatus, 'Choose a future publish date and time.', 'bad');
          return;
        }
        publishNow.disabled = true;
        schedulePublish.disabled = true;
        setStatus(workflowStatus, 'Saving draft…');
        try {
          await P.lmsUpdateCourse(course.id, collectCoursePayload());
          await P.lmsPublishCourseRevision(course.id, { scheduled_for: scheduledFor.toISOString() });
          setStatus(workflowStatus, 'Automatic publish scheduled.', 'ok');
          await reload();
        } catch (error) {
          setStatus(workflowStatus, error?.data?.error || error?.message || 'Publish could not be scheduled.', 'bad');
          publishNow.disabled = false;
          schedulePublish.disabled = false;
        }
      }, { tiny: true });
      publishingWorkflow.body.append(
        revision
          ? C.note(revision.state === 'scheduled' && revision.scheduled_for
              ? `Current draft is scheduled for ${date(revision.scheduled_for)}.`
              : 'There are unpublished draft changes.')
          : C.note('The editor currently starts from the live version. Saving creates an unpublished draft.'),
        K.fields([K.field('Automatic publish time', scheduleAt, 'Uses your local time.')], 1),
        K.cardActions([previewDraft, publishNow, schedulePublish], workflowStatus),
      );
    } else {
      publishingWorkflow.body.append(C.note('Nothing is visible to learners until this draft is explicitly published.'));
    }

    /* Integration --------------------------------------------------------- */
    const openedx = section('Open edX mapping', 'Map this course to an Open edX course run while keeping the Gravitas+ learner experience.');
    openedx.body.append(K.fields([
      K.field('Course key', openedxKey, 'Example: course-v1:Gravitas+Research101+2026'),
      K.field('Learner URL', openedxUrl),
      K.field('Studio URL', openedxStudio),
    ]));
    if (course) {
      const openedxStatus = statusLine();
      const validate = action('Validate Open edX mapping', async () => {
        validate.disabled = true;
        setStatus(openedxStatus, 'Checking…');
        try {
          const result = await P.adminValidateOpenEdxCourse(course.id);
          setStatus(openedxStatus, result.course_details?.course_name ? `Connected · ${result.course_details.course_name}` : 'Connected.', 'ok');
        } catch (error) {
          setStatus(openedxStatus, error?.message || 'Open edX mapping is not reachable yet.', 'bad');
        } finally { validate.disabled = false; }
      });
      openedx.body.append(K.cardActions([validate], openedxStatus));
    }

    /* People & forms ------------------------------------------------------ */
    const instructorsBox = section('Instructors', 'Several instructors per course, without changing their Research or Core access.', 6);
    const instructorState = (course?.instructors || []).map((item) => ({
      user_id: item.user_id, name: item.name, email: item.email, role: item.role || 'instructor',
    }));
    const instructorList = el('div');
    const drawInstructors = () => {
      const rows = instructorState.map((item) => {
        const role = K.select([['lead', 'Lead'], ['instructor', 'Instructor'], ['assistant', 'Teaching assistant']], item.role);
        role.setAttribute('aria-label', 'Instructor role');
        role.addEventListener('change', () => { item.role = role.value; });
        const remove = K.button('Remove', () => {
          const index = instructorState.indexOf(item);
          if (index >= 0) instructorState.splice(index, 1);
          drawInstructors();
        }, { tiny: true, danger: true });
        return K.row({ title: item.name || item.email, meta: item.email, lead: K.avatar(item.name || item.email), actions: [role, remove] });
      });
      instructorList.replaceChildren(rows.length ? K.list(rows) : K.empty('No instructors assigned. Search registered accounts below.'));
    };
    drawInstructors();
    const instructorRole = K.select([['lead', 'Lead'], ['instructor', 'Instructor'], ['assistant', 'Teaching assistant']], 'instructor');
    instructorRole.setAttribute('aria-label', 'Role for added instructor');
    const instructorResults = el('div');
    const instructorFinder = K.search('Search instructor account', async (q) => {
      instructorResults.replaceChildren();
      if (q.length < 2) return;
      try {
        const data = await P.adminUsers(q);
        instructorResults.append(K.list((data.users || []).slice(0, 8).map((user) => K.row({
          title: user.name, meta: user.email, lead: K.avatar(user.name || user.email),
          actions: [K.button('Add', () => {
            if (!instructorState.some((entry) => String(entry.user_id) === String(user.id))) {
              instructorState.push({ user_id: user.id, name: user.name, email: user.email, role: instructorRole.value });
              drawInstructors();
            }
          }, { tiny: true })],
        }))));
      } catch {}
    }, 180);
    instructorsBox.body.append(instructorList, K.toolbar([instructorFinder.wrap, instructorRole]), instructorResults);

    const profileBox = section('Enrollment & profile form', 'Fields learners complete after enrolling. Required fields lock protected lessons until done.', 6);
    const registrationHost = K.stack();
    for (const fieldSpec of course?.registration_schema || []) registrationHost.append(registrationFieldEditor(fieldSpec));
    profileBox.body.append(registrationHost, K.cardActions([K.button('Add profile field', () => registrationHost.append(registrationFieldEditor()), { tiny: true })]));

    /* Payment ------------------------------------------------------------- */
    const payment = section('Payment', 'Paid-course checkout policy. Enrollment is granted only after a verified payment or an admin grant; a checkout link never creates a fake purchase.');
    const paymentConfig = course?.payment_config || {};
    const paymentEnabled = K.toggle(!!paymentConfig.enabled, 'Checkout enabled');
    const paymentProvider = K.select([['external', 'External checkout'], ['stripe', 'Stripe'], ['sumup', 'SumUp']], paymentConfig.provider || 'external');
    const paymentSku = K.input(paymentConfig.sku || '');
    const paymentCheckoutUrl = K.input(paymentConfig.checkout_url || '', 'url', 'https://checkout.example/…');
    const paymentWebhookSecret = K.input(paymentConfig.webhook_secret || '', 'password', 'Webhook secret');
    payment.body.append(
      K.switches([paymentEnabled]),
      K.fields([
        K.field('Provider', paymentProvider),
        K.field('SKU / product key', paymentSku),
        K.field('Checkout URL', paymentCheckoutUrl, 'Supports {payment_id}, {course_id}, {user_email}, {amount}, and {currency} placeholders.'),
        K.field('Webhook secret', paymentWebhookSecret, course ? 'Provider/backend webhook: /api/lms/courses/' + course.id + '/payment-webhook/ · send X-Gravitas-Payment-Secret.' : 'Saved per course.'),
      ], 2),
    );

    /* Learning behavior --------------------------------------------------- */
    const learningConfig = course?.learning_config || {};
    const aiEnabled = K.toggle(learningConfig.ai_enabled !== false, 'AI Tutor enabled');
    const zoteroEnabled = K.toggle(learningConfig.zotero_enabled !== false, 'Zotero/source management enabled');
    const labEnabled = K.toggle(learningConfig.lab_enabled !== false, 'Interactive Lab enabled');
    const profileRequired = K.toggle(learningConfig.require_profile_before_content !== false, 'Require profile form before protected content');
    const discussionsEnabled = K.toggle(learningConfig.discussions_enabled !== false, 'Course discussion group enabled');
    const literatureEnabled = K.toggle(learningConfig.literature_enabled !== false, 'Paper recommendations enabled', 'ORCID / arXiv / INSPIRE / Semantic Scholar');
    const notebookEnabled = K.toggle(learningConfig.notebook_enabled !== false, 'Notebook workspace enabled');
    const gitEnabled = K.toggle(learningConfig.git_enabled !== false, 'Git/GitHub exercise push enabled');
    const socialEnabled = K.toggle(learningConfig.social_publish_enabled !== false, 'Achievement publishing enabled');
    const pkmEnabled = K.toggle(learningConfig.pkm_enabled !== false, 'PKM exports enabled');
    const offlineEnabled = K.toggle(learningConfig.offline_enabled !== false, 'Limited offline read mode enabled');
    const guidanceMode = K.select([
      ['hint_only', 'Hints only · never reveal final answer'],
      ['guided', 'Guided · hints first, full answer only after effort/request'],
      ['full', 'Full explanations allowed'],
    ], learningConfig.ai_guidance_mode || 'guided');
    const instructorPrompt = K.textarea(learningConfig.ai_instructor_prompt || '', 4);
    const notebookRuntime = K.select([
      ['python', 'Python in browser + .ipynb export'],
      ['jupyter', 'Jupyter / Python'],
      ['mathematica', 'Mathematica / Wolfram kernel'],
    ], learningConfig.notebook_runtime || 'python');
    const notebookPackages = K.textarea(Array.isArray(learningConfig.notebook_packages) ? learningConfig.notebook_packages.join('\n') : '', 3, '', { code: true });
    const jupyterUrl = K.input(learningConfig.jupyter_url || '', 'url', 'https://jupyter.example/…');
    const mathematicaUrl = K.input(learningConfig.mathematica_url || '', 'url', 'https://wolfram.example/…');

    const tutor = section('AI tutor', 'How much the course tutor may reveal, and any instructions of your own.', 6);
    tutor.body.append(
      K.switches([aiEnabled]),
      K.field('AI guidance mode', guidanceMode),
      K.field('Instructor AI guidance', instructorPrompt, 'Extra policy/instructions appended to the course tutor system prompt.'),
    );
    const notebook = section('Notebook & runtimes', 'The reproducible environment exercises run in.', 6);
    notebook.body.append(
      K.switches([notebookEnabled]),
      K.fields([
        K.field('Default notebook runtime', notebookRuntime, '', { wide: true }),
        K.field('Jupyter runner URL', jupyterUrl),
        K.field('Mathematica / Wolfram runner URL', mathematicaUrl),
        K.field('Notebook packages', notebookPackages, 'One Python package per line. Stored in the reproducible environment spec.', { wide: true }),
      ], 2),
    );
    const behavior = section('Learning behavior', 'Research tooling, collaboration, offline access and exercise workflows for this course.');
    behavior.body.append(K.switches([
      profileRequired, discussionsEnabled, labEnabled, zoteroEnabled, literatureEnabled,
      gitEnabled, socialEnabled, pkmEnabled, offlineEnabled,
    ]));

    /* Structure ----------------------------------------------------------- */
    const structure = section(
      'Course structure',
      enrolled.length
        ? `${enrolled.length} enrollment(s) exist. Stable IDs preserve learner progress while lessons and assessments are edited.`
        : 'Modules contain lessons, course media, Labs and optional assessments.',
    );
    const modulesHost = K.stack();
    const finalsHost = K.stack();
    populateStructure(modulesHost, finalsHost, course);
    structure.body.append(modulesHost, K.cardActions([K.button('Add module', () => modulesHost.append(moduleEditor()))]));
    const finals = section('Course assessments', 'Final assessments that apply to the whole course.');
    finals.body.append(finalsHost, K.cardActions([K.button('Add final assessment', () => finalsHost.append(assessmentEditor()))]));

    /* Media & enrollment (existing courses only) -------------------------- */
    const mediaPane = [];
    if (course) {
      const currentGroups = (mediaData.groups || []).map((group) => {
        const current = (group.versions || []).find((item) => item.id === group.current_id) || (group.versions || [])[0];
        return { ...group, current };
      }).filter((group) => group.current);
      const maxUpload = mediaData.max_file_bytes ? P.formatBytes(mediaData.max_file_bytes) : 'configured server limit';
      const cloudState = mediaData.nextcloud?.state || 'unavailable';
      const media = section(
        'Course media library',
        'Nextcloud-backed media with folders and version history. File types are unrestricted; each upload may be up to ' + maxUpload + '.',
        8,
        [
          K.badge(cloudState === 'live' ? `Nextcloud · ${mediaData.nextcloud?.mountpoint || 'Gravitas Learning'}` : cloudState === 'partial' ? 'Migration pending' : 'Storage unavailable',
            cloudState === 'live' ? 'ok' : cloudState === 'partial' ? 'warn' : 'bad'),
          mediaData.nextcloud?.files_url ? K.anchor('Open in Nextcloud', mediaData.nextcloud.files_url, { tiny: true }) : null,
        ],
      );
      if (cloudState === 'partial') media.body.append(C.note('Nextcloud is active, but at least one older local file still needs migration.'));

      const assetList = K.stack();
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
          assetList.append(K.heading(folderKey || 'Root'));
          folderHost = K.list();
          assetList.append(folderHost);
        }

        const actions = [];
        const open = K.anchor(item.kind === 'file' ? 'Download' : 'Open', item.kind === 'file' ? item.download_url : item.source_url, { tiny: true, external: item.kind !== 'file' });
        actions.push(open);

        if (item.kind === 'file') {
          const picker = K.input('', 'file');
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
              await reload();
            } catch (error) {
              alert(error?.message || 'New version could not be uploaded.');
            }
          });
          media.body.append(picker);
          actions.push(action('New version', () => picker.click(), false, true));
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
              title: nextTitle.trim(), folder_path: nextFolder.trim(), source_url: sourceUrl,
              lesson_id: item.lesson_id || null, metadata: item.metadata || {},
            });
            await reload();
          } catch (error) {
            edit.disabled = false;
            alert(error?.message || 'Asset could not be updated.');
          }
        }, false, true);
        actions.push(edit);

        const remove = K.button('Delete current', async () => {
          if (!confirm('Delete current version of “' + item.title + '”? Older versions stay available.')) return;
          remove.disabled = true;
          try {
            await P.adminDeleteLearningAsset(item.id);
            await reload();
          } catch (error) {
            remove.disabled = false;
            alert(error?.message || 'Version could not be deleted.');
          }
        }, { tiny: true, danger: true });
        actions.push(remove);

        const node = K.row({
          title: item.title,
          meta: P.meta([label(item.kind), 'v' + item.version, item.version_count + ' ' + (item.version_count === 1 ? 'version' : 'versions'), item.mime_type, item.size ? P.formatBytes(item.size) : '']),
          body: item.version_note || '',
          lead: K.avatar(item.title, { mark: item.kind === 'file' ? 'files' : 'link', series: 2 }),
          actions,
        });
        folderHost.append(node);

        if ((group.versions || []).length > 1) {
          const history = el('details', 'adm-details');
          history.append(el('summary', null, 'Version history · ' + group.versions.length));
          history.append(K.list(group.versions.map((version) => K.row({
            title: 'v' + version.version + ' · ' + (version.original_name || version.title),
            meta: P.meta([date(version.created_at), version.is_current ? 'Current' : '', version.size ? P.formatBytes(version.size) : '']),
            body: version.version_note || '',
            actions: version.kind === 'file' ? [K.anchor('Download v' + version.version, version.download_url, { tiny: true, external: false })] : [],
          }))));
          node.querySelector('.adm-row__main').append(history);
        }
      }
      if (!currentGroups.length) assetList.append(K.empty('No course assets yet. Upload a file or register an external URL or embed.'));
      media.body.append(assetList);

      const addAsset = section('Add asset', 'A file, a link or an embed, optionally tied to one lesson.', 4);
      const assetTitle = K.input('', 'text', 'Asset title');
      const assetKind = K.select([['file', 'File'], ['url', 'URL'], ['embed', 'Embed']], 'file');
      const assetFolder = K.input('', 'text', 'Week 1/Datasets');
      assetFolder.setAttribute('list', 'course-media-folders-' + course.id);
      const folderOptions = el('datalist');
      folderOptions.id = 'course-media-folders-' + course.id;
      for (const value of mediaData.folders || []) {
        const option = el('option');
        option.value = value;
        folderOptions.append(option);
      }
      const assetVersionNote = K.input('', 'text', 'Optional');
      const assetFile = K.input('', 'file');
      const assetUrl = K.input('', 'url', 'https://…');
      const lessonOptions = [['', 'Whole course']];
      for (const module of course.modules || []) for (const lesson of module.lessons || []) lessonOptions.push([lesson.id, module.title + ' · ' + lesson.title]);
      const assetLesson = K.select(lessonOptions, '');
      const fileField = K.field('File', assetFile);
      const urlField = K.field('URL', assetUrl);
      const syncKind = () => { fileField.hidden = assetKind.value !== 'file'; urlField.hidden = assetKind.value === 'file'; };
      assetKind.addEventListener('change', syncKind);
      syncKind();
      const assetStatus = statusLine();
      const assetSave = action('Add asset', async () => {
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
          await reload();
        } catch (error) {
          setStatus(assetStatus, error?.message || 'Asset could not be saved.', 'bad');
          assetSave.disabled = false;
        }
      }, true);
      addAsset.body.append(
        K.fields([
          K.field('Title', assetTitle), K.field('Kind', assetKind), K.field('Folder', assetFolder),
          K.field('Lesson', assetLesson), fileField, urlField, K.field('Version note', assetVersionNote),
        ], 1),
        folderOptions,
        K.cardActions([assetSave], assetStatus),
      );

      const access = section('Enrollment management', 'Grant this course directly to a registered account.', 12);
      const enrollStatus = statusLine();
      const resultList = el('div');
      const userFinder = K.search('Search account', async (q) => {
        resultList.replaceChildren();
        if (q.length < 2) return;
        try {
          const data = await P.adminUsers(q);
          resultList.append(K.list(data.users.slice(0, 8).map((user) => {
            const grant = K.button('Enroll', async () => {
              grant.disabled = true;
              try { await P.lmsEnroll(course.id, { user_id: user.id }); setStatus(enrollStatus, `${user.email} enrolled.`, 'ok'); }
              catch (error) { setStatus(enrollStatus, error?.message || 'Enrollment failed.', 'bad'); grant.disabled = false; }
            }, { tiny: true });
            return K.row({ title: user.name, meta: user.email, lead: K.avatar(user.name || user.email), actions: [grant] });
          })));
        } catch (error) {
          setStatus(enrollStatus, error?.message || 'Accounts could not be searched.', 'bad');
        }
      }, 200);
      access.body.append(K.toolbar([userFinder.wrap], [enrollStatus]), resultList);
      const enrolledRows = enrolled.map((item) => enrollmentAdminRow(item, reload));
      if (enrolledRows.length) access.body.append(K.heading(`Enrollments · ${enrolledRows.length}`), K.list(enrolledRows));
      mediaPane.push(K.bento([media.box, addAsset.box]), K.bento([access.box]));
    }

    const tabList = [
      ['details', 'Details'],
      ['structure', 'Structure'],
      ['behavior', 'Learning behavior'],
      ['people', 'Instructors & forms'],
      ['payment', 'Payment'],
      ['integration', 'Open edX'],
      ...(course ? [['media', 'Media & enrollment']] : []),
    ];
    const builders = {
      details: () => [K.bento([details.box, publishing.box]), K.bento([publishingWorkflow.box]), K.bento([courseCoverEditor(course)])],
      structure: () => [K.bento([structure.box, finals.box])],
      behavior: () => [K.bento([tutor.box, notebook.box, behavior.box])],
      people: () => [K.bento([instructorsBox.box, profileBox.box])],
      payment: () => [K.bento([payment.box])],
      integration: () => [K.bento([openedx.box])],
      media: () => mediaPane,
    };
    form.append(K.tabs(tabList, (key) => builders[key](), { name: 'Course builder', eager: true }));

    const collectCoursePayload = () => {
      const tagIds = [...tagSelect.selectedOptions].map((option) => Number(option.value));
      const payload = {
        title: title.value.trim(),
        slug: slug.value.trim(),
        summary: summary.value,
        description: description.value,
        access_type: accessType.value,
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
      if (!course) payload.status = 'draft';
      return payload;
    };

    const line = statusLine();
    const save = action(course ? 'Save draft' : 'Create draft', null, true);
    save.type = 'submit';
    form.append(K.foot([save, link(go, 'Back to LMS Admin', `${ADMIN}/lms`)], line));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      save.disabled = true;
      setStatus(line, course ? 'Saving draft…' : 'Creating draft…');
      const payload = collectCoursePayload();

      try {
        const result = course ? await P.lmsUpdateCourse(course.id, payload) : await P.lmsCreateCourse(payload);
        setStatus(line, course ? 'Draft saved. Learners still see the live version.' : 'Draft created.', 'ok');
        save.disabled = false;
        if (!course) go(`${ADMIN}/lms/courses/${result.course.id}`, { replace: true });
        else await reload();
      } catch (error) {
        setStatus(line, error?.data?.error || error?.message || 'Course was not saved.', 'bad');
        save.disabled = false;
      }
    });
    wrap.append(form);
  } catch (error) {
    K.failure(host, 'LMS course', error, () => renderAdminCourseEditor(host, id, { go }));
  }
}

/* ==========================================================================
   RESEARCH
   ========================================================================== */

export async function renderAdminResearch(host, { go }) {
  K.loading(host, 'Research Admin', { tiles: 4, cards: [12] });
  try {
    const data = await P.adminResearchProjects();
    const projects = data.projects || [];
    const wrap = K.page(host, {
      title: 'Research Admin',
      meta: 'Project policy and membership, without making Core administrators Research participants.',
      actions: [link(go, 'Research workspace', '/workspace/research')],
    });
    const count = (fn) => projects.filter(fn).length;
    wrap.append(K.tiles([
      K.tile({ value: projects.length, label: 'Projects', icon: 'space-research', featured: true, note: 'Every workspace' }),
      K.tile({ value: count((p) => p.status === 'active'), label: 'Active', icon: 'progress', note: 'In progress now' }),
      K.tile({ value: count((p) => p.category === 'client'), label: 'Client projects', icon: 'opportunity', note: 'Revenue research' }),
      K.tile({ value: count((p) => p.secure_data_room), label: 'Secure data rooms', icon: 'secure', note: 'Restricted storage' }),
    ]));

    const box = section('Projects', 'Open a project to change its policy or membership.');
    let filter = '';
    const listHost = el('div');
    const draw = () => {
      const shown = projects.filter((p) => !filter || p.category === filter);
      listHost.replaceChildren(shown.length ? K.list(shown.map((project, index) => K.row({
        title: project.title,
        meta: P.meta([project.owner?.name, label(project.category), project.deadline ? `Due ${date(project.deadline)}` : '']),
        lead: K.avatar(project.title, { mark: 'projects', series: (index % 4) + 1 }),
        badges: [K.stateBadge(project.status), K.badge(label(project.visibility)), project.secure_data_room ? K.badge('Secure room', 'accent') : null],
        onClick: () => go(`${ADMIN}/research/${project.id}`),
      }))) : K.empty(projects.length ? 'No project in this category.' : 'No research projects yet. Projects created in the Research workspace appear here.'));
    };
    box.body.append(K.toolbar([K.choices([['', 'All'], ['internal', 'Internal'], ['client', 'Client'], ['community', 'Community']], '', (value) => { filter = value; draw(); })], [K.count(projects.length, 'project')]), listHost);
    draw();
    wrap.append(K.bento([box.box]));
  } catch (error) {
    K.failure(host, 'Research Admin', error, () => renderAdminResearch(host, { go }));
  }
}

export async function renderAdminResearchProject(host, id, { go }) {
  K.loading(host, 'Research project', { tiles: 0, cards: [8, 4] });
  try {
    const data = await P.adminResearchProject(id);
    const project = data.project;
    const wrap = K.page(host, {
      title: project.title,
      meta: P.meta([label(project.status), label(project.category), `${project.counts.members} members`, `${project.counts.files} files`, `${project.counts.folders} folders`]),
      actions: [link(go, 'Open in Research Workspace', `/workspace/research/projects/${project.id}`), link(go, 'All projects', `${ADMIN}/research`)],
    });
    const form = el('form', 'adm-form');
    const title = K.input(project.title);
    const description = K.textarea(project.description, 5);
    const status = K.select([['intake', 'Intake'], ['active', 'Active'], ['review', 'Review'], ['delivered', 'Delivered'], ['on_hold', 'On hold'], ['closed', 'Closed']], project.status);
    const category = K.select([['internal', 'Internal research'], ['client', 'Client / revenue research'], ['community', 'Community research']], project.category);
    const visibility = K.select([['private', 'Private'], ['invite', 'Invite only'], ['community', 'Community'], ['public', 'Public']], project.visibility);
    const confidentiality = K.select([['internal', 'Internal'], ['confidential', 'Confidential'], ['restricted', 'Restricted data room'], ['public', 'Public']], project.confidentiality);
    const question = K.textarea(project.research_question, 4);
    const client = K.input(project.client_name || '');
    const deadline = K.input(project.deadline || '', 'date');
    const budget = K.input(project.budget || '', 'number');
    budget.step = '0.01';
    const currency = K.input(project.currency || 'EUR');
    const secure = K.toggle(project.secure_data_room, 'Secure data room', 'Restricted storage and audited access.');
    const publicLinks = K.toggle(project.allow_public_links, 'Allow public share links');
    const downloads = K.toggle(project.allow_downloads, 'Allow downloads');
    const archived = K.toggle(project.archived, 'Archive project', 'Hidden from active lists; nothing is deleted.');

    const main = section('Project', 'Metadata shown in the Research workspace.', 8);
    main.body.append(
      K.fields([K.field('Title', title, '', { wide: true }), K.field('Status', status), K.field('Category', category), K.field('Client', client), K.field('Deadline', deadline), K.field('Budget', budget), K.field('Currency', currency)]),
      K.field('Description', description),
      K.field('Research question', question),
    );
    const policy = section('Policy', 'Who can see the project and what leaves it.', 4);
    policy.body.append(
      K.fields([K.field('Visibility', visibility), K.field('Confidentiality', confidentiality)], 1),
      K.switches([secure, publicLinks, downloads, archived]),
    );
    const line = statusLine();
    const save = action('Save project policy', null, true);
    save.type = 'submit';
    form.append(K.bento([main.box, policy.box]), K.foot([save, link(go, 'Back to Research Admin', `${ADMIN}/research`)], line));
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
      } catch (error) {
        setStatus(line, error?.message || 'Project was not saved.', 'bad');
      } finally {
        save.disabled = false;
      }
    });
    wrap.append(form);

    const membership = section('Members & Nextcloud access', 'Membership here is mirrored to the project’s Nextcloud folder.', 8);
    const memberStatus = statusLine();
    const members = project.members.map((member, index) => K.row({
      title: member.name, meta: member.email,
      lead: K.avatar(member.name || member.email, { series: (index % 4) + 1 }),
      badges: [K.badge(label(member.role), member.project_owner ? 'accent' : '')],
      actions: member.project_owner ? [] : [K.button('Revoke', async () => {
        try {
          await P.adminUpdateResearchProject(project.id, { member: { action: 'revoke', user_id: member.user_id } });
          renderAdminResearchProject(host, id, { go });
        } catch (error) { setStatus(memberStatus, error?.message || 'Membership could not be revoked.', 'bad'); }
      }, { tiny: true, danger: true })],
    }));
    membership.body.append(members.length ? K.list(members) : K.empty('No members yet.'));
    const email = K.input('', 'email', 'Registered account email');
    const role = K.select([['viewer', 'Viewer'], ['editor', 'Editor'], ['owner', 'Project owner role']], 'viewer');
    const add = K.button('Grant access', async () => {
      if (!email.value.trim()) { setStatus(memberStatus, 'Enter an account email.', 'bad'); return; }
      add.disabled = true;
      setStatus(memberStatus, 'Granting access…');
      try {
        await P.adminUpdateResearchProject(project.id, { member: { action: 'grant', email: email.value.trim(), role: role.value } });
        await renderAdminResearchProject(host, id, { go });
      } catch (error) {
        setStatus(memberStatus, error?.message || 'Access could not be granted.', 'bad');
        add.disabled = false;
      }
    }, { solid: true });
    membership.body.append(K.heading('Grant access'), K.fields([K.field('Account email', email), K.field('Role', role)], 2), K.cardActions([add], memberStatus));

    const applications = section('Applications', 'Community applications to join this project.', 4);
    const apps = project.applications.map((item) => K.row({
      title: item.name, meta: P.meta([item.email, date(item.created_at)]),
      badges: [K.stateBadge(item.status), ...(item.skills || []).slice(0, 3).map((skill) => K.badge(skill))],
    }));
    applications.body.append(apps.length ? K.list(apps) : K.empty('No applications.'));
    wrap.append(K.bento([membership.box, applications.box]));
  } catch (error) {
    K.failure(host, 'Research project', error, () => renderAdminResearchProject(host, id, { go }));
  }
}

/* ==========================================================================
   ACTIVITY
   ========================================================================== */

export async function renderAdminActivity(host) {
  K.loading(host, 'Activity', { tiles: 0, cards: [12] });
  try {
    const wrap = K.page(host, {
      title: 'Activity',
      meta: 'The cross-layer audit stream. Administrative changes and product events stay attributable to a person.',
    });
    let layer = '';
    const box = section('Events');
    const counter = el('span', 'adm-count');
    const listHost = el('div');
    const filter = K.choices([['', 'All layers'], ['shell', 'Site'], ['dashboard', 'Dashboard'], ['lms', 'LMS'], ['research', 'Research'], ['core', 'Core']], '', (value) => { layer = value; load(); });
    box.body.append(K.toolbar([filter], [counter]), listHost);
    wrap.append(K.bento([box.box]));
    const load = async () => {
      listHost.replaceChildren(el('div', 'fl-skeleton adm-skeleton'));
      try {
        const data = await P.adminActivity({ layer });
        const events = data.events || [];
        counter.textContent = `${events.length} event${events.length === 1 ? '' : 's'}`;
        listHost.replaceChildren(events.length ? K.list(events.map((item) => activityRow(item, { withActor: true }))) : K.empty('No audit events match this filter.'));
      } catch (error) {
        listHost.replaceChildren(K.empty(error?.message || 'Activity could not be loaded.', [action('Retry', load)]));
      }
    };
    await load();
  } catch (error) {
    K.failure(host, 'Activity', error, () => renderAdminActivity(host));
  }
}

/* ==========================================================================
   NEXTCLOUD DECK
   ========================================================================== */

export async function renderAdminDeck(host) {
  K.loading(host, 'Nextcloud Deck', { tiles: 0, cards: [8, 4] });
  try {
    const data = await P.adminDeck();
    const wrap = K.page(host, {
      title: 'Nextcloud Deck',
      meta: 'Gravitas stays the source of truth. Deck is the native execution surface for Core tasks.',
      actions: data.board?.url ? [K.anchor('Open Deck', data.board.url)] : [],
    });
    const state = data.configured ? (data.available ? ['Deck adapter ready', 'ok'] : ['Deck unavailable', 'bad']) : ['Credentials not configured', 'warn'];
    const connection = section('Connection', 'The board Core tasks are mirrored into.', 8, [K.badge(state[0], state[1])]);
    const line = statusLine();
    const sync = K.button('Sync Core tasks to Deck', async () => {
      sync.disabled = true;
      setStatus(line, 'Reconciling Deck…');
      try {
        const result = await P.adminDeckSync();
        const c = result.changes;
        setStatus(line, `Synced ${result.tasks} tasks · ${c.created} created · ${c.updated} updated · ${c.moved} moved · ${c.archived} archived.`, 'ok');
      } catch (error) {
        setStatus(line, error?.data?.detail || error?.message || 'Deck sync failed.', 'bad');
      } finally {
        sync.disabled = !data.configured;
      }
    }, { solid: true });
    sync.disabled = !data.configured;
    connection.body.append(
      K.defs([
        ['Board', data.board ? data.board.title : (data.error || 'Created on the first sync.')],
        ['Canonical tasks', data.board ? String(data.task_count) : '—'],
        ['Mode', data.mirror_mode === 'bidirectional-execution' ? 'Two-way for execution fields' : 'Gravitas → Deck'],
      ]),
      K.cardActions([sync, data.board?.url ? K.anchor('Open Deck', data.board.url) : null], line),
    );
    const contract = section('Sync contract', 'What moves, and in which direction.', 4);
    contract.body.append(K.defs([
      ['Canonical data', 'Title, owner, status, priority, due date, description and definition of done originate in Gravitas.'],
      ['Native execution', 'Tasks are mirrored into Backlog, Active, Blocked and Done stacks in Deck.'],
      ['Safe reconciliation', 'Every card carries a stable Gravitas marker. Deleted tasks are archived in Deck, not left live.'],
    ]));
    wrap.append(K.bento([connection.box, contract.box]));
  } catch (error) {
    K.failure(host, 'Nextcloud Deck', error, () => renderAdminDeck(host));
  }
}

/* ==========================================================================
   SUPPORT TICKETS
   ========================================================================== */

export async function renderAdminTickets(host) {
  K.loading(host, 'Support tickets', { tiles: 0, cards: [4, 8] });
  try {
    const wrap = K.page(host, {
      title: 'Support tickets',
      meta: 'Member conversations with the Gravitas+ team. Only Core administrators can read or reply.',
    });
    const list = section('Tickets', '', 4);
    const detail = section('Conversation', 'Choose a ticket to read and reply.', 8);
    const listHost = el('div');
    let filter = '';
    let openId = null;
    list.body.append(K.choices([['', 'All'], ['waiting_team', 'Waiting'], ['open', 'Open'], ['resolved', 'Done']], '', (value) => { filter = value; reload(); }), listHost);
    wrap.append(K.bento([list.box, detail.box]));
    const detailTitle = detail.head.querySelector('.wc-card__title');
    const detailNote = detail.head.querySelector('.wc-card__note');

    const openTicket = async (ticketId) => {
      openId = ticketId;
      for (const node of listHost.querySelectorAll('.adm-row')) {
        if (node.dataset.id === String(ticketId)) node.setAttribute('aria-current', 'true');
        else node.removeAttribute('aria-current');
      }
      detail.body.replaceChildren(el('div', 'fl-skeleton adm-skeleton'));
      try {
        const result = await P.adminTicket(ticketId);
        const ticket = result.ticket;
        detailTitle.textContent = ticket.subject;
        if (detailNote) detailNote.textContent = P.meta([ticket.member.name, ticket.member.email, `Updated ${date(ticket.updated_at)}`]);
        const thread = el('div', 'adm-thread');
        for (const message of ticket.messages || []) {
          const bubble = el('article', 'adm-msg');
          if (message.is_team_reply) bubble.dataset.team = '';
          const who = el('div', 'adm-msg__who');
          who.append(el('strong', null, message.is_team_reply ? 'Gravitas+ Team' : message.author), el('span', null, date(message.created_at)));
          bubble.append(who, el('p', 'adm-msg__body', message.body));
          thread.append(bubble);
        }
        if (!thread.childElementCount) thread.append(K.empty('No messages yet.'));

        const form = el('form', 'adm-form');
        const reply = K.textarea('', 4, 'Reply to this ticket…');
        const status = K.select([
          ['open', 'Open'], ['waiting_member', 'Waiting for member'], ['waiting_team', 'Waiting for Gravitas+'],
          ['resolved', 'Resolved'], ['closed', 'Closed'],
        ], ticket.status);
        status.setAttribute('aria-label', 'Ticket status');
        status.style.width = 'auto';
        const send = action('Send reply', null, true);
        send.type = 'submit';
        const line = statusLine();
        const saveStatus = action('Update status', async () => {
          saveStatus.disabled = true;
          try { await P.adminUpdateTicket(ticketId, { status: status.value }); await reload(); await openTicket(ticketId); }
          catch (error) { setStatus(line, error?.message || 'Status was not changed.', 'bad'); }
          finally { saveStatus.disabled = false; }
        });
        form.append(K.field('Reply', reply), K.cardActions([send, status, saveStatus], line));
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          if (!reply.value.trim()) { setStatus(line, 'Write a reply first.', 'bad'); return; }
          send.disabled = true;
          setStatus(line, 'Sending…');
          try { await P.adminReplyTicket(ticketId, reply.value.trim()); await reload(); await openTicket(ticketId); }
          catch (error) { setStatus(line, error?.message || 'Reply failed.', 'bad'); send.disabled = false; }
        });
        detail.body.replaceChildren(K.cardActions([K.stateBadge(ticket.status), K.stateBadge(ticket.priority)]), thread, form);
      } catch (error) {
        detail.body.replaceChildren(K.empty(error?.message || 'Ticket could not be loaded.'));
      }
    };

    const reload = async () => {
      const fresh = await P.adminTickets(filter);
      const tickets = fresh.tickets || [];
      listHost.replaceChildren(tickets.length ? K.list(tickets.map((ticket) => {
        const node = K.row({
          title: ticket.subject,
          meta: P.meta([ticket.member.name, `${ticket.message_count} messages`, date(ticket.updated_at)]),
          badges: [K.stateBadge(ticket.status)],
          onClick: () => openTicket(ticket.id),
          current: String(ticket.id) === String(openId),
          chevron: false,
        });
        node.dataset.id = String(ticket.id);
        return node;
      })) : K.empty('No tickets in this filter.'));
      return tickets;
    };
    const tickets = await reload();
    if (tickets[0]) await openTicket(tickets[0].id);
  } catch (error) {
    K.failure(host, 'Support tickets', error, () => renderAdminTickets(host));
  }
}

/* ==========================================================================
   NEWSLETTER
   ========================================================================== */

export async function renderAdminNewsletter(host) {
  K.loading(host, 'Newsletter', { tiles: 3, cards: [8, 4] });
  try {
    const data = await P.adminNewsletter();
    const subscribersList = data.subscribers || [];
    const campaignsList = data.campaigns || [];
    const wrap = K.page(host, {
      title: 'Newsletter',
      meta: 'Confirmed subscribers, delivery history and direct campaign sending.',
    });
    wrap.append(K.tiles([
      K.tile({ value: data.active_count, label: 'Active subscribers', icon: 'mail', featured: true, note: 'Receive the next send' }),
      K.tile({ value: subscribersList.filter((item) => !item.active).length, label: 'Inactive', icon: 'team', note: 'In the latest list' }),
      K.tile({ value: campaignsList.length, label: 'Recent campaigns', icon: 'share', note: campaignsList[0] ? `Last ${date(campaignsList[0].created_at)}` : 'None sent yet' }),
    ]));

    const composer = section('Send newsletter', 'Each active subscriber gets a separate email; addresses are never shown to other recipients.', 8);
    const form = el('form', 'adm-form');
    const subject = K.input('', 'text', 'Email subject');
    const body = K.textarea('', 10, 'Newsletter body…');
    const line = statusLine();
    const send = action(`Send to ${data.active_count} subscribers`, null, true);
    send.type = 'submit';
    form.append(K.field('Subject', subject), K.field('Message', body), K.cardActions([send], line));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!subject.value.trim() || !body.value.trim()) { setStatus(line, 'Subject and message are required.', 'bad'); return; }
      if (!confirm(`Send this email to ${data.active_count} active subscribers?`)) return;
      send.disabled = true;
      setStatus(line, 'Sending…');
      try {
        const result = await P.adminSendNewsletter({ subject: subject.value.trim(), body: body.value.trim() });
        setStatus(line, `Sent to ${result.sent_count} subscribers.`, 'ok');
        subject.value = '';
        body.value = '';
      } catch (error) {
        setStatus(line, error?.message || 'Newsletter could not be sent.', 'bad');
      } finally {
        send.disabled = false;
      }
    });
    composer.body.append(form);

    const campaigns = section('Recent campaigns', '', 4);
    const campaignRows = campaignsList.map((item) => K.row({
      title: item.subject, meta: P.meta([`${item.sent_count} sent`, date(item.created_at)]), body: item.created_by,
    }));
    campaigns.body.append(campaignRows.length ? K.list(campaignRows) : K.empty('No campaigns sent yet.'));

    const subscribers = section('Subscribers', 'Deactivating stops delivery without deleting the address.');
    const subscriberRows = subscribersList.map((item, index) => {
      const toggle = K.button(item.active ? 'Deactivate' : 'Activate', async () => {
        toggle.disabled = true;
        try { await P.adminUpdateNewsletterSubscriber(item.id, !item.active); renderAdminNewsletter(host); }
        catch { toggle.disabled = false; }
      }, { tiny: true });
      return K.row({
        title: item.email,
        meta: P.meta([item.source, date(item.created_at)]),
        lead: K.avatar(item.email, { series: (index % 4) + 1 }),
        badges: [item.active ? K.badge('Active', 'ok') : K.badge('Inactive')],
        actions: [toggle],
      });
    });
    subscribers.body.append(subscriberRows.length ? K.list(subscriberRows) : K.empty('No subscribers yet. Confirmed website subscriptions appear here.'));
    wrap.append(K.bento([composer.box, campaigns.box, subscribers.box]));
  } catch (error) {
    K.failure(host, 'Newsletter', error, () => renderAdminNewsletter(host));
  }
}

/* ==========================================================================
   INTERACTIVE LAB
   ========================================================================== */

export async function renderAdminLabs(host) {
  K.loading(host, 'Interactive Lab', { tiles: 0, cards: [4, 8] });
  try {
    const data = await P.adminLabs();
    const labs = data.labs || [];
    const wrap = K.page(host, {
      title: 'Interactive Lab',
      meta: 'Sandboxed interactive experiments built from HTML, CSS and JavaScript files.',
    });
    const list = section('Labs', '', 4);
    const editor = section('Lab editor', 'Published labs need index.html. Code runs in a sandbox on the public Lab page.', 8);
    wrap.append(K.bento([list.box, editor.box]));
    const listHost = el('div');
    list.body.append(listHost);
    let selected = labs[0] || null;

    const drawList = () => {
      listHost.replaceChildren(labs.length ? K.list(labs.map((lab) => K.row({
        title: lab.title,
        meta: P.meta([lab.slug, lab.duration_text, date(lab.updated_at)]),
        badges: [K.stateBadge(lab.status)],
        onClick: () => { selected = lab; drawList(); drawEditor(lab); },
        current: selected?.id === lab.id,
        chevron: false,
      }))) : K.empty('No managed labs yet.'));
    };

    const drawEditor = (lab = null) => {
      editor.head.querySelector('.wc-card__title').textContent = lab ? lab.title : 'New lab';
      const form = el('form', 'adm-form');
      const title = K.input(lab?.title || '', 'text', 'Lab title');
      const slug = K.input(lab?.slug || '', 'text', 'my-lab');
      slug.disabled = !!lab;
      if (!lab) title.addEventListener('input', () => { if (!slug.dataset.touched) slug.value = K.slugify(title.value); });
      slug.addEventListener('input', () => { slug.dataset.touched = '1'; });
      const summary = K.textarea(lab?.summary || '', 3);
      const duration = K.input(lab?.duration_text || '', 'text', '10 min');
      const state = K.select([['draft', 'Draft'], ['published', 'Published']], lab?.status || 'draft');
      const existing = Object.fromEntries((lab?.files || []).map((file) => [file.name, file.content || '']));
      const index = K.textarea(existing['index.html'] || '<!doctype html>\n<html><head><meta charset="utf-8"><link rel="stylesheet" href="styles.css"></head><body>\n<h1>Interactive Lab</h1>\n<script src="app.js"><\/script></body></html>', 14, '', { code: true });
      const css = K.textarea(existing['styles.css'] || '', 14, '/* styles.css */', { code: true });
      const js = K.textarea(existing['app.js'] || '', 14, '// app.js', { code: true });
      const line = statusLine();
      const save = action(lab ? 'Save lab' : 'Create lab', null, true);
      save.type = 'submit';
      const open = lab ? K.anchor('Open public', `/lab.html?lab=${encodeURIComponent(lab.slug)}`) : null;
      const remove = lab ? K.button('Delete', async () => {
        if (!confirm(`Delete “${lab.title}”?`)) return;
        try { await P.adminDeleteLab(lab.id); await renderAdminLabs(host); }
        catch (error) { setStatus(line, error?.message || 'Lab could not be deleted.', 'bad'); }
      }, { danger: true }) : null;
      const files = K.tabs([['index', 'index.html'], ['css', 'styles.css'], ['js', 'app.js']], (key) => [{ index, css, js }[key]], { name: 'Lab files', eager: true, remember: false });
      form.append(
        K.fields([K.field('Title', title), K.field('Slug', slug, 'Lowercase letters, numbers and hyphens.'), K.field('Duration', duration), K.field('Status', state)]),
        K.field('Summary', summary),
        files,
        K.cardActions([save, open, remove], line),
      );
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        save.disabled = true;
        setStatus(line, 'Saving…');
        const filesPayload = [{ name: 'index.html', content: index.value }];
        if (css.value.trim()) filesPayload.push({ name: 'styles.css', content: css.value });
        if (js.value.trim()) filesPayload.push({ name: 'app.js', content: js.value });
        const payload = { title: title.value.trim(), slug: slug.value.trim(), summary: summary.value.trim(), duration_text: duration.value.trim(), status: state.value, files: filesPayload };
        try {
          if (lab) await P.adminUpdateLab(lab.id, payload); else await P.adminCreateLab(payload);
          await renderAdminLabs(host);
        } catch (error) {
          setStatus(line, error?.message || 'Lab could not be saved.', 'bad');
          save.disabled = false;
        }
      });
      editor.body.replaceChildren(form);
    };

    const tools = el('div');
    tools.append(K.button('New lab', () => { selected = null; drawList(); drawEditor(null); }, { solid: true, tiny: true }));
    list.head.append(tools);
    drawList();
    drawEditor(selected);
  } catch (error) {
    K.failure(host, 'Interactive Lab', error, () => renderAdminLabs(host));
  }
}
