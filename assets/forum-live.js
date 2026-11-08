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
  function count(value) { return Number.isInteger(value) && value >= 0 ? String(value) : '—'; }
  function tableRow(t) {
    var li = el('li'), a = link('', forumURL(t.url), 'fm-row');
    var main = el('span', 'fm-row__main');
    main.append(el('span', 'fm-room', t.category), el('span', 'fm-row__title', t.title));
    if (t.tags && t.tags.length) {
      var tags = el('span', 'fm-row__tags');
      t.tags.forEach(function (tag) { tags.append(el('span', 'g-tag', tag)); }); main.append(tags);
    }
    var who = el('span', 'fm-c-who'), people = el('span', 'fm-who');
    (t.participants || []).forEach(function (p) {
      var avatar;
      if (p.avatar_url) {
        avatar = el('img', 'avatar fm-av'); avatar.src = forumURL(p.avatar_url);
        avatar.alt = ''; avatar.width = 28; avatar.height = 28; avatar.loading = 'lazy';
        avatar.addEventListener('error', function () { avatar.replaceWith(initials(p)); }, {once:true});
      } else avatar = initials(p);
      avatar.title = p.name || p.username; people.append(avatar);
    });
    who.append(people);
    if (people.children.length) who.append(el('span', 'g-visually-hidden', (t.participants || []).map(function (p) { return p.name || p.username; }).join(', ')));
    var replies = el('span', 'fm-c-n', count(t.reply_count)), views = el('span', 'fm-c-n fm-c-views', count(t.view_count));
    replies.append(el('span', 'g-visually-hidden', ' replies')); views.append(el('span', 'g-visually-hidden', ' views'));
    var activity = el('time', 'fm-c-n fm-c-age', '—'), date = new Date(t.last_posted_at || 'invalid');
    if (!Number.isNaN(date.getTime())) {
      var minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
      activity.textContent = minutes < 60 ? minutes + 'm' : minutes < 1440 ? Math.floor(minutes / 60) + 'h' : minutes < 365 * 1440 ? Math.floor(minutes / 1440) + 'd' : Math.floor(minutes / (365 * 1440)) + 'y';
      activity.dateTime = date.toISOString(); activity.title = 'Last activity ' + date.toLocaleString();
      activity.append(el('span', 'g-visually-hidden', ' since last activity'));
    }
    a.append(main, who, replies, views, activity); li.append(a); return li;
  }
  function initials(p) {
    var avatar = el('span', 'avatar fm-av', Array.from(p.name || p.username || '?').slice(0, 2).join('').toUpperCase());
    avatar.title = p.name || p.username; return avatar;
  }
  function row(t, layout) {
    if (layout === 'table') return tableRow(t);
    var li = el('li', 'rd-thread');
    var likes = el('div', 'gq-likes');
    likes.append(el('span', '', '♡'), el('span', '', count(t.like_count)));
    likes.setAttribute('aria-label', count(t.like_count) + ' likes');
    var body = el('div', 'rd-thread__main'), tags = el('div', 'rd-thread__top');
    tags.append(el('span', 'rd-tag', t.category));
    (t.tags || []).forEach(function (tag) { tags.append(el('span', 'rd-tag', tag)); });
    var heading = el('h3'); heading.append(link(t.title, forumURL(t.url)));
    body.append(tags, heading);
    if (t.excerpt) body.append(el('p', '', t.excerpt));
    var foot = el('div', 'rd-thread__foot', count(t.reply_count) + (t.reply_count === 1 ? ' reply' : ' replies'));
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
    var more = document.querySelector('[data-forum-more]'), search = document.querySelector('[data-forum-search]'), counter = document.querySelector('[data-forum-count]');
    var layout = host.dataset.forumLayout;
    var page = 0, category = 0, sort = 'latest', controller, requestId = 0, categories, failedPage = false, roomSignature = '';
    var args = new URLSearchParams(location.search), roomAliases = {open:'open-question', t1:'ai-in-research', t01:'ai-in-research', t3:'discovery', t03:'discovery', t4:'computable-universe', t04:'computable-universe', fix:'corrections', next:'propose-a-topic', lab:'lab-results', hi:'introductions'};
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
      rooms.replaceChildren();
      if (layout !== 'table') rooms.append(el('h2', '', 'Rooms'));
      [{id:0, name:layout === 'table' ? 'All' : 'All rooms'}].concat(categories).forEach(function (c) {
        var b = el('button', layout === 'table' ? 'chip fm-step' : 'rd-room', c.name); b.type = 'button';
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
          var order = ['open-question','ai-in-research','discovery','computable-universe','corrections','propose-a-topic','lab-results','introductions'];
          categories.sort(function (a,b) {
            var ai = order.indexOf(a.slug), bi = order.indexOf(b.slug);
            return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi);
          });
          if (requestedRoom) {
            var match = categories.find(function (c) { return c.slug === requestedRoom; });
            requestedRoom = null;
            if (match) { category = match.id; drawRooms(); load(false); return; }
          }
          drawRooms();
          if (!append) host.replaceChildren();
          (data.topics || []).forEach(function (t) {
            if (!host.querySelector('[data-discussion-id="' + Number(t.id) + '"]')) {
              var node = row(t, layout); node.dataset.discussionId = t.id; host.append(node);
            }
          });
          status.replaceChildren();
          if (!host.children.length) status.append(el('p', 'rd-empty', 'No public discussions here yet. Start the first conversation.'));
          more.hidden = !data.has_more;
          if (counter) counter.textContent = host.children.length + (data.has_more ? '+' : '') + (host.children.length === 1 ? ' thread' : ' threads');
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
          (data.topics || []).slice(0, 3).forEach(function (t) { host.append(row(t, host.dataset.forumLayout)); });
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
              var article = el('article'); article.append(el('b', '', p.username), el('p', '', p.text.length > 400 ? p.text.slice(0,400) + '…' : p.text)); host.append(article);
            });
            host.append(link('Read and reply in the Forum', forumURL(topic.url), 'g-btn g-btn--secondary g-btn--sm'));
          }
          if (host.closest('[data-forum-topic]')) replaceLegacyWriter(host, key);
        }).catch(function () {
          failure(host, load, 'This conversation is not available here yet.');
          host.append(link('Open the Forum', '/forum.html'));
        });
      }
      load();
    });
  }
  function replaceLegacyWriter(host, key) {
    var region = host.closest('[data-forum-topic]'), main = document.getElementById('main');
    if (!region || !main) return;
    var observer;
    function move() {
      var form = Array.from(main.querySelectorAll('[data-comment-form]')).find(function (f) { return f.dataset.commentForm === key; });
      if (!form) return false;
      if (observer) observer.disconnect();
      form.style.display = 'none';
      form.before(host, el('p', 'g-muted', 'Earlier responses remain below. Continue the conversation in the Forum.'));
      region.remove(); return true;
    }
    if (!move()) {
      observer = new MutationObserver(move); observer.observe(main, {childList:true, subtree:true});
      addEventListener('pagehide', function () { observer.disconnect(); }, {once:true});
    }
  }
  function earlierCommunityResponses() {
    var host = document.querySelector('[data-forum-community] [data-forum-discussion="weekly-thought-experiment"]');
    if (!host) return;
    var history = el('section', 'g-mt-lg');
    history.hidden = true; host.parentNode.append(history);
    json('/api/community/comments/weekly-thought-experiment/').then(function (data) {
      if (!data.comments || !data.comments.length) return;
      history.append(el('h3', '', 'Earlier responses'));
      data.comments.forEach(function (comment) {
        var article = el('article', 'g-mt-sm');
        article.append(el('b', '', comment.author), el('p', '', comment.body)); history.append(article);
      });
      history.hidden = false;
    }).catch(function () {});
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
  feed(); peeks(); discussions(); drafts(); earlierCommunityResponses();
})();
