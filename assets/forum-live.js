/* Public conversations are anonymous Discourse reads through Django. We never
   copy the redesign's fixtures or make a local vote look persisted. Reading
   private rooms and every write use Discourse's own authenticated application.
   Render only the changing feed: controls, focus and drafts survive refreshes. */
(function () {
  'use strict';
  var configJob;
  function json(url, signal) {
    return fetch(url, {credentials: 'same-origin', cache: 'no-store', signal: signal})
      .then(function (r) { if (!r.ok) throw new Error('unavailable'); return r.json(); });
  }
  function config() {
    if (!configJob) configJob = json('/api/forum/config/');
    return configJob;
  }
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
  function link(text, href, cls) {
    var node = el('a', cls, text); node.href = href; return node;
  }
  function forumURL(value) {
    var parsed = new URL(value, location.href);
    if (parsed.protocol !== 'https:') throw new Error('unsafe_url');
    return parsed.href;
  }
  function row(t) {
    var li = el('li', 'rd-thread');
    var likes = el('div', 'gq-likes');
    likes.append(el('span', '', '♡'), el('span', '', String(t.like_count)));
    likes.setAttribute('aria-label', t.like_count + ' likes');
    var body = el('div', 'rd-thread__main'), tags = el('div', 'rd-thread__top');
    tags.append(el('span', 'rd-tag', t.category));
    (t.tags || []).forEach(function (tag) { tags.append(el('span', 'rd-tag', tag)); });
    var heading = el('h3'); heading.append(link(t.title, forumURL(t.url)));
    body.append(tags, heading);
    if (t.excerpt) body.append(el('p', '', t.excerpt));
    var foot = el('div', 'rd-thread__foot', t.reply_count + (t.reply_count === 1 ? ' reply' : ' replies'));
    if (t.last_posted_at) {
      var date = new Date(t.last_posted_at);
      if (!Number.isNaN(date.getTime())) {
        var time = el('time', '', date.toLocaleDateString(undefined, {day:'numeric', month:'short'}));
        time.dateTime = date.toISOString(); foot.append(time);
      }
    }
    body.append(foot); li.append(likes, body); return li;
  }
  function failure(host, retry, message) {
    host.replaceChildren(el('p', 'g-muted', message || 'The Forum is temporarily unavailable. Your work has been kept.'));
    if (retry) {
      var button = el('button', 'g-btn g-btn--secondary g-btn--sm', 'Try again');
      button.type = 'button'; button.addEventListener('click', retry); host.append(button);
    }
  }
  function feed() {
    var host = document.querySelector('[data-forum-feed]'); if (!host) return;
    var rooms = document.getElementById('rd-rooms'), status = document.querySelector('[data-forum-status]');
    var more = document.querySelector('[data-forum-more]'), search = document.querySelector('[data-forum-search]');
    var page = 0, category = 0, sort = 'latest', controller, requestId = 0, categories, failedPage = false, roomSignature = '';
    var args = new URLSearchParams(location.search), roomAliases = {open:'open-question', t1:'ai-in-research', t4:'computable-universe', fix:'corrections', next:'propose-a-topic', lab:'lab-results', hi:'introductions'};
    var requestedRoom = roomAliases[args.get('room')] || args.get('room');
    function drawRooms() {
      var signature = JSON.stringify(categories);
      if (roomSignature === signature && rooms.querySelector('button')) {
        rooms.querySelectorAll('[data-category-id]').forEach(function (button) {
          button.setAttribute('aria-pressed', String(Number(button.dataset.categoryId) === category));
        });
        return;
      }
      roomSignature = signature;
      rooms.replaceChildren(el('h2', '', 'Rooms'));
      [{id:0, name:'All rooms'}].concat(categories).forEach(function (c) {
        var b = el('button', 'rd-room', c.name); b.type = 'button';
        b.dataset.categoryId = c.id;
        b.setAttribute('aria-pressed', String(category === c.id));
        if (c.parent_category_id) b.classList.add('gq-subroom');
        b.addEventListener('click', function () { category = c.id; page = 0; drawRooms(); load(false); });
        rooms.append(b);
      });
    }
    function load(append) {
      failedPage = false;
      if (controller) controller.abort(); controller = new AbortController();
      var id = ++requestId; status.replaceChildren(el('p', 'g-muted', 'Loading discussions…'));
      more.disabled = true; host.setAttribute('aria-busy', 'true');
      json('/api/forum/feed/?' + new URLSearchParams({sort:sort, category:category, page:page}), controller.signal)
        .then(function (data) {
          if (id !== requestId) return;
          categories = data.categories || [];
          if (requestedRoom) {
            var match = categories.find(function (c) { return c.slug === requestedRoom; });
            requestedRoom = null;
            if (match) { category = match.id; drawRooms(); load(false); return; }
          }
          drawRooms();
          if (!append) host.replaceChildren();
          (data.topics || []).forEach(function (t) {
            if (!host.querySelector('[data-discussion-id="' + Number(t.id) + '"]')) {
              var node = row(t); node.dataset.discussionId = t.id; host.append(node);
            }
          });
          status.replaceChildren();
          if (!host.children.length) status.append(el('p', 'rd-empty', 'No public discussions here yet. Start the first conversation.'));
          more.hidden = !data.has_more;
          var query = new URL(location.href); query.searchParams.delete('room');
          if (category) query.searchParams.set('category', category); else query.searchParams.delete('category');
          history.replaceState(null, '', query);
        }).catch(function (error) {
          if (error.name === 'AbortError' || id !== requestId) return;
          failedPage = true;
          failure(status, function () { load(append); }, 'Discussions could not be loaded. Try again in a moment.');
          if (!categories) failure(rooms, null, 'Rooms are unavailable.');
        }).finally(function () { if (id === requestId) { more.disabled = false; host.setAttribute('aria-busy', 'false'); } });
    }
    var initialCategory = Number(args.get('category')); if (Number.isInteger(initialCategory) && initialCategory > 0) category = initialCategory;
    document.querySelectorAll('[data-forum-sort]').forEach(function (b) {
      b.addEventListener('click', function () {
        sort = b.dataset.forumSort; page = 0;
        document.querySelectorAll('[data-forum-sort]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        load(false);
      });
    });
    more.addEventListener('click', function () { if (!failedPage) page += 1; load(true); });
    search.addEventListener('submit', function (e) {
      e.preventDefault(); var q = search.elements.q.value.trim(); if (!q) return;
      config().then(function (c) { location.assign(forumURL(c.search_url) + '?q=' + encodeURIComponent(q)); })
        .catch(function () { configJob = null; failure(status, null, 'Search is temporarily unavailable. Your search text is still here.'); });
    });
    config().then(function (c) {
      document.querySelector('[data-forum-new]').href = forumURL(c.new_topic_url);
    }).catch(function () { configJob = null; });
    load(false);
  }
  function peeks() {
    document.querySelectorAll('[data-forum-peek]').forEach(function (host) {
      function load() {
        host.replaceChildren(el('li', 'rd-empty', 'Loading discussions…'));
        json('/api/forum/feed/').then(function (data) {
          host.replaceChildren();
          (data.topics || []).slice(0, 3).forEach(function (t) { host.append(row(t)); });
          if (!host.children.length) host.append(el('li', 'rd-empty', 'The next conversation can start with you.'));
        }).catch(function () { failure(host, load, 'Recent discussions are temporarily unavailable.'); });
      }
      load();
    });
  }
  function discussions() {
    var auto = document.querySelector('[data-forum-topic-auto]');
    if (auto) {
      var slug = new URLSearchParams(location.search).get('slug') || '';
      if (/^[a-z0-9-]{1,180}$/.test(slug)) auto.dataset.forumDiscussion = slug;
      else auto.textContent = 'Open a published Topic to find its conversation.';
    }
    document.querySelectorAll('[data-forum-discussion]').forEach(function (host) {
      var key = host.dataset.forumDiscussion;
      function load() {
        json('/api/forum/discussions/' + encodeURIComponent(key) + '/').then(function (data) {
          host.replaceChildren(); var topic = data.discussion;
          host.append(link(topic.title, forumURL(topic.url), 'gq-discussion-title'));
          if (data.polls && data.polls.length) {
            var poll = data.polls[0], total = Number(poll.voters || 0);
            (poll.options || []).forEach(function (option) {
              var choice = el('p', 'gq-poll-option');
              // Poll labels are cooked HTML. Extract text, then render as text.
              var doc = new DOMParser().parseFromString(option.html || '', 'text/html');
              choice.append(el('span', '', doc.body.textContent || 'Option'));
              if (typeof option.votes === 'number') choice.append(el('small', '', String(option.votes) + ' votes'));
              host.append(choice);
            });
            host.append(el('p', 'g-muted', total + (total === 1 ? ' member has voted.' : ' members have voted.')));
            host.append(link('Vote in the Forum', forumURL(topic.url), 'g-btn g-btn--secondary g-btn--sm'));
          } else {
            (data.posts || []).slice(1, 4).forEach(function (p) {
              var article = el('article'); article.append(el('b', '', p.username), el('p', '', p.text)); host.append(article);
            });
            host.append(link('Read and reply in the Forum', forumURL(topic.url), 'g-btn g-btn--secondary g-btn--sm'));
          }
        }).catch(function () {
          failure(host, load, 'This conversation is not available here yet.');
          host.append(link('Open the Forum', '/forum.html'));
        });
      }
      load();
    });
  }
  function drafts() {
    var form = document.querySelector('[data-forum-draft]'); if (!form) return;
    var note = form.querySelector('[data-form-note]');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var stance = form.querySelector('[name="stance"]:checked'), body = form.elements.body.value.trim();
      if (!stance || body.length < 20 || body.length > 1000) { note.textContent = 'Choose a position and add 20–1,000 characters of reasoning.'; return; }
      config().then(function (c) {
        var params = new URLSearchParams({title:body.slice(0, 100), category:'open-question',
          body:'Position: ' + stance.value + '\n\n' + body + '\n\n[The Open Question](https://graviquest.com/community#this-week)'});
        var target = forumURL(c.new_topic_url) + '?' + params;
        if (target.length > 7500) { note.textContent = 'Please shorten this reply, or open the Forum to write a longer post. Your reasoning is still here.'; return; }
        location.assign(target);
      }).catch(function () { configJob = null; note.textContent = 'The Forum is temporarily unavailable. Your draft is still here; please try again.'; });
    });
  }
  feed(); peeks(); discussions(); drafts();
})();
