import * as P from './ws-platform.js?v=20260919-lms1';

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
  head.append(el('h1', 'ws-doc__title', title));
  if (subtitle) head.append(el('p', 'ws-doc__meta', subtitle));
  wrap.append(head);
  host.append(wrap);
  return wrap;
}

function loading(host, title) {
  const wrap = doc(host, title);
  const grid = el('div', 'fl-skeleton-grid');
  for (let i = 0; i < 6; i += 1) grid.append(el('div', 'fl-skeleton'));
  wrap.append(grid);
  return wrap;
}

function errorView(host, title, error, retry) {
  const wrap = doc(host, title);
  const box = el('div', 'fl-state fl-state--error');
  box.append(el('strong', null, 'This view could not be loaded.'));
  box.append(el('p', null, error?.message || 'The platform did not return a usable response.'));
  if (retry) {
    const button = action('Retry', retry, true);
    box.append(button);
  }
  wrap.append(box);
}

function action(text, handler, solid = false) {
  const button = el('button', solid ? 'ws-btn ws-btn--solid' : 'ws-btn', text);
  button.type = 'button';
  button.addEventListener('click', handler);
  return button;
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
  head.append(el('h2', 'fl-panel__title', title));
  if (note) head.append(el('p', 'fl-muted', note));
  const body = el('div', 'fl-panel__body');
  box.append(head, body);
  return { box, body, head };
}

function empty(title, copy) {
  const state = el('div', 'fl-state');
  state.append(el('strong', null, title));
  state.append(el('p', 'fl-muted', copy));
  return state;
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

function percent(value) {
  const number = Math.max(0, Math.min(100, Number(value) || 0));
  const wrap = el('div', 'fl-progress');
  const bar = el('span', 'fl-progress__bar');
  bar.style.setProperty('--progress', `${number}%`);
  wrap.append(bar, el('small', 'fl-progress__text', `${number.toFixed(number % 1 ? 1 : 0)}%`));
  return wrap;
}

function link(go, text, href, solid = false) {
  return action(text, () => go(href), solid);
}

export async function renderMemberOverview(host, { go }) {
  loading(host, 'Dashboard');
  try {
    const data = await P.memberDashboard();
    const wrap = doc(host, 'Dashboard', 'One account view across reading, discussion, learning and research.');

    const identity = el('div', 'fl-identity');
    const identityMain = el('div');
    identityMain.append(el('span', 'fl-eyebrow', 'MEMBER'));
    identityMain.append(el('strong', 'fl-identity__name', data.member.name));
    identityMain.append(el('span', 'fl-muted', data.member.email));
    const identityBadges = el('div', 'fl-badges');
    identityBadges.append(badge(label(data.member.community_role)), badge(label(data.member.community_status)));
    identity.append(identityMain, identityBadges);
    wrap.append(identity);

    const metrics = el('div', 'fl-metrics');
    metrics.append(
      metric(data.library.saved_count, 'Saved'),
      metric(data.discussions.total, 'Discussions'),
      metric(data.topic_progress?.total || 0, 'Topics in progress'),
      metric(data.support?.open || 0, 'Open tickets'),
    );
    if (data.learning?.access) metrics.append(metric(data.learning.active, 'Active courses'));
    if (data.research?.access) metrics.append(metric(data.research.projects, 'Research projects'));
    wrap.append(metrics);

    const next = section('Next', 'The most useful unfinished work across your enabled layers.');
    if (!data.next_actions.length) next.body.append(empty('Nothing waiting', 'Save something, enroll in a course or join a research project and it will appear here.'));
    for (const item of data.next_actions) {
      next.body.append(row({
        title: item.title,
        meta: item.meta,
        badges: [label(item.kind)],
        onClick: () => go(item.href),
      }));
    }
    wrap.append(next.box);

    const cols = el('div', 'fl-columns');
    const saved = section('Recently saved');
    if (!data.library.recent_saved.length) saved.body.append(empty('No saved material yet', 'Save an article, dossier or path from the public site.'));
    for (const item of data.library.recent_saved.slice(0, 5)) {
      saved.body.append(row({ title: item.title, meta: P.meta([label(item.kind), date(item.saved_at)]), body: item.summary }));
    }
    saved.head.append(link(go, 'Open library', '/workspace/dashboard/library'));

    const activity = section('Recent activity');
    if (!data.activity.length) activity.body.append(empty('No activity yet', 'Your comments, topic progress, learning and research activity will appear here.'));
    for (const item of data.activity.slice(0, 7)) {
      activity.body.append(row({
        title: item.title,
        meta: P.meta([item.meta, date(item.created_at)]),
        badges: [label(item.kind)],
        onClick: item.href ? () => go(item.href) : null,
      }));
    }
    cols.append(saved.box, activity.box);
    wrap.append(cols);
  } catch (error) {
    errorView(host, 'Dashboard', error, () => renderMemberOverview(host, { go }));
  }
}

export async function renderMemberLibrary(host, { go }) {
  loading(host, 'Library');
  try {
    const data = await P.memberDashboard();
    const wrap = doc(host, 'Library', 'Material saved and followed from the public Gravitas+ site.');
    const metrics = el('div', 'fl-metrics');
    metrics.append(metric(data.library.saved_count, 'Saved'), metric(data.library.following_count, 'Following'));
    wrap.append(metrics);

    const saved = section('Saved');
    if (!data.library.recent_saved.length) saved.body.append(empty('Your library is empty', 'Use Save on public articles, dossiers and learning material.'));
    for (const item of data.library.recent_saved) {
      const tools = [];
      if (item.url) {
        const open = el('a', 'ws-btn ws-btn--tiny', 'Open');
        open.href = item.url;
        tools.push(open);
      }
      const remove = action('Remove', async () => {
        remove.disabled = true;
        try { await P.removeLibraryItem('saved', item.item_key); await renderMemberLibrary(host, { go }); }
        catch { remove.disabled = false; }
      });
      remove.classList.add('ws-btn--tiny');
      tools.push(remove);
      saved.body.append(row({
        title: item.title,
        meta: P.meta([label(item.kind), date(item.saved_at)]),
        body: item.summary,
        actions: tools,
      }));
    }
    wrap.append(saved.box);

    const following = section('Following');
    if (!data.library.following.length) following.body.append(empty('Not following anything yet', 'Follow a topic on the public site to keep it in your account.'));
    for (const item of data.library.following) {
      const tools = [];
      if (item.url) {
        const open = el('a', 'ws-btn ws-btn--tiny', 'Open'); open.href = item.url; tools.push(open);
      }
      const unfollow = action('Unfollow', async () => {
        unfollow.disabled = true;
        try { await P.removeLibraryItem('following', item.item_key); await renderMemberLibrary(host, { go }); }
        catch { unfollow.disabled = false; }
      });
      unfollow.classList.add('ws-btn--tiny'); tools.push(unfollow);
      following.body.append(row({ title: item.title, meta: label(item.kind), body: item.summary, actions: tools }));
    }
    wrap.append(following.box);
  } catch (error) {
    errorView(host, 'Library', error, () => renderMemberLibrary(host, { go }));
  }
}

export async function renderMemberDiscussions(host) {
  loading(host, 'Discussions');
  try {
    const data = await P.memberDashboard();
    const wrap = doc(host, 'Discussions', 'Your contributions on published Gravitas+ material.');
    const metrics = el('div', 'fl-metrics');
    metrics.append(
      metric(data.discussions.total, 'Contributions'),
      metric(data.discussions.published, 'Published'),
      metric(data.discussions.pending, 'Pending review'),
    );
    wrap.append(metrics);
    const box = section('Recent contributions');
    if (!data.discussions.recent.length) box.body.append(empty('No discussions yet', 'Comments you post on public material appear here.'));
    for (const item of data.discussions.recent) {
      box.body.append(row({
        title: item.content_key.replace(/-/g, ' '),
        meta: P.meta([label(item.status), date(item.updated_at)]),
        body: item.body,
      }));
    }
    wrap.append(box.box);
  } catch (error) {
    errorView(host, 'Discussions', error, () => renderMemberDiscussions(host));
  }
}

export async function renderMemberProgress(host, { go }) {
  loading(host, 'Progress');
  try {
    const data = await P.memberDashboard();
    const wrap = doc(host, 'Progress', 'Learning completion and current research participation, without mixing their permissions.');

    const learning = section('Learning');
    learning.head.append(link(go, 'Learning workspace', '/workspace/learning'));
    if (!data.learning.enrollments.length) learning.body.append(empty('No course progress yet', 'Your course enrollments and certificates appear here.'));
    for (const item of data.learning.enrollments) {
      const node = row({
        title: item.course_title,
        meta: P.meta([label(item.status), item.completed_at ? `Completed ${date(item.completed_at)}` : '']),
        onClick: () => go(`/workspace/learning/courses/${item.course_id}`),
      });
      node.querySelector('.fl-row__main').append(percent(item.progress_percent));
      learning.body.append(node);
    }
    wrap.append(learning.box);

    const research = section('Research participation');
    research.head.append(link(go, 'Research workspace', '/workspace/research'));
    if (!data.research.recent.length) research.body.append(empty('No research projects yet', 'Projects you own or join appear here independently of LMS access.'));
    for (const item of data.research.recent) {
      research.body.append(row({
        title: item.title,
        meta: P.meta([label(item.role), label(item.status), item.deadline ? `Due ${date(item.deadline)}` : '']),
        badges: [item.secure_data_room ? 'Secure data room' : ''],
        onClick: () => go(`/workspace/research/projects/${item.id}`),
      }));
    }
    wrap.append(research.box);
  } catch (error) {
    errorView(host, 'Progress', error, () => renderMemberProgress(host, { go }));
  }
}

export async function renderLearningOverview(host, { go }) {
  loading(host, 'Learning');
  try {
    const [mine, catalog] = await Promise.all([P.lmsMe(), P.lmsCourses()]);
    const wrap = doc(host, 'Learning', 'Courses, assessments and certificates. Learning access is independent from Research.');
    const active = (mine.enrollments || []).filter((item) => item.status === 'active' || item.status === 'paused');
    const completed = (mine.enrollments || []).filter((item) => item.status === 'completed');
    const certs = completed.filter((item) => item.certificate?.valid);
    const metrics = el('div', 'fl-metrics');
    metrics.append(metric(active.length, 'In progress'), metric(completed.length, 'Completed'), metric(certs.length, 'Certificates'), metric((catalog.courses || []).length, 'Catalog'));
    wrap.append(metrics);

    const current = section('Continue learning');
    if (!active.length) current.body.append(empty('Nothing in progress', 'Choose a published course from the catalog.'));
    for (const enrollment of active) {
      const node = row({
        title: enrollment.course_title,
        meta: label(enrollment.status),
        onClick: () => go(`/workspace/learning/courses/${enrollment.course_id}`),
      });
      node.querySelector('.fl-row__main').append(percent(enrollment.progress_percent));
      current.body.append(node);
    }
    current.head.append(link(go, 'My learning', '/workspace/learning/my'));
    wrap.append(current.box);

    const discover = section('Catalog');
    for (const course of (catalog.courses || []).slice(0, 6)) discover.body.append(courseRow(course, go));
    if (!(catalog.courses || []).length) discover.body.append(empty('No published courses', 'Published courses will appear here.'));
    discover.head.append(link(go, 'View catalog', '/workspace/learning/catalog'));
    wrap.append(discover.box);
  } catch (error) {
    errorView(host, 'Learning', error, () => renderLearningOverview(host, { go }));
  }
}

function courseMeta(course) {
  const access = course.access_type === 'paid'
    ? `${course.price || '—'} ${course.currency || 'EUR'}`
    : label(course.access_type);
  return P.meta([access, `${course.lesson_count ?? 0} lessons`, course.enrolled ? `${course.progress_percent}% complete` : '']);
}

function courseRow(course, go) {
  return row({
    title: course.title,
    meta: courseMeta(course),
    body: course.summary,
    badges: [course.certificate_enabled ? 'Certificate' : '', course.enrolled ? label(course.enrollment_status) : ''],
    onClick: () => go(`/workspace/learning/courses/${course.id}`),
  });
}

export async function renderLearningCatalog(host, { go }) {
  loading(host, 'Course catalog');
  try {
    const data = await P.lmsCourses();
    const wrap = doc(host, 'Course catalog', 'Published Gravitas+ courses. Enrollment and Research access remain separate.');
    const toolbar = el('div', 'fl-toolbar');
    const search = el('input', 'v-input fl-input');
    search.type = 'search';
    search.placeholder = 'Search courses';
    toolbar.append(search);
    wrap.append(toolbar);
    const box = section('Courses');
    const courses = data.courses || [];
    const draw = () => {
      box.body.innerHTML = '';
      const q = search.value.trim().toLowerCase();
      const matches = courses.filter((item) => !q || `${item.title} ${item.summary}`.toLowerCase().includes(q));
      if (!matches.length) box.body.append(empty('No matching courses', courses.length ? 'Try another search.' : 'There are no published courses yet.'));
      for (const item of matches) box.body.append(courseRow(item, go));
    };
    search.addEventListener('input', draw);
    draw();
    wrap.append(box.box);
  } catch (error) {
    errorView(host, 'Course catalog', error, () => renderLearningCatalog(host, { go }));
  }
}

export async function renderMyLearning(host, { go }) {
  loading(host, 'My learning');
  try {
    const data = await P.lmsMe();
    const wrap = doc(host, 'My learning', 'All course enrollments and completion state.');
    const box = section('Enrollments');
    const items = data.enrollments || [];
    if (!items.length) box.body.append(empty('No enrollments yet', 'Open the catalog to start a course.'));
    for (const item of items) {
      const node = row({
        title: item.course_title,
        meta: P.meta([label(item.status), label(item.access_source), item.completed_at ? `Completed ${date(item.completed_at)}` : '']),
        badges: [item.certificate?.valid ? 'Certificate issued' : ''],
        onClick: () => go(`/workspace/learning/courses/${item.course_id}`),
      });
      node.querySelector('.fl-row__main').append(percent(item.progress_percent));
      box.body.append(node);
    }
    wrap.append(box.box);
  } catch (error) {
    errorView(host, 'My learning', error, () => renderMyLearning(host, { go }));
  }
}

export async function renderCertificates(host, { go }) {
  loading(host, 'Certificates');
  try {
    const data = await P.lmsMe();
    const wrap = doc(host, 'Certificates', 'Certificates issued for completed Gravitas+ courses.');
    const certs = (data.enrollments || []).filter((item) => item.certificate);
    const grid = el('div', 'fl-card-grid');
    if (!certs.length) wrap.append(empty('No certificates yet', 'A certificate appears here when a certificate-enabled course is completed.'));
    for (const item of certs) {
      const card = el('article', 'fl-certificate');
      card.append(el('span', 'fl-eyebrow', item.certificate.valid ? 'GRAVITAS+ CERTIFICATE' : 'REVOKED CERTIFICATE'));
      card.append(el('h2', null, item.course_title));
      card.append(el('p', 'fl-muted', `Issued ${date(item.certificate.issued_at)}`));
      card.append(el('code', 'fl-code', item.certificate.code));
      card.append(link(go, 'Open course', `/workspace/learning/courses/${item.course_id}`));
      if (!item.certificate.valid) card.dataset.revoked = '';
      grid.append(card);
    }
    wrap.append(grid);
  } catch (error) {
    errorView(host, 'Certificates', error, () => renderCertificates(host, { go }));
  }
}

function parseOption(value) {
  try { return JSON.parse(value); } catch { return value; }
}

function lessonCard(lesson, course, host, go) {
  const details = el('details', 'fl-lesson');
  const summary = el('summary', 'fl-lesson__summary');
  const main = el('span');
  main.append(el('strong', null, lesson.title));
  main.append(el('small', 'fl-muted', P.meta([
    label(lesson.kind),
    lesson.duration_seconds ? `${Math.ceil(lesson.duration_seconds / 60)} min` : '',
    lesson.is_preview ? 'Preview' : '',
  ])));
  summary.append(main, badge(lesson.locked ? 'Locked' : 'Available'));
  details.append(summary);
  const body = el('div', 'fl-lesson__body');
  let openedAt = 0;
  let viewSent = false;

  const sendDwell = () => {
    if (!openedAt || !course.enrolled) return;
    const seconds = Math.max(1, Math.round((Date.now() - openedAt) / 1000));
    openedAt = 0;
    P.lmsCourseEvent(course.id, {
      kind: 'lesson.dwell',
      lesson_id: lesson.id,
      duration_seconds: seconds,
    }).catch(() => {});
  };

  details.addEventListener('toggle', () => {
    if (details.open) {
      openedAt = Date.now();
      if (!viewSent && course.enrolled && !lesson.locked) {
        viewSent = true;
        P.lmsCourseEvent(course.id, { kind: 'lesson.view', lesson_id: lesson.id }).catch(() => {});
      }
    } else {
      sendDwell();
    }
  });

  if (lesson.locked) {
    const lockCopy = {
      prerequisite_lessons: 'Complete the prerequisite lessons first.',
      minimum_progress: 'Reach the required course progress before opening this lesson.',
      scheduled_release: 'This lesson is scheduled for a later release.',
      course_profile_required: 'Complete the required course profile first.',
      course_enrollment_required: 'Enroll in the course or ask an administrator for access.',
      invalid_access_rule: 'This lesson has an invalid access rule. Ask the course team to review it.',
    };
    body.append(empty('Lesson locked', lockCopy[lesson.lock_reason] || 'Complete the required access steps or ask the course team for access.'));
  } else {
    if (lesson.summary) body.append(el('p', 'fl-muted', lesson.summary));
    if (lesson.body) body.append(el('div', 'fl-prose', lesson.body));

    if (lesson.kind === 'lab' && lesson.lab_slug && course.learning_config?.lab_enabled !== false) {
      const frame = el('iframe', 'fl-course-embed');
      frame.src = `/lab-run/${encodeURIComponent(lesson.lab_slug)}/`;
      frame.title = lesson.title;
      frame.loading = 'lazy';
      frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-popups');
      body.append(frame);
      const labOpen = action('Start Lab activity', () => {
        if (course.enrolled) P.lmsCourseEvent(course.id, { kind: 'lab.use', lesson_id: lesson.id }).catch(() => {});
        frame.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, true);
      body.prepend(labOpen);
    } else if (lesson.kind === 'embed' && lesson.content_url) {
      const frame = el('iframe', 'fl-course-embed');
      frame.src = lesson.content_url;
      frame.title = lesson.title;
      frame.loading = 'lazy';
      frame.referrerPolicy = 'no-referrer';
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
      body.append(frame);
    } else if (lesson.kind === 'video' && lesson.content_url) {
      const media = el('video', 'fl-course-media');
      media.controls = true;
      media.preload = 'metadata';
      media.src = lesson.content_url;
      body.append(media);
    } else if (lesson.kind === 'audio' && lesson.content_url) {
      const media = el('audio', 'fl-course-media');
      media.controls = true;
      media.preload = 'metadata';
      media.src = lesson.content_url;
      body.append(media);
    } else if (lesson.content_url) {
      const media = el('a', 'ws-btn', ['file', 'pdf', 'document', 'dataset'].includes(lesson.kind) ? 'Open / download resource' : 'Open lesson resource');
      media.href = lesson.content_url;
      media.target = '_blank';
      media.rel = 'noopener';
      body.append(media);
    }

    if (course.enrolled) {
      const actions = el('div', 'fl-form-actions');
      const done = action('Mark complete', async () => {
        done.disabled = true;
        done.textContent = 'Saving…';
        sendDwell();
        try {
          await P.lmsLessonProgress(lesson.id, { completed: true, progress_seconds: lesson.duration_seconds || 0 });
          await renderCourse(host, course.id, { go });
        } catch (error) {
          done.disabled = false;
          done.textContent = error?.message || 'Try again';
        }
      }, true);
      const skip = action('Skip for now', async () => {
        skip.disabled = true;
        sendDwell();
        try {
          await P.lmsCourseEvent(course.id, { kind: 'lesson.skip', lesson_id: lesson.id });
          skip.textContent = 'Skipped';
        } catch {
          skip.disabled = false;
        }
      });
      actions.append(done, skip);
      body.append(actions);
    }
  }
  details.append(body);
  return details;
}

function assessmentCard(assessment, course, host, go) {
  const box = section(assessment.title, `${assessment.passing_score}% to pass · ${assessment.max_attempts} attempts`);
  if (!assessment.questions?.length) {
    box.body.append(empty('Assessment unavailable', course.enrolled ? 'No scorable questions were published.' : 'Enroll to open the assessment.'));
    return box.box;
  }
  const form = el('form', 'fl-assessment');
  const answers = new Map();
  assessment.questions.forEach((question, index) => {
    const qid = String(question.id ?? index + 1);
    const field = el('label', 'fl-question');
    field.append(el('strong', null, question.prompt || `Question ${index + 1}`));
    if (Array.isArray(question.choices) && question.choices.length) {
      const select = el('select', 'v-input fl-input');
      const placeholder = el('option', null, 'Choose an answer');
      placeholder.value = '';
      select.append(placeholder);
      question.choices.forEach((choice) => {
        const option = el('option', null, String(choice));
        option.value = JSON.stringify(choice);
        select.append(option);
      });
      select.addEventListener('change', () => { if (select.value) answers.set(qid, parseOption(select.value)); else answers.delete(qid); });
      field.append(select);
    } else {
      const input = el('input', 'v-input fl-input');
      input.addEventListener('input', () => answers.set(qid, input.value));
      field.append(input);
    }
    form.append(field);
  });
  const status = el('p', 'fl-muted');
  const submit = action('Submit assessment', () => {} , true);
  submit.type = 'submit';
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    status.textContent = 'Scoring…';
    try {
      const result = await P.lmsAssessmentAttempt(assessment.id, Object.fromEntries(answers));
      const attempt = result.attempt || {};
      status.textContent = `${attempt.passed ? 'Passed' : 'Not passed'} · ${attempt.score}%`;
      status.dataset.tone = attempt.passed ? 'ok' : 'warn';
      if (attempt.passed) setTimeout(() => renderCourse(host, course.id, { go }), 700);
    } catch (error) {
      status.textContent = error?.message || 'Assessment could not be submitted.';
      status.dataset.tone = 'bad';
      submit.disabled = false;
    }
  });
  form.append(submit, status);
  box.body.append(form);
  return box.box;
}

function courseRegistrationPanel(course, profile, host, go) {
  if (!course.enrolled || !course.registration_schema?.length || profile?.completed) return null;
  const box = section('Complete your course profile', 'The course team requires these fields before protected lessons unlock.');
  const form = el('form', 'fl-form');
  const controls = new Map();
  for (const spec of course.registration_schema) {
    if (!spec || !spec.key || !spec.label) continue;
    let control;
    if (spec.type === 'select') {
      control = el('select', 'v-input fl-input');
      control.append(el('option', null, 'Choose…'));
      control.firstElementChild.value = '';
      for (const value of spec.options || []) {
        const option = el('option', null, String(value));
        option.value = String(value);
        control.append(option);
      }
    } else if (spec.type === 'textarea') {
      control = el('textarea', 'v-input fl-input fl-textarea');
      control.rows = 4;
    } else if (spec.type === 'checkbox') {
      control = el('input');
      control.type = 'checkbox';
    } else {
      control = el('input', 'v-input fl-input');
      control.type = spec.type === 'number' ? 'number' : 'text';
    }
    if (spec.required) control.required = true;
    controls.set(spec.key, { control, spec });
    const labelWrap = el('label', 'task-board__field');
    labelWrap.append(el('span', 'task-board__label', spec.label + (spec.required ? ' *' : '')), control);
    if (spec.help) labelWrap.append(el('small', 'fl-muted', spec.help));
    form.append(labelWrap);
  }
  const status = el('p', 'v-note');
  const save = action('Save and continue', () => {}, true);
  save.type = 'submit';
  form.append(save, status);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const answers = {};
    for (const [key, item] of controls) answers[key] = item.spec.type === 'checkbox' ? item.control.checked : item.control.value;
    save.disabled = true;
    status.textContent = 'Saving…';
    try {
      await P.lmsSaveRegistrationProfile(course.id, answers);
      await renderCourse(host, course.id, { go });
    } catch (error) {
      status.textContent = error?.data?.fields?.length
        ? `Required: ${error.data.fields.join(', ')}`
        : (error?.message || 'Profile could not be saved.');
      save.disabled = false;
    }
  });
  box.body.append(form);
  return box.box;
}

function courseAssetsPanel(course) {
  if (!course.enrolled || !(course.assets || []).length) return null;
  const box = section('Course files & embeds', 'Course media is managed like a shared learning asset library.');
  for (const item of course.assets) {
    const tools = [];
    const href = item.kind === 'file' ? item.download_url : item.source_url;
    if (href) {
      const open = el('a', 'ws-btn ws-btn--tiny', item.kind === 'file' ? 'Download' : 'Open');
      open.href = href;
      open.target = item.kind === 'file' ? '_self' : '_blank';
      if (item.kind !== 'file') open.rel = 'noopener';
      tools.push(open);
    }
    box.body.append(row({
      title: item.title,
      meta: P.meta([label(item.kind), item.size ? P.formatBytes(item.size) : '', item.mime_type || '']),
      actions: tools,
    }));
  }
  return box.box;
}

async function courseTutorPanel(course) {
  if (!course.enrolled) return null;
  const box = section('AI Tutor', 'Ask Plusar in the context of this course, a lesson and optionally selected Zotero sources.');
  const controls = el('div', 'fl-form-grid');
  const lessonSelect = el('select', 'v-input fl-input');
  const rootOption = el('option', null, 'Whole course');
  rootOption.value = '';
  lessonSelect.append(rootOption);
  for (const module of course.modules || []) {
    for (const lesson of module.lessons || []) {
      const option = el('option', null, `${module.title} · ${lesson.title}`);
      option.value = lesson.id;
      lessonSelect.append(option);
    }
  }
  const sourceSelect = el('select', 'v-input fl-input');
  const noSource = el('option', null, 'No Zotero library');
  noSource.value = '';
  sourceSelect.append(noSource);
  let connections = [];
  try {
    connections = (await P.lmsZotero()).connections || [];
    for (const connection of connections) {
      const option = el('option', null, connection.label || `Zotero ${connection.library_id}`);
      option.value = connection.id;
      sourceSelect.append(option);
    }
  } catch {}
  controls.append(lessonSelect, sourceSelect);
  box.body.append(controls);

  const sourceSearch = el('div', 'fl-form');
  sourceSearch.hidden = true;
  const query = el('input', 'v-input fl-input');
  query.type = 'search';
  query.placeholder = 'Search Zotero sources';
  const sourceResults = el('div', 'fl-stack');
  const selected = new Set();
  sourceSearch.append(query, sourceResults);
  box.body.append(sourceSearch);

  let searchTimer = null;
  const searchSources = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      sourceResults.innerHTML = '';
      if (!sourceSelect.value) return;
      try {
        const data = await P.lmsZoteroItems({ connectionId: sourceSelect.value, q: query.value.trim(), limit: 12 });
        for (const item of data.items || []) {
          const line = el('label', 'v-check-row');
          const check = el('input');
          check.type = 'checkbox';
          check.checked = selected.has(item.key);
          check.addEventListener('change', () => check.checked ? selected.add(item.key) : selected.delete(item.key));
          line.append(check, el('span', null, `${item.title}${item.date ? ' · ' + item.date : ''}`));
          sourceResults.append(line);
        }
      } catch (error) {
        sourceResults.append(el('p', 'fl-muted', error?.message || 'Zotero search failed.'));
      }
    }, 200);
  };
  sourceSelect.addEventListener('change', () => {
    selected.clear();
    sourceSearch.hidden = !sourceSelect.value;
    if (sourceSelect.value) searchSources();
  });
  query.addEventListener('input', searchSources);

  const chat = el('div', 'fl-ai-tutor');
  const log = el('div', 'fl-ai-tutor__log');
  const form = el('form', 'fl-form');
  const question = el('textarea', 'v-input fl-input fl-textarea');
  question.rows = 3;
  question.placeholder = 'Ask a question, request a hint, or test your understanding…';
  const send = action('Ask Plusar', () => {}, true);
  send.type = 'submit';
  const note = el('p', 'v-note');
  const history = [];
  form.append(question, send, note);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = question.value.trim();
    if (!value) return;
    const yours = el('article', 'fl-ai-tutor__turn');
    yours.dataset.who = 'you';
    yours.append(el('strong', null, 'You'), el('p', null, value));
    log.append(yours);
    question.value = '';
    send.disabled = true;
    note.textContent = 'Plusar is thinking…';
    try {
      const data = await P.lmsAiTutor(course.id, {
        question: value,
        lesson_id: lessonSelect.value ? Number(lessonSelect.value) : null,
        source_connection_id: sourceSelect.value ? Number(sourceSelect.value) : null,
        source_keys: [...selected],
        history,
      });
      history.push({ role: 'user', content: value }, { role: 'assistant', content: data.answer });
      const reply = el('article', 'fl-ai-tutor__turn');
      reply.dataset.who = 'assistant';
      reply.append(el('strong', null, 'Plusar'), el('p', null, data.answer));
      if (data.sources?.length) {
        const sources = el('div', 'fl-badges');
        data.sources.forEach((item) => sources.append(badge(item.title)));
        reply.append(sources);
      }
      log.append(reply);
      note.textContent = '';
    } catch (error) {
      note.textContent = error?.message || 'AI Tutor is temporarily unavailable.';
    } finally {
      send.disabled = false;
      log.scrollTop = log.scrollHeight;
    }
  });
  chat.append(log, form);
  box.body.append(chat);
  return box.box;
}

function zoteroConnectionPanel() {
  const box = section('Source management · Zotero', 'Connect a personal Zotero user or group library. The API key is encrypted and never shown again.');
  const form = el('form', 'fl-form');
  const labelInput = el('input', 'v-input fl-input');
  labelInput.placeholder = 'Library label';
  const type = el('select', 'v-input fl-input');
  [['user','User library'],['group','Group library']].forEach(([value,text]) => {
    const option = el('option', null, text); option.value = value; type.append(option);
  });
  const id = el('input', 'v-input fl-input'); id.placeholder = 'Zotero library ID';
  const key = el('input', 'v-input fl-input'); key.type = 'password'; key.placeholder = 'Zotero API key';
  const save = action('Connect Zotero', () => {}, true); save.type = 'submit';
  const note = el('p', 'v-note');
  const list = el('div', 'fl-stack');
  const reload = async () => {
    list.innerHTML = '';
    try {
      const data = await P.lmsZotero();
      for (const item of data.connections || []) {
        const remove = action('Disconnect', async () => {
          remove.disabled = true;
          try { await P.lmsDeleteZotero(item.id); await reload(); } catch { remove.disabled = false; }
        });
        remove.classList.add('ws-btn--tiny');
        list.append(row({ title: item.label, meta: P.meta([label(item.library_type), item.library_id]), badges: ['Connected'], actions: [remove] }));
      }
      if (!(data.connections || []).length) list.append(empty('No source manager connected', 'Connect Zotero to work with your own research library inside AI exercises.'));
    } catch (error) {
      list.append(el('p', 'fl-muted', error?.message || 'Source connections unavailable.'));
    }
  };
  form.append(labelInput, type, id, key, save, note);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    save.disabled = true; note.textContent = 'Checking Zotero…';
    try {
      await P.lmsConnectZotero({ label: labelInput.value.trim() || 'Zotero', library_type: type.value, library_id: id.value.trim(), api_key: key.value });
      key.value = ''; note.textContent = 'Connected.'; await reload();
    } catch (error) {
      note.textContent = error?.message || 'Connection failed.'; save.disabled = false;
    } finally {
      save.disabled = false;
    }
  });
  box.body.append(form, list);
  reload();
  return box.box;
}

export async function renderCourse(host, id, { go }) {
  loading(host, 'Course');
  try {
    const data = await P.lmsCourse(id);
    const course = data.course;
    if (course.enrolled) P.lmsCourseEvent(course.id, { kind: 'course.open' }).catch(() => {});
    const wrap = doc(host, course.title, course.summary || 'Gravitas+ course');
    const hero = el('div', 'fl-course-hero');
    const info = el('div');
    const tags = el('div', 'fl-badges');
    tags.append(badge(label(course.access_type)), badge(label(course.status)));
    if (course.provider === 'openedx') tags.append(badge('Open edX'));
    if (course.category?.name) tags.append(badge(course.category.name));
    (course.tags || []).forEach((item) => tags.append(badge(item.name)));
    if (course.certificate_enabled) tags.append(badge('Gravitas+ Certificate'));
    info.append(tags);
    if (course.instructors?.length) info.append(el('p', 'fl-muted', `Instructors · ${course.instructors.map((item) => item.name).join(', ')}`));
    if (course.description) info.append(el('p', 'fl-prose', course.description));
    if (course.enrolled) info.append(percent(course.progress_percent));
    hero.append(info);

    const actions = el('div', 'fl-course-hero__actions');
    if (!course.enrolled) {
      if (course.access_type === 'open') {
        const enroll = action('Enroll', async () => {
          enroll.disabled = true;
          enroll.textContent = 'Enrolling…';
          try {
            await P.lmsEnroll(course.id, {});
            await P.loadBootstrap();
            await renderCourse(host, id, { go });
          } catch (error) {
            enroll.disabled = false;
            enroll.textContent = error?.message || 'Try again';
          }
        }, true);
        actions.append(enroll);
      } else if (course.access_type === 'paid') {
        actions.append(badge(`${course.price || '—'} ${course.currency || 'EUR'}`));
        actions.append(el('p', 'fl-muted', course.payment?.enabled
          ? 'Payment is configured for this course.'
          : 'Payment-ready course. Checkout stays disabled until the payment provider is activated.'));
      } else {
        actions.append(el('p', 'fl-muted', 'This course is invite-only. A Core administrator can grant enrollment.'));
      }
    } else {
      actions.append(badge(label(course.enrollment_status), 'ok'));
      if (course.provider === 'openedx' && course.openedx_launch_url) {
        const openedx = el('a', 'ws-btn', 'Open learning engine');
        openedx.href = course.openedx_launch_url;
        openedx.target = '_blank';
        openedx.rel = 'noopener';
        actions.append(openedx);
      }
      if (course.certificate?.valid) actions.append(link(go, 'View certificate', '/workspace/learning/certificates'));
      for (const [fmt, title] of [['md','Markdown'],['tex','LaTeX'],['docx','DOCX']]) {
        const download = el('a', 'ws-btn ws-btn--tiny', title);
        download.href = `/api/lms/courses/${course.id}/export/${fmt}/`;
        download.download = '';
        actions.append(download);
      }
    }
    hero.append(actions);
    wrap.append(hero);

    let profile = null;
    if (course.enrolled && course.registration_schema?.length) {
      try { profile = await P.lmsRegistrationProfile(course.id); } catch {}
      const registration = courseRegistrationPanel(course, profile, host, go);
      if (registration) wrap.append(registration);
    }

    const curriculum = section('Curriculum');
    const modules = course.modules || [];
    if (!modules.length) curriculum.body.append(empty('No lessons published yet', course.provider === 'openedx' ? 'This course is delivered by Open edX. Use Open learning engine when it becomes available.' : 'The course structure has not been published.'));
    for (const module of modules) {
      const moduleBox = el('section', 'fl-module');
      moduleBox.append(el('h3', null, module.title));
      if (module.summary) moduleBox.append(el('p', 'fl-muted', module.summary));
      const lessons = el('div', 'fl-lessons');
      (module.lessons || []).forEach((lesson) => lessons.append(lessonCard(lesson, course, host, go)));
      moduleBox.append(lessons);
      curriculum.body.append(moduleBox);
    }
    wrap.append(curriculum.box);

    if ((course.assessments || []).length) {
      const assessments = el('div', 'fl-stack');
      (course.assessments || []).forEach((assessment) => assessments.append(assessmentCard(assessment, course, host, go)));
      wrap.append(assessments);
    }

    const assets = courseAssetsPanel(course);
    if (assets) wrap.append(assets);

    if (course.enrolled) {
      if (course.learning_config?.ai_enabled !== false) {
        const tutor = await courseTutorPanel(course);
        if (tutor) wrap.append(tutor);
      }
      if (course.learning_config?.zotero_enabled !== false) {
        wrap.append(zoteroConnectionPanel());
      }
    }

    if (course.certificate) {
      const cert = section('Gravitas+ Certificate');
      cert.body.append(row({
        title: course.certificate.valid ? 'Certificate issued' : 'Certificate revoked',
        meta: P.meta([course.certificate.code, date(course.certificate.issued_at)]),
      }));
      wrap.append(cert.box);
    }
  } catch (error) {
    errorView(host, 'Course', error, () => renderCourse(host, id, { go }));
  }
}
