/* Preview-only stand-in for the theme's JavaScript changes.

   scripts/forum-preview.mjs serves the theme's CSS from this checkout, but the
   theme's .gjs components are compiled by Discourse on the server, so changes
   to them cannot reach the preview. This file imitates their visible result
   with plain DOM work, so a change can be judged before it is deployed. It is
   never deployed: the real code is in discourse/theme/javascripts/. Keep the
   two in step when either changes.

   Imitated:
   - components/graviquest/forum-home.gjs: the front page's room directory,
     and a room's head on a room page. The directory reads
     backend/core/forum_rooms.json (served by the preview at
     /__gq/forum-rooms.json). Rooms that ops/discourse/rooms.rb has not made
     yet are drawn from that file, say so ("Made on release"), and open a
     preview-only room page (see "Rooms that exist only in forum_rooms.json"
     below); the deployed theme reads names, descriptions and counts from
     Discourse and leaves a missing room out.
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
  let rooms;
  fetch('/__gq/forum-rooms.json').then((r) => r.json()).then((data) => { rooms = data; run(); });

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const threads = (n) => (!n ? 'No threads yet' : n === 1 ? '1 thread' : `${n} threads`);

  function signedIn() {
    return !document.documentElement.classList.contains('anon');
  }

  function roomPageCategory() {
    const m = location.pathname.match(/^\/c\/(?:.+\/)?(\d+)(?:\/|$)/);
    const s = site();
    return m && s ? s.categories.find((c) => c.id === Number(m[1])) : null;
  }

  // The front page as forum-home.gjs draws it: forum.html's head, then a row
  // per room. Every room opens the preview's room page, which shows the
  // threads it will hold once rooms.rb has run.
  function drawHome(heading) {
    if (!rooms || heading.dataset.gqShim === 'home') return;
    const s = site();
    const bySlug = new Map((s?.categories || []).map((c) => [c.slug, c]));
    heading.className = 'gq-forum-heading gq-forum-home';
    heading.innerHTML = `<header class="gq-page-top"><div><span class="gq-eyebrow">Community · Forum</span><h1>Forum</h1>` +
      `<p class="gq-lead">A few rooms, set up by the team. Read any thread without an account; sign in when you want to reply.</p></div>` +
      '<a class="btn btn-primary gq-page-top__action" href="/new-topic">Start a Thread</a>' + `</header>` +
      `<div class="gq-roomlist"><div class="gq-roomrow gq-roomrow--head" aria-hidden="true"><span>Room</span><span class="gq-n gq-n--threads">Threads</span><span class="gq-n">Replies</span><span class="gq-n">Activity</span></div><ol class="gq-rooms">` +
      rooms.rooms.map((r) => {
        const c = bySlug.get(r.slug);
        return `<li><a class="gq-roomrow" href="/latest?gq-room=${encodeURIComponent(r.slug)}" data-gq-preview><span class="gq-roomrow__main"><span class="gq-roomrow__name">${esc(c ? c.name : r.name)}</span>` +
          `<span class="gq-roomrow__desc">${esc(r.description)}</span></span><span class="gq-n gq-n--threads">${r.threads.length}</span><span class="gq-n"></span><span class="gq-n gq-n--age"></span></a></li>`;
      }).join('') + '</ol></div>';
    heading.dataset.gqShim = 'home';
  }

  function drawRoomHead(heading, c) {
    const key = 'room-' + c.id;
    if (heading.dataset.gqShim === key) return;
    heading.className = 'gq-page-top gq-room-head';
    heading.innerHTML = `<div><nav class="gq-crumb" aria-label="Breadcrumb"><a href="/">Forum</a></nav><h1>${esc(c.name)}</h1>` +
      (c.description_text ? `<p class="gq-lead">${esc(c.description_text)}</p>` : '') + '</div>';
    heading.dataset.gqShim = key;
  }

  /* ---- The rooms as they will be after the next release --------------------
     /latest?gq-room=<slug> draws a room from forum_rooms.json: its head, then
     its threads. A thread rooms.rb will post is drawn from the file
     (&gq-thread=<n> opens it as a thread page); a thread that already exists
     (the official Topic 01 discussion) is listed from Discourse and opens for
     real. Nothing here is deployed. */
  function markdown(text) {
    const inline = (s) => esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    return text.split(/\n\n+/).map((block) => {
      const lines = block.split('\n');
      if (lines.every((l) => /^- /.test(l))) return '<ul>' + lines.map((l) => `<li>${inline(l.slice(2))}</li>`).join('') + '</ul>';
      if (lines.every((l) => /^\d+\. /.test(l))) return '<ol>' + lines.map((l) => `<li>${inline(l.replace(/^\d+\. /, ''))}</li>`).join('') + '</ol>';
      return `<p>${inline(block)}</p>`;
    }).join('');
  }

  function previewRoom() {
    const params = new URLSearchParams(location.search);
    const slug = params.get('gq-room');
    const room = slug && rooms?.rooms.find((r) => r.slug === slug);
    return room ? { room, thread: params.get('gq-thread') } : null;
  }

  function previewStyles() {
    if (document.getElementById('gq-preview-style')) return;
    const style = document.createElement('style');
    style.id = 'gq-preview-style';
    style.textContent = `
      .gq-preview-note{margin:1rem 0 0;font:400 .8125rem/1.4 "DM Mono",monospace;color:var(--g-text-subtle)}
      .gq-preview-threads{list-style:none;margin:0 0 4rem;padding:0;border-top:1px solid var(--g-hairline)}
      .gq-preview-threads li{margin:0;border-bottom:1px solid var(--g-hairline)}
      .gq-preview-threads a{display:flex;justify-content:space-between;gap:1.5rem;padding:1.25rem .5rem;color:var(--g-text);text-decoration:none}
      .gq-preview-threads a:hover{background:var(--g-surface)}
      .gq-preview-threads b{font:600 1.0625rem/1.4 "DM Sans",sans-serif}
      .gq-preview-threads span{font:400 .8125rem/1.4 "DM Mono",monospace;color:var(--g-text-subtle);white-space:nowrap}
      .gq-preview-thread{max-width:48rem;margin:0 auto 4rem;padding-top:2rem}
      .gq-preview-thread h1{margin:.75rem 0 1.5rem;font-size:clamp(1.6rem,1.3rem + 1.2vw,2.1rem);line-height:1.2}
      .gq-preview-post__who{font:600 .9375rem/1.4 "DM Sans",sans-serif;margin-bottom:.75rem}
      .gq-preview-post__body{font:400 1.0625rem/1.7 Literata,Georgia,serif;color:var(--g-text)}
      .gq-preview-post__body a{color:var(--g-text);text-decoration:underline}`;
    document.head.append(style);
  }

  function drawPreviewRoom(heading, { room, thread }) {
    const key = `preview-${room.slug}-${thread || ''}`;
    if (heading.dataset.gqShim === key) return;
    heading.dataset.gqShim = key;
    previewStyles();
    const roomHref = `/latest?gq-room=${encodeURIComponent(room.slug)}`;
    const t = thread != null && room.threads[Number(thread)];
    if (t && !t.existing) {
      heading.className = 'gq-preview-thread';
      heading.innerHTML = `<nav class="gq-thread-crumb" aria-label="Discussion breadcrumb"><a href="/latest" data-gq-preview>Forum</a> <span aria-hidden="true">/</span> <a href="${roomHref}" data-gq-preview>${esc(room.name)}</a></nav>` +
        `<h1>${esc(t.title)}</h1><div class="gq-preview-post__who">GraviQuest</div><div class="gq-preview-post__body">${markdown(t.body)}</div>` +
        `<p class="gq-preview-note">Preview: rooms.rb posts this thread when the theme is released.</p>`;
      return;
    }
    heading.className = 'gq-preview-room';
    heading.innerHTML = `<header class="gq-page-top"><div><nav class="gq-crumb" aria-label="Breadcrumb"><a href="/latest" data-gq-preview>Forum</a></nav>` +
      `<h1>${esc(room.name)}</h1><p class="gq-lead">${esc(room.description)}</p></div></header>` +
      `<ul class="gq-preview-threads">${room.threads.map((x, i) => `<li data-gq-thread="${i}">${x.existing ? '' : `<a href="${roomHref}&gq-thread=${i}" data-gq-preview><b>${esc(x.title)}</b><span>on release</span></a>`}</li>`).join('')}</ul>`;
    // The thread that already exists is listed from Discourse, at its URL.
    const existing = room.threads.findIndex((x) => x.existing);
    const c = site()?.categories.find((x) => x.slug === room.slug);
    const slot = heading.querySelector(`[data-gq-thread="${existing}"]`);
    if (existing < 0 || !slot) return;
    const say = (text) => { slot.innerHTML = `<a href="#" data-gq-preview-inert><b>${esc(text)}</b><span></span></a>`; };
    if (!c) return say(room.threads[existing].title);
    fetch(`/c/${c.slug}/${c.id}/l/latest.json`).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).then((data) => {
      const about = c.topic_url?.split('/').pop();
      const topic = (data.topic_list?.topics || []).find((x) => String(x.id) !== about);
      if (!topic) return say('Could not find the existing thread.');
      slot.innerHTML = `<a href="/t/${topic.id}"><b>${esc(room.threads[existing].title)}</b><span>${Math.max(0, (topic.posts_count || 1) - 1)} replies</span></a>`;
    }).catch(() => say('Could not load this room’s threads. Reload the page.'));
  }

  // Preview links reload the page: Discourse's router would otherwise keep
  // /latest as the same route and never redraw.
  window.addEventListener('click', (event) => {
    if (event.target.closest?.('[data-gq-preview-inert]')) { event.preventDefault(); return; }
    const link = event.target.closest?.('a[data-gq-preview]');
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    location.href = link.href;
  }, true);

  function directory() {
    const heading = document.querySelector('.gq-forum-heading, .gq-room-head');
    if (!heading) return;
    const preview = previewRoom();
    if (preview) return drawPreviewRoom(heading, preview);
    const c = roomPageCategory();
    c ? drawRoomHead(heading, c) : drawHome(heading);
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
    try { directory(); thread(); rows(); addSiteSection(); joinUs(); } finally { busy = false; }
  }
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', run);
})();
