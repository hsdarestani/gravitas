/* Preview-only stand-in for the theme's JavaScript changes.

   scripts/forum-preview.mjs serves the theme's CSS from this checkout, but the
   theme's .gjs components are compiled by Discourse on the server, so changes
   to them cannot reach the preview. This file imitates their visible result
   with plain DOM work, so a change can be judged before it is deployed. It is
   never deployed: the real code is in discourse/theme/javascripts/. Keep the
   two in step when either changes.

   Imitated:
   - api-initializers/graviquest.js: rows of "About the … category" threads
     get .gq-room-about (hidden by common.scss).
   - api-initializers/graviquest.js: the GraviQuest section in the menu.
   - components/graviquest/forum-heading.gjs: rooms missing from the chip row.
   - components/graviquest/thread-details.gjs: "Forum" crumb goes to "/", and
     "Last reply" is left out of a thread with no replies.
   - api-initializers/graviquest.js: the house words (thread, room) are not
     imitated; they are set before Discourse renders, which a script injected
     into a running page cannot do. */
(function () {
  const site = () => window.Discourse?.__container__?.lookup('service:site');

  function markRoomAbout() {
    const s = site();
    if (!s) return;
    const about = new Set(s.categories.map((c) => c.topic_url && c.topic_url.split('/').pop()).filter(Boolean));
    document.querySelectorAll('.topic-list-item[data-topic-id]').forEach((row) => {
      row.classList.toggle('gq-room-about', about.has(row.dataset.topicId));
    });
  }

  function addMissingRooms() {
    const nav = document.querySelector('.gq-room-links');
    const s = site();
    if (!nav || !s || nav.dataset.gqShim) return;
    nav.dataset.gqShim = '1';
    const skip = ['uncategorized', 'general', 'site-feedback', 'staff'];
    const have = new Set([...nav.querySelectorAll('a')].map((a) => a.getAttribute('href')));
    s.categories
      .filter((c) => !c.parent_category_id && !skip.includes(c.slug) && !have.has(c.url))
      .forEach((c) => {
        const a = document.createElement('a');
        a.href = c.url;
        a.textContent = c.name;
        if (location.pathname.startsWith(c.url)) a.setAttribute('aria-current', 'page');
        const after = c.slug === 'computable-universe' ? nav.querySelector('a[href*="/c/discovery/"]') : null;
        after ? after.after(a) : nav.append(a);
      });
  }

  function fixCrumb() {
    document.querySelectorAll('.gq-thread-crumb a[href="https://graviquest.com/forum.html"]').forEach((a) => a.setAttribute('href', '/'));
  }

  function dropEmptyLastReply() {
    const facts = document.querySelector('.gq-thread-facts');
    if (!facts || facts.querySelector('dd')?.textContent.trim() !== '0') return;
    facts.querySelectorAll(':scope > div').forEach((d) => { if (d.querySelector('dt')?.textContent.trim() === 'Last reply') d.remove(); });
  }

  function addSiteSection() {
    const panel = document.querySelector('.menu-panel .sidebar-sections, .sidebar-hamburger-dropdown .sidebar-sections');
    if (!panel || panel.querySelector('[data-section-name="graviquest"]')) return;
    const links = [['Topics', 'https://graviquest.com/topics.html'], ['Lab', 'https://graviquest.com/lab.html'], ['Learn', 'https://graviquest.com/learn.html'], ['Community', 'https://graviquest.com/community'], ['Workspace', 'https://graviquest.com/workspace']];
    const sec = document.createElement('div');
    sec.className = 'sidebar-section sidebar-section-wrapper sidebar-section--expanded';
    sec.dataset.sectionName = 'graviquest';
    sec.innerHTML = '<div class="sidebar-section-header-wrapper sidebar-row"><span class="sidebar-section-header"><span class="sidebar-section-header-text">GraviQuest</span></span></div><ul class="sidebar-section-content">' +
      links.map(([t, h]) => `<li class="sidebar-section-link-wrapper"><a class="sidebar-section-link sidebar-row" href="${h}"><span class="sidebar-section-link-content-text">${t}</span></a></li>`).join('') + '</ul>';
    panel.append(sec);
  }

  const run = () => { markRoomAbout(); addMissingRooms(); fixCrumb(); dropEmptyLastReply(); addSiteSection(); };
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', run);
})();
