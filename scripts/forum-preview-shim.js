/* Preview-only stand-in for the theme's JavaScript changes.

   scripts/forum-preview.mjs serves the theme's CSS from this checkout, but the
   theme's .gjs components are compiled by Discourse on the server, so changes
   to them cannot reach the preview. This file imitates their visible result
   with plain DOM work, so a change can be judged before it is deployed. It is
   never deployed: the real code is in discourse/theme/javascripts/. Keep the
   two in step when either changes.

   Imitated:
   - components/graviquest/forum-home.gjs: the deployed theme already draws
     the front page and room heads; this turns the deployed markup into the
     checkout's (2026-11-19: room chips, sort as a segmented control grouped
     with search on the right, This Week's Question as the current Topic's
     question). Edit forumHome() below when forum-home.gjs changes.
   - components/graviquest/thread-details.gjs: the breadcrumb names the
     room's Topic, and the rail beside the posts is gone.
   - api-initializers/graviquest.js: rows of "About the … category" threads
     get .gq-room-about, rows with no replies .gq-no-replies, and the menu gets
     its GraviQuest section.
   - The house words (thread, room, the profile's figures) are not imitated;
     they are set before Discourse renders, which a script injected into a
     running page cannot do. */
(function () {
  const site = () => window.Discourse?.__container__?.lookup('service:site');

  // forum-home.gjs as it is in this checkout. The deployed component's markup
  // is hidden and this draws the checkout's template beside it from the same
  // data (site categories, the URL), redrawn when the URL changes.
  const ROOMS = ['about-the-forum', 'about-graviquest', 'ai-in-research'];
  const TOPIC_PAGES = { 'ai-in-research': 'https://graviquest.com/topic-answer-that-looked-right.html' };
  const WEEK = {
    topic: 'Topic 01 · AI in Research',
    question: 'Can you trust an answer that looks right?',
    url: 'https://graviquest.com/api/forum/open/answer-that-looked-right/',
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function shimStyle() {
    if (document.getElementById('gq-shim-home-style')) return;
    const style = document.createElement('style');
    style.id = 'gq-shim-home-style';
    style.textContent = '.gq-shim-host > :not(.gq-shim){display:none!important}';
    document.head.append(style);
  }

  function forumHome() {
    const deployed = document.querySelector('.gq-forum-home:not(.gq-shim *), .gq-room-head');
    const host = deployed?.parentElement;
    const s = site();
    if (!host || !s) return;
    shimStyle();
    host.classList.add('gq-shim-host');
    const key = location.pathname + location.search;
    let mine = host.querySelector(':scope > .gq-shim');
    if (mine && mine.dataset.key === key) return;
    const m = location.pathname.match(/^\/c\/(?:.+\/)?(\d+)(?:\/|$)/);
    const category = m ? s.categories.find((c) => c.id === Number(m[1])) : null;
    const top = /\/top(\/|$)|\/l\/top/.test(location.pathname);
    const bySlug = new Map(s.categories.map((c) => [c.slug, c]));
    const chips = ROOMS.map((slug) => bySlug.get(slug)).filter(Boolean);
    const latestUrl = category ? category.url : '/latest';
    const topUrl = category ? `${category.url}/l/top?period=all` : '/top?period=all';
    const topicPage = category && TOPIC_PAGES[category.slug];
    const html =
      '<header class="gq-page-top gq-forum-home"><div><span class="gq-eyebrow">Community · Forum</span><h1>Forum</h1>' +
      '<p class="gq-lead">A few rooms, set up by the team. Read any thread without an account; sign in when you want to reply.</p></div>' +
      `<a class="btn btn-primary gq-page-top__action${category ? ' gq-is-held' : ''}" href="/new-topic">Start a Thread</a></header>` +
      '<section class="gq-week"><div class="gq-week__text">' +
      `<h2 class="gq-week__label">This Week’s Question · ${esc(WEEK.topic)}</h2>` +
      `<p class="gq-week__question">${esc(WEEK.question)}</p>` +
      `<a class="gq-week__link" href="${WEEK.url}">Join the Thread <span aria-hidden="true">→</span></a></div>` +
      '<svg class="gq-week__well" viewBox="0 0 240 96" aria-hidden="true"><path d="M0 40 H62 C92 40 98 78 120 78 C142 78 148 40 178 40 H240" /><circle cx="120" cy="69" r="7" /></svg></section>' +
      '<div class="gq-filters"><nav class="gq-chips" aria-label="Rooms">' +
      `<a class="gq-chip${category ? '' : ' is-active'}" href="/latest">All</a>` +
      chips.map((c) => `<a class="gq-chip${category && c.id === category.id ? ' is-active' : ''}" href="${c.url}" data-room="${c.slug}">${esc(c.name)}</a>`).join('') +
      '</nav><div class="gq-tools"><nav class="gq-sort" aria-label="Sort threads">' +
      `<a class="gq-sort__option${top ? '' : ' is-active'}" href="${latestUrl}">Latest</a>` +
      `<a class="gq-sort__option${top ? ' is-active' : ''}" href="${topUrl}">Top</a></nav>` +
      '<form class="gq-search" action="/search" method="get" role="search"><input type="search" name="q" placeholder="Search threads" aria-label="Search threads"></form></div></div>' +
      (category
        ? '<section class="gq-room"><div class="gq-room__text">' +
          `<h2 class="gq-room__title">${esc(category.name)}</h2>` +
          (category.description_text ? `<p class="gq-room__lead">${esc(category.description_text)}</p>` : '') +
          '</div><div class="gq-room__actions">' +
          (topicPage ? `<a class="btn btn-default" href="${topicPage}">Open the Topic</a>` : '') +
          '<a class="btn btn-primary gq-new-thread" href="/new-topic">New thread</a></div></section>'
        : '');
    if (!mine) {
      mine = document.createElement('div');
      mine.className = 'gq-shim';
      host.append(mine);
    }
    mine.dataset.key = key;
    mine.innerHTML = html;
    // revealChosen: bring the chosen room into the chips line's view.
    const line = mine.querySelector('.gq-chips');
    const chip = line.querySelector('.gq-chip.is-active');
    if (category && chip && line.scrollWidth > line.clientWidth) {
      const pad = parseFloat(getComputedStyle(line).paddingLeft) || 0;
      line.scrollLeft = chip.offsetLeft - line.offsetLeft - pad;
    }
  }

  // forum-home.gjs switchList(): rooms and sort change the list in place,
  // without a reload and without Discourse sending the page to the top.
  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('.gq-shim .gq-chips a.gq-chip, .gq-shim .gq-sort a.gq-sort__option');
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const router = window.Discourse?.__container__?.lookup('service:router');
    if (!router) return;
    event.preventDefault();
    event.stopPropagation();
    const scroller = document.scrollingElement;
    const release = () => { if (scroller.scrollTo === release) delete scroller.scrollTo; };
    scroller.scrollTo = release;
    setTimeout(release, 3000);
    router.transitionTo(link.getAttribute('href')).catch(() => {});
  }, true);

  // ops/discourse/rooms.rb names the system account GraviQuest (data, so the
  // preview imitates it on the posts it draws).
  function systemName() {
    document.querySelectorAll('article[data-user-id="-1"] .names .first a').forEach((a) => {
      const t = [...a.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim() === 'system');
      if (t) t.textContent = ' GraviQuest ';
    });
  }

  function thread() {
    document.querySelector('.gq-thread-rail')?.remove();
    document.querySelector('.gq-community-sidebar')?.remove();
    document.querySelector('.gq-thread-byline')?.remove();
    const crumb = document.querySelector('.gq-thread-crumb');
    const s = site();
    if (!crumb || crumb.dataset.gqShim || !s) return;
    crumb.querySelectorAll('a[href="https://graviquest.com/forum.html"]').forEach((a) => a.setAttribute('href', '/'));
    const room = crumb.querySelector('a:last-of-type');
    const c = s.categories.find((x) => x.url === room?.getAttribute('href'));
    const parent = c?.parent_category_id && s.categories.find((x) => x.id === c.parent_category_id);
    if (parent) {
      const sep = document.createElement('span'); sep.setAttribute('aria-hidden', 'true'); sep.textContent = '/';
      const name = document.createElement('span'); name.textContent = parent.name;
      room.before(name, sep);
    }
    crumb.dataset.gqShim = '1';
  }

  function rows() {
    const s = site();
    const about = new Set((s?.categories || []).map((c) => c.topic_url && c.topic_url.split('/').pop()).filter(Boolean));
    document.querySelectorAll('.topic-list-item[data-topic-id]').forEach((row) => {
      row.classList.toggle('gq-room-about', about.has(row.dataset.topicId));
      const n = row.querySelector('.badge-posts .number, .posts-map .number');
      if (n) row.classList.toggle('gq-no-replies', n.textContent.trim() === '0');
      row.querySelector('.gq-row-room')?.remove();
    });
  }

  function addSiteSection() {
    const panel = document.querySelector('.menu-panel .sidebar-sections, .sidebar-hamburger-dropdown .sidebar-sections');
    if (!panel || panel.querySelector('[data-section-name="graviquest"]')) return;
    const links = [['Topics', 'https://graviquest.com/topics.html'], ['Lab', 'https://graviquest.com/lab.html'], ['Learn', 'https://graviquest.com/learn.html'], ['Community', 'https://graviquest.com/community']];
    const sec = document.createElement('div');
    sec.className = 'sidebar-section sidebar-section-wrapper sidebar-section--expanded';
    sec.dataset.sectionName = 'graviquest';
    sec.innerHTML = '<div class="sidebar-section-header-wrapper sidebar-row"><span class="sidebar-section-header"><span class="sidebar-section-header-text">GraviQuest</span></span></div><ul class="sidebar-section-content">' +
      links.map(([t, h]) => `<li class="sidebar-section-link-wrapper"><a class="sidebar-section-link sidebar-row" href="${h}"><span class="sidebar-section-link-content-text">${t}</span></a></li>`).join('') + '</ul>';
    panel.append(sec);
  }

  // components/graviquest/navigation.gjs: the site's "Join Us" for a visitor
  // in place of Workspace (the preview is always signed out).
  function joinUs() {
    const a = document.querySelector('.d-header .gq-workspace:not(.gq-join)');
    if (!a) return;
    a.classList.add('gq-join');
    a.href = 'https://graviquest.com/signup';
    a.setAttribute('aria-label', 'Create your free account');
    a.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><g transform="translate(0.645 0.673) scale(0.945894)" stroke-width="1.797"><path d="M2.6 20.4v-1.7a4.6 4.6 0 0 1 4.6-4.6h3.4a4.6 4.6 0 0 1 4.6 4.6v1.7"/><path d="M18.8 5.6v4.8"/><path d="M16.4 8h4.8"/><circle cx="8.9" cy="7.4" r="3.5" fill="currentColor" stroke="none"/></g></svg><span>Join Us</span>';
  }

  let busy = false;
  function run() {
    if (busy) return;
    busy = true;
    try { forumHome(); systemName(); thread(); rows(); addSiteSection(); joinUs(); } finally { busy = false; }
  }
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', run);
})();
