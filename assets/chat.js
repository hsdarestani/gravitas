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
   ========================================================================= */
(function () {
  'use strict';

  var CFG = window.GRAVITAS_CHAT || {};

  /* ---- What this site actually contains ---------------------------------
     Keys are matched loosely against the question. Keeping this as data
     rather than as branching logic means adding a page is one entry, and the
     answers stay in one place where an editor can read them. */
  var INDEX = [
    {
      k: 'topic topics dossier long form deep dive series film essay layers what is a topic',
      a: 'A Topic is one question worked all the way through: the film that opens it, the essay that argues it, the sources at three levels of difficulty, a timeline, something interactive to break, and the strongest case against our own conclusion.',
      l: [['Browse Topics', 'topics.html'], ['See a finished one', 'topic-computable-universe.html']]
    },
    {
      k: 'magazine article essay read writing archive blog',
      a: 'The Magazine is the written side: narrative and analytical pieces that stand on their own rather than supporting a film. Most run 8–20 minutes.',
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
      l: [['Create an account', 'account.html'], ['Sign in', 'account.html#in']]
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
      k: 'video youtube channel watch episode programme show series film',
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

  /* ---- Markup ------------------------------------------------------------ */
  var ICON = {
    // The channel's own G, not a generic sparkle. An assistant that wears the
    // brand reads as part of the site rather than as a bolted-on vendor widget.
    spark: '<svg class="gchat__spark gchat__mark" viewBox="0 0 491.17 491.22" fill="currentColor" aria-hidden="true"><path d="M491.17,433.95l-57.19,57.26c-57.04-33.03-122.2-50.49-188.39-50.49s-131.47,17.46-188.35,50.46L0,433.95c33-56.87,50.46-122,50.46-188.35S33,114.13,0,57.26L57.19,0c57.07,33.03,122.2,50.46,188.39,50.46S377.08,33.03,433.95.02l42.04,72.41c-69.65,40.41-149.3,61.78-230.41,61.78-44.2,0-88.05-6.39-130.09-18.75,12.34,42.01,18.72,85.87,18.72,130.14s-6.36,88.08-18.72,130.09c42.01-12.36,85.84-18.7,130.09-18.7s88.05,6.36,130.11,18.75c-8.45-28.73-14.08-58.31-16.83-88.27h-113.28v-83.76h195.15v41.89c0,66.34,17.44,131.47,50.44,188.35Z"/></svg>',
    x: '<svg class="gchat__x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6"/></svg>'
  };

  var root = document.createElement('div');
  root.className = 'gchat';
  root.innerHTML =
    '<div class="gchat__panel" id="gchat-panel" role="dialog" aria-label="Ask Gravitas+" aria-modal="false">' +
      // A lockup and a close, nothing else. The old header put the mark in a
      // bordered circle (which reads as an avatar, this is a logo, not a
      // person) above a mono uppercase strapline that repeated the note at the
      // foot of the panel. Saying it twice, once in the loudest treatment in
      // the widget, made the header the busiest part of a thing whose job is
      // to get out of the way.
      '<div class="gchat__head">' +
        '<span class="gchat__brand">' +
          ICON.spark +
          '<span class="gchat__title">Ask Gravitas<span class="gchat__plus">+</span></span>' +
        '</span>' +
        '<button class="gchat__close" type="button" aria-label="Close assistant">' + ICON.x + '</button>' +
      '</div>' +
      '<div class="gchat__log" role="log" aria-live="polite" aria-atomic="false"></div>' +
      '<div class="gchat__chips"></div>' +
      '<form class="gchat__form">' +
        '<textarea class="gchat__input" rows="1" placeholder="Ask about anything on the site…" aria-label="Your question"></textarea>' +
        '<button class="gchat__send" type="submit" aria-label="Send">' + ICON.send + '</button>' +
      '</form>' +
      '<p class="gchat__foot"></p>' +
    '</div>' +
    '<button class="gchat__btn" type="button" aria-expanded="false" aria-controls="gchat-panel" aria-label="Ask Gravitas+">' +
      ICON.spark + '<span>Ask Gravitas+</span>' +
    '</button>';
  document.body.appendChild(root);

  var log = root.querySelector('.gchat__log');
  var chips = root.querySelector('.gchat__chips');
  var form = root.querySelector('.gchat__form');
  var input = root.querySelector('.gchat__input');
  var launcher = root.querySelector('.gchat__btn');
  var foot = root.querySelector('.gchat__foot');

  foot.textContent = CFG.endpoint
    ? 'Answers may be wrong. Check anything that matters.'
    : 'Guided search, not a chatbot. It answers from an index of this site.';

  /* ---- Rendering --------------------------------------------------------- */
  function bubble(who, text, links) {
    var el = document.createElement('div');
    el.className = 'gchat__msg gchat__msg--' + who;
    var p = document.createElement('p');
    p.textContent = text;
    el.appendChild(p);
    if (links && links.length) {
      var row = document.createElement('div');
      row.className = 'gchat__links';
      links.forEach(function (l) {
        var a = document.createElement('a');
        a.className = 'gchat__link';
        a.href = l[1] || l.href;
        a.textContent = l[0] || l.label;
        row.appendChild(a);
      });
      el.appendChild(row);
    }
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  function thinking() {
    var el = document.createElement('div');
    el.className = 'gchat__msg gchat__msg--bot gchat__typing';
    el.innerHTML = '<i></i><i></i><i></i>';
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  function renderChips() {
    chips.innerHTML = '';
    OPENERS.forEach(function (q) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'gchat__chip';
      b.textContent = q;
      b.addEventListener('click', function () { chips.innerHTML = ''; send(q); });
      chips.appendChild(b);
    });
  }

  /* ---- Answering --------------------------------------------------------- */
  var history = [];

  function localAnswer(q) {
    var hit = match(q);
    if (hit) return { reply: hit.a, links: hit.l };
    return { reply: FALLBACK, links: [['Topics', 'topics.html'], ['Community', 'community.html']] };
  }

  function remoteAnswer(q) {
    return fetch(CFG.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: q, history: history.slice(-8), page: location.pathname })
    }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).then(function (d) {
      if (!d || !d.reply) throw new Error('empty');
      return { reply: d.reply, links: (d.links || []).map(function (l) { return [l.label, l.href]; }) };
    });
  }

  function send(text) {
    var q = (text || '').trim();
    if (!q) return;
    bubble('me', q);
    history.push({ role: 'user', content: q });
    input.value = '';
    input.style.height = 'auto';

    var dots = thinking();
    var job = CFG.endpoint
      ? remoteAnswer(q).catch(function () { return localAnswer(q); })
      // A local lookup returns instantly, which reads as canned. A short beat
      // makes the exchange feel like a reply rather than a page update.
      : new Promise(function (res) { setTimeout(function () { res(localAnswer(q)); }, 420); });

    job.then(function (out) {
      dots.remove();
      bubble('bot', out.reply, out.links);
      history.push({ role: 'assistant', content: out.reply });
    });
  }

  /* ---- Open / close ------------------------------------------------------ */
  var greeted = false;
  function setOpen(open) {
    root.classList.toggle('is-open', open);
    launcher.setAttribute('aria-expanded', String(open));
    if (open) {
      if (!greeted) {
        greeted = true;
        bubble('bot', 'Hello. I know what is on this site and where to find it: Topics, the Lab, learning paths, the community, accounts. What are you after?');
        renderChips();
      }
      // Not on touch: focusing the field summons the keyboard over the panel
      // before the reader has seen what the panel says.
      if (window.matchMedia('(pointer: fine)').matches) input.focus();
    } else {
      // The launcher fades back in over ~200ms; focusing it before it is
      // visible puts the focus ring on something the reader cannot see.
      setTimeout(function () { launcher.focus(); }, 210);
    }
  }

  launcher.addEventListener('click', function () { setOpen(true); });
  root.querySelector('.gchat__close').addEventListener('click', function () { setOpen(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && root.classList.contains('is-open')) setOpen(false);
  });

  form.addEventListener('submit', function (e) { e.preventDefault(); send(input.value); });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); }
  });
  input.addEventListener('input', function () {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 96) + 'px';
  });

  /* Any link in the panel is a normal navigation, so close first, otherwise
     the widget re-renders on the new page with the panel shut anyway and the
     transition looks like a bug. */
  log.addEventListener('click', function (e) {
    if (e.target.closest('a')) setOpen(false);
  });

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
