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

import * as P from './ws-platform.js';
import { el, panel, row, empty, skeleton, failure, stats } from './ws-views.js';
import { availableWorkspaces } from './ws-nav.js';

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

export function stopClock() {
  clearInterval(clockTimer);
  clockTimer = 0;
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
  const card = el('section', 'v-focus');

  const head = el('div', 'v-focus__head');
  const mark = el('span', 'v-focus__mark');
  mark.innerHTML = icon('target');
  head.append(mark, el('h2', null, "Today's focus"));
  card.append(head);

  card.append(el('p', 'v-focus__body', focusText(tasks)));

  const foot = el('div', 'v-focus__foot');
  const ask = el('button', 'ws-btn', 'Ask the assistant');
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
    sub: P.meta([P.label(task.priority), task.initiative]),
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

  doc.append(heroEl(P.platform.user));
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
}

/* ---- Core --------------------------------------------------------------- */

function renderCoreBody(doc, ctx, boot) {
  const holder = el('div');
  doc.append(holder);
  skeleton(6, holder);

  return Promise.all([P.dashboard('core'), P.content(), P.call('/operating/meetings/').catch(() => ({}))])
    .then(([board, pipeline, calendar]) => {
      holder.innerHTML = '';

      holder.append(stats([
        ['Open tasks', board.counts.tasks],
        ['Initiatives', board.counts.initiatives],
        ['Content pipeline', board.counts.content],
        ['Waiting on research', board.counts.research_waiting],
      ]));

      const columns = el('div', 'v-columns');
      columns.append(todayPanel(board.tasks || [], ctx));
      columns.append(upNextPanel(calendar.meetings || calendar.results || [], ctx));
      holder.append(columns);

      const second = el('div', 'v-columns');

      const content = panel('Content pipeline', linkBtn('View pipeline', '/workspace/core/content', ctx));
      const items = pipeline.items || [];
      if (items.length) {
        collapsible(content.body, items, 5, (item) => row({
          title: item.title,
          sub: P.meta([P.label(item.kind), P.formatDate(item.due_date)]),
          badges: [P.label(item.status)],
        }));
      } else {
        content.body.append(empty('Nothing in the pipeline', 'Content items appear here once created.'));
      }

      const initiatives = panel('Initiatives', linkBtn('Planning', '/workspace/operating', ctx));
      const list = board.initiatives || [];
      if (list.length) {
        collapsible(initiatives.body, list, 5, (item) => row({
          title: item.title,
          sub: P.meta([P.label(item.status), P.label(item.stage)]),
        }));
      } else {
        initiatives.body.append(empty('No initiatives', 'Initiatives group the work behind an objective.'));
      }

      second.append(content, initiatives);
      holder.append(second);
    })
    .catch((err) => {
      holder.innerHTML = '';
      holder.append(failure('the Core workspace', err, () => renderCoreBody(doc, ctx, boot)));
    });
}

/* ---- Research ----------------------------------------------------------- */

function renderResearchBody(doc, ctx, boot) {
  const holder = el('div');
  doc.append(holder);
  skeleton(6, holder);

  return P.dashboard('research')
    .then((board) => {
      holder.innerHTML = '';

      holder.append(stats([
        ['Active projects', board.counts.projects],
        ['Client projects', board.counts.client_projects],
        ['Community projects', board.counts.community_projects],
        ['Research requests', board.counts.research_requests],
      ]));

      const columns = el('div', 'v-columns');
      columns.append(projectsPanel(board.projects || [], ctx));

      const recent = panel('Recent knowledge', linkBtn('Notes', '/workspace/research/notes', ctx));
      const resources = board.recent_resources || [];
      if (resources.length) {
        collapsible(recent.body, resources, 5, (item) => row({
          title: item.title || item.original_name,
          sub: P.meta([P.label(item.kind), item.project_title, P.formatDate(item.updated_at)]),
        }));
      } else {
        recent.body.append(empty('Nothing recent', 'Notes, files and datasets appear here as they are added.'));
      }
      columns.append(recent);
      holder.append(columns);

      const requests = board.research_requests || [];
      if (requests.length) {
        const box = panel('Research requests');
        collapsible(box.body, requests, 5, (item) => row({
          title: item.title,
          sub: P.meta([P.label(item.status), item.assignee, P.formatDate(item.due_date)]),
        }));
        holder.append(box);
      }
    })
    .catch((err) => {
      holder.innerHTML = '';
      holder.append(failure('the Research workspace', err, () => renderResearchBody(doc, ctx, boot)));
    });
}
