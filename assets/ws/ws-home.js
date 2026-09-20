/* ==========================================================================
   GRAVITAS+ WORKSPACE  ·  DASHBOARD
   Home, and the Overview of each workspace. One module, because the three
   screens are the same screen with different sources: greeting, focus, what
   is due today, what is next, and what is running.

   Every figure comes from the backend. The one thing computed here is the
   focus paragraph, and it is arithmetic over real due dates rather than
   prose from a model. It is labelled as such. A dashboard that opens with a
   confident sentence nobody can check is the fastest way to lose a team's
   trust in the rest of the numbers on it.
   ========================================================================== */

import * as P from './ws-platform.js?v=20260919-planning1';
import * as C from './ws-charts.js?v=20260919-charts2';
import { el, panel, row, empty, skeleton, failure, stats } from './ws-views.js?v=20260920-dashboard3';
import { availableWorkspaces } from './ws-nav.js?v=20260919-planning1';
import * as K from './ws-kms.js';

const icon = (name) => window.GravitasIcons.icon(name, 'g-wi');

/* ==========================================================================
   THE HERO: greeting, clock, weather
   ========================================================================== */

function greeting(hour) {
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/* The first name only. "Good evening, Sajad Aghapour" reads like a letter
   from a bank; a greeting uses the name people are called by. Falls back to
   the local part of the address, then to nothing at all, because "Good
   evening, User" is worse than "Good evening". */
function firstName(user) {
  if (!user) return '';
  const full = (user.name || user.display_name || user.first_name || '').trim();
  if (full) return full.split(/\s+/)[0];
  const email = (user.email || '').trim();
  if (!email) return '';
  const local = email.split('@')[0].split(/[._-]/)[0];
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : '';
}

let clockTimer = 0;
let intelligenceTimer = 0;

export function stopClock() {
  clearInterval(clockTimer);
  clockTimer = 0;
  clearInterval(intelligenceTimer);
  intelligenceTimer = 0;
}

function heroEl(user) {
  const hero = el('section', 'v-hero');

  const left = el('div', 'v-hero__lead');
  const name = firstName(user);
  const now = new Date();

  const hello = el('h1', 'v-hero__hello', name ? `${greeting(now.getHours())}, ${name}` : greeting(now.getHours()));
  const date = el('p', 'v-hero__date', now.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }));
  left.append(hello, date);

  const right = el('div', 'v-hero__aside');

  /* The clock ticks every second, which is the only reason it is worth
     showing at all: a time that updates once a minute is a time that is
     wrong for most of the minute you are looking at it. The interval is
     cleared whenever the dashboard is replaced, so navigating away does not
     leave a timer writing into a detached node. */
  const clock = el('time', 'v-hero__clock');
  const tick = () => {
    const at = new Date();
    clock.textContent = at.toLocaleTimeString('en-GB', { hour12: false });
    clock.dateTime = at.toISOString();
  };
  tick();
  stopClock();
  clockTimer = setInterval(tick, 1000);

  const weather = el('div', 'v-hero__weather');
  weather.hidden = true;
  right.append(clock, weather);
  loadWeather(weather);

  hero.append(left, right);
  return hero;
}

function workspaceOverviewHead(scope, user) {
  const head = el('header', 'ws-doc__head fl-head wc-workspace-head');
  const copy = el('div');
  const isCore = scope === 'core';
  copy.append(
    el('h1', 'ws-doc__title', isCore ? 'Core Workspace' : 'Research'),
    el(
      'p',
      'ws-doc__meta',
      isCore
        ? 'Execution, content, planning and operating work in one view.'
        : 'Projects, knowledge, collaboration and research intelligence in one view.',
    ),
  );

  const context = el('div', 'wc-ident wc-workspace-context');
  const mark = el('span', 'wc-ident__avatar');
  mark.innerHTML = icon(isCore ? 'space-core' : 'space-research');
  const text = el('div');
  const now = new Date();
  text.append(
    el('span', 'wc-ident__name', greeting(now.getHours())),
    el('span', 'wc-ident__meta', now.toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    })),
  );
  context.append(mark, text);
  head.append(copy, context);
  return head;
}

/* ---- Weather ------------------------------------------------------------
   Open-Meteo, which needs no key and no account. It is the one request the
   workspace makes to anything outside Gravitas, so it is worth being precise
   about what leaves: a fixed pair of coordinates for a city, and nothing
   else. No account identifier, no page, no browser geolocation prompt. The
   city defaults to Potsdam, the address in the site's own legal notice, and
   Settings can change it.

   It fails silently and stays hidden. Weather is decoration on a work
   dashboard; an error message where the temperature should be would be
   worth less than the empty space. */

const WEATHER_PLACES = {
  potsdam: { label: 'Potsdam', lat: 52.4009, lon: 13.0591 },
  berlin: { label: 'Berlin', lat: 52.52, lon: 13.405 },
  hamburg: { label: 'Hamburg', lat: 53.5511, lon: 9.9937 },
  munich: { label: 'Munich', lat: 48.1351, lon: 11.582 },
  vienna: { label: 'Vienna', lat: 48.2082, lon: 16.3738 },
  zurich: { label: 'Zurich', lat: 47.3769, lon: 8.5417 },
  london: { label: 'London', lat: 51.5072, lon: -0.1276 },
  tehran: { label: 'Tehran', lat: 35.6892, lon: 51.389 },
};

export function weatherPlace() {
  try {
    const saved = localStorage.getItem('gravitas.ws.place');
    if (saved && WEATHER_PLACES[saved]) return saved;
  } catch { /* storage denied */ }
  return 'potsdam';
}

export function weatherEnabled() {
  try { return localStorage.getItem('gravitas.ws.weather') !== 'off'; } catch { return true; }
}

export { WEATHER_PLACES };

/* Open-Meteo's WMO code, reduced to the distinctions a glance can use. */
function sky(code) {
  if (code === 0) return 'Clear';
  if (code <= 2) return 'Mostly clear';
  if (code === 3) return 'Overcast';
  if (code <= 48) return 'Fog';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Showers';
  if (code <= 86) return 'Snow showers';
  return 'Thunderstorm';
}

async function loadWeather(host) {
  if (!weatherEnabled()) return;
  const place = WEATHER_PLACES[weatherPlace()];

  try {
    const url = 'https://api.open-meteo.com/v1/forecast'
      + `?latitude=${place.lat}&longitude=${place.lon}`
      + '&current=temperature_2m,weather_code';
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) return;
    const data = await res.json();
    const temp = Math.round(data.current.temperature_2m);

    host.innerHTML = '';
    host.append(el('span', 'v-hero__temp', `${temp}°`));
    host.append(el('span', 'v-hero__place', place.label));
    host.append(el('span', 'v-hero__sky', sky(data.current.weather_code)));
    host.hidden = false;
  } catch {
    // Offline, blocked, or the service is down. The row stays hidden.
  }
}

/* ==========================================================================
   FOCUS
   ========================================================================== */

const DAY = 86400000;

function daysLate(task) {
  if (!task.due_date) return 0;
  const due = new Date(task.due_date + 'T23:59:59');
  return Math.floor((Date.now() - due) / DAY);
}

/* Built from due dates and statuses, not written by a model. The wording
   changes with the data rather than being a template with numbers dropped
   into it, and when there is nothing to say it says that instead of
   manufacturing urgency. */
function focusText(tasks) {
  const open = tasks.filter((task) => !['done', 'archived'].includes(task.status));
  if (!open.length) return 'Nothing is assigned to you right now.';

  const late = open.filter((task) => daysLate(task) > 0).sort((a, b) => daysLate(b) - daysLate(a));
  const doing = open.filter((task) => task.status === 'in_progress');

  if (late.length) {
    const worst = late[0];
    const days = daysLate(worst);
    const rest = late.length - 1;
    return `${worst.title} is ${days} day${days === 1 ? '' : 's'} overdue`
      + (rest ? `, and ${rest} other${rest === 1 ? ' is' : 's are'} late too` : '')
      + '. Clear it first.'
      + (doing.length ? ` ${doing.length} task${doing.length === 1 ? ' is' : 's are'} already in progress.` : '');
  }

  const soon = open
    .filter((task) => task.due_date && daysLate(task) > -3)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));

  if (soon.length) {
    return `Nothing is overdue. ${soon[0].title} is due next`
      + (soon.length > 1 ? `, with ${soon.length - 1} more inside three days.` : '.');
  }
  return `Nothing is overdue. ${open.length} task${open.length === 1 ? '' : 's'} open, none due in the next three days.`;
}

function focusEl(tasks, ctx) {
  const card = el('section', 'v-focus wc-card');
  card.dataset.span = '12';

  const head = el('div', 'v-focus__head');
  const mark = el('span', 'v-focus__mark');
  mark.innerHTML = icon('target');
  head.append(mark, el('h2', null, "Today's focus"));
  card.append(head);

  card.append(el('p', 'v-focus__body', focusText(tasks)));

  const foot = el('div', 'v-focus__foot');
  const ask = el('button', 'ws-btn', 'Ask Pulsar');
  ask.type = 'button';
  ask.addEventListener('click', () => ctx.openAssistant?.('What should I do first today?'));
  foot.append(ask);

  /* Says where the sentence came from. Without this the card reads as a
     model's opinion, and the first time somebody disagrees with it they stop
     believing the counts underneath it too. */
  foot.append(el('span', 'v-focus__source', 'From your due dates'));
  card.append(foot);
  return card;
}

/* ==========================================================================
   COLLAPSING LISTS
   ========================================================================== */

/* Shows the first few and offers the rest. The count is in the label, so
   the reader can decide whether it is worth the click before making it. */
function collapsible(host, items, limit, draw) {
  const shown = items.slice(0, limit);
  for (const item of shown) host.append(draw(item));

  const rest = items.length - shown.length;
  if (rest <= 0) return;

  const more = el('button', 'v-more', `Show ${rest} more`);
  more.type = 'button';
  more.addEventListener('click', () => {
    more.remove();
    for (const item of items.slice(limit)) host.append(draw(item));
  });
  host.append(more);
}

/* ==========================================================================
   PANELS
   ========================================================================== */

function taskRow(task, ctx) {
  const late = daysLate(task);
  const done = ['done', 'archived'].includes(task.status);

  const node = row({
    title: task.title,
    sub: P.meta([P.label(task.priority), P.formatDate(task.due_date)]),
    onClick: () => ctx.go('/workspace/core/tasks'),
  });

  const flag = el('span', 'v-flag');
  if (done) {
    flag.textContent = 'Done';
    flag.dataset.tone = 'done';
  } else if (late > 0) {
    flag.textContent = `${late}d late`;
    flag.dataset.tone = 'late';
  } else if (task.status === 'in_progress') {
    flag.textContent = 'Doing';
    flag.dataset.tone = 'doing';
  } else if (task.due_date) {
    flag.textContent = P.formatDate(task.due_date).replace(/ \d{4}$/, '');
  }
  if (flag.textContent) node.append(flag);
  return node;
}

function todayPanel(tasks, ctx) {
  const box = panel('Today', ctx.canCore
    ? linkBtn('Open board', '/workspace/core/tasks', ctx) : null);

  const open = tasks.filter((task) => !['done', 'archived'].includes(task.status));
  const ordered = [...open].sort((a, b) => daysLate(b) - daysLate(a));

  if (!ordered.length) {
    box.body.append(empty('Nothing assigned', 'Tasks assigned to you appear here.'));
    return box;
  }
  collapsible(box.body, ordered, 4, (task) => taskRow(task, ctx));
  return box;
}

function linkBtn(text, path, ctx) {
  const btn = el('button', 'v-mini-btn', text);
  btn.type = 'button';
  btn.addEventListener('click', () => ctx.go(path));
  return btn;
}

/* Up next reads /operating/meetings/, which is a Core endpoint, so it only
   appears for people who can open Core. For everyone else the panel is not
   rendered at all rather than rendered empty: an empty panel implies you
   have no meetings, which is a different claim from not having a calendar. */
function upNextPanel(meetings, ctx) {
  const box = panel('Up next');

  const now = Date.now();
  const upcoming = meetings
    .filter((meeting) => new Date(meeting.scheduled_for).getTime() > now - 3600000)
    .sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for));

  if (!upcoming.length) {
    box.body.append(empty('Nothing scheduled', 'Meetings on the operating calendar appear here.'));
    return box;
  }

  collapsible(box.body, upcoming, 4, (meeting) => {
    const at = new Date(meeting.scheduled_for);
    const today = at.toDateString() === new Date().toDateString();
    const node = row({
      title: meeting.title,
      sub: P.meta([
        today ? 'Today' : at.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
        meeting.duration_minutes ? `${meeting.duration_minutes} min` : '',
        P.label(meeting.kind),
      ]),
    });
    // The time leads, because on a schedule the time is the thing being
    // scanned for and the title is what confirms it.
    const when = el('span', 'v-when', at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }));
    node.prepend(when);
    return node;
  });
  return box;
}

function projectsPanel(projects, ctx) {
  const box = panel('Projects', linkBtn('All projects', '/workspace/research/projects', ctx));

  if (!projects.length) {
    box.body.append(empty('No projects', 'Projects you own or have been added to appear here.'));
    return box;
  }

  collapsible(box.body, projects, 4, (project) => {
    const node = row({
      title: project.title,
      /* No progress bar. The project payload carries a status and a
         deadline and no percentage, and a bar drawn from a status enum
         would be a number this system does not actually have. */
      sub: P.meta([P.label(project.category), project.client_name, project.deadline ? `Due ${P.formatDate(project.deadline)}` : '']),
      onClick: () => ctx.go(`/workspace/research/projects/${project.id}`),
    });
    if (project.status) {
      const flag = el('span', 'v-flag', P.label(project.status));
      node.append(flag);
    }
    return node;
  });
  return box;
}

/* ==========================================================================
   THE THREE SCREENS
   ========================================================================== */

export function renderDashboard(host, ctx, scope) {
  stopClock();
  host.innerHTML = '';

  const doc = el('div', 'ws-doc ws-doc--wide');
  host.append(doc);

  if (ctx.booting) {
    doc.append(skeleton(8));
    return;
  }

  const boot = P.platform.boot;
  if (!boot) {
    doc.append(failure('your workspaces', new Error('unreachable'), ctx.reload));
    return;
  }

  if (scope === 'home') {
    doc.append(heroEl(P.platform.user));
  } else {
    doc.append(workspaceOverviewHead(scope, P.platform.user));
  }
  doc.append(focusEl(boot.my_work.tasks || [], ctx));

  if (scope === 'home') return renderHomeBody(doc, ctx, boot);
  if (scope === 'core') return renderCoreBody(doc, ctx, boot);
  return renderResearchBody(doc, ctx, boot);
}

/* ---- Home --------------------------------------------------------------- */

function renderHomeBody(doc, ctx, boot) {
  const cards = el('div', 'v-workspaces');
  for (const workspace of availableWorkspaces()) {
    const card = el('button', 'v-workspace');
    card.type = 'button';
    card.addEventListener('click', () => ctx.go(workspace.home));

    const mark = el('span', 'v-workspace__icon');
    mark.innerHTML = icon(workspace.icon);

    const body = el('span', 'v-workspace__body');
    body.append(el('strong', null, workspace.name));
    body.append(el('span', 'v-workspace__long', workspace.long));

    const arrow = el('span', 'v-workspace__go');
    arrow.innerHTML = icon('arrow');

    card.append(mark, body, arrow);
    cards.append(card);
  }
  doc.append(cards);

  const columns = el('div', 'v-columns');
  columns.append(todayPanel(boot.my_work.tasks || [], ctx));

  if (ctx.canCore) {
    const box = panel('Up next');
    box.body.append(skeleton(3));
    columns.append(box);
    P.call('/operating/meetings/')
      .then((data) => {
        const fresh = upNextPanel(data.meetings || data.results || [], ctx);
        box.replaceWith(fresh);
      })
      .catch(() => {
        box.body.innerHTML = '';
        box.body.append(empty('Calendar unavailable', 'The operating calendar did not answer.'));
      });
  }
  doc.append(columns);

  doc.append(projectsPanel(boot.my_work.research || [], ctx));
  doc.append(learningPanel(ctx));
}

/* ---- Learning on Home ---------------------------------------------------
   One panel, and only when there is something to do. Learning loses every
   argument with a deadline, which is exactly why the review queue has to
   appear beside the deadlines rather than in a workspace somebody has to
   remember to visit. When nothing is due it says so in one line and takes
   up no more room than that: a permanent "keep learning!" card is an advert
   and gets tuned out within a week. */
function learningPanel(ctx) {
  const counts = K.queueCounts();
  const box = panel('Learning', linkBtn('Knowledge', '/workspace/kms', ctx));

  if (counts.due) {
    const node = row({
      title: `${counts.due} ${counts.due === 1 ? 'card is' : 'cards are'} due for review`,
      sub: 'Roughly a minute each. These are the ones closest to being forgotten.',
      onClick: () => ctx.go('/workspace/kms/recall'),
    });
    box.body.append(node);
  } else {
    const next = K.nextStep();
    if (next) {
      box.body.append(row({
        title: next.step.title,
        sub: `${next.item.title} · ${next.progress.done} of ${next.progress.total} steps done`,
        onClick: () => ctx.go(`/workspace/kms/paths/${next.item.id}`),
      }));
    } else {
      box.body.append(empty('Nothing due', 'The review queue is empty and every path is finished.'));
    }
  }
  return box;
}

/* ---- Core --------------------------------------------------------------- */

function renderCoreBody(doc, ctx, boot) {
  const holder = el('div');
  doc.append(holder);
  skeleton(6, holder);

  return Promise.all([P.dashboard('core'), P.content(), P.call('/operating/meetings/').catch(() => ({}))])
    .then(([board, pipeline, calendar]) => {
      holder.innerHTML = '';
      const layout = C.bento();

      const tiles = [
        C.statTile({
          value: board.counts.tasks,
          label: 'Open tasks',
          icon: 'tasks',
          note: 'Manager-defined execution',
          featured: true,
          onClick: () => ctx.go('/workspace/core/tasks'),
        }),
        C.statTile({
          value: board.counts.projects || 0,
          label: 'Projects',
          icon: 'projects',
          note: 'Core projects',
          onClick: () => ctx.go('/workspace/operating'),
        }),
        C.statTile({
          value: board.counts.content,
          label: 'Content pipeline',
          icon: 'content',
          note: 'Items in production',
          onClick: () => ctx.go('/workspace/core/content'),
        }),
        C.statTile({
          value: board.counts.research_waiting,
          label: 'Waiting on research',
          icon: 'space-research',
          note: 'Research handoffs',
          onClick: () => ctx.go('/workspace/research'),
        }),
      ];
      tiles.forEach((tile, index) => {
        tile.dataset.span = '3';
        tile.dataset.series = String((index % 5) + 1);
      });
      layout.append(...tiles);

      const today = todayPanel(board.tasks || [], ctx);
      today.dataset.span = '8';
      const next = upNextPanel(calendar.meetings || calendar.results || [], ctx);
      next.dataset.span = '4';
      next.classList.add('wc-card--accent');
      layout.append(today, next);

      const mix = C.card({
        title: 'Work mix',
        note: 'Live volume across the Core operating system.',
        span: 6,
      });
      mix.body.append(C.barRows([
        { label: 'Open tasks', value: board.counts.tasks || 0, series: '1' },
        { label: 'Projects', value: board.counts.projects || 0, series: '2' },
        { label: 'Content', value: board.counts.content || 0, series: '3' },
        { label: 'Research wait', value: board.counts.research_waiting || 0, series: '4' },
      ], { scaffold: true }));
      layout.append(mix.box);

      const content = panel('Content pipeline', linkBtn('View pipeline', '/workspace/core/content', ctx));
      content.dataset.span = '6';
      const items = pipeline.items || [];
      if (items.length) {
        collapsible(content.body, items, 5, (item) => row({
          title: item.title,
          sub: P.meta([P.label(item.kind), P.formatDate(item.due_date)]),
          badges: [P.label(item.status)],
        }));
      } else {
        content.body.append(C.note('Nothing in the pipeline yet.'));
      }
      layout.append(content);

      const planning = panel('Planning', linkBtn('Open planning', '/workspace/operating', ctx));
      planning.dataset.span = '4';
      planning.body.append(row({
        title: 'OKRs & Milestones',
        sub: 'Objectives, Key Results, progress and delivery milestones.',
        badges: ['OKR', 'Milestones'],
        onClick: () => ctx.go('/workspace/operating'),
      }));

      const assets = panel('Operating assets', linkBtn('Assets & Blueprints', '/workspace/core/assets', ctx));
      assets.dataset.span = '8';
      assets.body.append(row({
        title: 'Content Studio Blueprint',
        sub: 'The content operating system, from strategy through governance.',
        badges: ['v0.2', 'Team approval', '16 sections'],
        onClick: () => ctx.go('/workspace/core/assets/content-studio-blueprint'),
      }));
      layout.append(planning, assets);

      holder.append(layout);
    })
    .catch((err) => {
      holder.innerHTML = '';
      holder.append(failure('the Core workspace', err, () => renderCoreBody(doc, ctx, boot)));
    });
}

/* ---- Research Intelligence ----------------------------------------------
   Core members get an extra operational radar inside Research. The gate is
   duplicated by design: ctx.canCore keeps the surface invisible, while the
   endpoint itself is wrapped in require_core so a copied URL cannot bypass
   the product boundary. */

function intelligenceDate(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function intelligenceRelative(value) {
  if (!value) return 'not updated yet';
  const stamp = new Date(value).getTime();
  if (Number.isNaN(stamp)) return 'updated recently';
  const mins = Math.max(0, Math.round((Date.now() - stamp) / 60000));
  if (mins < 2) return 'updated just now';
  if (mins < 60) return `updated ${mins} min ago`;
  const hours = Math.round(mins / 60);
  return `updated ${hours} h ago`;
}

function intelligenceMetric(value, label, index = 0) {
  const icons = ['planning', 'research', 'activity', 'cycle'];
  const node = C.statTile({
    value: value || 0,
    label,
    icon: icons[index] || 'activity',
    featured: index === 0,
  });
  node.classList.add('ri__metric');
  node.dataset.series = String((index % 5) + 1);
  return node;
}

function intelligenceChip(text, tone = '') {
  const chip = el('span', 'ri-chip', text);
  if (tone) chip.dataset.tone = tone;
  return chip;
}

function intelligenceCard(item, tab) {
  const card = el('article', 'ri-card');

  const meta = el('div', 'ri-card__meta');
  meta.append(intelligenceChip(item.source || 'Source'));
  if (item.kind === 'paper') meta.append(intelligenceChip('Paper'));
  if (item.kind === 'tool') meta.append(intelligenceChip('Tool'));
  if (item.kind === 'development') meta.append(intelligenceChip('Development'));
  if (item.kind === 'funding' && item.status) meta.append(intelligenceChip(P.label(item.status)));
  if (tab === 'history' && item.event_type) {
    meta.append(intelligenceChip(item.event_type === 'new' ? 'New' : 'Updated', item.event_type === 'new' ? 'positive' : 'caution'));
  }

  const stamp = item.close_date || item.date || item.updated_at || item.open_date;
  if (stamp) meta.append(el('time', 'ri-card__date', intelligenceDate(stamp)));
  card.append(meta);

  card.append(el('h3', 'ri-card__title', item.title || 'Untitled'));
  if (item.summary) card.append(el('p', 'ri-card__summary', item.summary));

  const facts = el('div', 'ri-card__facts');
  if (tab === 'funding') {
    if (item.agency) {
      const fact = el('span'); fact.append(el('strong', null, 'Agency '), document.createTextNode(item.agency)); facts.append(fact);
    }
    if (item.close_date) {
      const fact = el('span'); fact.append(el('strong', null, 'Deadline '), document.createTextNode(intelligenceDate(item.close_date))); facts.append(fact);
    }
    if (item.award_ceiling) {
      const fact = el('span'); fact.append(el('strong', null, 'Up to '), document.createTextNode(item.award_ceiling)); facts.append(fact);
    }
    if (item.opportunity_number) facts.append(el('span', null, item.opportunity_number));
  } else if (item.kind === 'tool') {
    if (Number.isFinite(Number(item.stars))) {
      const fact = el('span'); fact.append(el('strong', null, '★ '), document.createTextNode(Number(item.stars).toLocaleString())); facts.append(fact);
    }
    if (item.language) facts.append(el('span', null, item.language));
  } else if (item.authors?.length) {
    facts.append(el('span', null, item.authors.join(', ')));
  }
  if (facts.childNodes.length) card.append(facts);

  if (tab === 'funding' && item.template_available) {
    const templates = el('div', 'ri-card__templates');
    templates.append(el('strong', null, 'Application template / form found'));
    for (const name of item.template_names || []) templates.append(el('span', null, name));
    card.append(templates);
  } else if (tab === 'funding' && item.attachment_count) {
    card.append(intelligenceChip(`${item.attachment_count} announcement attachment${item.attachment_count === 1 ? '' : 's'}`, 'caution'));
  }

  const foot = el('div', 'ri-card__foot');
  if (item.url) {
    const link = el('a', 'ri-card__open', tab === 'funding' ? 'Open call ↗' : 'Open source ↗');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    foot.append(link);
  }
  const relevance = Number(item.relevance || 0);
  if (relevance) foot.append(el('span', 'ri__source-note', `Relevance ${relevance}%`));
  card.append(foot);
  return card;
}

function renderResearchIntelligence(host) {
  const section = el('section', 'ri wc-card');
  section.dataset.span = '12';
  section.setAttribute('aria-labelledby', 'research-intelligence-title');

  const head = el('div', 'ri__head');
  const intro = el('div', 'ri__intro');
  intro.append(
    el('p', 'ri__eyebrow', 'Core intelligence'),
    el('h2', 'ri__title', 'Research Intelligence'),
    el('p', 'ri__subtitle', 'Continuous background radar for funding calls, new AI research tools and papers, and important developments in AI for research and education — with persistent change history.'),
  );
  intro.querySelector('.ri__title').id = 'research-intelligence-title';

  const actions = el('div', 'ri__head-actions');
  const live = el('span', 'ri__live', 'Live sources');
  const refresh = el('button', 'ri__refresh', 'Refresh');
  refresh.type = 'button';
  actions.append(live, refresh);
  head.append(intro, actions);

  const metrics = el('div', 'ri__metrics');
  metrics.append(
    intelligenceMetric(0, 'Funding calls', 0),
    intelligenceMetric(0, 'Papers & tools', 1),
    intelligenceMetric(0, 'AI developments', 2),
    intelligenceMetric(0, 'History events', 3),
  );

  const tabs = el('div', 'ri__tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Research Intelligence feeds');
  const content = el('div', 'ri__content');
  const foot = el('div', 'ri__foot');
  const updated = el('span', null, 'Connecting to sources…');
  const errors = el('span'); errors.dataset.errors = '';
  foot.append(updated, errors);
  section.append(head, metrics, tabs, content, foot);
  host.append(section);

  let payload = null;
  let active = sessionStorage.getItem('gravitas.research.intelligenceTab') || 'funding';
  const choices = [
    ['funding', 'Funding Calls'],
    ['papers_tools', 'Papers & Tools'],
    ['developments', 'AI Developments'],
    ['history', 'History'],
  ];
  const buttons = new Map();

  const drawLoading = () => {
    content.innerHTML = '';
    const loading = el('div', 'ri__loading');
    for (let i = 0; i < 3; i += 1) loading.append(el('div', 'ri__skeleton'));
    content.append(loading);
  };

  const draw = () => {
    if (!payload) return;
    content.innerHTML = '';
    for (const [key, button] of buttons) button.setAttribute('aria-selected', String(key === active));

    const items = payload[active] || [];
    if (!items.length) {
      content.append(el('div', 'ri__empty', 'No matching items are available from the connected sources right now.'));
      return;
    }

    const grid = el('div', 'ri__grid');
    for (const item of items) grid.append(intelligenceCard(item, active));
    content.append(grid);
  };

  for (const [key, label] of choices) {
    const button = el('button', 'ri__tab', label);
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(key === active));
    button.addEventListener('click', () => {
      active = key;
      sessionStorage.setItem('gravitas.research.intelligenceTab', active);
      draw();
    });
    buttons.set(key, button);
    tabs.append(button);
  }

  const load = async (force = false) => {
    const first = !payload;
    refresh.disabled = true;
    refresh.textContent = force ? 'Refreshing…' : 'Loading…';
    if (first) drawLoading();

    try {
      payload = await P.call(`/platform/research-intelligence/${force ? '?refresh=1' : ''}`);
      metrics.innerHTML = '';
      metrics.append(
        intelligenceMetric((payload.funding || []).length, 'Funding calls', 0),
        intelligenceMetric((payload.papers_tools || []).length, 'Papers & tools', 1),
        intelligenceMetric((payload.developments || []).length, 'AI developments', 2),
        intelligenceMetric((payload.history || []).length, 'History events', 3),
      );
      const automatic = payload.automation || {};
      const lastAutomatic = automatic.completed_at || automatic.started_at;
      updated.textContent = lastAutomatic
        ? `background radar ${intelligenceRelative(lastAutomatic)} · runs every 30 min`
        : `${intelligenceRelative(payload.generated_at)} · background radar enabled`;
      const unavailable = payload.errors || [];
      errors.textContent = unavailable.length ? `${unavailable.length} source check${unavailable.length === 1 ? '' : 's'} unavailable` : '';
      live.textContent = unavailable.length ? 'Partial live' : 'Live sources';
      draw();

      clearInterval(intelligenceTimer);
      const interval = Math.max(5 * 60, Number(payload.refresh_seconds || 1800)) * 1000 + 5000;
      intelligenceTimer = setInterval(() => load(false), interval);
    } catch (error) {
      content.innerHTML = '';
      const box = el('div', 'ri__error');
      box.append(el('strong', null, 'Research Intelligence is temporarily unavailable'));
      box.append(el('span', null, 'The rest of the Research dashboard is unaffected. Retry when the source connection is available.'));
      content.append(box);
      updated.textContent = 'Could not refresh sources';
      live.textContent = 'Source connection issue';
    } finally {
      refresh.disabled = false;
      refresh.textContent = 'Refresh';
    }
  };

  refresh.addEventListener('click', () => load(true));
  load(false);
}

/* ---- Research ----------------------------------------------------------- */

function renderResearchBody(doc, ctx, boot) {
  const holder = el('div');
  doc.append(holder);
  skeleton(6, holder);

  return P.dashboard('research')
    .then((board) => {
      holder.innerHTML = '';
      const layout = C.bento();

      const tiles = [
        C.statTile({
          value: board.counts.projects,
          label: 'Active projects',
          icon: 'projects',
          note: 'Research workspace',
          featured: true,
          onClick: () => ctx.go('/workspace/research/projects'),
        }),
        C.statTile({
          value: board.counts.client_projects,
          label: 'Client projects',
          icon: 'files',
          note: 'Client work',
          onClick: () => ctx.go('/workspace/research/projects?category=client'),
        }),
        C.statTile({
          value: board.counts.community_projects,
          label: 'Community projects',
          icon: 'collaboration',
          note: 'Open collaboration',
          onClick: () => ctx.go('/workspace/research/projects?category=community'),
        }),
        C.statTile({
          value: board.counts.research_requests,
          label: 'Research requests',
          icon: 'activity',
          note: 'Requests and handoffs',
          onClick: () => ctx.go('/workspace/research/tasks?show=requests'),
        }),
      ];
      tiles.forEach((tile, index) => {
        tile.dataset.span = '3';
        tile.dataset.series = String((index % 5) + 1);
      });
      layout.append(...tiles);

      const projects = projectsPanel(board.projects || [], ctx);
      projects.dataset.span = '8';
      layout.append(projects);

      const otherProjects = Math.max(
        0,
        Number(board.counts.projects || 0)
          - Number(board.counts.client_projects || 0)
          - Number(board.counts.community_projects || 0),
      );
      const portfolio = C.card({
        title: 'Portfolio mix',
        note: 'Current research projects by collaboration type.',
        span: 4,
      });
      portfolio.body.append(C.barRows([
        { label: 'Client', value: board.counts.client_projects || 0, series: '1' },
        { label: 'Community', value: board.counts.community_projects || 0, series: '2' },
        { label: 'Other', value: otherProjects, series: '4' },
      ], { scaffold: true }));
      layout.append(portfolio.box);

      if (ctx.canCore) renderResearchIntelligence(layout);

      const resources = board.recent_resources || [];
      const recent = panel('Recent knowledge', linkBtn('Notes', '/workspace/research/notes', ctx));
      recent.dataset.span = (board.research_requests || []).length ? '6' : '12';
      if (resources.length) {
        collapsible(recent.body, resources, 5, (item) => row({
          title: item.title || item.original_name,
          sub: P.meta([P.label(item.kind), item.project_title, P.formatDate(item.updated_at)]),
        }));
      } else {
        recent.body.append(C.note('Notes, files and datasets will appear here as they are added.'));
      }
      layout.append(recent);

      const requests = board.research_requests || [];
      if (requests.length) {
        const box = panel('Research requests');
        box.dataset.span = '6';
        collapsible(box.body, requests, 5, (item) => row({
          title: item.title,
          sub: P.meta([P.label(item.status), item.assignee, P.formatDate(item.due_date)]),
        }));
        layout.append(box);
      }

      holder.append(layout);
    })
    .catch((err) => {
      holder.innerHTML = '';
      holder.append(failure('the Research workspace', err, () => renderResearchBody(doc, ctx, boot)));
    });
}
