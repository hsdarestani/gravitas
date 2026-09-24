/* =========================================================================
   GRAVITAS+, ASK GRAVITAS
   A floating assistant available on every page.

   On the honesty of it: there is no backend here, and a widget that invents
   answers about a site is worse than no widget. So this ships as a *router*,
   not an oracle. It matches a question against a hand-written index of what
   is actually on this site and answers with real destinations. It says what
   it is at the bottom of the panel, and when it doesn't know, it says that
   instead of guessing.

   To make it a real assistant, set before this script loads:

     window.GRAVITAS_CHAT = { endpoint: 'https://your-api.example/chat' };

   The endpoint receives { message, history, page } as JSON and should reply
   with { reply: "..." } (optionally { links: [{label, href}] }). Everything
   below then defers to it, and the local index becomes the fallback for when
   that call fails, which is the behaviour you want at 3am anyway.

   The same widget is Pulsar in the workspace. It used to be a tab in the
   workspace dock, opened from the foot of the left rail, so the assistant
   lived bottom-left there and bottom-right everywhere else and behaved
   differently in each. Now there is one: the workspace loads this file and
   hands it a different ask() through window.GravitasChat.configure(), and
   the launcher, the hover, the tabs and the minimize are the same thing
   wherever the reader meets them.
   ========================================================================= */
(function () {
  'use strict';

  var CFG = window.GRAVITAS_CHAT || {};
  if (!CFG.endpoint) CFG.endpoint = '/api/pulsar/ask/';

  /* ---- What this site actually contains ---------------------------------
     Keys are matched loosely against the question. Keeping this as data
     rather than as branching logic means adding a page is one entry, and the
     answers stay in one place where an editor can read them. */
  var INDEX = [
    {
      k: 'topic topics dossier long form deep dive series video essay layers what is a topic',
      a: 'A Topic is one question worked all the way through: the video that opens it, the essay that argues it, the sources at three levels of difficulty, a timeline, something interactive to break, and the strongest case against our own conclusion.',
      l: [['Browse Topics', 'topics.html'], ['See a finished one', 'topic-computable-universe.html']]
    },
    {
      k: 'magazine article essay read writing archive blog',
      a: 'The Magazine is the written side: narrative and analytical pieces that stand on their own rather than supporting a video. Most run 8–20 minutes.',
      l: [['Magazine', 'magazine.html']]
    },
    {
      k: 'lab game simulation interactive play experiment tool sandbox try',
      a: 'The Lab is where you do the thing instead of watching it: hypothesis testing, spotting hype in a press release, splitting a research budget, reviewing a flawed paper. Most take five to twelve minutes.',
      l: [['Interactive Lab', 'lab.html'], ['Play Hypothesis Machine', 'game-hypothesis-machine.html']]
    },
    {
      k: 'learn learning path course curriculum study order beginner start where do i start new here',
      a: 'Learning Paths are the ordered version of the archive, a route that assumes you are starting somewhere specific. "AI in Research" is the one that is live; the others are being built.',
      l: [['Learning Paths', 'learn.html'], ['AI in Research', 'path-ai-in-research.html']]
    },
    {
      k: 'community join member role contribute volunteer help translate review discuss forum people group',
      a: 'The community is the point, not the afterthought. There are six roles (Reader, Researcher, Translator, Critic, Builder and Host) and you can hold more than one. Members propose the next Topic, vote on it, and argue with the conclusions in public.',
      l: [['Join Us', 'community.html#join'], ['See the roles', 'community.html']]
    },
    {
      k: 'newsletter email subscribe weekly mailing list',
      a: 'One edited email a week: what mattered, why, and what to be sceptical about. No link dumps.',
      l: [['Newsletter', 'newsletter.html']]
    },
    {
      k: 'account sign in log in register password profile free cost price pay subscription paywall',
      a: 'Everything on the site is free to read and free to play, and there is no paywall planned. An account is optional. It follows Topics, keeps your place in a path, and lets you put your name to an argument.',
      l: [['Create an account', '/signup'], ['Sign in', 'account.html#in']]
    },
    {
      k: 'about who what is gravitas team behind contact mission why',
      a: 'Gravitas+ is a media project, an interactive lab and a community, working on how science actually gets made, and on what AI is doing to research and teaching. The About page has the editorial rules, which are the interesting part.',
      l: [['About', 'about.html']]
    },
    {
      k: 'field fields discipline biology chemistry medicine climate psychology economics social science neuroscience ecology engineering statistics physics maths relevant for me my subject',
      a: 'Every field, deliberately. The questions here are the ones every discipline shares: what counts as evidence, how a hypothesis earns its keep, who funds the work, what peer review really catches. Examples get drawn from biology, medicine, climate, psychology and economics as readily as from physics.',
      l: [['Browse Topics', 'topics.html'], ['Community', 'community.html']]
    },
    {
      k: 'ai artificial intelligence machine learning ml model llm research tools',
      a: 'AI runs through most of what we make: whether a model can form a hypothesis or only a sentence that resembles one, and how to use one on your own data without fooling yourself.',
      l: [['Can a machine form a hypothesis?', 'topic-machine-hypothesis.html'], ['AI in Research path', 'path-ai-in-research.html']]
    },
    {
      k: 'dark light mode theme colour color night bright toggle switch',
      a: 'Both. The control is the sun/moon button in the header. Dark is the default until you pick otherwise, and your choice is remembered after that.',
      l: []
    },
    {
      k: 'video youtube channel watch episode programme show series',
      a: 'Five strands: one long narrative a month, a weekly read on new work, monthly interviews, a fortnightly practical lab, and a monthly roundtable on questions with no one-line answer.',
      l: [['What we make', 'index.html#make']]
    },
    {
      k: 'suggest propose idea topic request vote next what should you cover',
      a: 'Members propose subjects and vote on what gets made next. That vote is the main reason to have an account.',
      l: [['Propose a Topic', 'community.html#join']]
    }
  ];

  var OPENERS = [
    'Where should I start?',
    'Is this only for physicists?',
    'How do I join?'
  ];

  var FALLBACK = 'I could not match that to anything on the site, and I would rather say so than invent an answer. The Topics index and the Community page are the two best places to look, or ask me about the Lab, the learning paths, accounts or the newsletter.';

  /* ---- Matching ----------------------------------------------------------
     Word overlap, with a length guard so that "a" and "is" don't decide the
     answer. Crude, but it is honest about being crude, and for a dozen
     destinations it beats anything more elaborate. */
  var STOP = ' a an and are as at be by can do does for from how i in is it me my of on or the to what when where which who why you your this that with '.split(' ');

  function tokens(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(function (w) { return w.length > 2 && STOP.indexOf(w) === -1; });
  }

  function match(q) {
    var qt = tokens(q);
    if (!qt.length) return null;
    var best = null, bestScore = 0;
    INDEX.forEach(function (row) {
      var keys = row.k.split(' ');
      var score = 0;
      qt.forEach(function (w) {
        keys.forEach(function (k) {
          if (k === w) score += 2;
          else if (k.length > 3 && (k.indexOf(w) === 0 || w.indexOf(k) === 0)) score += 1;
        });
      });
      if (score > bestScore) { bestScore = score; best = row; }
    });
    return bestScore >= 2 ? best : null;
  }

  /* ---- What a page may override ------------------------------------------
     The public site uses the defaults. The workspace calls configure() with
     its own ask(), which answers from the reader's pages and cites them, its
     own router for the links those answers carry, and its own storage key, so
     a workspace conversation about a dossier never shows up as a tab on the
     magazine and the other way round. */
  var DEFAULTS = {
    title: 'Ask Pulsar',
    greeting: 'Hello. I know what is on this site and where to find it: Topics, the Lab, learning paths, the community, accounts. What are you after?',
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
    spark: '<svg class="gchat__spark gchat__mark" viewBox="0 0 400 400" fill="currentColor" aria-hidden="true"><path d="M100,0c0,55.22-44.77,100-100,100v100c110.46,0,200-89.55,200-200h-100Z"/><path d="M300,0c0,55.22,44.77,100,100,100v100c-110.46,0-200-89.55-200-200h100Z"/><path d="M300,400c0-55.22,44.77-100,100-100v-100c-110.46,0-200,89.55-200,200h100Z"/><path d="M100,400c0-55.22-44.77-100-100-100v-100c110.46,0,200,89.55,200,200h-100Z"/><circle cx="200" cy="200" r="25"/></svg>',
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
    // Closed, the launcher is the mark in a circle and nothing else; the name
    // is on the panel it opens, and on aria-label for anyone who cannot see it.
    '<button class="gchat__btn" type="button" aria-expanded="false" aria-controls="gchat-panel" aria-label="Ask Pulsar" title="Ask Pulsar">' +
      ICON.spark +
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
              return { who: m.who, text: m.text, links: m.links || [] };
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

  function render() { renderTabs(); renderLog(); }

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
        var a = document.createElement('a');
        a.className = 'gchat__link';
        a.href = l.href;
        a.textContent = l.label;
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
  function pairs(list) {
    return (list || []).map(function (l) {
      return Array.isArray(l) ? { label: l[0], href: l[1] } : { label: l.label, href: l.href };
    });
  }

  function localAnswer(q) {
    var hit = match(q);
    if (hit) return { reply: hit.a, links: pairs(hit.l) };
    return { reply: FALLBACK, links: pairs([['Topics', 'topics.html'], ['Community', 'community.html']]) };
  }

  function remoteAnswer(q, history) {
    return fetch(CFG.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: q, history: history, page: location.pathname })
    }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
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
    if (CFG.endpoint) return remoteAnswer(q, history).catch(function () { return localAnswer(q); });
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
      return { role: m.who === 'me' ? 'user' : 'assistant', content: m.text };
    });
    if (!t.title) t.title = topic(q);
    t.msgs.push({ who: 'me', text: q });
    t.pending = true;
    input.value = '';
    input.style.height = 'auto';
    save();
    render();

    answer(q, history).then(function (out) {
      t.pending = false;
      t.msgs.push({ who: 'bot', text: out.reply, links: out.links, actions: out.actions });
      // The tab may have been closed while the answer was on its way.
      if (!find(t.id)) return;
      t.unread = t.id !== activeId;
      save();
      render();
    });
  }

  /* ---- Open / minimize ---------------------------------------------------
     On a mouse, resting on the launcher opens the panel. Opened that way it is
     a preview: moving the pointer away folds it back, unless the reader has
     clicked or typed in it, at which point it is theirs and stays until they
     minimize it. That keeps hover from ever throwing away something the
     reader was in the middle of, and keeps a pointer that merely crossed the
     corner from leaving a panel over the page. Touch has no hover, so there a
     tap opens it, as before. */
  var HOVER = window.matchMedia('(hover: hover) and (pointer: fine)');
  var preview = false;
  var armed = true;
  var enterTimer = 0;
  var leaveTimer = 0;

  function isOpen() { return root.classList.contains('is-open'); }

  function setOpen(open, how) {
    clearTimeout(enterTimer);
    clearTimeout(leaveTimer);
    if (open) {
      if (isOpen()) {
        if (how !== 'hover') preview = false;
      } else {
        preview = how === 'hover';
        root.classList.add('is-open');
        launcher.setAttribute('aria-expanded', 'true');
        current().unread = false;
        render();
      }
      // A preview does not take focus: the reader has not asked to type, and
      // taking focus from the page on a pointer pass would be theft. Not on
      // touch either, where focusing summons the keyboard over the panel
      // before the reader has seen what it says.
      if (how !== 'hover' && window.matchMedia('(pointer: fine)').matches) input.focus();
      return;
    }
    if (!isOpen()) return;
    var hadFocus = root.contains(document.activeElement);
    preview = false;
    root.classList.remove('is-open');
    launcher.setAttribute('aria-expanded', 'false');
    // The launcher reappears under a pointer that is still in the corner;
    // without this, the next twitch of the mouse would open it again.
    armed = !root.matches(':hover');
    // The launcher fades back in over ~200ms; focusing it before it is
    // visible puts the focus ring on something the reader cannot see.
    if (hadFocus) setTimeout(function () { launcher.focus(); }, 210);
  }

  function engage() { preview = false; clearTimeout(leaveTimer); }

  launcher.addEventListener('click', function () { setOpen(true, 'click'); });
  launcher.addEventListener('mouseenter', function () {
    if (!HOVER.matches || !armed || isOpen()) return;
    enterTimer = setTimeout(function () { setOpen(true, 'hover'); }, 140);
  });
  launcher.addEventListener('mouseleave', function () { clearTimeout(enterTimer); });
  root.addEventListener('mouseenter', function () { clearTimeout(leaveTimer); });
  root.addEventListener('mouseleave', function () {
    armed = true;
    clearTimeout(enterTimer);
    if (!preview) return;
    leaveTimer = setTimeout(function () { if (preview) setOpen(false); }, 450);
  });
  panel.addEventListener('pointerdown', engage);
  panel.addEventListener('focusin', engage);

  root.querySelector('.gchat__min').addEventListener('click', function () { setOpen(false); });
  newBtn.addEventListener('click', addTab);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen()) setOpen(false);
  });

  form.addEventListener('submit', function (e) { e.preventDefault(); send(input.value); });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); }
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
