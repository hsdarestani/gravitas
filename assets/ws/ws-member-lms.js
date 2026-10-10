import * as P from './ws-platform.js?v=20261008-operational2';
import * as C from './ws-charts.js?v=20261008-operational2';
import { courseCover } from './ws-course-cover.js?v=20261008-operational2';
import { dateTimeField } from './ws-datetime.js?v=20261008-operational2';

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

/* A number. With `onClick` it is a button that opens what it counts; that
   used to be wired on afterwards by ws-actionable-ui.js matching labels. */
function metric(value, title, note = '', onClick = null) {
  const node = el(onClick ? 'button' : 'div', `fl-metric wc-tile${onClick ? ' wc-tile--button' : ''}`);
  if (onClick) {
    node.type = 'button';
    node.addEventListener('click', onClick);
  }
  const head = el('div', 'wc-tile__head');
  head.append(el('span', 'fl-metric__title wc-tile__label', title));
  node.append(head);
  node.append(el('strong', 'fl-metric__value wc-tile__value', String(value ?? 0)));
  if (note) node.append(el('small', 'fl-muted wc-tile__note', note));
  return node;
}

/* Title and note are one block inside the head, so an action button added
   later lands opposite the pair rather than between them. */
function section(title, note = '') {
  const box = el('section', 'fl-panel wc-card');
  box.dataset.span = '12';
  const head = el('div', 'fl-panel__head wc-card__head');
  const heading = el('div');
  heading.append(el('h2', 'fl-panel__title wc-card__title', title));
  if (note) heading.append(el('p', 'fl-muted wc-card__note', note));
  head.append(heading);
  const body = el('div', 'fl-panel__body wc-card__body');
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
  const node = el(onClick ? 'button' : 'div', `fl-row wc-item${onClick ? ' fl-row--button wc-item--button' : ''}`);
  if (onClick) {
    node.type = 'button';
    node.addEventListener('click', onClick);
  }
  const main = el('div', 'fl-row__main wc-item__main');
  main.append(el('strong', 'wc-item__title', title || 'Untitled'));
  if (meta) main.append(el('small', 'fl-muted wc-item__meta', meta));
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
    label: label(kind), value, series: ACTIVITY_SERIES[kind] || '4',
  }));
}

/* An overview page: the shared head (title, sentence, context line on the
   right, actions beneath) over a bento. The Dashboard and Learning use the
   same head Research and Core do, from C.pageHead, so all four workspaces
   open the same way. */
function overviewDoc(host, head) {
  host.innerHTML = '';
  const wrap = el('div', 'ws-doc ws-doc--wide fl-doc');
  wrap.append(C.pageHead(head));
  host.append(wrap);
  return wrap;
}

function greeting(hour = new Date().getHours()) {
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function longDate() {
  return new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function memberTiles(data, go) {
  const library = data.library || {};
  const discussions = data.discussions || {};
  const topics = data.topic_progress || {};
  const learning = data.learning || {};
  const research = data.research || {};

  const tiles = [
    C.statTile({
      value: count(library.saved_count), label: 'Saved', icon: 'library', featured: true,
      note: count(library.following_count) ? `${count(library.following_count)} followed` : 'From the public site',
      onClick: () => go('/workspace/dashboard/library'),
    }),
    C.statTile({
      value: count(discussions.total), label: 'Discussions', icon: 'discussion',
      part: count(discussions.published), total: count(discussions.total),
      note: 'On published material',
      onClick: () => go('/workspace/dashboard/discussions'),
    }),
    C.statTile({
      value: count(topics.total), label: 'Topics', icon: 'topic',
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
      value: count(learning.active), label: 'Courses', icon: 'course',
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
    value: count(data.support?.open), label: 'Open tickets', icon: 'support',
    note: count(data.support?.open) ? 'Waiting on a reply' : 'Nothing open',
    onClick: () => go('/workspace/dashboard/support'),
  }));

  /* Marked in series order so a layer keeps one colour across the tiles,
     the bar chart and the activity strip. The tiles are returned loose
     rather than in a grid of their own: the dashboard is one grid, and a
     nested one would break that alignment. tileRow() closes the row on the
     twelve-column line whatever the count — this used to be two columns
     each regardless, so an account without LMS or Research showed four or
     five tiles and a hole where the rest should have been. */
  return C.tileRow(tiles);
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
    rows.push({ label: 'Projects', value: count(research.projects), series: '4', onClick: () => go('/workspace/research') });
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
      icon: 'discussion',
      onClick: () => go('/workspace/dashboard/discussions'),
    }))));
  }
  return box.box;
}

const NEXT_ICONS = { path: 'path', learning: 'course', research: 'projects', comment: 'discussion', topic: 'topic' };
const SAVED_ICONS = { article: 'magazine', topic: 'topic', lab: 'lab', path: 'path', dossier: 'files' };

function linkButton(go, text, href) {
  const button = action(text, () => go(href));
  button.classList.add('ws-btn--tiny');
  return button;
}

export async function renderMemberOverview(host, { go }) {
  loading(host, 'Dashboard');
  try {
    const data = await P.memberDashboard();
    /* The member is the context line here, where Research and Core show
       their workspace mark: on the Dashboard the account is the subject. */
    const member = data.member || {};
    const wrap = overviewDoc(host, {
      title: 'Dashboard',
      meta: 'One account view across reading, discussion, learning and research.',
      mark: avatarNode(member),
      name: member.name || member.email || '',
      detail: P.meta([member.email, label(member.community_role), label(member.community_status)]),
      actions: [
        link(go, 'Progress', '/workspace/dashboard/progress', true),
        link(go, 'Open library', '/workspace/dashboard/library'),
      ],
    });

    if (P.canOpenCore()) {
      try {
        const reportState = await P.call('/platform/work-reports/');
        if (reportState.checkin?.due) {
          const daily = section('Pulsar · Daily work report', 'What did you work on today? Review and confirm your update.');
          daily.body.append(link(go, 'Write today’s report', '/workspace/core/work-reports', true));
          wrap.append(daily.box);
        }
      } catch (error) {
        if (error.status !== 403) {
          const daily = section('Daily Work Reports', 'Reporting status is temporarily unavailable.');
          daily.body.append(link(go, 'Open reports', '/workspace/core/work-reports'));
          wrap.append(daily.box);
        }
      }
    }

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
    const reveal = (box) => () => box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const saved = section('Saved');
    const following = section('Following');
    metrics.append(
      metric(data.library.saved_count, 'Saved', '', reveal(saved.box)),
      metric(data.library.following_count, 'Following', '', reveal(following.box)),
    );
    wrap.append(metrics);

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
    // The tiles filter the list beneath them. ?status= still works, because
    // the dashboards link here with it.
    let status = new URLSearchParams(location.search).get('status') || '';
    const matches = (item) => {
      const word = label(item.status).toLowerCase();
      return !status || (status === 'published' ? word.includes('published') : word.includes('pending'));
    };
    const box = section('Recent contributions');
    const draw = () => {
      box.body.replaceChildren();
      const shown = data.discussions.recent.filter(matches);
      if (status) {
        const note = el('div', 'fl-filter-note');
        note.append(el('span', null, `${shown.length} ${status === 'published' ? 'published' : 'pending'} contribution${shown.length === 1 ? '' : 's'}`));
        const clear = action('Show all', () => { status = ''; draw(); });
        clear.classList.add('ws-btn--tiny');
        note.append(clear);
        box.body.append(note);
      }
      if (!shown.length) {
        box.body.append(empty(status ? 'Nothing in this state' : 'No discussions yet', status ? 'Try another filter.' : 'Comments you post on public material appear here.'));
        return;
      }
      for (const item of shown) {
        box.body.append(row({
          title: item.content_key.replace(/-/g, ' '),
          meta: P.meta([label(item.status), date(item.updated_at)]),
          body: item.body,
        }));
      }
    };
    const pick = (next) => () => { status = next; draw(); box.box.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    const metrics = el('div', 'fl-metrics');
    metrics.append(
      metric(data.discussions.total, 'Contributions', '', pick('')),
      metric(data.discussions.published, 'Published', '', pick('published')),
      metric(data.discussions.pending, 'Pending review', '', pick('pending')),
    );
    wrap.append(metrics, box.box);
    draw();
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

/* ==========================================================================
   THE LEARNING OVERVIEW
   Built from the same pieces as the Dashboard, and on purpose. It used to be
   assembled from the course pages' own parts — fl-row lines with a progress
   bar under each title, pill badges for "3 nodes", a solid Start button in
   the middle of a row, a dashed empty box where a sentence would do, and a
   full-width submit bar — so it was the one workspace that read as a
   different product. The course pages keep those parts, where they belong;
   this screen is an overview and now looks like the other three: the shared
   head, clickable tiles, and cards holding marked rows, with a ring where
   the row has a real percentage and nothing where it does not.
   ========================================================================== */

const COURSE_SERIES = { active: '1', paused: '4', completed: '2' };

function enrollmentItem(enrollment, go) {
  const share = Number(enrollment.progress_percent);
  return C.listItem({
    title: enrollment.course_title,
    meta: P.meta([label(enrollment.status), Number.isFinite(share) ? `${Math.round(share)}% complete` : '']),
    icon: 'course',
    series: COURSE_SERIES[enrollment.status] || '1',
    right: Number.isFinite(share) ? C.ring(share, { label: `${enrollment.course_title}: ${Math.round(share)}%` }) : null,
    onClick: () => go(`/workspace/learning/courses/${enrollment.course_id}`),
  });
}

function catalogItem(course, go) {
  return C.listItem({
    title: course.title,
    meta: courseMeta(course),
    icon: course.enrolled ? 'learning' : 'course',
    series: course.enrolled ? '1' : '3',
    onClick: () => go(`/workspace/learning/courses/${course.id}`),
  });
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
    const enrollments = mine.enrollments || [];
    const active = enrollments.filter((item) => item.status === 'active' || item.status === 'paused');
    const completed = enrollments.filter((item) => item.status === 'completed');
    const certs = completed.filter((item) => item.certificate?.valid);
    const paths = publishedPaths.paths || [];
    const courses = catalog.courses || [];
    const activePath = (personalPaths.assignments || [])[0] || null;

    const wrap = overviewDoc(host, {
      title: 'Learning',
      meta: 'Courses, learning paths, assessments and certificates. Learning access is independent from Research.',
      mark: C.markSlot('space-knowledge'),
      name: greeting(),
      detail: longDate(),
      actions: [
        link(go, 'My Learning', '/workspace/learning/my', true),
        link(go, 'Course Catalog', '/workspace/learning/catalog'),
      ],
    });

    const layout = C.bento();
    layout.append(...C.tileRow([
      C.statTile({
        value: active.length, label: 'In progress', icon: 'learning', note: 'Active courses', featured: true,
        onClick: () => go('/workspace/learning/my'),
      }),
      C.statTile({
        value: completed.length, label: 'Completed', icon: 'check',
        part: completed.length, total: enrollments.length,
        note: 'Finished courses',
        onClick: () => go('/workspace/learning/my'),
      }),
      C.statTile({
        value: certs.length, label: 'Certificates', icon: 'certificate', note: 'Valid credentials',
        onClick: () => go('/workspace/learning/certificates'),
      }),
      C.statTile({
        value: paths.length, label: 'Learning paths', icon: 'path', note: 'Published paths',
        onClick: () => go('/workspace/learning/catalog'),
      }),
    ]));

    /* The one accented card, as on the Dashboard: it is the instruction on
       a screen that is otherwise a report. */
    const current = C.card({
      title: 'Continue learning',
      note: 'Courses you are enrolled in',
      span: 8,
      tone: 'accent',
      action: linkButton(go, 'My Learning', '/workspace/learning/my'),
    });
    current.box.dataset.span = '8';
    if (active.length) {
      current.body.append(C.list(active.slice(0, 4).map((item) => enrollmentItem(item, go))));
    } else {
      current.body.append(C.note('Nothing in progress. Pick a published course or start a learning path.'));
      current.body.append(C.actions([link(go, 'Browse the catalog', '/workspace/learning/catalog', true)]));
    }
    layout.append(current.box);

    /* The gauge with its three counts under it, the same shape as the
       Dashboard's Completion card. */
    const completion = C.card({ title: 'Completion', note: 'Finished courses across all enrollments', span: 4 });
    completion.body.append(C.gauge({
      value: completed.length,
      total: enrollments.length,
      label: 'completed',
      caption: `${completed.length} of ${enrollments.length} courses complete`,
      empty: 'No course progress yet',
    }));
    completion.body.append(C.legend([
      { label: 'Active', value: active.length, series: '1' },
      { label: 'Completed', value: completed.length, series: '2' },
      { label: 'Certificates', value: certs.length, series: '3' },
    ]));
    layout.append(completion.box);

    const pathsBox = C.card({
      title: 'Published learning paths',
      note: 'Curated multi-course routes with gates and milestones',
      span: 6,
    });
    pathsBox.box.dataset.span = '6';
    if (paths.length) {
      pathsBox.body.append(C.list(paths.slice(0, 4).map((path) => {
        const start = action('Start path', async () => {
          start.disabled = true;
          start.textContent = 'Starting…';
          try {
            await P.lmsPersonalizePath({ goal: path.title, learning_path_id: path.id, use_template: true });
            await renderLearningOverview(host, { go });
          } catch (error) {
            start.disabled = false;
            start.textContent = 'Try again';
            start.title = error?.message || '';
          }
        });
        start.classList.add('ws-btn--tiny');
        return C.listItem({
          title: path.title,
          meta: P.meta([
            `${(path.nodes || []).length} courses`,
            `${(path.edges || []).length} connections`,
          ]),
          icon: 'path',
          series: '3',
          right: start,
        });
      })));
    } else {
      pathsBox.body.append(C.note('No published paths yet. The course team publishes them from LMS Admin.'));
    }
    layout.append(pathsBox.box);

    const discover = C.card({
      title: 'Catalog',
      note: 'Published courses ready to open or enroll in',
      span: 6,
      action: linkButton(go, 'View all', '/workspace/learning/catalog'),
    });
    if (courses.length) discover.body.append(C.list(courses.slice(0, 4).map((course) => catalogItem(course, go))));
    else discover.body.append(C.note('No published courses yet.'));
    layout.append(discover.box);

    if (activePath) {
      const pathBox = C.card({
        title: 'Your learning path',
        note: activePath.learning_path_title
          ? `Following ${activePath.learning_path_title}`
          : 'Personalised around your research goal',
        span: 8,
      });
      if (activePath.goal) pathBox.body.append(C.note(activePath.goal));
      const courseProgress = new Map(enrollments.map((item) => [String(item.course_id), item]));
      const steps = (activePath.nodes || []).map((node) => {
        const nodeType = node.type || (node.course_id ? 'course' : 'milestone');
        const enrollment = node.course_id ? courseProgress.get(String(node.course_id)) : null;
        const share = enrollment ? Number(enrollment.progress_percent) : null;
        return C.listItem({
          title: node.title || (node.course_id ? 'Course ' + node.course_id : node.id),
          meta: P.meta([label(nodeType), enrollment ? label(enrollment.status) : '']),
          icon: node.course_id ? 'course' : 'target',
          series: enrollment?.status === 'completed' ? '2' : '1',
          right: Number.isFinite(share) ? C.ring(share, { label: `${Math.round(share)}%` }) : null,
          onClick: node.course_id ? () => go('/workspace/learning/courses/' + node.course_id) : null,
        });
      });
      if (steps.length) pathBox.body.append(C.list(steps));
      else pathBox.body.append(C.note('This path has no steps yet. Ask the course team to review it.'));
      layout.append(pathBox.box);
    }

    const personal = personalizedPathPanel(go);
    personal.dataset.span = activePath ? '4' : '12';
    layout.append(personal);

    wrap.append(layout);
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

/* A course as a card: its cover, what it is, and — for an enrollment — how
   far along it is. Catalog and My learning both draw these, so a course
   looks the same wherever the reader meets it. */
function courseTile(course, go, { eyebrow = '', meta = '', progress = null, flag = '' } = {}) {
  const card = el('button', 'flc-tile');
  card.type = 'button';
  card.addEventListener('click', () => go(`/workspace/learning/courses/${course.id}`));
  const media = el('span', 'flc-tile__media');
  media.append(courseCover(course, 'flc-cover'));
  if (flag) media.append(el('span', 'flc-tile__flag', flag));
  const body = el('span', 'flc-tile__body');
  if (eyebrow) body.append(el('span', 'fl-eyebrow', eyebrow));
  body.append(el('strong', 'flc-tile__title', course.title || 'Untitled course'));
  if (course.summary) body.append(el('span', 'flc-tile__summary', plainText(course.summary)));
  const foot = el('span', 'flc-tile__foot');
  if (progress != null) foot.append(percent(progress));
  if (meta) foot.append(el('small', 'fl-muted', meta));
  if (foot.childElementCount) body.append(foot);
  card.append(media, body);
  return card;
}

function courseTiles(items) {
  const grid = el('div', 'flc-tiles');
  items.forEach((item) => grid.append(item));
  return grid;
}

export async function renderLearningCatalog(host, { go }) {
  loading(host, 'Course Catalog');
  try {
    const data = await P.lmsCourses();
    const wrap = doc(host, 'Course Catalog', 'Published Gravitas+ courses. Enrollment and Research access remain separate.');
    const toolbar = el('div', 'fl-toolbar');
    const search = el('input', 'v-input fl-input');
    search.type = 'search';
    search.placeholder = 'Search courses';
    toolbar.append(search);
    wrap.append(toolbar);
    const results = el('div', 'flc-results');
    const courses = data.courses || [];
    const draw = () => {
      results.innerHTML = '';
      const q = search.value.trim().toLowerCase();
      const matches = courses.filter((item) => !q || `${item.title} ${item.summary}`.toLowerCase().includes(q));
      if (!matches.length) {
        results.append(empty('No matching courses', courses.length ? 'Try another search.' : 'There are no published courses yet.'));
        return;
      }
      results.append(courseTiles(matches.map((item) => courseTile(item, go, {
        eyebrow: item.category?.name || '',
        // The bar carries the progress, so the line under it does not repeat it.
        meta: item.enrolled ? P.meta([courseMeta({ ...item, enrolled: false })]) : courseMeta(item),
        progress: item.enrolled ? item.progress_percent : null,
        flag: item.enrolled ? label(item.enrollment_status || 'enrolled') : (item.certificate_enabled ? 'Certificate' : ''),
      }))));
    };
    search.addEventListener('input', draw);
    draw();
    wrap.append(results);
  } catch (error) {
    errorView(host, 'Course Catalog', error, () => renderLearningCatalog(host, { go }));
  }
}

export async function renderMyLearning(host, { go }) {
  loading(host, 'My Learning');
  try {
    const data = await P.lmsMe();
    const wrap = doc(host, 'My Learning', 'All course enrollments and completion state.');
    const items = data.enrollments || [];
    if (!items.length) {
      wrap.append(empty('No enrollments yet', 'Open the catalog to start a course.'));
      return;
    }
    wrap.append(courseTiles(items.map((item) => courseTile({
      id: item.course_id,
      title: item.course_title,
      summary: item.course_summary,
      cover_url: item.course_cover_url,
    }, go, {
      meta: P.meta([label(item.access_source), item.completed_at ? `Completed ${date(item.completed_at)}` : '', item.certificate?.valid ? 'Certificate issued' : '']),
      progress: item.progress_percent,
      flag: label(item.status),
    }))));
  } catch (error) {
    errorView(host, 'My Learning', error, () => renderMyLearning(host, { go }));
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

function lessonInteractionPanel(lesson, course) {
  const panel = el('div', 'fl-learning-interactions');
  const heading = el('div', 'fl-learning-interactions__head');
  heading.append(
    el('strong', null, 'Your layer on this lesson'),
    el('small', 'fl-muted', 'Notes and highlights sync into the Learning area in Nextcloud.'),
  );
  panel.append(heading);

  const form = el('form', 'fl-learning-interactions__composer');
  const kind = el('select', 'v-input fl-input');
  [
    ['note', 'Note'],
    ['task', 'Task'],
    ['reminder', 'Reminder'],
    ['bookmark', 'Bookmark'],
  ].forEach(([value, text]) => {
    const option = el('option', null, text);
    option.value = value;
    kind.append(option);
  });
  const body = el('textarea', 'v-input fl-input fl-textarea');
  body.rows = 2;
  body.placeholder = 'Write a note or something you want to come back to…';
  const due = dateTimeField({ placeholder: 'Due date (optional)' });
  due.hidden = true;
  const save = action('Add', () => {}, true);
  save.type = 'submit';
  const highlight = action('Highlight selection', async () => {
    const quote = String(window.getSelection?.()?.toString() || '').trim();
    if (!quote) {
      highlight.textContent = 'Select lesson text first';
      window.setTimeout(() => { highlight.textContent = 'Highlight selection'; }, 1800);
      return;
    }
    highlight.disabled = true;
    try {
      await P.lmsCreateInteraction(course.id, {
        kind: 'highlight',
        lesson_id: lesson.id,
        section_key: `lesson-${lesson.id}`,
        quote,
        anchor: { lesson_id: lesson.id, selected_text: quote.slice(0, 1200) },
      });
      await refresh();
    } catch (error) {
      highlight.title = error?.message || '';
    } finally {
      highlight.disabled = false;
    }
  });
  highlight.classList.add('ws-btn--tiny');

  kind.addEventListener('change', () => {
    due.hidden = !['task', 'reminder'].includes(kind.value);
    body.placeholder = kind.value === 'note'
      ? 'Write a note or something you want to come back to…'
      : kind.value === 'bookmark'
        ? 'Optional bookmark label'
        : 'What should you do next?';
  });

  const controls = el('div', 'fl-learning-interactions__controls');
  controls.append(kind, due, save, highlight);
  form.append(body, controls);

  const list = el('div', 'fl-learning-interactions__list');

  const draw = (items) => {
    list.innerHTML = '';
    if (!items.length) {
      list.append(el('p', 'fl-muted', 'Nothing attached to this lesson yet.'));
      return;
    }
    for (const item of items) {
      const tools = [];
      if (['task', 'reminder'].includes(item.kind)) {
        const toggle = action(item.completed ? 'Reopen' : 'Done', async () => {
          toggle.disabled = true;
          try {
            await P.lmsUpdateInteraction(course.id, item.id, { completed: !item.completed });
            await refresh();
          } catch {
            toggle.disabled = false;
          }
        });
        toggle.classList.add('ws-btn--tiny');
        tools.push(toggle);
      }
      const remove = action('Delete', async () => {
        remove.disabled = true;
        try {
          await P.lmsDeleteInteraction(course.id, item.id);
          await refresh();
        } catch {
          remove.disabled = false;
        }
      });
      remove.classList.add('ws-btn--tiny');
      tools.push(remove);

      const meta = P.meta([
        label(item.kind),
        item.due_at ? new Date(item.due_at).toLocaleString() : '',
        item.nextcloud_resource_id ? 'Nextcloud' : '',
        item.completed ? 'Done' : '',
      ]);
      list.append(row({
        title: item.body || item.quote || item.label,
        meta,
        body: item.quote && item.body ? item.quote : '',
        badges: item.completed ? ['Completed'] : [],
        actions: tools,
      }));
    }
  };

  const refresh = async () => {
    try {
      const data = await P.lmsCourseInteractions(course.id, { lesson_id: lesson.id });
      const items = data.interactions || [];
      const others = (course._learningInteractions || []).filter((item) => String(item.lesson_id) !== String(lesson.id));
      course._learningInteractions = [...others, ...items];
      draw(items);
    } catch (error) {
      list.innerHTML = '';
      list.append(el('p', 'fl-muted', error?.message || 'Lesson notes could not be loaded.'));
    }
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = body.value.trim();
    if (kind.value === 'note' && !text) return;
    if (['task', 'reminder'].includes(kind.value) && !text) return;
    save.disabled = true;
    try {
      await P.lmsCreateInteraction(course.id, {
        kind: kind.value,
        lesson_id: lesson.id,
        section_key: `lesson-${lesson.id}`,
        body: text,
        due_at: due.value ? new Date(due.value).toISOString() : null,
        anchor: { lesson_id: lesson.id },
      });
      body.value = '';
      due.value = '';
      await refresh();
    } catch (error) {
      save.title = error?.message || '';
    } finally {
      save.disabled = false;
    }
  });

  panel.append(form, list);
  draw((course._learningInteractions || []).filter((item) => String(item.lesson_id) === String(lesson.id)));
  return panel;
}

/* ==========================================================================
   COURSE TEXT
   Course descriptions and lesson bodies are written in Markdown by the
   course team, and were printed with white-space: pre-wrap, so a learner
   read "**Introduction to AI Workflows**" with the asterisks in it. This
   is a deliberately small reader — paragraphs, headings, lists, quotes,
   code, emphasis and links — built from DOM nodes, never from innerHTML,
   because the text is authored content and must not become markup.

   Maths is left exactly as written. ws-math.js watches the workspace and
   typesets $…$ and \(…\) wherever it lands in a text node, so the reader's
   only duty is not to mistake the asterisk in $a*b*c$ for emphasis.
   ========================================================================== */

const SAFE_HREF = /^(https?:|mailto:|\/(?!\/)|#)/i;
const INLINE = /(`[^`\n]+`)|(\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\)|\$[^$\n]+?\$)|\*\*([^*]+?)\*\*|__([^_]+?)__|\*([^*\s][^*\n]*?)\*|(?<![\w])_([^_\s][^_\n]*?)_(?![\w])|\[([^\]\n]+)\]\(([^)\s]+)\)/g;

function inlineMarkdown(text, target) {
  let last = 0;
  INLINE.lastIndex = 0;
  const source = String(text);
  const matches = [...source.matchAll(INLINE)];
  for (const m of matches) {
    if (m.index > last) appendLines(target, source.slice(last, m.index));
    if (m[1]) target.append(el('code', null, m[1].slice(1, -1)));
    else if (m[2]) target.append(document.createTextNode(m[2]));
    else if (m[3] || m[4]) {
      const strong = el('strong');
      inlineMarkdown(m[3] || m[4], strong);
      target.append(strong);
    } else if (m[5] || m[6]) {
      const em = el('em');
      inlineMarkdown(m[5] || m[6], em);
      target.append(em);
    } else if (m[7]) {
      if (SAFE_HREF.test(m[8])) {
        const a = el('a', null, m[7]);
        a.href = m[8];
        if (/^https?:/i.test(m[8])) {
          a.target = '_blank';
          a.rel = 'noopener';
        }
        target.append(a);
      } else {
        target.append(document.createTextNode(m[7]));
      }
    }
    last = m.index + m[0].length;
  }
  if (last < source.length) appendLines(target, source.slice(last));
  return target;
}

/* A single newline stays a line break. Lessons written before this reader
   existed were laid out for pre-wrap, and their authors meant those breaks. */
function appendLines(target, text) {
  text.split('\n').forEach((part, index) => {
    if (index) target.append(el('br'));
    if (part) target.append(document.createTextNode(part));
  });
}

const BLOCK_START = /^\s*(```|#{1,6}\s|>|[-*+]\s+|\d+[.)]\s+|(-{3,}|\*{3,})\s*$)/;

function markdown(source, cls = '') {
  const root = el('div', `flc-md${cls ? ` ${cls}` : ''}`);
  const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }

    if (/^\s*```/.test(line)) {
      const code = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) { code.push(lines[i]); i += 1; }
      i += 1;
      const pre = el('pre');
      pre.append(el('code', null, code.join('\n')));
      root.append(pre);
      continue;
    }
    const heading = /^\s*(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min(6, heading[1].length + 2);
      root.append(inlineMarkdown(heading[2], el(`h${level}`)));
      i += 1;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      root.append(el('hr'));
      i += 1;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quoted = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { quoted.push(lines[i].replace(/^\s*>\s?/, '')); i += 1; }
      const quote = el('blockquote');
      quote.append(...markdown(quoted.join('\n')).childNodes);
      root.append(quote);
      continue;
    }
    const bullet = /^\s*[-*+]\s+/;
    const number = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || number.test(line)) {
      const ordered = number.test(line);
      const marker = ordered ? number : bullet;
      const list = el(ordered ? 'ol' : 'ul');
      while (i < lines.length && marker.test(lines[i])) {
        let text = lines[i].replace(marker, '');
        i += 1;
        // An indented line under an item continues it.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !marker.test(lines[i])) { text += `\n${lines[i].trim()}`; i += 1; }
        list.append(inlineMarkdown(text, el('li')));
      }
      root.append(list);
      continue;
    }
    const para = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i])) { para.push(lines[i]); i += 1; }
    root.append(inlineMarkdown(para.join('\n'), el('p')));
  }
  return root;
}

/* For one-line places — the page lede, a meta line — where emphasis
   markers are noise and structure has nowhere to go. */
function plainText(source) {
  return String(source || '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(\*\*|__|`)/g, '')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Marks the quote wherever it sits in the rendered lesson, across the
   strong and em nodes the Markdown made. A learner selects rendered text,
   so that is what the stored quote is matched against. */
function highlightQuote(root, quote) {
  for (const old of root.querySelectorAll('mark.fl-return-highlight')) old.replaceWith(...old.childNodes);
  root.normalize();
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let text = '';
  let node;
  while ((node = walker.nextNode())) {
    nodes.push({ node, start: text.length });
    text += node.nodeValue;
  }
  const at = text.indexOf(quote);
  if (at < 0) return null;
  const end = at + quote.length;
  const locate = (offset, isEnd) => {
    for (const item of nodes) {
      const stop = item.start + item.node.nodeValue.length;
      if (offset < stop || (isEnd && offset === stop)) return [item.node, offset - item.start];
    }
    return null;
  };
  const from = locate(at, false);
  const to = locate(end, true);
  if (!from || !to) return null;
  const range = document.createRange();
  range.setStart(from[0], from[1]);
  range.setEnd(to[0], to[1]);
  const mark = el('mark', 'fl-return-highlight');
  mark.append(range.extractContents());
  range.insertNode(mark);
  return mark;
}

/* A return point names a lesson. When that lesson is not the one on
   screen, the course opens it and finishes the job after it has drawn. */
let pendingFocus = null;

function focusLearningInteraction(item, openLesson = null) {
  if (!item?.lesson_id) return;
  const target = document.getElementById(`lesson-${item.lesson_id}`);
  if (!target) {
    if (openLesson) openLesson(item.lesson_id, item);
    return;
  }
  const prose = target.querySelector('.flc-md');
  const quote = String(item.quote || item.anchor?.selected_text || '').trim();
  const mark = prose && quote ? highlightQuote(prose, quote) : null;
  window.requestAnimationFrame(() => {
    (mark || target).scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

function courseReturnPointsPanel(course, openLesson = null) {
  const box = section(
    'Return points',
    'Notes, highlights, bookmarks and reminders that take you back to the lesson context where you created them.',
  );

  const draw = () => {
    box.body.innerHTML = '';
    const items = (course._learningInteractions || [])
      .filter((item) => ['note', 'highlight', 'bookmark', 'reminder'].includes(item.kind))
      .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));

    if (!items.length) {
      box.body.append(empty('No return points yet', 'Add a note, highlight, bookmark or reminder inside a lesson.'));
      return;
    }

    const modules = new Map();
    for (const module of course.modules || []) {
      for (const lesson of module.lessons || []) {
        modules.set(String(lesson.id), { lesson, module });
      }
    }

    const list = el('div', 'fl-course-return-points');
    for (const item of items) {
      const context = modules.get(String(item.lesson_id));
      const title = item.body || item.quote || item.label || label(item.kind);
      const node = row({
        title,
        meta: P.meta([
          label(item.kind),
          context ? `${context.module.title} · ${context.lesson.title}` : 'Course',
          item.due_at ? new Date(item.due_at).toLocaleString() : '',
          item.nextcloud_resource_id ? 'Nextcloud' : '',
        ]),
        badges: item.completed ? ['Done'] : [],
        onClick: item.lesson_id ? () => focusLearningInteraction(item, openLesson) : null,
      });
      list.append(node);
    }
    box.body.append(list);
  };

  const refresh = action('Refresh', async () => {
    refresh.disabled = true;
    try {
      const data = await P.lmsCourseInteractions(course.id);
      course._learningInteractions = data.interactions || [];
      draw();
    } catch (error) {
      refresh.title = error?.message || '';
    } finally {
      refresh.disabled = false;
    }
  });
  refresh.classList.add('ws-btn--tiny');
  box.head.append(refresh);
  draw();
  return box.box;
}

async function coursePlanPanel(course, openLesson = null) {
  const box = section('Course plan', 'Required lessons plus your own tasks and reminders, in one progress model.');
  const render = async () => {
    box.body.innerHTML = '';
    try {
      const data = await P.lmsLearningPlan(course.id);
      const summary = el('div', 'fl-course-plan__summary');
      summary.append(
        percent(data.workspace_progress_percent),
        el('span', 'fl-muted', `${data.done} of ${data.total} plan items complete`),
      );
      box.body.append(summary);

      const add = el('form', 'fl-course-plan__add');
      const text = el('input', 'v-input fl-input');
      text.placeholder = 'Add a course task';
      const due = dateTimeField({ placeholder: 'Due date (optional)' });
      const submit = action('Add task', () => {}, true);
      submit.type = 'submit';
      add.append(text, due, submit);
      add.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!text.value.trim()) return;
        submit.disabled = true;
        try {
          await P.lmsCreateInteraction(course.id, {
            kind: 'task',
            body: text.value.trim(),
            due_at: due.value ? new Date(due.value).toISOString() : null,
            section_key: 'course-plan',
          });
          text.value = '';
          due.value = '';
          await render();
        } catch (error) {
          submit.title = error?.message || '';
        } finally {
          submit.disabled = false;
        }
      });
      box.body.append(add);

      const items = data.checklist || [];
      if (!items.length) {
        box.body.append(empty('No plan items yet', 'Required lessons and your own tasks appear here.'));
        return;
      }
      const list = el('div', 'fl-course-plan__list');
      for (const item of items) {
        const tools = [];
        if (item.type === 'task' || item.type === 'reminder') {
          const toggle = action(item.done ? 'Reopen' : 'Done', async () => {
            toggle.disabled = true;
            try {
              await P.lmsUpdateInteraction(course.id, item.id, { completed: !item.done });
              await render();
            } catch {
              toggle.disabled = false;
            }
          });
          toggle.classList.add('ws-btn--tiny');
          tools.push(toggle);
        }
        list.append(row({
          title: item.title,
          meta: P.meta([
            item.module_title,
            label(item.type),
            item.due_at ? new Date(item.due_at).toLocaleString() : '',
          ]),
          badges: item.done ? ['Done'] : [],
          onClick: item.type === 'lesson' && openLesson ? () => openLesson(item.lesson_id) : null,
          actions: tools,
        }));
      }
      box.body.append(list);
    } catch (error) {
      box.body.append(empty('Course plan unavailable', error?.message || 'Try again.'));
    }
  };
  await render();
  return box.box;
}

async function pulsarAccessPanel(course) {
  const box = section(
    'Pulsar access',
    'Pulsar starts without project access. Grant individual projects explicitly; the grant follows Pulsar across workspace views, and every read is still checked against your live project permissions.',
  );
  try {
    const data = await P.lmsPulsarAccess(course.id);
    const grants = new Map((data.grants || []).map((item) => [String(item.project_id), item]));
    if (!(data.projects || []).length) {
      box.body.append(empty('No project context available', 'Projects you can access will appear here when Research access is available.'));
      return box.box;
    }
    for (const project of data.projects || []) {
      const grant = grants.get(String(project.id));
      const line = el('div', 'fl-pulsar-access__row');
      const main = el('div', 'fl-pulsar-access__main');
      main.append(el('strong', null, project.title));
      main.append(el('small', 'fl-muted', project.can_edit ? 'You can edit this project' : 'You can view this project'));

      const enabled = el('input');
      enabled.type = 'checkbox';
      enabled.checked = !!grant?.active;
      const markdown = el('input');
      markdown.type = 'checkbox';
      markdown.checked = grant ? grant.allow_markdown !== false : true;
      const notes = el('input');
      notes.type = 'checkbox';
      notes.checked = grant ? grant.allow_notes !== false : true;

      const controls = el('div', 'fl-pulsar-access__controls');
      const wrapCheck = (input, text) => {
        const row = el('label', 'v-check-row');
        row.append(input, el('span', null, text));
        return row;
      };
      controls.append(
        wrapCheck(enabled, 'Allow Pulsar'),
        wrapCheck(markdown, 'Markdown files'),
        wrapCheck(notes, 'Project notes'),
      );

      const saveGrant = async () => {
        [enabled, markdown, notes].forEach((node) => { node.disabled = true; });
        try {
          await P.lmsSetPulsarAccess(course.id, {
            project_id: project.id,
            enabled: enabled.checked,
            allow_markdown: markdown.checked,
            allow_notes: notes.checked,
            allow_write_interactions: true,
          });
        } catch (error) {
          enabled.checked = !!grant?.active;
          line.title = error?.message || '';
        } finally {
          [enabled, markdown, notes].forEach((node) => { node.disabled = false; });
        }
      };
      enabled.addEventListener('change', saveGrant);
      markdown.addEventListener('change', saveGrant);
      notes.addEventListener('change', saveGrant);

      line.append(main, controls);
      box.body.append(line);
    }
  } catch (error) {
    box.body.append(empty('Pulsar permissions unavailable', error?.message || 'Try again.'));
  }
  return box.box;
}

function lessonMeta(lesson) {
  return P.meta([
    label(lesson.kind),
    lesson.duration_seconds ? `${Math.ceil(lesson.duration_seconds / 60)} min` : '',
    lesson.is_preview ? 'Preview' : '',
    lesson.is_required === false ? 'Optional' : '',
  ]);
}

/* One lesson, open, as the page. Lessons used to be <details> rows stacked
   in the curriculum, all of them on one screen with every panel the course
   has below them; the index tree now chooses the lesson and this draws it.
   The view event goes out when it draws, the dwell when the reader leaves
   it for any other route. */
function lessonView(lesson, course, { position, next, offline, reload, openLesson, goHome }) {
  const article = el('article', 'flc-lesson');
  article.id = `lesson-${lesson.id}`;
  const head = el('header', 'flc-lesson__head');
  const where = el('span', 'fl-eyebrow', P.meta([position.module.title, `Lesson ${position.index} of ${position.total}`]));
  const title = el('h2', 'flc-lesson__title', lesson.title);
  const meta = el('div', 'flc-lesson__meta');
  meta.append(el('span', 'fl-muted', lessonMeta(lesson)));
  if (lesson.locked) meta.append(badge('Locked'));
  else if (position.done) meta.append(badge('Completed', 'ok'));
  head.append(where, title, meta);
  article.append(head);
  const body = el('div', 'flc-lesson__body');
  let openedAt = Date.now();

  const sendDwell = () => {
    if (!openedAt || !course.enrolled || offline) return;
    const seconds = Math.max(1, Math.round((Date.now() - openedAt) / 1000));
    openedAt = 0;
    P.lmsCourseEvent(course.id, {
      kind: 'lesson.dwell',
      lesson_id: lesson.id,
      duration_seconds: seconds,
    }).catch(() => {});
  };
  const leave = () => {
    sendDwell();
    removeEventListener('ws:navigate', leave);
    removeEventListener('popstate', leave);
    removeEventListener('pagehide', leave);
  };
  addEventListener('ws:navigate', leave);
  addEventListener('popstate', leave);
  addEventListener('pagehide', leave);
  if (course.enrolled && !lesson.locked && !offline) {
    P.lmsCourseEvent(course.id, { kind: 'lesson.view', lesson_id: lesson.id }).catch(() => {});
  }

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
    if (['course_profile_required', 'course_enrollment_required'].includes(lesson.lock_reason)) {
      body.append(C.actions([action('Go to the course overview', goHome, true)]));
    }
  } else {
    if (lesson.summary) body.append(el('p', 'flc-lesson__lede', lesson.summary));

    if (lesson.kind === 'lab' && lesson.lab_slug && course.learning_config?.lab_enabled !== false) {
      const frame = el('iframe', 'fl-course-embed');
      frame.src = `/lab-run/${encodeURIComponent(lesson.lab_slug)}/`;
      frame.title = lesson.title;
      frame.loading = 'lazy';
      frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-popups');
      const labOpen = action('Start Lab activity', () => {
        if (course.enrolled) P.lmsCourseEvent(course.id, { kind: 'lab.use', lesson_id: lesson.id }).catch(() => {});
        frame.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, true);
      body.append(C.actions([labOpen]), frame);
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
      body.append(C.actions([media]));
    }

    if (lesson.body) body.append(markdown(lesson.body, 'flc-lesson__prose'));

    if (course.enrolled && !offline) {
      const actions = el('div', 'flc-lesson__actions');
      const done = action(position.done ? 'Completed · mark again' : 'Mark complete', async () => {
        done.disabled = true;
        done.textContent = 'Saving…';
        sendDwell();
        try {
          await P.lmsLessonProgress(lesson.id, { completed: true, progress_seconds: lesson.duration_seconds || 0 });
          await reload(next ? next.lesson.id : '');
        } catch (error) {
          done.disabled = false;
          done.textContent = error?.message || 'Try again';
        }
      }, !position.done);
      const skip = action('Skip for now', async () => {
        skip.disabled = true;
        sendDwell();
        try {
          await P.lmsCourseEvent(course.id, { kind: 'lesson.skip', lesson_id: lesson.id });
          skip.textContent = 'Skipped';
          if (next) openLesson(next.lesson.id);
        } catch {
          skip.disabled = false;
        }
      });
      actions.append(done, skip);
      if (position.done && next) actions.prepend(action(`Next · ${next.lesson.title}`, () => openLesson(next.lesson.id), true));
      body.append(actions);
      body.append(lessonInteractionPanel(lesson, course));
    }
  }
  article.append(body);
  return article;
}

/* An assessment reads as a quiz, not as a settings form. Choices are option
   cards rather than a <select>: a closed dropdown hides the very answers the
   reader is meant to weigh against each other, and costs two clicks a question.
   Submit keeps its natural width in a footer beside the answered count, and
   waits until every question has an answer — attempts are limited, and a stray
   click on a half-filled quiz would spend one. A failed attempt re-arms the
   button; before, it stayed disabled until the page was reloaded. */
const trimNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? String(+number.toFixed(2)) : String(value ?? '');
};

function assessmentCard(assessment, course, reload) {
  const attempts = Number(assessment.max_attempts) || 0;
  const box = section(assessment.title, `${trimNumber(assessment.passing_score)}% to pass · ${attempts} ${attempts === 1 ? 'attempt' : 'attempts'}`);
  if (!assessment.questions?.length) {
    box.body.append(empty('Assessment unavailable', course.enrolled ? 'No scorable questions were published.' : 'Enroll to open the assessment.'));
    return box.box;
  }
  const form = el('form', 'flc-quiz');
  const list = el('ol', 'flc-quiz__list');
  const answers = new Map();
  const total = assessment.questions.length;
  const progress = el('span', 'flc-quiz__progress');
  const status = el('span', 'flc-quiz__status');
  status.setAttribute('role', 'status');
  const submit = action('Submit assessment', () => {}, true);
  submit.type = 'submit';
  submit.classList.add('flc-quiz__submit');
  const sync = () => {
    progress.textContent = `${answers.size} of ${total} answered`;
    submit.disabled = answers.size < total;
  };
  const group = `quiz-${assessment.id ?? Math.random().toString(36).slice(2)}`;
  assessment.questions.forEach((question, index) => {
    const qid = String(question.id ?? index + 1);
    const item = el('li', 'flc-quiz__q');
    const set = el('fieldset', 'flc-quiz__set');
    const legend = el('legend', 'flc-quiz__prompt');
    legend.append(el('span', 'flc-quiz__num', String(index + 1)), el('span', null, question.prompt || `Question ${index + 1}`));
    set.append(legend);
    if (Array.isArray(question.choices) && question.choices.length) {
      const choices = el('div', 'flc-quiz__choices');
      question.choices.forEach((choice, at) => {
        const option = el('label', 'flc-quiz__choice');
        const input = el('input');
        input.type = 'radio';
        input.name = `${group}-${qid}`;
        input.value = JSON.stringify(choice);
        input.addEventListener('change', () => {
          if (!input.checked) return;
          answers.set(qid, parseOption(input.value));
          item.dataset.answered = 'true';
          sync();
        });
        option.append(input, el('span', 'flc-quiz__key', String.fromCharCode(65 + (at % 26))), el('span', 'flc-quiz__text', String(choice)));
        choices.append(option);
      });
      set.append(choices);
    } else {
      const input = el('input', 'v-input fl-input flc-quiz__input');
      input.placeholder = 'Your answer';
      input.addEventListener('input', () => {
        if (input.value.trim()) answers.set(qid, input.value); else answers.delete(qid);
        item.dataset.answered = String(answers.has(qid));
        sync();
      });
      set.append(input);
    }
    item.append(set);
    list.append(item);
  });
  const foot = el('div', 'flc-quiz__foot');
  const meta = el('div', 'flc-quiz__meta');
  meta.append(progress, status);
  foot.append(meta, submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (answers.size < total) return;
    submit.disabled = true;
    delete status.dataset.tone;
    status.textContent = 'Scoring…';
    try {
      const result = await P.lmsAssessmentAttempt(assessment.id, Object.fromEntries(answers));
      const attempt = result.attempt || {};
      status.textContent = `${attempt.passed ? 'Passed' : 'Not passed'} · ${trimNumber(attempt.score)}%`;
      status.dataset.tone = attempt.passed ? 'ok' : 'warn';
      if (attempt.passed) setTimeout(() => reload(), 700);
      else submit.disabled = false;
    } catch (error) {
      status.textContent = error?.message || 'Assessment could not be submitted.';
      status.dataset.tone = 'bad';
      submit.disabled = false;
    }
  });
  sync();
  form.append(list, foot);
  box.body.append(form);
  return box.box;
}

function courseRegistrationPanel(course, profile, reload) {
  if (!course.enrolled || !course.registration_schema?.length || profile?.completed) return null;
  const box = section('Complete your course profile', 'The course team requires these fields before protected lessons unlock.');
  box.box.classList.add('flc-callout');
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
      control.rows = 3;
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
  form.append(C.actions([save, status]));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const answers = {};
    for (const [key, item] of controls) answers[key] = item.spec.type === 'checkbox' ? item.control.checked : item.control.value;
    save.disabled = true;
    status.textContent = 'Saving…';
    try {
      await P.lmsSaveRegistrationProfile(course.id, answers);
      await reload();
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
  const box = section('AI Tutor', 'Ask Pulsar with course context, a lesson, selected Zotero sources and only the projects granted under Pulsar access.');
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
  const send = action('Ask Pulsar', () => {}, true);
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
    note.textContent = 'Pulsar is thinking…';
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
      reply.append(el('strong', null, 'Pulsar'), el('p', null, data.answer));
      if (data.sources?.length) {
        const sources = el('div', 'fl-badges');
        data.sources.forEach((item) => sources.append(badge(item.project ? `${item.project} · ${item.title}` : item.title)));
        reply.append(sources);
      }
      const replyActions = el('div', 'fl-form-actions');
      const saveNote = action('Save as lesson note', async () => {
        saveNote.disabled = true;
        try {
          await P.lmsCreateInteraction(course.id, {
            kind: 'note',
            lesson_id: lessonSelect.value ? Number(lessonSelect.value) : null,
            section_key: lessonSelect.value ? `lesson-${lessonSelect.value}` : 'course-ai',
            body: data.answer,
            anchor: { source: 'pulsar', question: value },
          });
          saveNote.textContent = 'Saved to page + Nextcloud';
        } catch (error) {
          saveNote.textContent = error?.message || 'Save failed';
          saveNote.disabled = false;
        }
      });
      saveNote.classList.add('ws-btn--tiny');
      const makeTask = action('Turn into task', async () => {
        makeTask.disabled = true;
        try {
          await P.lmsCreateInteraction(course.id, {
            kind: 'task',
            lesson_id: lessonSelect.value ? Number(lessonSelect.value) : null,
            section_key: lessonSelect.value ? `lesson-${lessonSelect.value}` : 'course-plan',
            body: data.answer.slice(0, 24000),
            anchor: { source: 'pulsar', question: value },
          });
          makeTask.textContent = 'Task added';
        } catch (error) {
          makeTask.textContent = error?.message || 'Task failed';
          makeTask.disabled = false;
        }
      });
      makeTask.classList.add('ws-btn--tiny');
      replyActions.append(saveNote, makeTask);
      reply.append(replyActions);
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

    const saveCurrentNotebook = async () => {
      const saved = await P.lmsSaveNotebook(course.id, {
        id: currentId,
        title: title.value.trim() || course.title + ' notebook',
        runtime: runtime.value,
        code: code.value,
        environment: { packages, course_id: course.id },
      });
      currentId = saved.notebook.id;
      return saved.notebook;
    };

    const renderRemoteResult = (executed) => {
      const parts = [];
      if (executed.output) parts.push(executed.output);
      if (executed.result != null) {
        parts.push(typeof executed.result === 'string' ? executed.result : JSON.stringify(executed.result, null, 2));
      }
      if (executed.artifacts?.length) {
        parts.push('Artifacts:\n' + executed.artifacts.map((item) => typeof item === 'string' ? item : JSON.stringify(item)).join('\n'));
      }
      output.textContent = parts.join('\n\n') || 'Execution completed.';
    };

    const runBrowserPython = async () => {
      output.textContent = runtime.value === 'jupyter'
        ? 'Loading browser Jupyter/Python kernel…'
        : 'Loading Python runtime…';
      const pyodide = await loadBrowserPython();
      if (packages.length) {
        await pyodide.loadPackage('micropip');
        const micropip = pyodide.pyimport('micropip');
        try {
          await micropip.install(packages);
        } finally {
          micropip.destroy?.();
        }
      }
      let stdout = '';
      if (pyodide.setStdout) pyodide.setStdout({ batched: (text) => { stdout += text + '\n'; } });
      const value = await pyodide.runPythonAsync(code.value || '');
      output.textContent = stdout + (value == null ? '' : String(value));
    };

    try {
      if (runtime.value === 'mathematica') {
        output.textContent = 'Saving reproducible environment…';
        await saveCurrentNotebook();
        output.textContent = 'Running Mathematica…';
        const executed = await P.lmsExecuteNotebook(currentId);
        renderRemoteResult(executed);
        await refresh();
        return;
      }

      if (runtime.value === 'jupyter') {
        output.textContent = 'Saving reproducible notebook…';
        await saveCurrentNotebook();
        try {
          output.textContent = 'Trying configured Jupyter runner…';
          const executed = await P.lmsExecuteNotebook(currentId);
          renderRemoteResult(executed);
          await refresh();
          return;
        } catch (error) {
          if (error?.message !== 'notebook_runner_not_configured') throw error;
          output.textContent = 'No server Jupyter runner configured; using the reproducible browser Python kernel…';
        }
      }

      await runBrowserPython();
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
  // In a strip of its own, so the form's grid does not stretch the button
  // into a full-width bar that reads as a second text field.
  form.append(goal, C.actions([build]));
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

/* ==========================================================================
   THE COURSE
   This screen used to be every panel the course has, stacked full width in
   one column: the hero, the profile form, return points, the plan, Pulsar
   permissions, the whole curriculum with every lesson open-able in place,
   then the tutor, Zotero, integrations, the group chat, papers, a notebook,
   GitHub, publishing and PKM export. Fourteen cards of equal weight, and
   the lesson the learner came for was somewhere in the middle of them.

   It is now two things side by side. The main column is what is being
   learned: the course overview with its curriculum, or one lesson. The
   side column is the course card (progress, the next step, the
   instructors) and the course tools, listed as plugins and opened in a
   drawer beside the lesson, so a note or a tutor question never costs the
   reader their place. Which lesson is open is the URL
   (/learning/courses/:id/lessons/:lesson), and the index tree in
   ws-five-layer.js draws the same outline, so the two always agree.

   Tools build when first opened, not when the course loads. Before, every
   course open paid for Pulsar grants, Zotero connections and the
   integrations list whether or not the learner looked at them.

   The course payload is cached for a minute per course, so stepping
   through lessons does not refetch the course, its interactions and its
   plan on every click. Anything that changes progress drops the cache.
   ========================================================================== */

const glyph = (name) => window.GravitasIcons?.icon(name, 'g-wi') || '';
const courseCache = new Map();
const COURSE_TTL = 60000;

function forgetCourse(id) {
  courseCache.delete(String(id));
}

async function loadCourse(id) {
  const key = String(id);
  const hit = courseCache.get(key);
  if (hit && Date.now() - hit.at < COURSE_TTL) return { ...hit, fresh: false };
  let data;
  let offline = null;
  try {
    data = await P.lmsCourse(id);
  } catch (networkError) {
    offline = await loadOfflineCourseSnapshot(id);
    if (!offline) throw networkError;
    data = offline.data;
  }
  const course = data.course;
  let plan = null;
  let profile = null;
  if (!offline && course.enrolled) {
    const [interactions, planData, profileData] = await Promise.all([
      P.lmsCourseInteractions(course.id).then((result) => result.interactions || []).catch(() => []),
      P.lmsLearningPlan(course.id).catch(() => null),
      course.registration_schema?.length ? P.lmsRegistrationProfile(course.id).catch(() => null) : null,
    ]);
    course._learningInteractions = interactions;
    plan = planData;
    profile = profileData;
  }
  const bundle = { data, plan, profile, offline, at: Date.now() };
  if (!offline) courseCache.set(key, bundle);
  return { ...bundle, fresh: true };
}

/* The plan names the next required item; when that is a lesson it wins.
   Otherwise the first open lesson the plan does not report as done. */
function pickNext(flat, done, plan) {
  if (plan?.next?.type === 'lesson') {
    const found = flat.find((item) => String(item.lesson.id) === String(plan.next.lesson_id));
    if (found && !found.lesson.locked) return found;
  }
  return flat.find((item) => !item.lesson.locked && !done.has(String(item.lesson.id))) || null;
}

function courseHead(course, compact) {
  const head = el('header', 'ws-doc__head fl-head flc-head');
  if (compact) head.dataset.compact = 'true';
  const eyebrow = P.meta([course.category?.name, course.provider === 'openedx' ? 'Open edX' : '']) || 'Course';
  head.append(el('span', 'fl-eyebrow', eyebrow));
  head.append(el('h1', 'ws-doc__title', course.title));
  if (!compact && course.summary) head.append(el('p', 'ws-doc__meta flc-head__summary', plainText(course.summary)));
  return head;
}

function enrollActions(course, actions, reload) {
  if (course.access_type === 'open') {
    const enroll = action('Enroll', async () => {
      enroll.disabled = true;
      enroll.textContent = 'Enrolling…';
      try {
        await P.lmsEnroll(course.id, {});
        await P.loadBootstrap();
        await reload();
      } catch (error) {
        enroll.disabled = false;
        enroll.textContent = error?.message || 'Try again';
      }
    }, true);
    actions.append(enroll);
  } else if (course.access_type === 'paid') {
    actions.append(el('strong', 'flc-summary__price', (course.price || '—') + ' ' + (course.currency || 'EUR')));
    const paymentState = el('p', 'fl-muted');
    if (course.payment?.enabled && course.payment?.checkout_url) {
      const checkout = action('Continue to checkout', async () => {
        checkout.disabled = true;
        checkout.textContent = 'Preparing checkout…';
        const checkoutWindow = window.open('about:blank', '_blank', 'noopener');
        try {
          const result = await P.lmsStartCheckout(course.id);
          const url = result.payment?.checkout_url;
          paymentState.textContent = result.payment
            ? 'Payment status · ' + label(result.payment.status)
            : '';
          if (url && checkoutWindow) checkoutWindow.location.href = url;
          else if (url) location.href = url;
          else checkoutWindow?.close();
          checkout.textContent = 'Open checkout';
        } catch (error) {
          checkoutWindow?.close();
          paymentState.textContent = error?.message || 'Checkout could not be prepared.';
          paymentState.dataset.tone = 'bad';
          checkout.textContent = 'Continue to checkout';
        } finally {
          checkout.disabled = false;
        }
      }, true);
      actions.append(checkout, paymentState);
      const refreshPayment = async () => {
        if (!actions.isConnected) return false;
        try {
          const result = await P.lmsCheckout(course.id);
          if (result.enrolled) {
            await P.loadBootstrap();
            await reload();
            return true;
          }
          const latest = (result.payments || [])[0];
          paymentState.textContent = latest
            ? 'Payment status · ' + label(latest.status) + (latest.external_reference ? ' · ' + latest.external_reference : '')
            : 'Access activates after payment is verified.';
        } catch {
          paymentState.textContent = 'Access activates after payment is verified.';
        }
        return false;
      };
      refreshPayment();
      const paymentTimer = window.setInterval(async () => {
        if (!actions.isConnected || await refreshPayment()) window.clearInterval(paymentTimer);
      }, 10000);
    } else {
      paymentState.textContent = course.payment?.enabled
        ? 'Payment is configured, but the checkout URL is not available yet.'
        : 'Checkout is not enabled for this course.';
      actions.append(paymentState);
    }
  } else {
    actions.append(el('p', 'fl-muted', 'This course is invite-only. A Core administrator can grant enrollment.'));
  }
}

function courseShare(course) {
  return Math.max(0, Math.min(100, Number(course.progress_percent) || 0));
}

/* "2 of 8 required lessons" when the plan reports required lessons;
   otherwise only the percentage the enrollment carries. */
function progressCopy(course, plan) {
  const required = (plan?.checklist || []).filter((item) => item.type === 'lesson');
  return required.length
    ? `${required.filter((item) => item.done).length} of ${required.length} required lessons`
    : `${Math.round(courseShare(course))}% complete`;
}

function courseBadges(course) {
  const tags = el('div', 'fl-badges');
  if (course.enrolled && course.enrollment_status) tags.append(badge(label(course.enrollment_status), 'ok'));
  tags.append(badge(label(course.access_type)));
  if (course.status && course.status !== 'published') tags.append(badge(label(course.status)));
  if (course.certificate_enabled) tags.append(badge('Gravitas+ Certificate'));
  (course.tags || []).forEach((item) => tags.append(badge(item.name)));
  return tags;
}

/* The one next step: enroll (or pay) before enrollment, continue after. */
function courseActions(course, { plan, nextUp, current = null, openLesson, reload, go }, cls) {
  const actions = el('div', cls);
  if (!course.enrolled) {
    enrollActions(course, actions, reload);
    return actions;
  }
  if (nextUp && (!current || String(current.lesson.id) !== String(nextUp.lesson.id))) {
    const started = Number(course.progress_percent) > 0 || (plan?.done || 0) > 0;
    actions.append(action(started ? 'Continue learning' : 'Start the course', () => openLesson(nextUp.lesson.id), true));
  }
  if (course.provider === 'openedx' && course.openedx_launch_url) {
    const openedx = el('a', 'ws-btn', 'Open learning engine');
    openedx.href = course.openedx_launch_url;
    openedx.target = '_blank';
    openedx.rel = 'noopener';
    actions.append(openedx);
  }
  if (course.certificate?.valid) actions.append(link(go, 'View certificate', '/workspace/learning/certificates'));
  return actions;
}

/* The side card beside a lesson: where the learner stands and the one
   thing to do next. The ring is drawn from progress_percent, which the
   enrollment carries. */
function courseSummaryCard(course, options) {
  const card = el('section', 'flc-card flc-summary');
  if (course.enrolled) {
    const share = courseShare(course);
    const progress = el('div', 'flc-summary__progress');
    progress.append(C.ring(share, { size: 52, label: `${Math.round(share)}% complete` }));
    const text = el('div', 'flc-summary__figures');
    text.append(el('strong', null, `${Math.round(share)}% complete`));
    text.append(el('small', 'fl-muted', progressCopy(course, options.plan)));
    progress.append(text);
    card.append(progress);
  }
  card.append(courseBadges(course));
  if (course.instructors?.length) {
    const people = el('div', 'flc-summary__people');
    people.append(el('span', 'fl-eyebrow', course.instructors.length > 1 ? 'Instructors' : 'Instructor'));
    people.append(el('span', null, course.instructors.map((item) => item.name).join(', ')));
    card.append(people);
  }
  const actions = courseActions(course, options, 'flc-summary__actions');
  if (actions.childElementCount) card.append(actions);
  return card;
}

/* The top of the course overview: the cover beside the course, as a
   reader meets it in a catalog, with where they stand and the next step. */
function courseHero(course, options) {
  const hero = el('header', 'flc-hero');
  const info = el('div', 'flc-hero__info');
  const top = el('div', 'flc-hero__top');
  if (course.enrolled) {
    const pill = el('span', 'flc-pill');
    pill.append(C.ring(courseShare(course), { size: 22, label: `${Math.round(courseShare(course))}% complete` }));
    pill.append(el('span', null, progressCopy(course, options.plan)));
    top.append(pill);
  }
  const eyebrow = P.meta([course.category?.name, course.provider === 'openedx' ? 'Open edX' : '']);
  if (eyebrow) top.append(el('span', 'fl-eyebrow', eyebrow));
  if (top.childElementCount) info.append(top);
  info.append(el('h1', 'ws-doc__title flc-hero__title', course.title));
  if (course.summary) info.append(el('p', 'flc-hero__summary', plainText(course.summary)));
  if (course.instructors?.length) {
    info.append(el('p', 'flc-hero__people', `Taught by ${course.instructors.map((item) => item.name).join(', ')}`));
  }
  info.append(courseBadges(course));
  const actions = courseActions(course, options, 'flc-hero__actions');
  if (actions.childElementCount) info.append(actions);
  const media = el('div', 'flc-hero__media');
  media.append(courseCover(course, 'flc-cover', { eager: true }));
  hero.append(info, media);
  return hero;
}

function offlineExportPanel(course, data) {
  const box = section('Offline & export', 'Keep a read-only copy of this course on this device, or download it as a document.');
  const actions = el('div', 'fl-form-actions flc-export');
  if (course.learning_config?.offline_enabled !== false) {
    const saveOffline = action('Save offline', async () => {
      saveOffline.disabled = true;
      saveOffline.textContent = 'Saving…';
      const ok = await saveOfflineCourseSnapshot(data);
      saveOffline.textContent = ok ? 'Saved offline' : 'Offline save failed';
      saveOffline.disabled = false;
    }, true);
    actions.append(saveOffline);
  }
  for (const [fmt, title] of [['md', 'Markdown'], ['tex', 'LaTeX'], ['docx', 'DOCX']]) {
    const download = el('a', 'ws-btn', title);
    download.href = `/api/lms/courses/${course.id}/export/${fmt}/`;
    download.download = '';
    actions.append(download);
  }
  box.body.append(actions);
  return box.box;
}

/* Every tool a course offers, in the order a learner reaches for them.
   learning_config switches a tool off; absent means on, as before. */
function coursePlugins(course, data, { openLesson }) {
  const on = (key) => course.learning_config?.[key] !== false;
  const files = (course.assets || []).length;
  return [
    { group: 'Study', key: 'plan', title: 'Course plan', note: 'Lessons, tasks and reminders', mark: 'tasks', build: () => coursePlanPanel(course, openLesson) },
    { group: 'Study', key: 'returns', title: 'Return points', note: 'Notes, highlights, bookmarks', mark: 'learning', build: () => courseReturnPointsPanel(course, openLesson) },
    on('ai_enabled') && { group: 'Study', key: 'tutor', title: 'AI Tutor', note: 'Ask Pulsar about this course', mark: 'pulsar', build: () => courseTutorPanel(course) },
    on('discussions_enabled') && { group: 'Study', key: 'group', title: 'Course group', note: 'Learners and instructors', mark: 'collaboration', build: () => courseDiscussionPanel(course) },
    files && { group: 'Study', key: 'files', title: 'Course files', note: `${files} file${files === 1 ? '' : 's'} and embeds`, mark: 'files', build: () => courseAssetsPanel(course) },
    on('literature_enabled') && { group: 'Research', key: 'papers', title: 'Related papers', note: 'arXiv, INSPIRE, Semantic Scholar', mark: 'search', build: () => literaturePanel(course) },
    on('zotero_enabled') && { group: 'Research', key: 'zotero', title: 'Zotero sources', note: 'Your reference library', mark: 'library', build: () => zoteroConnectionPanel() },
    on('notebook_enabled') && { group: 'Research', key: 'notebook', title: 'Notebook', note: 'Python in the browser, .ipynb', mark: 'datasets', build: () => notebookPanel(course) },
    on('git_enabled') && { group: 'Research', key: 'git', title: 'GitHub', note: 'Push work for review', mark: 'cycle', build: () => gitPanel(course) },
    { group: 'Connect', key: 'pulsar', title: 'Pulsar access', note: 'Projects Pulsar may read', mark: 'secure', build: () => pulsarAccessPanel(course) },
    { group: 'Connect', key: 'tools', title: 'Connected tools', note: 'GitHub, LinkedIn, ORCID, Medium', mark: 'share', build: () => learningIntegrationsPanel() },
    on('social_publish_enabled') && { group: 'Connect', key: 'publish', title: 'Publish', note: 'Share an achievement', mark: 'external', build: () => publishingPanel(course) },
    { group: 'Connect', key: 'export', title: 'Offline & export', note: 'Save offline, Markdown, LaTeX, DOCX', mark: 'content', build: () => offlineExportPanel(course, data) },
    on('pkm_enabled') && { group: 'Connect', key: 'pkm', title: 'Export to PKM', note: 'Obsidian, Logseq, Notion, Roam', mark: 'mindmap', build: () => pkmExportPanel(course) },
  ].filter(Boolean);
}

const PLUGIN_SERIES = { Study: '1', Research: '2', Connect: '4' };

/* A sheet over the right edge of the workspace. A tool keeps its state
   between openings — a half-written tutor question, a notebook — because
   each panel is built once per course visit and only hidden after. */
function pluginDrawer() {
  const root = el('div', 'flc-drawer');
  root.dataset.open = 'false';
  root.inert = true;
  const scrim = el('div', 'flc-drawer__scrim');
  const sheet = el('section', 'flc-drawer__sheet');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.tabIndex = -1;
  const close = el('button', 'flc-drawer__close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close tool');
  close.innerHTML = glyph('close') || '×';
  const body = el('div', 'flc-drawer__body');
  sheet.append(close, body);
  root.append(scrim, sheet);

  const built = new Map();
  let current = null;
  let trigger = null;
  const listeners = new Set();
  const changed = (key) => listeners.forEach((fn) => fn(key));

  const show = (key) => {
    for (const node of body.children) node.hidden = node.dataset.plugin !== key;
  };
  const hide = () => {
    if (root.dataset.open !== 'true') return;
    root.dataset.open = 'false';
    root.inert = true;
    current = null;
    changed(null);
    trigger?.focus?.({ preventScroll: true });
    trigger = null;
  };
  const open = async (plugin, from = null) => {
    if (current === plugin.key && root.dataset.open === 'true') {
      hide();
      return;
    }
    trigger = from;
    current = plugin.key;
    changed(plugin.key);
    root.dataset.open = 'true';
    root.inert = false;
    sheet.setAttribute('aria-label', plugin.title);
    show(plugin.key);
    close.focus({ preventScroll: true });
    if (built.has(plugin.key)) return;

    const wait = el('div', 'flc-drawer__wait');
    wait.dataset.plugin = plugin.key;
    wait.append(el('div', 'fl-skeleton'), el('div', 'fl-skeleton'));
    body.append(wait);
    built.set(plugin.key, wait);
    show(current);
    let made = null;
    try {
      made = await plugin.build();
    } catch (error) {
      wait.replaceChildren(empty(`${plugin.title} could not be opened`, error?.message || 'Try again.'));
      return;
    }
    if (!made) {
      wait.replaceChildren(empty(plugin.title, 'Nothing to show here yet.'));
      return;
    }
    made.dataset.plugin = plugin.key;
    wait.replaceWith(made);
    built.set(plugin.key, made);
    show(current);
  };

  scrim.addEventListener('click', hide);
  close.addEventListener('click', hide);
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      hide();
    }
  });
  return { root, open, close: hide, onChange: (fn) => listeners.add(fn) };
}

function pluginLauncher(plugins, drawer, emptyNote) {
  const card = el('section', 'flc-card flc-tools');
  card.append(el('h2', 'flc-card__title', 'Course tools'));
  if (!plugins.length) {
    card.append(el('p', 'fl-muted flc-tools__empty', emptyNote));
    return card;
  }
  const buttons = new Map();
  let group = '';
  let list = null;
  for (const plugin of plugins) {
    if (plugin.group !== group) {
      group = plugin.group;
      card.append(el('div', 'flc-tools__group', group));
      list = el('div', 'flc-tools__list');
      card.append(list);
    }
    const button = el('button', 'flc-tool');
    button.type = 'button';
    button.dataset.series = PLUGIN_SERIES[plugin.group] || '1';
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    const mark = el('span', 'flc-tool__mark');
    mark.innerHTML = glyph(plugin.mark);
    const text = el('span', 'flc-tool__text');
    text.append(el('span', 'flc-tool__title', plugin.title), el('small', 'flc-tool__note', plugin.note));
    button.append(mark, text);
    button.addEventListener('click', () => drawer.open(plugin, button));
    buttons.set(plugin.key, button);
    list.append(button);
  }
  drawer.onChange((key) => {
    for (const [name, button] of buttons) button.setAttribute('aria-expanded', String(name === key));
  });
  return card;
}

function nextUpCard(item, started, openLesson) {
  const card = el('section', 'flc-next');
  const text = el('div', 'flc-next__text');
  text.append(
    el('span', 'fl-eyebrow', started ? 'Up next' : 'Start here'),
    el('strong', 'flc-next__title', item.lesson.title),
    el('small', 'fl-muted', P.meta([item.module.title, lessonMeta(item.lesson)])),
  );
  card.append(text, action(started ? 'Continue' : 'Start lesson', () => openLesson(item.lesson.id), true));
  return card;
}

function aboutPanel(course) {
  const box = section('About this course');
  box.box.classList.add('flc-about');
  box.body.append(markdown(course.description));
  return box.box;
}

const minutes = (seconds) => Math.ceil((Number(seconds) || 0) / 60);

function durationText(seconds) {
  const total = minutes(seconds);
  if (!total) return '';
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/* The figures a learner sizes a course by. Total time is shown only when
   the course team entered lesson durations; a course with none gets no
   "0 min" that would read as an empty course. */
function courseStats(course) {
  const modules = course.modules || [];
  const lessons = modules.flatMap((module) => module.lessons || []);
  const seconds = lessons.reduce((sum, lesson) => sum + (Number(lesson.duration_seconds) || 0), 0);
  const strip = el('div', 'flc-stats');
  const stat = (mark, value, text) => {
    const item = el('div', 'flc-stat');
    const glyphSlot = el('span', 'flc-stat__mark');
    glyphSlot.innerHTML = glyph(mark);
    const words = el('span', 'flc-stat__text');
    words.append(el('strong', null, String(value)), el('span', 'fl-muted', text));
    item.append(glyphSlot, words);
    strip.append(item);
  };
  stat('content', lessons.length, lessons.length === 1 ? 'lesson' : 'lessons');
  stat('projects', modules.length, modules.length === 1 ? 'module' : 'modules');
  const assessments = (course.assessments || []).length;
  if (assessments) stat('target', assessments, assessments === 1 ? 'assessment' : 'assessments');
  if (seconds) stat('activity', durationText(seconds), 'in total');
  return strip;
}

/* The curriculum as an accordion, one row per module: its number, its
   title, how long it runs, how many lessons and how many are done. The
   module holding the next lesson opens by itself, the rest stay folded,
   so a twelve-module course is a page of twelve rows rather than a wall. */
function curriculumPanel(course, done, nextUp, openLesson) {
  const modules = course.modules || [];
  const box = el('section', 'flc-curriculum');
  box.append(courseStats(course));
  if (!modules.length) {
    box.append(empty('No lessons published yet', course.provider === 'openedx' ? 'This course is delivered by Open edX. Use Open learning engine when it becomes available.' : 'The course structure has not been published.'));
    return box;
  }
  const openId = nextUp ? String(nextUp.module.id) : String(modules[0].id);
  let number = 0;
  modules.forEach((module, index) => {
    const lessons = module.lessons || [];
    const finished = lessons.filter((lesson) => done.has(String(lesson.id))).length;
    const part = el('details', 'flc-acc');
    part.open = String(module.id) === openId;
    if (lessons.length && finished === lessons.length) part.dataset.state = 'done';

    const head = el('summary', 'flc-acc__head');
    head.append(el('span', 'flc-acc__num', String(index + 1)));
    const titles = el('span', 'flc-acc__titles');
    titles.append(el('strong', 'flc-acc__title', module.title), el('small', 'fl-muted', module.summary ? plainText(module.summary) : `Module ${index + 1}`));
    head.append(titles);
    const chips = el('span', 'flc-acc__chips');
    const seconds = lessons.reduce((sum, lesson) => sum + (Number(lesson.duration_seconds) || 0), 0);
    if (seconds) chips.append(el('span', 'flc-chip', durationText(seconds)));
    chips.append(el('span', 'flc-chip', `${lessons.length} lesson${lessons.length === 1 ? '' : 's'}`));
    if (finished) chips.append(el('span', 'flc-chip', `${finished}/${lessons.length} done`));
    head.append(chips);
    const twist = el('span', 'flc-acc__twist');
    twist.innerHTML = glyph('chevron');
    head.append(twist);
    part.append(head);

    const list = el('ol', 'flc-lessons');
    for (const lesson of lessons) {
      number += 1;
      const state = lesson.locked ? 'locked' : done.has(String(lesson.id)) ? 'done' : '';
      const item = el('li');
      const button = el('button', 'flc-lesson-row');
      button.type = 'button';
      if (state) button.dataset.state = state;
      const mark = el('span', 'flc-lesson-row__mark');
      if (state === 'done') mark.innerHTML = glyph('check');
      else if (state === 'locked') mark.innerHTML = glyph('secure');
      else mark.textContent = String(number);
      const text = el('span', 'flc-lesson-row__text');
      text.append(el('span', 'flc-lesson-row__title', lesson.title), el('small', 'fl-muted', P.meta([
        label(lesson.kind),
        lesson.is_preview ? 'Preview' : '',
        lesson.is_required === false ? 'Optional' : '',
      ])));
      button.append(mark, text);
      const side = el('span', 'flc-lesson-row__side');
      if (nextUp && String(nextUp.lesson.id) === String(lesson.id)) side.append(el('span', 'flc-lesson-row__tag', 'Up next'));
      if (lesson.duration_seconds) side.append(el('span', 'flc-lesson-row__time', durationText(lesson.duration_seconds)));
      button.append(side);
      button.addEventListener('click', () => openLesson(lesson.id));
      item.append(button);
      list.append(item);
    }
    if (!lessons.length) list.append(el('li', 'fl-muted flc-lessons__none', 'No lessons in this module yet.'));
    part.append(list);
    box.append(part);
  });
  return box;
}

function instructorsPanel(course) {
  if (!course.instructors?.length) return null;
  const box = section(course.instructors.length > 1 ? 'Instructors' : 'Instructor');
  const list = el('div', 'flc-people');
  for (const person of course.instructors) {
    const item = el('div', 'flc-person');
    item.append(el('span', 'flc-person__mark', (person.name || person.email || '?').trim().charAt(0).toUpperCase()));
    const text = el('span', 'flc-person__text');
    text.append(el('strong', null, person.name || person.email || 'Instructor'));
    if (person.role) text.append(el('small', 'fl-muted', label(person.role)));
    item.append(text);
    list.append(item);
  }
  box.body.append(list);
  return box.box;
}

function toolsGrid(plugins, drawer) {
  const grid = el('div', 'flc-toolgrid');
  const buttons = new Map();
  for (const plugin of plugins) {
    const button = el('button', 'flc-toolcard');
    button.type = 'button';
    button.dataset.series = PLUGIN_SERIES[plugin.group] || '1';
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    const mark = el('span', 'flc-tool__mark');
    mark.innerHTML = glyph(plugin.mark);
    const text = el('span', 'flc-tool__text');
    text.append(el('span', 'flc-tool__title', plugin.title), el('small', 'flc-tool__note', plugin.note));
    button.append(mark, text, el('span', 'flc-toolcard__group', plugin.group));
    button.addEventListener('click', () => drawer.open(plugin, button));
    buttons.set(plugin.key, button);
    grid.append(button);
  }
  drawer.onChange((key) => {
    for (const [name, button] of buttons) button.setAttribute('aria-expanded', String(name === key));
  });
  return grid;
}

/* The course overview is tabbed, like the course pages learners already
   know elsewhere: Overview, Course content, Discussion, Notes, Tools. Each
   tab is built the first time it is opened and kept after, and the tab is
   the URL hash, so a reload or a shared link lands on the same one. Tabs
   that need an enrollment or a connection are left out, not greyed. */
function courseTabs(course, data, options) {
  const { plan, done, nextUp, offline, openLesson, reload, drawer } = options;
  const live = course.enrolled && !offline;
  const tabs = [['overview', 'Overview'], ['content', 'Course content']];
  if (live && course.learning_config?.discussions_enabled !== false) tabs.push(['discussion', 'Discussion']);
  if (live) tabs.push(['notes', 'Notes'], ['tools', 'Tools']);

  const build = async (key) => {
    if (key === 'overview') {
      const parts = [];
      if (course.enrolled && nextUp) parts.push(nextUpCard(nextUp, courseShare(course) > 0 || done.size > 0, openLesson));
      if (course.description) parts.push(aboutPanel(course));
      parts.push(instructorsPanel(course));
      if (live) parts.push(await coursePlanPanel(course, openLesson));
      if (course.certificate) {
        const cert = section('Gravitas+ Certificate');
        cert.body.append(row({
          title: course.certificate.valid ? 'Certificate issued' : 'Certificate revoked',
          meta: P.meta([course.certificate.code, date(course.certificate.issued_at)]),
        }));
        parts.push(cert.box);
      }
      return parts;
    }
    if (key === 'content') {
      return [
        curriculumPanel(course, done, course.enrolled ? nextUp : null, openLesson),
        ...(course.assessments || []).map((assessment) => assessmentCard(assessment, course, () => reload())),
      ];
    }
    if (key === 'discussion') return [courseDiscussionPanel(course)];
    if (key === 'notes') return [courseReturnPointsPanel(course, openLesson)];
    const tools = coursePlugins(course, data, { openLesson }).filter((item) => !['plan', 'returns', 'group'].includes(item.key));
    return [toolsGrid(tools, drawer)];
  };

  const box = el('section', 'flc-tabbed');
  const bar = el('div', 'flc-tabs');
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', 'Course sections');
  const panel = el('div', 'flc-tabpanel');
  const panes = new Map();
  const buttons = new Map();
  const wanted = location.hash.replace(/^#/, '');
  let active = tabs.some(([key]) => key === wanted) ? wanted : (course.enrolled ? 'content' : 'overview');

  /* Panes differ a lot in height: Discussion carries a 32rem chat, Notes is
     often one empty state. Swapping a tall pane for a short one shrank the
     scroller under the reader, so the browser clamped scrollTop and the page
     jumped upwards. Before the swap the panel holds its old height. After
     the swap the scroll position is put back: the reader's own place, or,
     when the tab bar was stuck, the point where the bar sticks, so the new
     pane starts right under it. The panel is then given only the height
     that position needs. */
  const keepPlace = () => {
    const scroller = box.closest('.ws-view');
    if (!scroller) return () => {};
    const top = scroller.scrollTop;
    panel.style.minHeight = `${panel.offsetHeight}px`;
    return () => {
      const stick = box.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      const target = Math.min(top, Math.max(0, stick));
      panel.style.minHeight = '';
      const short = target + scroller.clientHeight - scroller.scrollHeight;
      if (short > 0) panel.style.minHeight = `${panel.offsetHeight + short}px`;
      scroller.scrollTop = target;
    };
  };

  const select = async (key, remember) => {
    active = key;
    for (const [name, button] of buttons) {
      const on = name === key;
      button.setAttribute('aria-selected', String(on));
      button.tabIndex = on ? 0 : -1;
    }
    if (remember) history.replaceState(history.state, '', `${location.pathname}${location.search}#${key}`);
    const restore = keepPlace();
    let pane = panes.get(key);
    const fresh = !pane;
    if (fresh) {
      pane = el('div', 'flc-tabpanel__pane');
      pane.id = `flc-tab-${key}`;
      pane.setAttribute('role', 'tabpanel');
      pane.setAttribute('aria-labelledby', `flc-tabbtn-${key}`);
      pane.append(el('div', 'fl-skeleton'));
      panel.append(pane);
      panes.set(key, pane);
    }
    // Hide the old pane now rather than after the build, or both panes stand
    // stacked while a slow one (Overview waits on the plan) loads.
    for (const [name, node] of panes) node.hidden = name !== active;
    restore();
    if (!fresh) return;
    try {
      pane.replaceChildren(...(await build(key)).filter(Boolean));
    } catch (error) {
      pane.replaceChildren(empty('This section could not be loaded', error?.message || 'Try again.'));
    }
  };

  for (const [key, text] of tabs) {
    const button = el('button', 'flc-tab', text);
    button.type = 'button';
    button.id = `flc-tabbtn-${key}`;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', `flc-tab-${key}`);
    button.addEventListener('click', () => select(key, true));
    buttons.set(key, button);
    bar.append(button);
  }
  bar.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const keys = tabs.map(([key]) => key);
    let index = keys.indexOf(active);
    if (event.key === 'ArrowRight') index = (index + 1) % keys.length;
    if (event.key === 'ArrowLeft') index = (index - 1 + keys.length) % keys.length;
    if (event.key === 'Home') index = 0;
    if (event.key === 'End') index = keys.length - 1;
    select(keys[index], true);
    buttons.get(keys[index]).focus();
  });

  box.append(bar, panel);
  select(active, false);
  return box;
}

function lessonPager(prev, next, openLesson, goHome) {
  const nav = el('nav', 'flc-pager');
  nav.setAttribute('aria-label', 'Lessons');
  const cell = (item, dir) => {
    const button = el('button', 'flc-pager__link');
    button.type = 'button';
    button.dataset.dir = dir;
    button.append(
      el('small', 'fl-muted', dir === 'prev' ? '← Previous' : item ? 'Next →' : 'End of the outline'),
      el('strong', null, item ? item.lesson.title : 'Back to the course overview'),
    );
    button.addEventListener('click', () => (item ? openLesson(item.lesson.id) : goHome()));
    return button;
  };
  nav.append(prev ? cell(prev, 'prev') : el('span'), cell(next, 'next'));
  return nav;
}

export async function renderCourse(host, id, ctx = {}) {
  const { go } = ctx;
  const token = `${Date.now()}-${Math.random()}`;
  host.dataset.courseRender = token;
  if (!courseCache.has(String(id))) loading(host, 'Course');
  try {
    const bundle = await loadCourse(id);
    if (host.dataset.courseRender !== token) return;
    const { data, plan, profile, offline } = bundle;
    const course = data.course;
    const base = `/workspace/learning/courses/${course.id}`;
    if (bundle.fresh && !offline && course.enrolled) P.lmsCourseEvent(course.id, { kind: 'course.open' }).catch(() => {});

    const done = new Set((plan?.checklist || [])
      .filter((item) => item.type === 'lesson' && item.done)
      .map((item) => String(item.lesson_id)));
    const flat = [];
    for (const module of course.modules || []) {
      for (const lesson of module.lessons || []) flat.push({ lesson, module });
    }
    const at = ctx.lesson ? flat.findIndex((item) => String(item.lesson.id) === String(ctx.lesson)) : -1;
    const current = at >= 0 ? flat[at] : null;
    const nextUp = pickNext(flat, done, plan);

    ctx.outline?.(course, done);
    const parent = course.enrolled
      ? { label: 'My Learning', path: '/workspace/learning/my' }
      : { label: 'Course Catalog', path: '/workspace/learning/catalog' };
    ctx.crumbs?.(ctx.lesson
      ? [parent, { label: course.title, path: base }, { label: current?.lesson.title || 'Lesson' }]
      : [parent, { label: course.title }]);

    const drawer = pluginDrawer();
    const goHome = () => go(base);
    const openLesson = (lessonId, focus = null) => {
      drawer.close();
      const path = `${base}/lessons/${lessonId}`;
      if (location.pathname.replace(/\/$/, '') === path) {
        if (focus) focusLearningInteraction(focus);
        else document.getElementById(`lesson-${lessonId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      pendingFocus = focus;
      go(path);
    };
    /* null redraws this screen; a lesson id (or '' for the overview) moves
       there. Either way the next draw reads the course fresh. */
    const reload = async (target = null) => {
      forgetCourse(course.id);
      if (target === null) return renderCourse(host, id, ctx);
      const path = target ? `${base}/lessons/${target}` : base;
      if (location.pathname.replace(/\/$/, '') === path) return renderCourse(host, id, ctx);
      go(path);
      return undefined;
    };

    host.innerHTML = '';
    const wrap = el('div', 'ws-doc ws-doc--wide fl-doc flc');
    host.append(wrap);
    const viewerId = P.platform?.user?.user?.id;
    const canAuthor = !!viewerId && (course.instructors || []).some(
      (item) => String(item.user_id) === String(viewerId),
    );
    if (!ctx.lesson && canAuthor) {
      const authorBar = el('div', 'fl-toolbar fl-course-author-bar');
      authorBar.append(
        el('span', 'fl-muted', 'You are an instructor for this course. Edits are saved as a private draft until you publish them.'),
        action('Edit course', () => go(`${base}/edit`), true),
      );
      wrap.append(authorBar);
    }

    const notice = offline ? el('div', 'ws-alert') : null;
    if (notice) {
      notice.append(
        el('strong', 'ws-alert__title', 'Offline read mode'),
        el('p', '', 'Showing the course snapshot saved ' + new Date(offline.saved_at).toLocaleString() + '. Progress updates, AI, Lab, discussions and external tools need a connection.'),
      );
    }
    const registration = course.enrolled && !offline
      ? courseRegistrationPanel(course, profile, () => reload())
      : null;
    const options = { plan, nextUp, current, openLesson, reload, go };

    if (!ctx.lesson) {
      // The overview: cover and course on top, then the tabbed sections.
      wrap.append(courseHero(course, options));
      if (notice) wrap.append(notice);
      if (registration) wrap.append(registration);
      wrap.append(courseTabs(course, data, { plan, done, nextUp, offline, openLesson, reload, drawer }));
    } else {
      // One lesson: the lesson, with the course card and the tools beside it.
      wrap.append(courseHead(course, true));
      if (notice) wrap.append(notice);
      const layout = el('div', 'flc-layout');
      const main = el('div', 'flc-main');
      const aside = el('aside', 'flc-aside');
      aside.setAttribute('aria-label', 'Course progress and tools');
      layout.append(main, aside);
      wrap.append(layout);
      if (registration) main.append(registration);
      if (!current) {
        main.append(empty('Lesson not found', 'This lesson is not published in the course any more, or the link is wrong.'));
        main.append(C.actions([action('Back to the course overview', goHome, true)]));
      } else {
        main.append(lessonView(current.lesson, course, {
          position: { module: current.module, index: at + 1, total: flat.length, done: done.has(String(current.lesson.id)) },
          next: flat[at + 1] || null,
          offline: !!offline,
          reload,
          openLesson,
          goHome,
        }));
        main.append(lessonPager(flat[at - 1] || null, flat[at + 1] || null, openLesson, goHome));
      }
      aside.append(courseSummaryCard(course, options));
      const plugins = course.enrolled && !offline ? coursePlugins(course, data, { openLesson }) : [];
      aside.append(pluginLauncher(plugins, drawer, offline
        ? 'Course tools need a connection.'
        : 'Notes, the AI tutor, the course group and the research tools open once you are enrolled.'));
    }
    wrap.append(drawer.root);

    // A new lesson starts at its top; a redraw of the same one stays put.
    if (host.dataset.coursePath !== location.pathname) {
      host.dataset.coursePath = location.pathname;
      const scroller = host.closest('.ws-main');
      if (scroller) scroller.scrollTop = 0;
    }
    if (current) {
      if (pendingFocus && String(pendingFocus.lesson_id) === String(current.lesson.id)) {
        const item = pendingFocus;
        pendingFocus = null;
        focusLearningInteraction(item);
      }
    }
  } catch (error) {
    if (host.dataset.courseRender !== token) return;
    errorView(host, 'Course', error, () => renderCourse(host, id, ctx));
  }
}
