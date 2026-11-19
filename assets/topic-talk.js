/* =========================================================================
   TOPIC · CONVERSATION
   One way of drawing and running a conversation on a Topic page, for every
   place a reader can write: under a video, at the end of an essay, beside a
   passage (topic-annotations.js) and under a viewpoint's reason
   (topic-viewpoints.js). window.GQTalk.

   It came out of the design review of 2026-11-19 (tests/topic.html), which
   drew threads with replies, likes and dislikes, a member's own notes with
   Edit and Delete, search, sort and an author filter. The review kept all of
   that in the browser; here every word and every count is the comment
   route's (backend/core/views.py, `comments`), so:

   - A new comment is pending until a moderator reads it. The route returns
     a member's own pending comments to them, marked, and this draws them as
     "Waiting for review, only you can see it" instead of letting them seem
     to vanish. Nobody else is sent them.
   - An edit goes back to the moderator for the same reason, and says so.
   - Replying and reacting need a published comment, so a pending one
     offers neither.
   - Signed out, the field still takes text. Posting keeps the draft on this
     device and says what to do; nothing typed is lost to a sign-in.

   A reply is attached to the thread's first comment and names the person it
   answers (@Name), so a thread is one level deep however long it runs. That
   is how the review drew it, and it keeps a narrow column readable.
   ========================================================================= */
(function () {
  'use strict';

  var API = '/api/community/comments/';
  var reduce = function () { return matchMedia('(prefers-reduced-motion: reduce)').matches; };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function cookie(name) {
    var match = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : '';
  }

  /* ---- Requests ----------------------------------------------------------- */
  function request(url, method, payload) {
    var send = function () {
      var init = { method: method || 'GET', credentials: 'same-origin', cache: 'no-store', headers: { 'Accept': 'application/json' } };
      if (method && method !== 'GET') {
        init.headers['Content-Type'] = 'application/json';
        init.headers['X-CSRFToken'] = cookie('csrftoken') || cookie('gravitas_staging_csrftoken');
        init.body = JSON.stringify(payload || {});
      }
      return fetch(url, init);
    };
    var ready = method && method !== 'GET'
      ? fetch('/api/auth/csrf/', { credentials: 'same-origin', cache: 'no-store' }).catch(function () {})
      : Promise.resolve();
    return ready.then(send).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) { data.status = response.status; throw data; }
        return data;
      });
    });
  }

  var mePromise = null;
  function me(force) {
    if (!mePromise || force) {
      mePromise = request('/api/auth/me/').then(function (data) {
        return { authenticated: !!data.authenticated, name: (data.user && data.user.name) || '' };
      }).catch(function () { return { authenticated: false, name: '' }; });
    }
    return mePromise;
  }

  var cache = {};
  function list(key, force) {
    if (!cache[key] || force) {
      cache[key] = request(API + encodeURIComponent(key) + '/').then(function (data) {
        return Array.isArray(data.comments) ? data.comments : [];
      });
      cache[key].catch(function () { delete cache[key]; });
    }
    return cache[key];
  }
  function post(key, body, opts) {
    opts = opts || {};
    var payload = { body: body };
    if (opts.parent) payload.parent_id = opts.parent;
    if (opts.anchor) payload.anchor = opts.anchor;
    return request(API + encodeURIComponent(key) + '/', 'POST', payload).then(function (data) {
      delete cache[key];
      notify(key);
      return data.comment;
    });
  }
  function edit(key, id, body) {
    return request(API + encodeURIComponent(key) + '/' + id + '/', 'PATCH', { body: body }).then(function (data) {
      delete cache[key];
      notify(key);
      return data.comment;
    });
  }
  function remove(key, id) {
    return request(API + encodeURIComponent(key) + '/' + id + '/', 'DELETE').then(function () {
      delete cache[key];
      notify(key);
    });
  }
  function react(key, id, value) {
    return request(API + encodeURIComponent(key) + '/' + id + '/reaction/', 'POST', { value: value }).then(function (data) {
      delete cache[key];
      return data;
    });
  }

  /* Every mounted block for a key redraws when any of them changes it: the
     annotation panel and the end-of-essay notes can share a key's count. */
  var listeners = {};
  function on(key, fn) { (listeners[key] = listeners[key] || []).push(fn); }
  function notify(key) { (listeners[key] || []).slice().forEach(function (fn) { try { fn(); } catch (err) { /* one block's failure is its own */ } }); }

  /* ---- Small parts ---------------------------------------------------------- */
  var ICON = {
    like: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 10.5v9h-3v-9zM7.5 10.5l3.6-6.3a1.6 1.6 0 0 1 3 .9l-.6 4h5a2 2 0 0 1 2 2.4l-1.3 6.4a2 2 0 0 1-2 1.6H7.5"/></svg>',
    dislike: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 13.5v-9h-3v9zM7.5 13.5l3.6 6.3a1.6 1.6 0 0 0 3-.9l-.6-4h5a2 2 0 0 0 2-2.4l-1.3-6.4a2 2 0 0 0-2-1.6H7.5"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="6.2"/><path d="m20 20-4.4-4.4"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.2"/><path d="M12 7.8v4.4l2.8 1.7"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/></svg>'
  };

  /* A member's mark: their initial on a tone picked from their name. The
     tones are the brand's own (accent, Sisal, the three signals), mixed into
     the surface so a row of them reads as people, not as statuses. */
  var TONES = ['var(--g-accent)', 'var(--g-sisal)', 'var(--g-signal-positive)', 'var(--g-signal-caution)', 'var(--g-signal-critical)', 'var(--g-cosmos-400, var(--g-accent))'];
  function avatar(name, size) {
    var text = String(name || '?').trim();
    var hash = 0;
    for (var i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    return '<span class="tk-av' + (size ? ' tk-av--' + size : '') + '" style="--tk-tone:' + TONES[hash % TONES.length] + '" aria-hidden="true">' + esc(text.charAt(0).toUpperCase() || '?') + '</span>';
  }

  function when(iso) {
    var date = new Date(iso || '');
    if (isNaN(date.getTime())) return '';
    var days = Math.floor((Date.now() - date.getTime()) / 864e5);
    if (days < 1 && new Date().getDate() === date.getDate()) return 'Today';
    if (days < 2) return 'Yesterday';
    if (days < 7) return days + ' days ago';
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function score(c) { return (c.like_count || 0) - (c.dislike_count || 0); }

  /* ---- Toast ---------------------------------------------------------------
     One line at the bottom of the window for what a click did, with at most
     one action. The polite status region says the same to a screen reader. */
  var toastNode = null, toastTimer = 0;
  function toast(text, action) {
    if (!toastNode) {
      toastNode = document.createElement('div');
      toastNode.className = 'tk-toast';
      toastNode.setAttribute('role', 'status');
      toastNode.setAttribute('aria-live', 'polite');
      document.body.append(toastNode);
    }
    clearTimeout(toastTimer);
    toastNode.innerHTML = '<span>' + esc(text) + '</span>' +
      (action ? '<a class="tk-toast__act" href="' + esc(action.href) + '">' + esc(action.label) + '</a>' : '');
    toastNode.classList.remove('is-on');
    void toastNode.offsetWidth;
    toastNode.classList.add('is-on');
    toastTimer = setTimeout(function () { toastNode.classList.remove('is-on'); }, action ? 6000 : 3200);
  }

  function signInPrompt(what) {
    return '<div class="tk-signin" role="status"><p><b>Sign in to ' + esc(what) + '.</b> What you wrote stays on this device until you come back.</p>' +
      '<div class="tk-signin__act"><a class="g-btn g-btn--primary g-btn--sm" href="/login">Sign in</a><a class="g-btn g-btn--ghost g-btn--sm" href="/signup">Create account</a></div></div>';
  }

  function failure(error, what) {
    if (error && error.status === 401) return 'Sign in to ' + what + '.';
    if (error && error.error === 'invalid_parent') return 'That comment is no longer open for replies.';
    return 'Could not ' + what + ' just now. Try again in a moment.';
  }

  /* ---- Drafts ----------------------------------------------------------------- */
  function draftKey(key, scope) { return 'gq:draft:' + key + (scope ? ':' + scope : ''); }
  function readDraft(key, scope) { try { return localStorage.getItem(draftKey(key, scope)) || ''; } catch (err) { return ''; } }
  function writeDraft(key, scope, text) {
    try { if (text) localStorage.setItem(draftKey(key, scope), text); else localStorage.removeItem(draftKey(key, scope)); } catch (err) { /* a convenience */ }
  }

  /* ---- One thread ------------------------------------------------------------ */
  function reactions(c) {
    if (c.status === 'pending') return '';
    var mine = c.viewer_reaction || '';
    return '<div class="tk-react" role="group" aria-label="Rate this comment">' +
      '<button class="tk-react__btn" type="button" data-tk-react="like" aria-pressed="' + (mine === 'like') + '" aria-label="Like. ' + plural(c.like_count || 0, 'like', 'likes') + '">' + ICON.like + '<b class="g-nums">' + (c.like_count || 0) + '</b></button>' +
      '<button class="tk-react__btn is-down" type="button" data-tk-react="dislike" aria-pressed="' + (mine === 'dislike') + '" aria-label="Dislike. ' + plural(c.dislike_count || 0, 'dislike', 'dislikes') + '">' + ICON.dislike + '<b class="g-nums">' + (c.dislike_count || 0) + '</b></button></div>';
  }

  function item(c, ctx, isReply) {
    var editing = ctx.editing === c.id;
    var pending = c.status === 'pending';
    var head = '<header class="tk-who">' + avatar(c.author) + '<span class="tk-who__text"><b>' + esc(c.author) + '</b>' +
      '<time datetime="' + esc(c.created_at) + '">' + esc(when(c.created_at)) + (c.edited ? ' · edited' : '') + '</time></span>' +
      (c.mine ? '<span class="g-tag tk-tag">Yours</span>' : '') + '</header>';
    var anchor = !isReply && ctx.renderAnchor ? ctx.renderAnchor(c) : '';
    var body = editing
      ? '<form class="tk-edit" data-tk-edit-form="' + c.id + '"><label class="g-visually-hidden" for="tk-ed-' + c.id + '">Edit your comment</label>' +
        '<textarea class="g-textarea" id="tk-ed-' + c.id + '" rows="3" maxlength="5000" required>' + esc(c.body) + '</textarea>' +
        '<div class="tk-row"><button class="g-btn g-btn--primary g-btn--sm" type="submit">Save</button><button class="g-btn g-btn--ghost g-btn--sm" type="button" data-tk-cancel>Cancel</button>' +
        '<span class="g-hint">An edit is read again before it shows.</span></div></form>'
      : '<p class="tk-body">' + mention(c.body) + '</p>';
    var note = pending ? '<p class="tk-pending">' + ICON.clock + '<span>Waiting for review. Only you can see it until a moderator has read it.</span></p>' : '';
    var own = c.mine
      ? '<button class="tk-link" type="button" data-tk-edit>Edit</button><button class="tk-link is-danger" type="button" data-tk-del>' + (ctx.arming === c.id ? 'Sure? Delete' : 'Delete') + '</button>'
      : '';
    var acts = editing ? '' : '<footer class="tk-acts">' + reactions(c) +
      (pending ? '' : '<button class="tk-link" type="button" data-tk-reply>Reply</button>') +
      '<button class="tk-link" type="button" data-tk-copy>Copy</button>' + own + '</footer>';
    return '<' + (isReply ? 'div class="tk-reply' : 'article class="tk-thread') + (pending ? ' is-pending' : '') + (c.mine ? ' is-mine' : '') + (ctx.active === c.id ? ' is-on' : '') + '" data-tk-id="' + c.id + '" id="tk-c-' + c.id + '">' +
      head + anchor + body + note + acts + '<div class="tk-rbox" data-tk-rbox="' + c.id + '"></div>' +
      (isReply ? '</div>' : '');
  }

  /* "@Name rest" keeps the name as a quiet label, the way the review drew a
     reply to a reply. Everything is text: the name is escaped like the rest. */
  function mention(body) {
    var text = esc(body);
    return text.replace(/^@([^\s]{1,40}(?: [A-Z][^\s]{0,30}\.?)?)\s/, '<span class="tk-at">@$1</span> ');
  }

  function thread(root, replies, ctx) {
    return item(root, ctx, false) + (replies.length ? '<div class="tk-replies">' + replies.map(function (r) { return item(r, ctx, true); }).join('') + '</div>' : '') + '</article>';
  }

  /* ---- A mounted conversation ---------------------------------------------- */
  var SORTS = [['new', 'Newest first'], ['old', 'Oldest first'], ['liked', 'Most liked'], ['replies', 'Most replies']];
  var uid = 0;

  function mount(host, options) {
    var o = Object.assign({
      key: '', title: '', titleTag: 'h4', intro: '',
      label: 'Your comment', placeholder: 'Add a comment…', button: 'Post',
      hint: 'Members can post. A moderator reads every comment first.',
      empty: 'No comments yet. The first one sets the tone.',
      pageSize: 4, tools: true, collapsible: false, compose: true,
      filter: null, anchor: null, composeExtra: null, renderAnchor: null,
      onCount: null, onDraw: null, signInWhat: 'post', layout: 'list', scope: ''
    }, options || {});
    var id = 'tk' + (++uid);
    var state = { all: [], query: '', sort: 'new', who: 'all', shown: o.pageSize, open: true, editing: 0, arming: 0, active: 0, loaded: false, failed: false, armTimer: 0 };

    host.classList.add('tk');
    host.innerHTML =
      (o.title ? '<div class="tk-head">' + (o.collapsible
        ? '<button class="tk-fold" type="button" aria-expanded="true" aria-controls="' + id + '-body" data-tk-fold><span class="tk-fold__chev">' + ICON.chevron + '</span><span><' + o.titleTag + ' class="tk-title">' + esc(o.title) + '</' + o.titleTag + '><span class="tk-count" data-tk-count role="status"></span></span></button>'
        : '<div><' + o.titleTag + ' class="tk-title">' + esc(o.title) + '</' + o.titleTag + '><span class="tk-count" data-tk-count role="status"></span></div>') +
        '<div class="tk-tools" data-tk-tools hidden>' +
          '<label class="tk-search">' + ICON.search + '<span class="g-visually-hidden">Search</span><input type="search" placeholder="Search" autocomplete="off" data-tk-q></label>' +
          '<label class="g-visually-hidden" for="' + id + '-sort">Sort</label><select class="g-select tk-select" id="' + id + '-sort" data-tk-sort>' + SORTS.map(function (s) { return '<option value="' + s[0] + '">' + s[1] + '</option>'; }).join('') + '</select>' +
          '<label class="g-visually-hidden" for="' + id + '-who">Filter by author</label><select class="g-select tk-select" id="' + id + '-who" data-tk-who><option value="all">All authors</option></select>' +
        '</div></div>' : '') +
      '<div class="tk-main" id="' + id + '-body">' +
      (o.intro ? '<p class="tk-intro">' + esc(o.intro) + '</p>' : '') +
      (o.compose ? '<form class="tk-compose" data-tk-compose><label class="g-label" for="' + id + '-new">' + esc(o.label) + '</label>' +
        (o.composeExtra ? '<div class="tk-compose__extra" data-tk-extra>' + o.composeExtra() + '</div>' : '') +
        '<textarea class="g-textarea" id="' + id + '-new" rows="3" maxlength="5000" placeholder="' + esc(o.placeholder) + '" data-tk-new></textarea>' +
        '<div class="tk-row"><button class="g-btn g-btn--primary g-btn--sm" type="submit">' + esc(o.button) + '</button><span class="g-hint" data-tk-note>' + esc(o.hint) + '</span></div>' +
        '<div data-tk-signin></div></form>' : '') +
      '<div class="tk-list' + (o.layout === 'grid' ? ' tk-list--grid' : '') + '" data-tk-list aria-live="polite"><p class="tk-empty">Loading…</p></div>' +
      '<div class="tk-more" data-tk-more></div></div>';

    var listNode = host.querySelector('[data-tk-list]');
    var moreNode = host.querySelector('[data-tk-more]');
    var countNode = host.querySelector('[data-tk-count]');
    var toolsNode = host.querySelector('[data-tk-tools]');
    var newField = host.querySelector('[data-tk-new]');
    if (newField) newField.value = readDraft(o.key, o.scope);

    function roots() {
      return state.all.filter(function (c) { return !c.parent_id && (!o.filter || o.filter(c)); });
    }
    function repliesOf(c) {
      return state.all.filter(function (r) { return r.parent_id === c.id; });
    }
    function visible() {
      var q = state.query;
      var out = roots().filter(function (c) {
        if (state.who !== 'all' && c.author !== state.who) return false;
        if (!q) return true;
        var hay = [c.body, c.author, (c.anchor && c.anchor.quote) || ''].concat(repliesOf(c).map(function (r) { return r.body + ' ' + r.author; })).join(' ').toLowerCase();
        return hay.indexOf(q) >= 0;
      });
      var by = {
        new: function (a, b) { return b.created_at.localeCompare(a.created_at); },
        old: function (a, b) { return a.created_at.localeCompare(b.created_at); },
        liked: function (a, b) { return score(b) - score(a) || b.created_at.localeCompare(a.created_at); },
        replies: function (a, b) { return repliesOf(b).length - repliesOf(a).length || b.created_at.localeCompare(a.created_at); }
      }[state.sort];
      /* The reader's own pending comments lead, whatever the order: they are
         what they just did. */
      return out.sort(function (a, b) { return (b.status === 'pending') - (a.status === 'pending') || by(a, b); });
    }

    function draw() {
      var all = roots();
      var shown = visible();
      if (countNode) countNode.textContent = !state.loaded ? '' : plural(all.length, 'comment', 'comments') + (shown.length !== all.length ? ' · ' + shown.length + ' shown' : '');
      if (toolsNode) {
        toolsNode.hidden = !o.tools || all.length < 4 || !state.open;
        var who = host.querySelector('[data-tk-who]');
        var names = Array.from(new Set(all.map(function (c) { return c.author; }))).sort();
        who.innerHTML = '<option value="all">All authors</option>' + names.map(function (n) { return '<option' + (state.who === n ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('');
      }
      if (state.failed) {
        listNode.innerHTML = '<p class="tk-empty">Comments could not be loaded just now. They are still there. <button class="tk-link" type="button" data-tk-retry>Try again</button></p>';
        moreNode.innerHTML = '';
        return;
      }
      if (!state.loaded) return;
      var ctx = { editing: state.editing, arming: state.arming, active: state.active, renderAnchor: o.renderAnchor };
      var cut = shown.slice(0, state.shown);
      listNode.innerHTML = cut.length ? cut.map(function (c) { return thread(c, repliesOf(c), ctx); }).join('')
        : '<p class="tk-empty">' + esc(all.length ? 'Nothing matches. Try another word or author.' : o.empty) + '</p>';
      var left = shown.length - cut.length;
      moreNode.innerHTML = (left > 0 ? '<button class="g-btn g-btn--secondary g-btn--sm" type="button" data-tk-more-btn>Show ' + Math.min(o.pageSize, left) + ' more · ' + left + ' left</button>' : '') +
        (state.shown > o.pageSize && shown.length > o.pageSize ? '<button class="g-btn g-btn--ghost g-btn--sm" type="button" data-tk-less>Show fewer</button>' : '');
      if (o.onCount) o.onCount(all.length, state.all);
      if (o.onDraw) o.onDraw(state.all);
    }

    function load(force) {
      return list(o.key, force).then(function (rows) {
        state.all = rows; state.loaded = true; state.failed = false; draw();
        return rows;
      }).catch(function () { state.failed = true; draw(); return []; });
    }

    function find(id) { return state.all.filter(function (c) { return c.id === id; })[0]; }
    function idOf(node) { var t = node.closest('[data-tk-id]'); return t ? Number(t.getAttribute('data-tk-id')) : 0; }

    function signedOut(where, what) {
      var box = where.querySelector('[data-tk-signin]') || where;
      box.innerHTML = signInPrompt(what || o.signInWhat);
    }

    host.addEventListener('submit', function (event) {
      var form = event.target;
      if (form.matches('[data-tk-compose]')) {
        event.preventDefault();
        var text = newField.value.trim();
        var note = form.querySelector('[data-tk-note]');
        if (!text) { newField.focus(); return; }
        writeDraft(o.key, o.scope, text);
        var anchor = o.anchor ? o.anchor(form) : null;
        var button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        note.textContent = 'Sending…';
        me().then(function (who) {
          if (!who.authenticated) { signedOut(form); note.textContent = o.hint; return null; }
          return post(o.key, text, { anchor: anchor }).then(function (comment) {
            newField.value = '';
            writeDraft(o.key, o.scope, '');
            form.querySelector('[data-tk-signin]').innerHTML = '';
            note.textContent = o.hint;
            state.query = ''; state.who = 'all';
            var q = host.querySelector('[data-tk-q]'); if (q) q.value = '';
            if (o.composeExtra) { var extra = form.querySelector('[data-tk-extra]'); if (extra) extra.innerHTML = o.composeExtra(); }
            toast('Sent. It shows here for you now, and for everyone once a moderator has read it.');
            return load(true).then(function () {
              var node = document.getElementById('tk-c-' + comment.id);
              if (node) node.scrollIntoView({ block: 'nearest', behavior: reduce() ? 'auto' : 'smooth' });
            });
          });
        }).catch(function (error) {
          note.textContent = failure(error, 'post');
          if (error && error.status === 401) signedOut(form);
        }).then(function () { button.disabled = false; });
        return;
      }
      if (form.matches('[data-tk-reply-form]')) {
        event.preventDefault();
        var parent = Number(form.getAttribute('data-tk-reply-form'));
        var to = form.getAttribute('data-tk-to') || '';
        var field = form.querySelector('textarea');
        var value = field.value.trim();
        if (!value) return;
        var full = to ? '@' + to + ' ' + value : value;
        writeDraft(o.key, 'reply-' + parent, value);
        me().then(function (who) {
          if (!who.authenticated) { signedOut(form, 'reply'); return null; }
          return post(o.key, full, { parent: parent }).then(function () {
            writeDraft(o.key, 'reply-' + parent, '');
            toast('Reply sent. It shows for everyone once a moderator has read it.');
            return load(true);
          });
        }).catch(function (error) { toast(failure(error, 'reply')); });
        return;
      }
      if (form.matches('[data-tk-edit-form]')) {
        event.preventDefault();
        var editId = Number(form.getAttribute('data-tk-edit-form'));
        var body = form.querySelector('textarea').value.trim();
        if (!body) return;
        edit(o.key, editId, body).then(function () {
          state.editing = 0;
          toast('Saved. A moderator reads the new version before it shows.');
          return load(true);
        }).catch(function (error) { toast(failure(error, 'save')); });
      }
    });

    host.addEventListener('input', function (event) {
      if (event.target.matches('[data-tk-q]')) { state.query = event.target.value.trim().toLowerCase(); state.shown = o.pageSize; draw(); return; }
      if (event.target === newField) writeDraft(o.key, o.scope, newField.value.trim());
    });
    host.addEventListener('change', function (event) {
      if (event.target.matches('[data-tk-sort]')) { state.sort = event.target.value; draw(); return; }
      if (event.target.matches('[data-tk-who]')) { state.who = event.target.value; state.shown = o.pageSize; draw(); }
    });

    host.addEventListener('click', function (event) {
      var t = event.target;
      if (t.closest('[data-tk-retry]')) { load(true); return; }
      if (t.closest('[data-tk-more-btn]')) { state.shown += o.pageSize; draw(); return; }
      if (t.closest('[data-tk-less]')) { state.shown = o.pageSize; draw(); host.scrollIntoView({ block: 'start', behavior: reduce() ? 'auto' : 'smooth' }); return; }
      var fold = t.closest('[data-tk-fold]');
      if (fold) {
        state.open = !state.open;
        fold.setAttribute('aria-expanded', String(state.open));
        host.querySelector('.tk-main').hidden = !state.open;
        host.classList.toggle('is-shut', !state.open);
        draw();
        return;
      }
      var reactBtn = t.closest('[data-tk-react]');
      if (reactBtn) {
        var cid = idOf(reactBtn), c = find(cid);
        if (!c) return;
        var value = reactBtn.getAttribute('aria-pressed') === 'true' ? '' : reactBtn.getAttribute('data-tk-react');
        me().then(function (who) {
          if (!who.authenticated) { toast('Sign in to like or dislike a comment.', { href: '/login', label: 'Sign in' }); return; }
          /* Drawn at once and corrected by the answer: a tap that waits for
             the network feels broken. */
          var before = { like_count: c.like_count, dislike_count: c.dislike_count, viewer_reaction: c.viewer_reaction };
          if (c.viewer_reaction === 'like') c.like_count--;
          if (c.viewer_reaction === 'dislike') c.dislike_count--;
          if (value === 'like') c.like_count++;
          if (value === 'dislike') c.dislike_count++;
          c.viewer_reaction = value;
          draw();
          var again = host.querySelector('[data-tk-id="' + cid + '"] [data-tk-react="' + reactBtn.getAttribute('data-tk-react') + '"]');
          if (again) { again.focus({ preventScroll: true }); if (value) { again.classList.add('is-pop'); } }
          react(o.key, cid, value).then(function (data) {
            c.like_count = data.like_count; c.dislike_count = data.dislike_count; c.viewer_reaction = data.reaction;
            if (o.onDraw) o.onDraw(state.all);
          }).catch(function (error) {
            Object.assign(c, before); draw();
            toast(failure(error, 'save your reaction'));
          });
        });
        return;
      }
      var replyBtn = t.closest('[data-tk-reply]');
      if (replyBtn) {
        var holder = replyBtn.closest('.tk-reply, .tk-thread');
        var rootNode = replyBtn.closest('.tk-thread');
        var rootId = Number(rootNode.getAttribute('data-tk-id'));
        var target = find(idOf(replyBtn));
        var box = holder.querySelector(':scope > [data-tk-rbox]');
        var to = holder.classList.contains('tk-reply') && target ? target.author : '';
        box.innerHTML = '<form class="tk-compose tk-compose--reply" data-tk-reply-form="' + rootId + '" data-tk-to="' + esc(to) + '">' +
          '<label class="g-visually-hidden" for="tk-r-' + rootId + '">Your reply' + (to ? ' to ' + esc(to) : '') + '</label>' +
          '<textarea class="g-textarea" id="tk-r-' + rootId + '" rows="2" maxlength="5000" placeholder="' + (to ? 'Reply to ' + esc(to) + '…' : 'Write a reply…') + '" required>' + esc(readDraft(o.key, 'reply-' + rootId)) + '</textarea>' +
          '<div class="tk-row"><button class="g-btn g-btn--primary g-btn--sm" type="submit">Post reply</button><button class="g-btn g-btn--ghost g-btn--sm" type="button" data-tk-rcancel>Cancel</button></div><div data-tk-signin></div></form>';
        box.querySelector('textarea').focus();
        return;
      }
      if (t.closest('[data-tk-rcancel]')) { t.closest('[data-tk-rbox]').innerHTML = ''; return; }
      if (t.closest('[data-tk-edit]')) { state.editing = idOf(t); draw(); var ta = document.getElementById('tk-ed-' + state.editing); if (ta) ta.focus(); return; }
      if (t.closest('[data-tk-cancel]')) { state.editing = 0; draw(); return; }
      var del = t.closest('[data-tk-del]');
      if (del) {
        var did = idOf(del);
        if (state.arming === did) {
          clearTimeout(state.armTimer);
          state.arming = 0;
          remove(o.key, did).then(function () { toast('Deleted.'); return load(true); }).catch(function (error) { toast(failure(error, 'delete')); });
          return;
        }
        state.arming = did;
        draw();
        var again2 = host.querySelector('[data-tk-id="' + did + '"] [data-tk-del]');
        if (again2) again2.focus();
        clearTimeout(state.armTimer);
        state.armTimer = setTimeout(function () { state.arming = 0; draw(); }, 4000);
        return;
      }
      var copyBtn = t.closest('[data-tk-copy]');
      if (copyBtn) {
        var cc = find(idOf(copyBtn));
        if (!cc) return;
        var quote = cc.anchor && cc.anchor.quote ? '“' + cc.anchor.quote + '” · ' : '';
        var text = quote + cc.author + ': ' + cc.body;
        var done = function () { toast('Copied.'); };
        if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, function () { toast('Your browser did not allow copying here.'); });
        else toast('Your browser did not allow copying here.');
      }
    });

    on(o.key, function () { load(false); });
    load(false);

    return {
      refresh: function () { return load(true); },
      redraw: draw,
      comments: function () { return state.all; },
      roots: roots,
      focusCompose: function (prefill) {
        if (!newField) return;
        if (prefill != null) newField.value = prefill;
        newField.focus();
      },
      setActive: function (cid) {
        state.active = cid;
        /* Bring the thread into the drawn page when it is further down. */
        var at = visible().findIndex(function (c) { return c.id === cid; });
        if (at >= state.shown) state.shown = at + 1;
        draw();
        var node = document.getElementById('tk-c-' + cid);
        if (node) node.scrollIntoView({ block: 'nearest', behavior: reduce() ? 'auto' : 'smooth' });
      },
      reset: function () { state.query = ''; state.who = 'all'; state.sort = 'new'; state.shown = o.pageSize; draw(); },
      set: function (next) {
        if ('query' in next) state.query = String(next.query || '').trim().toLowerCase();
        if ('sort' in next) state.sort = next.sort || 'new';
        if ('who' in next) state.who = next.who || 'all';
        state.shown = o.pageSize;
        draw();
      },
      authors: function () { return Array.from(new Set(roots().map(function (c) { return c.author; }))).sort(); }
    };
  }

  window.GQTalk = {
    me: me, list: list, post: post, edit: edit, remove: remove, react: react, on: on,
    mount: mount, avatar: avatar, when: when, toast: toast, esc: esc, plural: plural,
    signInPrompt: signInPrompt, failure: failure, request: request, icon: ICON,
    readDraft: readDraft, writeDraft: writeDraft
  };
})();
