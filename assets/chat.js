/* =========================================================================
   GRAVIQUEST, ASK GRAVITAS
   A floating assistant available on every page.

   Public replies use the existing Pulsar API, deployed page snapshots and
   explicitly published content. Page/section and bounded conversation history
   travel with each question; no page DOM, credentials or private context do.
   Network failures are shown honestly and leave the conversation available.

   The same widget is Pulsar in the workspace. It used to be a tab in the
   workspace dock, opened from the foot of the left rail, so the assistant
   lived bottom-left there and bottom-right everywhere else and behaved
   differently in each. Now there is one: the workspace loads this file and
   hands it a different ask() through window.GravitasChat.configure(), and
   the launcher, the tabs and the minimize are the same thing
   wherever the reader meets them.
   ========================================================================= */
(function () {
  'use strict';

  var CFG = window.GRAVITAS_CHAT || {};
  if (!CFG.endpoint) CFG.endpoint = '/api/pulsar/ask/';

  // Public answers come from the existing backend and its published content.
  // A failed request must not turn a stale keyword index into an authority.
  var OPENERS = ['Where should I start?', 'What is this page about?', 'How can I participate?'];

  /* ---- What a page may override ------------------------------------------
     The public site uses the defaults. The workspace calls configure() with
     its own ask(), which answers from the reader's pages and cites them, its
     own router for the links those answers carry, and its own storage key, so
     a workspace conversation about a dossier never shows up as a tab on the
     public site and the other way round. */
  var DEFAULTS = {
    title: 'Ask Pulsar',
    greeting: 'Ask me about this page, the ideas behind it, or where to go next.',
    openers: OPENERS,
    placeholder: 'Ask about anything on the site…',
    foot: '',
    storageKey: 'gchat.tabs.v1'
  };
  function opt(name) { return CFG[name] != null ? CFG[name] : DEFAULTS[name]; }

  /* ---- Markup ------------------------------------------------------------ */
  var ICON = {
    // The Pulsar mark, the assistant's own identity: four arcs bending round
    // a point, which is the pulse. It used to borrow the brand G; the
    // assistant now has a mark of its own, drawn in currentColor so it
    // follows the launcher and the header in both themes.
    spark: '<svg class="gchat__spark gchat__mark" viewBox="0 0 100 100" fill="currentColor" aria-hidden="true"><path d="M0,50v-20.2c16.46,0,29.8-13.34,29.8-29.8h20.2c0,27.62-22.38,50-50,50Z"/><path d="M50,100h-20.2c0-16.46-13.34-29.8-29.8-29.8v-20.2c27.62,0,50,22.38,50,50Z"/><path d="M100,50c-27.62,0-50-22.38-50-50h20.2c0,16.46,13.34,29.8,29.8,29.8v20.2Z"/><path d="M70.2,100h-20.2c0-27.62,22.38-50,50-50v20.2c-16.46,0-29.8,13.34-29.8,29.8Z"/><circle cx="50" cy="50" r="10.1"/></svg>',
    min: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6"/></svg>'
  };

  var root = document.createElement('div');
  root.className = 'gchat';
  root.innerHTML =
    '<div class="gchat__panel" id="gchat-panel" role="dialog" aria-label="Ask Pulsar" aria-modal="false">' +
      // A lockup and one control. The control minimizes rather than closes:
      // the conversations are kept, in tabs, and the launcher brings back
      // exactly what was on screen. A close button promised to throw that
      // away, which is the opposite of what it did even before tabs.
      '<div class="gchat__head">' +
        '<span class="gchat__brand">' +
          ICON.spark +
          '<span class="gchat__title"></span>' +
        '</span>' +
        '<button class="gchat__min" type="button" aria-label="Minimize assistant" title="Minimize">' + ICON.min + '</button>' +
      '</div>' +
      // One tab per conversation. A question about the Lab and a question
      // about accounts are two threads, and the history sent with each
      // question is the history of its own tab, so one topic never leaks
      // into the answers of another.
      '<div class="gchat__tabbar">' +
        '<div class="gchat__tabs" role="tablist" aria-label="Conversations"></div>' +
        '<button class="gchat__new" type="button" aria-label="New conversation" title="New conversation">' + ICON.plus + '</button>' +
      '</div>' +
      '<div class="gchat__log" role="log" aria-live="polite" aria-atomic="false"></div>' +
      '<div class="gchat__chips"></div>' +
      '<form class="gchat__form">' +
        '<textarea class="gchat__input" rows="1" aria-label="Your question"></textarea>' +
        '<button class="gchat__send" type="submit" aria-label="Send">' + ICON.send + '</button>' +
      '</form>' +
      '<p class="gchat__foot"></p>' +
    '</div>' +
    // At rest, the launcher is the mark in a circle; the name unrolls beside it
    // under the pointer (chat.css). aria-label carries it the whole time.
    '<button class="gchat__btn" type="button" aria-expanded="false" aria-controls="gchat-panel" aria-label="Ask Pulsar">' +
      ICON.spark + '<span class="gchat__label" aria-hidden="true"><span>Ask Pulsar</span></span>' +
    '</button>';
  document.body.appendChild(root);

  var panel = root.querySelector('.gchat__panel');
  var title = root.querySelector('.gchat__title');
  var tabList = root.querySelector('.gchat__tabs');
  var newBtn = root.querySelector('.gchat__new');
  var log = root.querySelector('.gchat__log');
  var chips = root.querySelector('.gchat__chips');
  var form = root.querySelector('.gchat__form');
  var input = root.querySelector('.gchat__input');
  var launcher = root.querySelector('.gchat__btn');
  var foot = root.querySelector('.gchat__foot');

  /* ---- Conversations -----------------------------------------------------
     Kept in localStorage, so a thread survives the page change its own links
     cause. What is stored is text and links only: actions such as "Save as
     task" close over live objects and are offered on the reply that made
     them, not replayed from storage. Storage can be missing or throw (private
     windows, blocked site data); the widget then works exactly as before,
     for the length of one page. */
  var MAX_TABS = 8;
  var MAX_MSGS = 60;
  var tabs = [];
  var activeId = null;

  function uid() { return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function blankTab() { return { id: uid(), title: '', msgs: [] }; }
  function find(id) {
    for (var i = 0; i < tabs.length; i++) if (tabs[i].id === id) return tabs[i];
    return null;
  }
  function current() { return find(activeId); }

  function load() {
    tabs = [];
    activeId = null;
    try {
      var raw = JSON.parse(localStorage.getItem(opt('storageKey')) || 'null');
      if (raw && Array.isArray(raw.tabs)) {
        tabs = raw.tabs
          .filter(function (t) { return t && t.id && Array.isArray(t.msgs); })
          .slice(0, MAX_TABS)
          .map(function (t) {
            return {
              id: String(t.id),
              title: String(t.title || ''),
              msgs: t.msgs.filter(function (m) {
                return m && (m.who === 'me' || m.who === 'bot') && typeof m.text === 'string';
              })
            };
          });
        activeId = raw.active;
      }
    } catch (e) { /* no storage: start with one empty conversation */ }
    if (!tabs.length) tabs.push(blankTab());
    if (!find(activeId)) activeId = tabs[0].id;
  }

  function save() {
    try {
      localStorage.setItem(opt('storageKey'), JSON.stringify({
        active: activeId,
        tabs: tabs.map(function (t) {
          return {
            id: t.id,
            title: t.title,
            msgs: t.msgs.slice(-MAX_MSGS).map(function (m) {
              return { who: m.who, text: m.text, links: m.links || [], page: m.page || '' };
            })
          };
        })
      }));
    } catch (e) { /* the conversation still works, it just won't be kept */ }
  }

  // The first question names the tab. Readers do not name chat threads, and
  // "Chat 3" says nothing about which one held the answer they want back.
  function topic(q) {
    var s = q.replace(/\s+/g, ' ').trim();
    if (s.length <= 30) return s;
    var cut = s.slice(0, 30);
    var space = cut.lastIndexOf(' ');
    return (space > 12 ? cut.slice(0, space) : cut) + '…';
  }

  function select(id) {
    var t = find(id);
    if (!t) return;
    activeId = id;
    t.unread = false;
    save();
    render();
    if (root.classList.contains('is-open') && window.matchMedia('(pointer: fine)').matches) input.focus();
  }

  // An empty conversation is already a new one, so the + goes to it instead
  // of stacking blank tabs.
  function addTab() {
    for (var i = 0; i < tabs.length; i++) {
      if (!tabs[i].msgs.length && !tabs[i].pending) { select(tabs[i].id); return; }
    }
    if (tabs.length >= MAX_TABS) return;
    var t = blankTab();
    tabs.push(t);
    select(t.id);
  }

  function closeTab(id) {
    var at = -1;
    for (var i = 0; i < tabs.length; i++) if (tabs[i].id === id) at = i;
    if (at < 0) return;
    tabs.splice(at, 1);
    if (!tabs.length) tabs.push(blankTab());
    if (activeId === id) activeId = tabs[Math.min(at, tabs.length - 1)].id;
    save();
    render();
  }

  /* ---- Rendering ---------------------------------------------------------
     The panel redraws from the conversation state rather than appending to
     whatever is on screen, because a reply can now land in a tab that is not
     the one showing. */
  function renderTabs() {
    tabList.innerHTML = '';
    tabs.forEach(function (t) {
      var on = t.id === activeId;
      var name = t.title || 'New chat';
      var tab = document.createElement('div');
      tab.className = 'gchat__tab' + (on ? ' is-active' : '');

      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'gchat__tab-btn';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(on));
      b.title = name;
      var label = document.createElement('span');
      label.className = 'gchat__tab-label';
      label.textContent = name;
      b.appendChild(label);
      if (t.unread) {
        var dot = document.createElement('i');
        dot.className = 'gchat__dot';
        dot.setAttribute('aria-label', 'new reply');
        b.appendChild(dot);
      }
      b.addEventListener('click', function () { select(t.id); });
      tab.appendChild(b);

      // The last empty conversation has nothing to close.
      if (tabs.length > 1 || t.msgs.length) {
        var x = document.createElement('button');
        x.type = 'button';
        x.className = 'gchat__tab-x';
        x.setAttribute('aria-label', 'Close conversation: ' + name);
        x.innerHTML = ICON.x;
        x.addEventListener('click', function () { closeTab(t.id); });
        tab.appendChild(x);
      }
      tabList.appendChild(tab);
    });
    newBtn.disabled = tabs.length >= MAX_TABS && tabs.every(function (t) { return t.msgs.length; });

    // Keep the active tab in view without scrollIntoView, which can scroll
    // the page underneath when the panel is fixed.
    var cur = tabList.querySelector('.is-active');
    if (cur) {
      var l = cur.offsetLeft, r = l + cur.offsetWidth;
      if (l < tabList.scrollLeft) tabList.scrollLeft = l;
      else if (r > tabList.scrollLeft + tabList.clientWidth) tabList.scrollLeft = r - tabList.clientWidth;
    }
    paintEdges();
  }

  /* ---- Moving along the tab strip ----------------------------------------
     With more tabs than fit, the strip scrolls sideways, but its scrollbar is
     hidden and a mouse has no sideways gesture, so the tabs past the edge
     could not be reached at all. Now the strip is a rail: press anywhere on it
     and pull, and it follows the pointer. A press that does not travel is
     still a click on the tab under it; one that does is a drag, and the click
     it would end in is swallowed so letting go does not switch tabs. Touch
     already scrolls the strip natively and is left to do so. A wheel turn
     moves it too, since that is what a mouse reader reaches for first. The
     edges fade where there is more, so the strip says that it goes on. */
  var drag = null;
  var DRAG_SLOP = 5;

  function paintEdges() {
    var max = tabList.scrollWidth - tabList.clientWidth;
    tabList.classList.toggle('has-before', tabList.scrollLeft > 1);
    tabList.classList.toggle('has-after', tabList.scrollLeft < max - 1);
  }

  tabList.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    if (tabList.scrollWidth <= tabList.clientWidth) return;
    drag = { id: e.pointerId, x: e.clientX, left: tabList.scrollLeft, moved: false };
  });
  tabList.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.x;
    if (!drag.moved) {
      if (Math.abs(dx) < DRAG_SLOP) return;
      drag.moved = true;
      // Captured only once it is a drag: capturing on press would retarget
      // the click of an ordinary tap to the strip instead of the tab.
      tabList.setPointerCapture(drag.id);
      tabList.classList.add('is-dragging');
    }
    tabList.scrollLeft = drag.left - dx;
  });
  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var moved = drag.moved;
    drag = null;
    tabList.classList.remove('is-dragging');
    if (moved) {
      var swallow = function (ev) { ev.stopPropagation(); ev.preventDefault(); };
      tabList.addEventListener('click', swallow, { capture: true, once: true });
      // If no click follows (released off the strip), do not eat the next one.
      setTimeout(function () { tabList.removeEventListener('click', swallow, true); }, 0);
    }
  }
  tabList.addEventListener('pointerup', endDrag);
  tabList.addEventListener('pointercancel', endDrag);
  tabList.addEventListener('wheel', function (e) {
    if (tabList.scrollWidth <= tabList.clientWidth) return;
    var d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!d) return;
    e.preventDefault();
    tabList.scrollLeft += d;
  }, { passive: false });
  tabList.addEventListener('scroll', paintEdges, { passive: true });

  function renderLog() {
    var t = current();
    log.innerHTML = '';
    chips.innerHTML = '';
    // The greeting heads every conversation but is not part of it: it is not
    // stored and not sent back as history.
    log.appendChild(bubble({ who: 'bot', text: opt('greeting') }));
    if (!t.msgs.length && !t.pending) renderChips();
    t.msgs.forEach(function (m) { log.appendChild(bubble(m)); });
    if (t.pending) log.appendChild(thinking());
    log.scrollTop = log.scrollHeight;
  }

  function render() {
    renderTabs(); renderLog();
    var pending = !!current().pending;
    root.querySelector('.gchat__send').disabled = pending;
    form.setAttribute('aria-busy', String(pending));
  }

  function bubble(m) {
    var el = document.createElement('div');
    el.className = 'gchat__msg gchat__msg--' + m.who;
    String(m.text).split('\n\n').forEach(function (para) {
      var p = document.createElement('p');
      p.textContent = para;
      el.appendChild(p);
    });
    var links = m.links || [];
    var actions = m.actions || [];
    if (links.length || actions.length) {
      var row = document.createElement('div');
      row.className = 'gchat__links';
      links.forEach(function (l) {
        if (!safeLink(l.href)) return;
        var a = document.createElement('a');
        a.className = 'gchat__link';
        a.href = CFG.linkBase ? new URL(l.href, CFG.linkBase).href : l.href;
        a.textContent = l.label;
        // The pill cuts a long title to one line (chat.css); the whole of
        // it stays one hover away.
        a.title = l.label;
        row.appendChild(a);
      });
      actions.forEach(function (act) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'gchat__link gchat__action';
        b.textContent = act.label;
        b.disabled = !!act.disabled;
        // The result is written back onto the action, not just the button,
        // because the next reply redraws the panel: a "Saved" that turned back
        // into "Save as task" would invite saving twice.
        b.addEventListener('click', function () {
          b.disabled = true;
          Promise.resolve(act.run()).then(function (out) {
            if (out && out.label) act.label = out.label;
            act.disabled = !!(out && out.disabled);
            b.textContent = act.label;
            b.disabled = act.disabled;
          }, function () { b.disabled = false; });
        });
        row.appendChild(b);
      });
      el.appendChild(row);
    }
    return el;
  }

  function thinking() {
    var el = document.createElement('div');
    el.className = 'gchat__msg gchat__msg--bot gchat__typing';
    el.innerHTML = '<i></i><i></i><i></i>';
    return el;
  }

  function renderChips() {
    (opt('openers') || []).forEach(function (q) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'gchat__chip';
      b.textContent = q;
      b.addEventListener('click', function () { send(q); });
      chips.appendChild(b);
    });
  }

  /* ---- Answering --------------------------------------------------------- */
  function safeLink(href) {
    if (typeof href !== 'string' || !href.trim()) return false;
    try {
      var url = new URL(href, location.href);
      // Private configured integrations may cite external sources; never allow
      // script/data URLs, including links replayed from local storage.
      return url.protocol === 'https:' || (url.protocol === 'http:' && url.origin === location.origin);
    } catch (err) { return false; }
  }

  function pairs(list) {
    return (list || []).map(function (l) {
      return Array.isArray(l) ? { label: l[0], href: l[1] } : { label: l.label, href: l.href };
    });
  }

  function localAnswer() {
    return { reply: 'Pulsar could not answer just now. Please try your question again in a moment.', links: [] };
  }

  /* Pulsar needs to know the headings and Topic cards a visitor actually
     sees. During the CMS migration the static public pages can be ahead of
     the DB, so read the same-origin Topics index instead of guessing from
     the backend's published ContentItems. No private DOM or user data. */
  var publicTopicsPromise = null;

  function readPublicTopicCards(doc) {
    return Array.prototype.slice.call(doc.querySelectorAll('#all a.entry'), 0, 40)
      .map(function (card) {
        var title = card.querySelector('h3');
        var planned = card.classList.contains('is-soon') ||
          card.getAttribute('aria-disabled') === 'true';
        return {
          title: title ? title.textContent.trim().slice(0, 220) : '',
          status: planned ? 'planned' : 'open',
          href: planned ? '' : (card.getAttribute('href') || '')
        };
      })
      .filter(function (row) { return Boolean(row.title); });
  }

  function publicTopicCards() {
    if (publicTopicsPromise) return publicTopicsPromise;
    if ((CFG.publicPage === '/forum' || CFG.publicPage === '/forum.html')) return Promise.resolve([]);
    if (location.pathname.endsWith('/topics')) {
      return Promise.resolve(readPublicTopicCards(document));
    }
    publicTopicsPromise = timedFetch('/topics', { cache: 'default', credentials: 'omit' }, 4000)
      .then(function (response) {
        if (!response.ok) throw new Error('topics-unavailable');
        return response.text();
      })
      .then(function (html) {
        return readPublicTopicCards(new DOMParser().parseFromString(html, 'text/html'));
      })
      .catch(function () { return []; });
    return publicTopicsPromise;
  }

  function publicPageContext() {
    // The public endpoint must not receive workspace or account DOM content.
    var path = location.pathname;
    var publicPath = (path === '/' || path === '/community' || (path.lastIndexOf('/') === 0 && path.endsWith('.html'))) && !/^\/(workspace|account)([/.]|$)/.test(path);
    if (!publicPath) return { heading: '', featured_topic: '', featured_href: '', actions: [] };

    var main = document.querySelector('main');
    var home = path === '/' || path === '/';
    var heading = main && main.querySelector('h1');
    var featured = home && main && main.querySelector('.lp-topic__q');
    var featuredLink = home && main && main.querySelector('.lp-topic__intro a[href^="topic-"]');
    var actions = main ? Array.prototype.slice.call(main.querySelectorAll('a[href], button'), 0, 45)
      .filter(function (node) { return !node.disabled && node.getAttribute('aria-disabled') !== 'true' && !node.closest('[hidden], [data-public-context-skip]'); })
      .map(function (node) {
        var label = (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100);
        return { label: label, href: node.getAttribute('href') || '' };
      })
      .filter(function (row) { return row.label; })
      .slice(0, 18) : [];
    return {
      heading: heading ? heading.textContent.trim().slice(0, 180) : '',
      featured_topic: featured ? featured.textContent.trim().slice(0, 220) : '',
      featured_href: featuredLink ? (featuredLink.getAttribute('href') || '') : '',
      actions: actions
    };
  }

  function timedFetch(url, options, ms) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, ms);
    return fetch(url, Object.assign({}, options, {signal: controller.signal}))
      .finally(function () { clearTimeout(timer); });
  }

  function readingContext() {
    var main = document.querySelector('main');
    if (!main || /\/(workspace|account)([/.]|$)/.test(location.pathname)) return {};
    var essay = main.querySelector('[data-essay-main] .tq-essay__head');
    var level = main.querySelector('[data-level][aria-pressed="true"]');
    var mode = main.querySelector('[data-mode][aria-pressed="true"]');
    return {essay: essay ? essay.id.replace('essay-', '') : '',
      level: level ? level.getAttribute('data-level') : '',
      mode: mode ? mode.getAttribute('data-mode') : ''};
  }

  function currentSection() {
    var main = document.querySelector('main');
    var active = main && main.querySelector('.tq-sec:not([hidden])');
    if (active) return active.id;
    if (location.hash) return location.hash.slice(1);
    var sections = main ? Array.prototype.slice.call(main.querySelectorAll('section[id]')) : [];
    var near = sections.find(function (node) {
      var box = node.getBoundingClientRect();
      return !node.hidden && box.top < 180 && box.bottom > 180;
    });
    return near ? near.id : '';
  }

  function remoteAnswer(q, history) {
    return publicTopicCards().then(function (catalog) {
      return timedFetch(CFG.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: q, history: history, page: CFG.publicPage || location.pathname, forum_topic: CFG.forumTopic || null,
          suggested: (current() ? current().msgs : []).filter(function (m) { return m.who === 'bot'; }).reduce(function (all, m) { return all.concat(m.links || []); }, []).slice(-10),
          section: currentSection(), reading: readingContext(), locale: document.documentElement.lang || 'en',
          topic_slug: location.pathname === '/topic' ? new URLSearchParams(location.search).get('slug') : '',
          page_context: publicPageContext(), topic_catalog: catalog
        })
      }, 25000);
    }).then(function (r) {
      return r.json().catch(function () {
        console.warn('Pulsar request failed', {status: r.status, code: 'invalid_response'});
        throw new Error('invalid_response');
      }).then(function (d) {
        if (!r.ok || (d && d.ok === false)) {
          // Only stable error metadata; never log prompts, history, complete
          // payloads, exception text or account/authentication details.
          var codes = ['cloudflare_ai_quota_exhausted', 'cloudflare_ai_rate_limited',
            'cloudflare_ai_authentication_failed', 'cloudflare_ai_timeout',
            'cloudflare_ai_failed', 'cloudflare_ai_network_error',
            'cloudflare_ai_invalid_response', 'cloudflare_ai_empty_response',
            'pulsar_provider_not_configured', 'pulsar_unavailable'];
          console.warn('Pulsar request failed', {
            status: r.status,
            code: d && codes.indexOf(d.error) !== -1 ? d.error : 'http_error',
            providerCodes: d && Array.isArray(d.provider_codes) ? d.provider_codes.filter(function (c) { return Number.isInteger(c); }).slice(0, 4) : [],
            requestId: d && /^[a-f0-9]{32}$/.test(d.request_id || '') ? d.request_id : ''
          });
          if (!d || !d.reply) throw new Error('http_error');
          return { reply: d.reply, links: [] };
        }
        return d;
      });
    }).then(function (d) {
      if (!d || !d.reply) throw new Error('empty');
      return { reply: d.reply, links: pairs(d.links) };
    });
  }

  function answer(q, history) {
    if (typeof CFG.ask === 'function') {
      return Promise.resolve()
        .then(function () { return CFG.ask(q, history); })
        .then(function (out) {
          return { reply: out.reply, links: pairs(out.links), actions: out.actions || [] };
        })
        .catch(function () {
          return { reply: 'That request did not go through. Pulsar may be down; try again in a moment.', links: [] };
        });
    }
    if (CFG.endpoint) return remoteAnswer(q, history).catch(function (error) {
      console.warn('Pulsar transport failed', { code: error && error.name === 'AbortError' ? 'timeout' : 'network_or_invalid_response' });
      return localAnswer(q);
    });
    // A local lookup returns instantly, which reads as canned. A short beat
    // makes the exchange feel like a reply rather than a page update.
    return new Promise(function (res) { setTimeout(function () { res(localAnswer(q)); }, 420); });
  }

  function send(text) {
    var q = (text || '').trim();
    var t = current();
    // One question at a time per conversation; another tab is free to ask.
    if (!q || t.pending) return;

    var history = t.msgs.slice(-8).map(function (m) {
      return { role: m.who === 'me' ? 'user' : 'assistant', content: m.text.slice(0, 600), page: m.page || '', links: (m.links || []).slice(0, 2) };
    });
    if (!t.title) t.title = topic(q);
    t.msgs.push({ who: 'me', text: q, page: location.pathname });
    t.pending = true;
    input.value = '';
    input.style.height = 'auto';
    save();
    render();

    answer(q, history).then(function (out) {
      t.pending = false;
      t.msgs.push({ who: 'bot', text: out.reply, links: out.links, actions: out.actions, page: location.pathname });
      // The tab may have been closed while the answer was on its way.
      if (!find(t.id)) return;
      t.unread = t.id !== activeId;
      save();
      render();
    });
  }

  /* ---- Open / minimize ---------------------------------------------------
     Only a click opens the panel. Resting the pointer on the launcher used to
     open it as a preview that folded back when the pointer left; now hover only
     unrolls the name beside the mark (chat.css), and the panel waits to be
     asked for. A pointer crossing the corner on its way somewhere else never
     puts a panel over the page. */
  function isOpen() { return root.classList.contains('is-open'); }

  function setOpen(open) {
    if (open) {
      if (!isOpen()) {
        root.classList.add('is-open');
        launcher.setAttribute('aria-expanded', 'true');
        current().unread = false;
        render();
      }
      // Not on touch, where focusing summons the keyboard over the panel
      // before the reader has seen what it says.
      if (window.matchMedia('(pointer: fine)').matches) input.focus();
      return;
    }
    if (!isOpen()) return;
    var hadFocus = root.contains(document.activeElement);
    root.classList.remove('is-open');
    launcher.setAttribute('aria-expanded', 'false');
    // The launcher fades back in over ~200ms; focusing it before it is
    // visible puts the focus ring on something the reader cannot see.
    if (hadFocus) setTimeout(function () { launcher.focus(); }, 210);
  }

  launcher.addEventListener('click', function () { setOpen(true); });

  root.querySelector('.gchat__min').addEventListener('click', function () { setOpen(false); });
  newBtn.addEventListener('click', addTab);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen()) setOpen(false);
  });

  form.addEventListener('submit', function (e) { e.preventDefault(); send(input.value); });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(input.value); }
  });
  input.addEventListener('input', function () {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 96) + 'px';
  });

  /* A link in the panel is a navigation. On the public site that is a new
     page, so the panel folds first rather than re-rendering shut on arrival,
     which looks like a bug. In the workspace, configure() hands over the
     router, and the link moves the reader without a page load. */
  log.addEventListener('click', function (e) {
    var a = e.target.closest('a');
    if (!a) return;
    if (typeof CFG.navigate === 'function' && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      CFG.navigate(a.getAttribute('href'));
    }
    setOpen(false);
  });

  function fitViewport() {
    var viewport = window.visualViewport;
    if (!viewport) return;
    var lift = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    root.style.setProperty('--gchat-keyboard', lift + 'px');
    root.style.setProperty('--gchat-viewport', viewport.height + 'px');
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitViewport);
    window.visualViewport.addEventListener('scroll', fitViewport);
    fitViewport();
  }

  function applyConfig() {
    title.textContent = opt('title');
    input.placeholder = opt('placeholder');
    foot.textContent = opt('foot') || (CFG.endpoint || CFG.ask
      ? 'Answers may be wrong. Check anything that matters.'
      : 'Guided search, not a chatbot. It answers from an index of this site.');
    load();
    render();
  }
  applyConfig();

  /* ---- For the page -------------------------------------------------------
     configure() may run before or after this script, so it announces itself
     with an event as well as the global. */
  window.GravitasChat = {
    configure: function (cfg) {
      for (var k in cfg) if (Object.prototype.hasOwnProperty.call(cfg, k)) CFG[k] = cfg[k];
      applyConfig();
    },
    updateContext: function (context) {
      CFG.publicPage = context.page || '';
      CFG.forumTopic = context.forumTopic || null;
    },
    open: function () { setOpen(true, 'api'); },
    // Starts a fresh conversation for the question: a prompt handed over by a
    // view is its own topic, not a follow-up to whatever was last asked.
    ask: function (question) {
      addTab();
      setOpen(true, 'api');
      if (question) send(question);
    }
  };
  document.dispatchEvent(new CustomEvent('gravitas-chat:ready'));

  /* The hero's orbit is a drag surface on touch. The launcher is fixed above
     it, so it steps aside while a drag is in progress rather than swallowing
     the gesture. */
  var hit = document.getElementById('lp-orbit-hit');
  if (hit) {
    hit.addEventListener('pointerdown', function () { root.classList.add('is-dragging-hero'); });
    ['pointerup', 'pointercancel'].forEach(function (ev) {
      window.addEventListener(ev, function () { root.classList.remove('is-dragging-hero'); });
    });
  }
})();
