import * as P from './ws-platform.js?v=20260919-advanced4';
import * as C from './ws-charts.js?v=20260919-charts2';

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

/* Title and note are one block inside the head, so an action button added
   later lands opposite the pair rather than between them. */
function section(title, note = '') {
  const box = el('section', 'fl-panel');
  const head = el('div', 'fl-panel__head');
  const heading = el('div');
  heading.append(el('h2', 'fl-panel__title', title));
  if (note) heading.append(el('p', 'fl-muted', note));
  head.append(heading);
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

/* ==========================================================================
   THE MEMBER DASHBOARD
   This is the first screen of the product, and for a reader who has not yet
   joined a project or enrolled in a course it is very nearly the only one.
   It used to be six numbers in boxes above three lists of sentences, which
   told a new member nothing they could not have guessed and gave a long-
   standing one no sense of where their account actually stood.

   It now leads with shape rather than prose: an arc gauge over everything
   that carries a real denominator, stat tiles whose meters show the
   finished part of each count, a ranked bar chart of the layers, and a
   seven-day column chart of recent events.

   Every figure still comes from /member/dashboard/. The charts changed how
   the payload is read, not what is in it, and the kit refuses to draw a
   proportion without a denominator — which is why research projects get a
   count and a status and never a bar. The project payload has no percentage
   in it, and a bar drawn from a status enum would be a false report on
   somebody's real work.
   ========================================================================== */

const count = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

/* One letter, from the name if there is one and the address if there is
   not. An avatar that says "?" is worse than an avatar that says nothing. */
function initial(member) {
  const source = (member?.name || member?.email || '').trim();
  return source ? source.charAt(0).toUpperCase() : '';
}

/* The picture from Settings when the account has one, the initial when it
   does not. The slot is the same size either way, so setting a picture does
   not shift the line it sits on. The image is decorative here — the name is
   right beside it — so its alt is empty rather than a repeat of the name. */
function avatarNode(member) {
  const slot = el('span', 'wc-ident__avatar');
  if (member?.avatar) {
    const img = el('img');
    img.src = member.avatar;
    img.alt = '';
    slot.append(img);
    slot.dataset.picture = 'true';
  } else {
    slot.textContent = initial(member);
  }
  return slot;
}

/* What the gauge is allowed to average over: the three things the payload
   counts completions for. Courses are counted as active plus completed
   rather than as every enrollment row, because a dropped enrollment is not
   unfinished work and counting it as such would drag the figure down
   forever. */
function trackedWork(data) {
  const paths = data.public_paths || {};
  const topics = data.topic_progress || {};
  const learning = data.learning || {};
  const courses = learning.access ? count(learning.active) + count(learning.completed) : 0;
  return {
    total: count(paths.total) + count(topics.total) + courses,
    done: count(paths.completed) + count(topics.completed) + (learning.access ? count(learning.completed) : 0),
  };
}

/* next_actions carries its progress inside a human string ("40% complete"),
   which is the right shape for the row's own subtitle and the wrong one for
   a ring. Pulling the number back out is only done where it is actually
   there; a row without one gets no ring rather than a ring at zero. */
function metaPercent(meta) {
  const found = /(\d+(?:\.\d+)?)\s*%/.exec(meta || '');
  return found ? Number(found[1]) : null;
}

const DAY = 86400000;

/* The last seven days of events, oldest first, from the activity feed.
   The feed is capped server-side at twelve events, so when it comes back
   full the week may be undercounted — the caller says which case it is in
   rather than presenting a possibly-short week as a complete one. */
function eventsByDay(activity = []) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = [];
  for (let back = 6; back >= 0; back -= 1) {
    const at = new Date(today.getTime() - back * DAY);
    days.push({
      label: at.toLocaleDateString('en-GB', { weekday: 'narrow' }),
      key: at.toDateString(),
      value: 0,
      series: '1',
    });
  }
  const index = new Map(days.map((day) => [day.key, day]));
  for (const item of activity) {
    if (!item.created_at) continue;
    const day = index.get(new Date(item.created_at).toDateString());
    if (day) day.value += 1;
  }
  return days;
}

const ACTIVITY_SERIES = { comment: '1', topic: '3', learning: '2', research: '4' };

function activityMix(activity = []) {
  const tally = new Map();
  for (const item of activity) {
    const kind = item.kind || 'other';
    tally.set(kind, (tally.get(kind) || 0) + 1);
  }
  return [...tally.entries()].map(([kind, value]) => ({
    label: label(kind), value, series: ACTIVITY_SERIES[kind] || '5',
  }));
}

/* The identity is a line under the page title, not a card of its own. As a
   card it was two hundred pixels of empty surface above an account that had
   nothing in it yet. */
function identity(member) {
  const strip = el('div', 'wc-ident');
  strip.append(avatarNode(member));
  const names = el('div');
  names.append(el('span', 'wc-ident__name', member.name));
  names.append(el('span', 'wc-ident__meta', P.meta([member.email, label(member.community_role), label(member.community_status)])));
  strip.append(names);
  return strip;
}

function memberTiles(data, go) {
  const library = data.library || {};
  const discussions = data.discussions || {};
  const topics = data.topic_progress || {};
  const learning = data.learning || {};
  const research = data.research || {};

  const tiles = [
    C.statTile({
      value: count(library.saved_count), label: 'Saved', icon: 'files', featured: true,
      note: count(library.following_count) ? `${count(library.following_count)} followed` : 'From the public site',
      onClick: () => go('/workspace/dashboard/library'),
    }),
    C.statTile({
      value: count(discussions.total), label: 'Discussions', icon: 'collaboration',
      part: count(discussions.published), total: count(discussions.total),
      note: 'On published material',
      onClick: () => go('/workspace/dashboard/discussions'),
    }),
    C.statTile({
      value: count(topics.total), label: 'Topics', icon: 'target',
      part: count(topics.completed), total: count(topics.total),
      note: 'Started',
      onClick: () => go('/workspace/dashboard/progress'),
    }),
  ];

  /* Six tiles is the ceiling the kit is laid out for, so public learning
     paths do not get one: the gauge already counts their completions and
     the bar chart carries the count. */
  if (learning.access) {
    tiles.push(C.statTile({
      value: count(learning.active), label: 'Courses', icon: 'content',
      note: count(learning.completed) ? `${count(learning.completed)} completed` : 'In progress',
      onClick: () => go('/workspace/learning'),
    }));
  }
  if (research.access) {
    tiles.push(C.statTile({
      value: count(research.projects), label: 'Projects', icon: 'projects',
      note: 'Owned or joined',
      onClick: () => go('/workspace/research'),
    }));
  }
  tiles.push(C.statTile({
    value: count(data.support?.open), label: 'Open tickets', icon: 'activity',
    note: count(data.support?.open) ? 'Waiting on a reply' : 'Nothing open',
    onClick: () => go('/workspace/dashboard/support'),
  }));

  /* Marked in series order so a layer keeps one colour across the tiles,
     the bar chart and the activity strip. Two charts that disagree about
     what blue means are worse than one chart. */
  tiles.forEach((tile, position) => {
    tile.dataset.series = String((position % 5) + 1);
    /* Two of twelve columns each, so six tiles fill a row and their edges
       land on the same gridlines the cards below them use. The tiles are
       returned loose rather than in a grid of their own: the dashboard is
       one grid, and a nested one would break that alignment. */
    tile.dataset.span = '2';
  });
  return tiles;
}

/* ---- The cards ---------------------------------------------------------- */

function rhythmCard(data, go) {
  const events = data.activity || [];
  /* The feed is capped server-side at twelve, so a full one may not cover
     the whole week. The note says which of the two readings this is rather
     than letting a truncated week pass as a quiet one. */
  const capped = events.length >= 12;
  const box = C.card({
    title: 'Activity',
    note: capped ? 'Your twelve most recent events, by day' : 'The last seven days',
    span: 8,
    action: linkButton(go, 'History', '/workspace/dashboard/progress'),
  });

  box.body.append(C.columns(eventsByDay(events), { scaffold: true }));
  if (events.length) {
    box.body.append(C.stackedMeter(activityMix(events)));
  } else {
    box.body.append(C.note('Nothing yet this week. Comments, topic progress and course activity land here as you go.'));
  }
  return box.box;
}

/* The one tinted card, because it is the only thing on the screen that is an
   instruction rather than a report. When there is nothing waiting it offers
   the three places the work actually starts, instead of a paragraph saying
   that there is nothing waiting. */
function nextCard(data, go) {
  const box = C.card({ title: 'Up next', note: 'Unfinished work across your layers', span: 4, tone: 'accent' });
  const items = data.next_actions || [];

  if (!items.length) {
    box.body.append(C.note('Nothing waiting. Pick something up:'));
    box.body.append(C.actions([
      action('Browse the library', () => go('/workspace/dashboard/library'), true),
      action('Topics', () => go('/workspace/dashboard/progress')),
      data.learning?.access ? action('Courses', () => go('/workspace/learning')) : null,
    ].filter(Boolean)));
    return box.box;
  }

  const rows = items.slice(0, 4).map((item) => {
    const share = metaPercent(item.meta);
    return C.listItem({
      title: item.title,
      meta: P.meta([label(item.kind), item.meta]),
      series: ACTIVITY_SERIES[item.kind] || '1',
      icon: NEXT_ICONS[item.kind] || 'target',
      right: share == null ? null : C.ring(share, { label: `${item.title}: ${item.meta}` }),
      onClick: () => go(item.href),
    });
  });
  box.body.append(C.list(rows));
  return box.box;
}

function layerCard(data, go) {
  const library = data.library || {};
  const learning = data.learning || {};
  const research = data.research || {};

  const rows = [
    { label: 'Saved', value: count(library.saved_count), series: '1', onClick: () => go('/workspace/dashboard/library') },
    { label: 'Following', value: count(library.following_count), series: '1', onClick: () => go('/workspace/dashboard/library') },
    { label: 'Discussions', value: count(data.discussions?.total), series: '2', onClick: () => go('/workspace/dashboard/discussions') },
    { label: 'Topics', value: count(data.topic_progress?.total), series: '3', onClick: () => go('/workspace/dashboard/progress') },
    { label: 'Paths', value: count(data.public_paths?.total), series: '3' },
  ];
  if (learning.access) {
    rows.push({ label: 'Courses', value: count(learning.active) + count(learning.completed), series: '4', onClick: () => go('/workspace/learning') });
  }
  if (research.access) {
    rows.push({ label: 'Projects', value: count(research.projects), series: '5', onClick: () => go('/workspace/research') });
  }

  const box = C.card({ title: 'Across your account', note: 'Items in the layers you can open', span: 4 });
  box.body.append(C.barRows(rows, { scaffold: true }));
  return box.box;
}

/* The gauge, with the three counts it averages listed beneath it. A single
   percentage with no breakdown is a number nobody can check. */
function completionCard(data) {
  const paths = data.public_paths || {};
  const topics = data.topic_progress || {};
  const learning = data.learning || {};
  const tracked = trackedWork(data);

  const box = C.card({ title: 'Completion', note: 'Topics, paths and courses', span: 4 });
  box.body.append(C.gauge({
    value: tracked.done,
    total: tracked.total,
    label: 'Finished',
    caption: `${tracked.done} of ${tracked.total} finished`,
    empty: 'Nothing tracked yet',
  }));

  const parts = [
    { label: 'Topics', value: count(topics.completed), series: '3' },
    { label: 'Paths', value: count(paths.completed), series: '1' },
  ];
  if (learning.access) parts.push({ label: 'Courses', value: count(learning.completed), series: '4' });
  box.body.append(C.legend(parts));
  return box.box;
}

function savedCard(data, go) {
  const items = data.library?.recent_saved || [];
  const box = C.card({
    title: 'Recently saved',
    note: 'Kept from the public site',
    span: 4,
    action: linkButton(go, 'Library', '/workspace/dashboard/library'),
  });

  if (!items.length) {
    box.body.append(C.note('Nothing saved yet. Use Save on any article, dossier or lab.'));
    return box.box;
  }
  box.body.append(C.list(items.slice(0, 4).map((item) => C.listItem({
    title: item.title,
    meta: P.meta([label(item.kind), date(item.saved_at)]),
    icon: SAVED_ICONS[item.kind] || 'notes',
    series: '1',
    onClick: item.url ? () => { window.location.href = item.url; } : null,
  }))));
  return box.box;
}

function activityCard(data, go) {
  const items = data.activity || [];
  const box = C.card({ title: 'Recent activity', note: 'Newest first', span: 8 });

  if (!items.length) {
    box.body.append(C.note('No activity yet. Comments, topic progress, learning and research activity appear here.'));
    return box.box;
  }
  box.body.append(C.list(items.slice(0, 4).map((item) => C.listItem({
    title: item.title,
    meta: P.meta([item.meta, date(item.created_at)]),
    icon: NEXT_ICONS[item.kind] || 'activity',
    series: ACTIVITY_SERIES[item.kind] || '1',
    onClick: item.href ? () => go(item.href) : null,
  }))));
  return box.box;
}

/* Published against pending, which is the whole of what the payload says
   about a member's comments and needs no second chart to say it. */
function discussionCard(data, go) {
  const talk = data.discussions || {};
  const box = C.card({
    title: 'Discussions',
    note: 'Published against pending review',
    span: 4,
    action: linkButton(go, 'All', '/workspace/dashboard/discussions'),
  });

  if (!count(talk.total)) {
    box.body.append(C.note('No comments yet. Discussion opens under every published topic.'));
    return box.box;
  }
  box.body.append(C.stackedMeter([
    { label: 'Published', value: count(talk.published), series: '2' },
    { label: 'Pending', value: count(talk.pending), series: '4' },
  ]));

  /* The three most recent comments under the split. The payload already
     carries them, and without them this card is one bar beside a list six
     rows tall, which is the shape that made the row look broken. */
  const recent = talk.recent || [];
  if (recent.length) {
    box.body.append(C.list(recent.slice(0, 3).map((item) => C.listItem({
      title: item.content_key.replace(/-/g, ' '),
      meta: P.meta([label(item.status), date(item.updated_at)]),
      series: item.status === 'published' ? '2' : '4',
      icon: 'collaboration',
      onClick: () => go('/workspace/dashboard/discussions'),
    }))));
  }
  return box.box;
}

const NEXT_ICONS = { path: 'planning', learning: 'content', research: 'projects', comment: 'collaboration', topic: 'target' };
const SAVED_ICONS = { article: 'notes', topic: 'target', lab: 'datasets', path: 'planning', dossier: 'files' };

function linkButton(go, text, href) {
  const button = action(text, () => go(href));
  button.classList.add('ws-btn--tiny');
  return button;
}

export async function renderMemberOverview(host, { go }) {
  loading(host, 'Dashboard');
  try {
    const data = await P.memberDashboard();
    const wrap = doc(host, 'Dashboard', 'One account view across reading, discussion, learning and research.');

    const head = wrap.querySelector('.fl-head');
    head?.append(identity(data.member));
    const tools = el('div', 'fl-form-actions');
    tools.append(link(go, 'Open library', '/workspace/dashboard/library'));
    tools.append(link(go, 'Progress', '/workspace/dashboard/progress', true));
    head?.append(tools);

    /* One grid for the whole screen. The spans read 2·6 / 8·4 / 4·4·4 /
       8·4, so every card edge falls on the gridline at 4 or 8 and the
       columns run straight down the page. */
    wrap.append(C.bento([
      ...memberTiles(data, go),
      rhythmCard(data, go), nextCard(data, go),
      layerCard(data, go), completionCard(data), savedCard(data, go),
      activityCard(data, go), discussionCard(data, go),
    ]));
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
    const [mine, catalog, publishedPaths, personalPaths] = await Promise.all([
      P.lmsMe(),
      P.lmsCourses(),
      P.lmsLearningPaths().catch(() => ({ paths: [] })),
      P.lmsPersonalizedPaths().catch(() => ({ assignments: [] })),
    ]);
    const wrap = doc(host, 'Learning', 'Courses, research-goal learning paths, assessments and certificates. Learning access is independent from Research.');
    const active = (mine.enrollments || []).filter((item) => item.status === 'active' || item.status === 'paused');
    const completed = (mine.enrollments || []).filter((item) => item.status === 'completed');
    const certs = completed.filter((item) => item.certificate?.valid);
    const activePath = (personalPaths.assignments || [])[0] || null;
    const metrics = el('div', 'fl-metrics');
    metrics.append(
      metric(active.length, 'In progress'),
      metric(completed.length, 'Completed'),
      metric(certs.length, 'Certificates'),
      metric((publishedPaths.paths || []).length, 'Learning paths'),
    );
    wrap.append(metrics);

    const current = section('Continue learning');
    if (!active.length) current.body.append(empty('Nothing in progress', 'Choose a published course or start a learning path.'));
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

    if (activePath) {
      const pathBox = section(
        'Your active learning path',
        activePath.learning_path_title
          ? 'Following published path · ' + activePath.learning_path_title
          : 'Personalized around your research goal.',
      );
      if (activePath.goal) pathBox.body.append(el('p', 'fl-prose', activePath.goal));
      if (activePath.rationale) pathBox.body.append(el('p', 'fl-muted', activePath.rationale));
      const pathNodes = el('div', 'fl-learning-path');
      const courseProgress = new Map((mine.enrollments || []).map((item) => [String(item.course_id), item]));
      for (const node of activePath.nodes || []) {
        const nodeType = node.type || (node.course_id ? 'course' : 'milestone');
        const enrollment = node.course_id ? courseProgress.get(String(node.course_id)) : null;
        const badges = [
          label(nodeType),
          enrollment ? label(enrollment.status) : '',
          enrollment ? enrollment.progress_percent + '% complete' : '',
        ].filter(Boolean);
        pathNodes.append(row({
          title: node.title || (node.course_id ? 'Course ' + node.course_id : node.id),
          body: node.description || '',
          badges,
          onClick: node.course_id ? () => go('/workspace/learning/courses/' + node.course_id) : null,
        }));
      }
      if (!(activePath.nodes || []).length) pathNodes.append(empty('Path has no nodes', 'Ask the course team to review this learning path.'));
      pathBox.body.append(pathNodes);
      wrap.append(pathBox.box);
    }

    const pathsBox = section('Published learning paths', 'Start a curated multi-course path with gates, milestones and branches defined by the course team.');
    for (const path of publishedPaths.paths || []) {
      const startPath = action('Start path', async () => {
        startPath.disabled = true;
        startPath.textContent = 'Starting…';
        try {
          await P.lmsPersonalizePath({
            goal: path.title,
            learning_path_id: path.id,
            use_template: true,
          });
          await renderLearningOverview(host, { go });
        } catch (error) {
          startPath.disabled = false;
          startPath.textContent = error?.message || 'Try again';
        }
      }, true);
      pathsBox.body.append(row({
        title: path.title,
        body: path.summary || '',
        badges: [
          (path.nodes || []).length + ' nodes',
          (path.edges || []).length + ' connections',
        ],
        actions: [startPath],
      }));
    }
    if (!(publishedPaths.paths || []).length) {
      pathsBox.body.append(empty('No published paths yet', 'The course team can publish complex multi-course paths from LMS Admin.'));
    }
    wrap.append(pathsBox.box);

    const discover = section('Catalog');
    for (const course of (catalog.courses || []).slice(0, 6)) discover.body.append(courseRow(course, go));
    if (!(catalog.courses || []).length) discover.body.append(empty('No published courses', 'Published courses will appear here.'));
    discover.head.append(link(go, 'View catalog', '/workspace/learning/catalog'));
    wrap.append(discover.box);

    wrap.append(personalizedPathPanel(go));
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
      const certificateActions = el('div', 'fl-form-actions');
      certificateActions.append(link(go, 'Open course', `/workspace/learning/courses/${item.course_id}`));
      if (item.certificate.download_url) {
        const download = el('a', 'ws-btn ws-btn--tiny', 'Download certificate');
        download.href = item.certificate.download_url;
        download.download = '';
        certificateActions.append(download);
      }
      card.append(certificateActions);
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
  const box = section('Course files & embeds', 'Current course media is organized in folders; file revisions are preserved by the course team.');
  const items = [...course.assets].sort((a, b) => {
    const folderCompare = String(a.folder_path || '').localeCompare(String(b.folder_path || ''));
    return folderCompare || String(a.title || '').localeCompare(String(b.title || ''));
  });
  let activeFolder = null;
  let folderHost = null;
  for (const item of items) {
    const folder = item.folder_path || '';
    if (folder !== activeFolder) {
      activeFolder = folder;
      const group = el('section', 'fl-stack');
      group.append(el('h3', null, folder || 'Root'));
      folderHost = el('div', 'fl-stack');
      group.append(folderHost);
      box.body.append(group);
    }
    const tools = [];
    const href = item.kind === 'file' ? item.download_url : item.source_url;
    if (href) {
      const open = el('a', 'ws-btn ws-btn--tiny', item.kind === 'file' ? 'Download' : 'Open');
      open.href = href;
      open.target = item.kind === 'file' ? '_self' : '_blank';
      if (item.kind !== 'file') open.rel = 'noopener';
      tools.push(open);
    }
    folderHost.append(row({
      title: item.title,
      meta: P.meta([
        label(item.kind),
        item.version ? 'v' + item.version : '',
        item.size ? P.formatBytes(item.size) : '',
        item.mime_type || '',
      ]),
      body: item.version_note || '',
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


let pyodideRuntimePromise = null;

function loadBrowserPython() {
  if (window.loadPyodide) {
    if (!pyodideRuntimePromise) pyodideRuntimePromise = window.loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/' });
    return pyodideRuntimePromise;
  }
  if (pyodideRuntimePromise) return pyodideRuntimePromise;
  pyodideRuntimePromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js';
    script.async = true;
    script.onload = () => {
      window.loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/' }).then(resolve, reject);
    };
    script.onerror = () => reject(new Error('Python runtime could not be loaded.'));
    document.head.append(script);
  });
  return pyodideRuntimePromise;
}

function learningIntegrationsPanel() {
  const box = section('Connected learning tools', 'Connect GitHub, LinkedIn, ORCID, or an existing Medium integration token. Tokens are encrypted server-side and are never returned.');
  const status = el('p', 'fl-muted');
  const list = el('div', 'fl-stack');
  const form = el('form', 'fl-form');
  const provider = el('select', 'v-input fl-input');
  for (const [value, labelText] of [['github','GitHub'],['linkedin','LinkedIn'],['orcid','ORCID'],['medium','Medium (legacy API)']]) {
    const option = el('option', null, labelText); option.value = value; provider.append(option);
  }
  const account = el('input', 'v-input fl-input');
  account.placeholder = 'Account ID / author URN / ORCID';
  const token = el('input', 'v-input fl-input');
  token.type = 'password';
  token.placeholder = 'Access token (not needed for ORCID)';
  const save = action('Connect', () => {}, true); save.type = 'submit';
  form.append(provider, account, token, save, status);

  const reload = async () => {
    list.innerHTML = '';
    try {
      const data = await P.lmsIntegrations();
      for (const item of data.integrations || []) {
        const remove = action('Disconnect', async () => {
          remove.disabled = true;
          try { await P.lmsDeleteIntegration(item.provider); await reload(); } catch { remove.disabled = false; }
        });
        const node = row({
          title: item.label || label(item.provider),
          meta: P.meta([label(item.provider), item.account_id || '', item.has_token ? 'Token stored' : '']),
          actions: [remove],
        });
        list.append(node);
      }
      if (!(data.integrations || []).length) list.append(empty('No external learning tools connected', 'Connect a tool only when a course workflow needs it.'));
    } catch (error) {
      list.append(empty('Connections unavailable', error?.message || 'Try again.'));
    }
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    save.disabled = true;
    status.textContent = 'Connecting…';
    const body = {
      provider: provider.value,
      account_id: account.value.trim(),
      token: token.value,
      validate: provider.value !== 'linkedin',
    };
    try {
      const result = await P.lmsSaveIntegration(body);
      status.textContent = 'Connected.';
      status.dataset.tone = 'ok';
      account.value = result.integration?.account_id || account.value;
      token.value = '';
      await reload();
    } catch (error) {
      status.textContent = error?.message || 'Connection failed.';
      status.dataset.tone = 'bad';
    } finally {
      save.disabled = false;
    }
  });

  box.body.append(form, list);
  reload();
  return box.box;
}

function courseDiscussionPanel(course) {
  const box = section('Course group', 'A course-scoped chat for enrolled learners and instructors, with replies, editing and lightweight live refresh.');
  const list = el('div', 'fl-course-chat');
  const form = el('form', 'fl-course-chat__composer');
  const composer = el('div', 'fl-stack');
  const replyState = el('div', 'fl-muted');
  replyState.hidden = true;
  const input = el('textarea', 'v-input fl-input fl-textarea');
  input.rows = 2;
  input.placeholder = 'Message the course group…';
  const send = action('Send', () => {}, true); send.type = 'submit';
  let replyToId = null;
  let replyToLabel = '';

  const clearReply = () => {
    replyToId = null;
    replyToLabel = '';
    replyState.hidden = true;
    replyState.innerHTML = '';
  };

  const setReply = (item) => {
    replyToId = item.id;
    replyToLabel = item.author?.name || 'message';
    replyState.innerHTML = '';
    replyState.hidden = false;
    replyState.append(
      document.createTextNode('Replying to ' + replyToLabel + ' · '),
      action('Cancel', clearReply, false, true),
    );
    input.focus();
  };

  composer.append(replyState, input);
  form.append(composer, send);

  let loadingOnce = false;
  const reload = async ({ quiet = false } = {}) => {
    if (!quiet && !loadingOnce) list.innerHTML = '<div class="fl-skeleton"></div>';
    try {
      const data = await P.lmsCourseDiscussion(course.id);
      const wasNearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
      list.innerHTML = '';
      const viewerId = P.platform?.user?.user?.id;
      for (const item of data.messages || []) {
        const message = el('article', 'fl-course-chat__message');
        const mine = viewerId && String(item.author?.id) === String(viewerId);
        if (mine) message.dataset.mine = 'true';
        const head = el('div', 'fl-course-chat__meta');
        head.append(
          el('strong', null, item.author?.name || 'Learner'),
          el('span', 'fl-muted', new Date(item.created_at).toLocaleString()),
        );
        if (item.reply_to_id) head.append(badge('Reply'));
        const body = el('div', 'fl-course-chat__body', item.deleted ? 'Message deleted.' : item.body);
        const tools = el('div', 'fl-form-actions');
        if (!item.deleted) {
          tools.append(action('Reply', () => setReply(item), false, true));
          if (mine) {
            tools.append(action('Edit', async () => {
              const nextBody = prompt('Edit message:', item.body);
              if (nextBody == null || !nextBody.trim()) return;
              try {
                await P.lmsEditCourseDiscussion(course.id, item.id, { body: nextBody.trim() });
                await reload({ quiet: true });
              } catch (error) {
                alert(error?.message || 'Message could not be edited.');
              }
            }, false, true));
            tools.append(action('Delete', async () => {
              if (!confirm('Delete this message?')) return;
              try {
                await P.lmsDeleteCourseDiscussion(course.id, item.id);
                await reload({ quiet: true });
              } catch (error) {
                alert(error?.message || 'Message could not be deleted.');
              }
            }, false, true));
          }
        }
        message.append(head, body);
        if (tools.children.length) message.append(tools);
        list.append(message);
      }
      if (!(data.messages || []).length) list.append(empty('No messages yet', 'Start the course discussion.'));
      if (!loadingOnce || wasNearBottom) list.scrollTop = list.scrollHeight;
      loadingOnce = true;
    } catch (error) {
      if (!quiet) {
        list.innerHTML = '';
        list.append(empty('Discussion unavailable', error?.message || 'Try again.'));
      }
    }
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = input.value.trim();
    if (!body) return;
    send.disabled = true;
    try {
      await P.lmsPostCourseDiscussion(course.id, {
        body,
        reply_to_id: replyToId,
      });
      input.value = '';
      clearReply();
      await reload({ quiet: true });
    } catch (error) {
      alert(error?.message || 'Message could not be sent.');
    } finally {
      send.disabled = false;
    }
  });

  box.body.append(list, form);
  reload();
  const timer = window.setInterval(() => {
    if (!box.box.isConnected) {
      window.clearInterval(timer);
      return;
    }
    reload({ quiet: true });
  }, 15000);
  return box.box;
}

function literaturePanel(course) {
  const box = section('Related papers', 'Search arXiv, INSPIRE, Semantic Scholar and your connected ORCID works from the selected lesson context.');
  const form = el('form', 'fl-form');
  const lesson = el('select', 'v-input fl-input');
  const whole = el('option', null, 'Whole course');
  whole.value = '';
  lesson.append(whole);
  for (const module of course.modules || []) {
    for (const item of module.lessons || []) {
      const option = el('option', null, module.title + ' · ' + item.title);
      option.value = item.id;
      lesson.append(option);
    }
  }
  const q = el('input', 'v-input fl-input');
  q.type = 'search';
  q.placeholder = 'Optional research topic; leave blank to use lesson context';
  const search = action('Find papers', () => {}, true); search.type = 'submit';
  const list = el('div', 'fl-stack');
  const controls = el('div', 'fl-form-grid');
  controls.append(lesson, q);
  form.append(controls, search);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    search.disabled = true;
    list.innerHTML = '<div class="fl-skeleton"></div>';
    try {
      const data = await P.lmsLiterature(course.id, {
        q: q.value.trim(),
        lessonId: lesson.value,
        limit: 6,
      });
      list.innerHTML = '';
      for (const paper of data.papers || []) {
        const open = paper.url ? el('a', 'ws-btn ws-btn--tiny', 'Open') : null;
        if (open) { open.href = paper.url; open.target = '_blank'; open.rel = 'noopener'; }
        list.append(row({
          title: paper.title,
          meta: P.meta([label(paper.provider), paper.year, (paper.authors || []).slice(0, 3).join(', ')]),
          body: paper.abstract,
          actions: [open].filter(Boolean),
        }));
      }
      if (!(data.papers || []).length) list.append(empty('No papers found', 'Try a broader research query.'));
    } catch (error) {
      list.innerHTML = '';
      list.append(empty('Paper search unavailable', error?.message || 'Try again.'));
    } finally {
      search.disabled = false;
    }
  });
  box.body.append(form, list);
  return box.box;
}

function notebookPanel(course) {
  const box = section('Reproducible notebook', 'Save a course notebook, run Python in the browser, export .ipynb, or open an external Jupyter/Mathematica runner when configured.');
  const list = el('div', 'fl-stack');
  const editor = el('div', 'fl-form');
  const title = el('input', 'v-input fl-input'); title.placeholder = 'Notebook title';
  const runtime = el('select', 'v-input fl-input');
  for (const value of ['python','jupyter','mathematica']) {
    const option = el('option', null, label(value)); option.value = value; runtime.append(option);
  }
  runtime.value = course.learning_config?.notebook_runtime || 'python';
  const code = el('textarea', 'v-input fl-input fl-textarea');
  code.rows = 12;
  code.spellcheck = false;
  code.placeholder = '# Python / notebook code';
  const output = el('pre', 'fl-code');
  output.textContent = '';
  const controls = el('div', 'fl-form-actions');
  const save = action('Save notebook', () => {}, true);
  const run = action('Run ' + label(runtime.value), () => {});
  runtime.addEventListener('change', () => { run.textContent = 'Run ' + label(runtime.value); });
  controls.append(save, run);
  editor.append(title, runtime, code, controls, output);

  let currentId = null;
  const refresh = async () => {
    list.innerHTML = '';
    try {
      const data = await P.lmsNotebooks(course.id);
      for (const item of data.notebooks || []) {
        const open = action('Edit', () => {
          currentId = item.id;
          title.value = item.title;
          runtime.value = item.runtime;
          code.value = item.code || '';
          output.textContent = '';
        });
        const download = el('a', 'ws-btn ws-btn--tiny', '.ipynb');
        download.href = '/api/lms/notebooks/' + item.id + '/export/';
        download.download = '';
        const external = [];
        if (item.jupyter_url) {
          const a = el('a', 'ws-btn ws-btn--tiny', 'Open Jupyter'); a.href = item.jupyter_url; a.target = '_blank'; a.rel = 'noopener'; external.push(a);
        }
        if (item.mathematica_url) {
          const a = el('a', 'ws-btn ws-btn--tiny', 'Open Mathematica'); a.href = item.mathematica_url; a.target = '_blank'; a.rel = 'noopener'; external.push(a);
        }
        list.append(row({
          title: item.title,
          meta: P.meta([label(item.runtime), 'revision ' + item.revision]),
          badges: (item.environment?.packages || []).slice(0, 4),
          actions: [open, download, ...external],
        }));
      }
      if (!(data.notebooks || []).length) list.append(empty('No notebook yet', 'Create one below. Python can run locally in the browser.'));
    } catch (error) {
      list.append(empty('Notebooks unavailable', error?.message || 'Try again.'));
    }
  };

  save.addEventListener('click', async () => {
    save.disabled = true;
    const packages = Array.isArray(course.learning_config?.notebook_packages) ? course.learning_config.notebook_packages : [];
    try {
      const result = await P.lmsSaveNotebook(course.id, {
        id: currentId,
        title: title.value.trim() || course.title + ' notebook',
        runtime: runtime.value,
        code: code.value,
        environment: { packages, course_id: course.id },
      });
      currentId = result.notebook.id;
      output.textContent = 'Saved revision ' + result.notebook.revision + '.';
      await refresh();
    } catch (error) {
      output.textContent = error?.message || 'Save failed.';
    } finally {
      save.disabled = false;
    }
  });

  run.addEventListener('click', async () => {
    run.disabled = true;
    const packages = Array.isArray(course.learning_config?.notebook_packages) ? course.learning_config.notebook_packages : [];
    try {
      if (runtime.value !== 'python') {
        output.textContent = 'Saving reproducible environment…';
        const saved = await P.lmsSaveNotebook(course.id, {
          id: currentId,
          title: title.value.trim() || course.title + ' notebook',
          runtime: runtime.value,
          code: code.value,
          environment: { packages, course_id: course.id },
        });
        currentId = saved.notebook.id;
        output.textContent = 'Running ' + label(runtime.value) + '…';
        const executed = await P.lmsExecuteNotebook(currentId);
        const parts = [];
        if (executed.output) parts.push(executed.output);
        if (executed.result != null) {
          parts.push(typeof executed.result === 'string' ? executed.result : JSON.stringify(executed.result, null, 2));
        }
        if (executed.artifacts?.length) {
          parts.push('Artifacts:\n' + executed.artifacts.map((item) => typeof item === 'string' ? item : JSON.stringify(item)).join('\n'));
        }
        output.textContent = parts.join('\n\n') || 'Execution completed.';
        await refresh();
        return;
      }

      output.textContent = 'Loading Python runtime…';
      const pyodide = await loadBrowserPython();
      if (packages.length) {
        try {
          await pyodide.loadPackage('micropip');
          const micropip = pyodide.pyimport('micropip');
          await micropip.install(packages);
          micropip.destroy?.();
        } catch (error) {
          output.textContent = 'Environment setup failed: ' + (error?.message || 'package install error');
          return;
        }
      }
      let stdout = '';
      if (pyodide.setStdout) pyodide.setStdout({ batched: (text) => { stdout += text + '\n'; } });
      const value = await pyodide.runPythonAsync(code.value || '');
      output.textContent = stdout + (value == null ? '' : String(value));
    } catch (error) {
      output.textContent = error?.message === 'notebook_runner_not_configured'
        ? label(runtime.value) + ' runner is not configured on this deployment.'
        : (error?.message || 'Notebook execution failed.');
    } finally {
      run.disabled = false;
    }
  });

  box.body.append(list, editor);
  refresh();
  return box.box;
}

function gitPanel(course) {
  const box = section('Versioning · GitHub', 'Push exercise or notebook work to a repository for instructor review. Each new push returns the review state to Pending.');
  const list = el('div', 'fl-stack');
  const form = el('form', 'fl-form');
  const repo = el('input', 'v-input fl-input'); repo.placeholder = 'owner/repository';
  const path = el('input', 'v-input fl-input'); path.placeholder = 'course/exercise.py';
  const branch = el('input', 'v-input fl-input'); branch.placeholder = 'main'; branch.value = 'main';
  const content = el('textarea', 'v-input fl-input fl-textarea'); content.rows = 8; content.placeholder = 'Exercise / notebook source';
  const message = el('input', 'v-input fl-input'); message.placeholder = 'Commit message';
  const push = action('Push to GitHub', () => {}, true); push.type = 'submit';
  const state = el('p', 'fl-muted');
  form.append(repo, path, branch, content, message, push, state);

  const reload = async () => {
    list.innerHTML = '';
    try {
      const data = await P.lmsGit(course.id);
      for (const item of data.repositories || []) {
        const open = el('a', 'ws-btn ws-btn--tiny', 'Open repository');
        open.href = item.html_url || ('https://github.com/' + item.owner + '/' + item.repository);
        open.target = '_blank';
        open.rel = 'noopener';
        const actions = [open];
        if (item.review_status === 'approved' && course.learning_config?.social_publish_enabled !== false) {
          for (const provider of ['linkedin', 'medium']) {
            const publish = action('Publish to ' + label(provider), async () => {
              const draft = 'I completed an approved Gravitas+ exercise in “' + course.title + '”. Repository: ' + (item.html_url || (item.owner + '/' + item.repository));
              const text = prompt('Post text:', draft);
              if (text == null || !text.trim()) return;
              publish.disabled = true;
              try {
                const result = await P.lmsPublishAchievement(course.id, {
                  provider,
                  title: course.title + ' · approved exercise',
                  text: text.trim(),
                });
                alert(result.url ? 'Published: ' + result.url : 'Published successfully.');
              } catch (error) {
                alert(error?.message || 'Publishing failed.');
              } finally {
                publish.disabled = false;
              }
            }, false, true);
            actions.push(publish);
          }
        }
        list.append(row({
          title: item.owner + '/' + item.repository,
          meta: P.meta([item.branch, item.last_commit_sha ? item.last_commit_sha.slice(0, 10) : '']),
          body: item.review_note || '',
          badges: [label(item.review_status || 'pending'), item.reviewed_by ? 'Reviewed by ' + item.reviewed_by : ''],
          actions,
        }));
      }
      if (!(data.repositories || []).length) list.append(empty('No repository linked yet', 'Push an exercise below; it will appear in the instructor review queue.'));
    } catch (error) {
      list.append(empty('Repository status unavailable', error?.message || 'Try again.'));
    }
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const [owner, repository] = repo.value.trim().split('/', 2);
    if (!owner || !repository || !path.value.trim()) {
      state.textContent = 'Use owner/repository and a file path.';
      state.dataset.tone = 'bad';
      return;
    }
    push.disabled = true;
    state.textContent = 'Pushing…';
    try {
      const result = await P.lmsGitPush(course.id, {
        owner, repository,
        branch: branch.value.trim() || 'main',
        path: path.value.trim(),
        content: content.value,
        message: message.value.trim() || 'Update Gravitas exercise',
      });
      state.textContent = 'Pushed · ' + (result.repository?.last_commit_sha || '').slice(0, 10) + ' · pending review';
      state.dataset.tone = 'ok';
      await reload();
    } catch (error) {
      state.textContent = error?.message || 'Git push failed.';
      state.dataset.tone = 'bad';
    } finally {
      push.disabled = false;
    }
  });
  box.body.append(list, form);
  reload();
  return box.box;
}

function publishingPanel(course) {
  const box = section('Publish an achievement', 'Publish strong course work directly to a connected LinkedIn account or an existing Medium integration.');
  const form = el('form', 'fl-form');
  const provider = el('select', 'v-input fl-input');
  for (const value of ['linkedin','medium']) {
    const option = el('option', null, label(value)); option.value = value; provider.append(option);
  }
  const title = el('input', 'v-input fl-input'); title.placeholder = 'Post title';
  const text = el('textarea', 'v-input fl-input fl-textarea'); text.rows = 6; text.placeholder = 'What did you learn or produce?';
  const publish = action('Publish', () => {}, true); publish.type = 'submit';
  const state = el('p', 'fl-muted');
  form.append(provider, title, text, publish, state);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    publish.disabled = true;
    state.textContent = 'Publishing…';
    try {
      const result = await P.lmsPublishAchievement(course.id, {
        provider: provider.value,
        title: title.value.trim() || course.title,
        text: text.value.trim(),
      });
      state.textContent = result.url ? 'Published · ' + result.url : 'Published.';
      state.dataset.tone = 'ok';
    } catch (error) {
      state.textContent = error?.message || 'Publish failed.';
      state.dataset.tone = 'bad';
    } finally {
      publish.disabled = false;
    }
  });
  box.body.append(form);
  return box.box;
}

function pkmExportPanel(course) {
  const box = section('Export to PKM', 'Package the course into common personal knowledge management formats.');
  const actions = el('div', 'fl-form-actions');
  for (const [target, title] of [['obsidian','Obsidian'],['logseq','Logseq'],['notion','Notion Markdown'],['roam','Roam JSON']]) {
    const download = el('a', 'ws-btn ws-btn--tiny', title);
    download.href = '/api/lms/courses/' + course.id + '/pkm/' + target + '/';
    download.download = '';
    actions.append(download);
  }
  box.body.append(actions);
  return box.box;
}

function personalizedPathPanel(go) {
  const box = section('Personal learning path', 'Describe a research goal and Gravitas+ builds an ordered multi-course route from the published catalog.');
  const form = el('form', 'fl-form');
  const goal = el('textarea', 'v-input fl-input fl-textarea'); goal.rows = 4; goal.placeholder = 'Example: I want to learn how to design and validate a reproducible causal-inference study.';
  const build = action('Build my path', () => {}, true); build.type = 'submit';
  const result = el('div', 'fl-stack');
  form.append(goal, build);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!goal.value.trim()) return;
    build.disabled = true;
    result.innerHTML = '<div class="fl-skeleton"></div>';
    try {
      const data = await P.lmsPersonalizePath({ goal: goal.value.trim() });
      result.innerHTML = '';
      if (data.assignment?.rationale) result.append(el('p', 'fl-muted', data.assignment.rationale));
      for (const node of data.assignment?.nodes || []) {
        result.append(row({
          title: node.title || ('Course ' + node.course_id),
          badges: ['Course'],
          onClick: () => go('/workspace/learning/courses/' + node.course_id),
        }));
      }
    } catch (error) {
      result.innerHTML = '';
      result.append(empty('Path could not be built', error?.message || 'Try again.'));
    } finally {
      build.disabled = false;
    }
  });
  box.body.append(form, result);
  return box.box;
}

function offlineCourseKey(id) {
  const userId = P.platform?.user?.user?.id || 'current';
  return 'gravitas.lms.offline.' + userId + '.' + id;
}

function openOfflineCourseDb() {
  if (!('indexedDB' in window)) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('gravitas-lms-offline-v1', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('courses')) db.createObjectStore('courses');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('offline_db_unavailable'));
  });
}

async function saveOfflineCourseSnapshot(data) {
  const snapshot = {
    saved_at: new Date().toISOString(),
    data,
  };
  try {
    const db = await openOfflineCourseDb();
    if (db) {
      await new Promise((resolve, reject) => {
        const tx = db.transaction('courses', 'readwrite');
        tx.objectStore('courses').put(snapshot, offlineCourseKey(data.course.id));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('offline_save_failed'));
      });
      db.close();
      return true;
    }
  } catch {}
  try {
    localStorage.setItem(offlineCourseKey(data.course.id), JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

async function loadOfflineCourseSnapshot(id) {
  try {
    const db = await openOfflineCourseDb();
    if (db) {
      const stored = await new Promise((resolve, reject) => {
        const tx = db.transaction('courses', 'readonly');
        const request = tx.objectStore('courses').get(offlineCourseKey(id));
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error('offline_read_failed'));
      });
      db.close();
      if (stored?.data?.course) return stored;
    }
  } catch {}
  try {
    const stored = JSON.parse(localStorage.getItem(offlineCourseKey(id)) || 'null');
    return stored?.data?.course ? stored : null;
  } catch {
    return null;
  }
}

export async function renderCourse(host, id, { go }) {
  loading(host, 'Course');
  try {
    let data;
    let offlineSnapshot = null;
    try {
      data = await P.lmsCourse(id);
    } catch (networkError) {
      offlineSnapshot = await loadOfflineCourseSnapshot(id);
      if (!offlineSnapshot) throw networkError;
      data = offlineSnapshot.data;
    }
    const course = data.course;
    if (!offlineSnapshot && course.enrolled) P.lmsCourseEvent(course.id, { kind: 'course.open' }).catch(() => {});
    const wrap = doc(host, course.title, course.summary || 'Gravitas+ course');
    if (offlineSnapshot) {
      const offline = el('div', 'ws-alert');
      offline.append(
        el('strong', 'ws-alert__title', 'Offline read mode'),
        el('p', '', 'Showing the course snapshot saved ' + new Date(offlineSnapshot.saved_at).toLocaleString() + '. Progress updates, AI, Lab, discussions and external tools need a connection.'),
      );
      wrap.append(offline);
    }
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
        actions.append(badge((course.price || '—') + ' ' + (course.currency || 'EUR')));
        const paymentState = el('p', 'fl-muted');
        if (course.payment?.enabled && course.payment?.checkout_url) {
          const checkout = action('Continue to checkout', async () => {
            checkout.disabled = true;
            checkout.textContent = 'Preparing checkout…';
            try {
              const result = await P.lmsStartCheckout(course.id);
              const url = result.payment?.checkout_url;
              paymentState.textContent = result.payment
                ? 'Payment status · ' + label(result.payment.status)
                : '';
              if (url) window.open(url, '_blank', 'noopener');
              checkout.textContent = 'Open checkout';
            } catch (error) {
              paymentState.textContent = error?.message || 'Checkout could not be prepared.';
              paymentState.dataset.tone = 'bad';
              checkout.textContent = 'Continue to checkout';
            } finally {
              checkout.disabled = false;
            }
          }, true);
          actions.append(checkout, paymentState);
          P.lmsCheckout(course.id).then((result) => {
            const latest = (result.payments || [])[0];
            paymentState.textContent = latest
              ? 'Payment status · ' + label(latest.status) + (latest.external_reference ? ' · ' + latest.external_reference : '')
              : 'Access activates after payment is verified.';
          }).catch(() => {
            paymentState.textContent = 'Access activates after payment is verified.';
          });
        } else {
          paymentState.textContent = course.payment?.enabled
            ? 'Payment is configured, but the checkout URL is not available yet.'
            : 'Checkout is not enabled for this course.';
          actions.append(paymentState);
        }
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
      if (!offlineSnapshot && course.learning_config?.offline_enabled !== false) {
        const saveOffline = action('Save offline', async () => {
          saveOffline.disabled = true;
          saveOffline.textContent = 'Saving…';
          const ok = await saveOfflineCourseSnapshot(data);
          saveOffline.textContent = ok ? 'Saved offline' : 'Offline save failed';
          saveOffline.disabled = false;
        });
        actions.append(saveOffline);
      }
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

    if (course.enrolled && !offlineSnapshot) {
      if (course.learning_config?.ai_enabled !== false) {
        const tutor = await courseTutorPanel(course);
        if (tutor) wrap.append(tutor);
      }
      if (course.learning_config?.zotero_enabled !== false) {
        wrap.append(zoteroConnectionPanel());
      }
      wrap.append(learningIntegrationsPanel());
      if (course.learning_config?.discussions_enabled !== false) {
        wrap.append(courseDiscussionPanel(course));
      }
      if (course.learning_config?.literature_enabled !== false) {
        wrap.append(literaturePanel(course));
      }
      if (course.learning_config?.notebook_enabled !== false) {
        wrap.append(notebookPanel(course));
      }
      if (course.learning_config?.git_enabled !== false) {
        wrap.append(gitPanel(course));
      }
      if (course.learning_config?.social_publish_enabled !== false) {
        wrap.append(publishingPanel(course));
      }
      if (course.learning_config?.pkm_enabled !== false) {
        wrap.append(pkmExportPanel(course));
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
