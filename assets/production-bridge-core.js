(function () {
  'use strict';

  /* Production-only behaviour. Kiarash's repository is the visual/content
     source of truth; this file deliberately does not patch markup, styles,
     icons, wording or thumbnails. It only turns prototype forms/account state
     into real Django API calls. */

  function cookie(name) {
    var prefix = name + '=';
    var parts = document.cookie ? document.cookie.split(';') : [];
    for (var i = 0; i < parts.length; i++) {
      var value = parts[i].trim();
      if (value.indexOf(prefix) === 0) return decodeURIComponent(value.slice(prefix.length));
    }
    return '';
  }

  function csrfToken() {
    return fetch('/api/auth/csrf/', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    }).then(function (res) {
      if (!res.ok) throw new Error('csrf');
      return cookie('csrftoken') || cookie('gravitas_staging_csrftoken');
    });
  }

  function apiPost(url, payload) {
    return csrfToken().then(function (token) {
      return fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-CSRFToken': token
        },
        body: JSON.stringify(payload || {})
      });
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw data;
        return data;
      });
    });
  }

  function noteFor(form) {
    if (!form) return null;
    if (form.id === 'p-up' || form.id === 'p-in' || form.id === 'p-reset') {
      return document.querySelector('.auth__note[data-form-note]');
    }
    return (form.parentElement && form.parentElement.querySelector('[data-form-note]')) ||
      form.querySelector('[data-form-note]');
  }

  function setNote(form, text) {
    var note = noteFor(form);
    if (note) note.textContent = text;
  }

  function setBusy(form, busy) {
    var button = form && form.querySelector('button[type="submit"]');
    if (button) button.disabled = !!busy;
  }

  function errorText(err) {
    if (!err) return 'Something went wrong. Please try again.';
    if (err.error === 'invalid_email') return 'Please enter a valid email address.';
    if (err.error === 'account_exists') return 'An account with this email already exists.';
    if (err.error === 'invalid_credentials') return 'Email or password is incorrect.';
    if (err.error === 'email_not_verified') return 'Confirm your email before signing in. We can resend the confirmation below.';
    if (err.error === 'invalid_or_expired_link') return 'This reset link is invalid or has expired.';
    if (err.error === 'password_invalid' && Array.isArray(err.messages) && err.messages.length) {
      return err.messages.join(' ');
    }
    if (err.error === 'email_delivery_failed') {
      return 'Email delivery is temporarily unavailable. Please try again shortly.';
    }
    return 'Something went wrong. Please try again.';
  }

  /* The label lives in one of three shapes depending on which header slot the
     link sits in: an explicit [data-auth-label], a bare <span> next to the icon
     (.gh-signin), or a loose text node after the icon (.gh-nav-signin). The
     previous version only knew about the text node and *appended* otherwise,
     which is why a signed-in visitor read "Sign inWorkspace" in the header:
     the <span> kept saying "Sign in" and "Workspace" was added after it. Write
     to whichever holder exists, then clear the others so the label can never be
     duplicated, however many times this runs. */
  function setLinkLabel(link, label) {
    if (!link) return;

    var holder = link.querySelector('[data-auth-label]');
    if (!holder) {
      var spans = link.children;
      for (var s = 0; s < spans.length; s++) {
        if (spans[s].tagName === 'SPAN' && spans[s].getAttribute('aria-hidden') !== 'true') {
          holder = spans[s];
          break;
        }
      }
    }

    var nodes = link.childNodes, text = null;
    for (var i = nodes.length - 1; i >= 0; i--) {
      if (nodes[i].nodeType === 3 && nodes[i].nodeValue.trim()) { text = nodes[i]; break; }
    }

    if (holder) {
      holder.textContent = label;
      // Drop any stray text node, including one a previous run appended.
      for (var j = nodes.length - 1; j >= 0; j--) {
        if (nodes[j].nodeType === 3 && nodes[j].nodeValue.trim()) link.removeChild(nodes[j]);
      }
    } else if (text) {
      text.nodeValue = label;
    } else {
      link.appendChild(document.createTextNode(label));
    }

    if (link.hasAttribute('aria-label')) link.setAttribute('aria-label', label);
    if (link.hasAttribute('title')) link.setAttribute('title', label);
  }

  function setJoinVisibility(visible) {
    /* "Join Us" is an acquisition CTA for visitors who do not have an
       account yet. Once Django confirms a session it competes with the real
       next action (Workspace) and makes a signed-in member look signed out.
       Keep this scoped to the two header CTA shapes only; the Community page
       content can still explain membership without losing its structure. */
    [].forEach.call(document.querySelectorAll('.gh-nav-join, .lp-header__cta'), function (join) {
      join.hidden = !visible;
      join.setAttribute('aria-hidden', String(!visible));
      if (!visible) join.setAttribute('tabindex', '-1');
      else join.removeAttribute('tabindex');
    });
  }

  function markAccount(email) {
    [].forEach.call(document.querySelectorAll('.gh-signin, .gh-nav-signin'), function (signIn) {
      setLinkLabel(signIn, 'Workspace');
      signIn.href = '/workspace';
    });
    setJoinVisibility(false);
    var note = document.querySelector('.auth__note[data-form-note]');
    if (note && email) note.textContent = 'Signed in as ' + email + '.';
  }

  var params = new URLSearchParams(location.search);
  var resetUid = params.get('reset_uid') || '';
  var resetToken = params.get('reset_token') || '';
  var resetForm = document.getElementById('p-reset');

  if (resetForm && resetUid && resetToken) {
    resetForm.innerHTML =
      '<button class="auth__back" type="button" data-tab="in">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>' +
        'Back to sign in</button>' +
      '<h1 class="auth__h">Choose a new password.</h1>' +
      '<p class="auth__lede">Use at least ten characters.</p>' +
      '<label class="g-field"><span class="g-label">New password</span>' +
        '<input class="g-input" name="new_password" type="password" autocomplete="new-password" minlength="10" required></label>' +
      '<button class="g-btn g-btn--primary g-btn--lg g-full" type="submit">Set new password</button>';
    resetForm.hidden = false;
  }

  document.addEventListener('click', function (e) {
    var resend = e.target && e.target.closest && e.target.closest('[data-resend-verification]');
    if (!resend) return;
    e.preventDefault();
    var email = resend.getAttribute('data-email') || '';
    resend.disabled = true;
    var original = resend.textContent;
    resend.textContent = 'Sending…';
    apiPost('/api/auth/email-confirm/resend/', { email: email })
      .then(function () { resend.textContent = 'Sent — check your inbox'; })
      .catch(function () { resend.textContent = 'Could not send — try again'; resend.disabled = false; })
      .finally(function () {
        if (!resend.disabled) window.setTimeout(function () { resend.textContent = original; }, 1800);
      });
  });

  var authStatus = document.getElementById('auth-status');
  if (authStatus) {
    if (params.get('email_verified') === '1') {
      authStatus.hidden = false;
      authStatus.innerHTML = '<h3 style="margin-top:0">Email confirmed</h3><p>Your email is verified. You can sign in now.</p>';
      if (history.replaceState) history.replaceState({}, '', '/login');
      window.setTimeout(function () { location.hash = 'in'; }, 0);
    } else if (params.get('email_verified') === '0') {
      authStatus.hidden = false;
      authStatus.innerHTML = '<h3 style="margin-top:0">Confirmation link expired</h3><p>Sign in with Google or resend the verification email from your pending account screen.</p>';
    } else if (params.get('google_error')) {
      authStatus.hidden = false;
      authStatus.innerHTML = '<h3 style="margin-top:0">Google sign-in did not finish</h3><p>Please try again or use email and password.</p>';
    }
  }

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || form.nodeType !== 1) return;

    var isSignup = form.id === 'p-up';
    var isLogin = form.id === 'p-in';
    var isReset = form.id === 'p-reset';
    // The prototype tagged every form `data-demo-form` and let site.js fake a
    // success note. That string is now banned from the public HTML, so the
    // hooks here are the real ones: auth forms by id, the newsletter by its
    // only class, and discussion forms by the content key they post against.
    var isNewsletter = form.matches && form.matches('.g-inline-form');
    var commentKey = form.getAttribute && form.getAttribute('data-comment-form');
    if (!isSignup && !isLogin && !isReset && !isNewsletter && !commentKey) return;

    // Capture phase wins before the prototype's demo-form listener.
    e.preventDefault();
    e.stopImmediatePropagation();
    setBusy(form, true);

    var job;
    if (isSignup) {
      setNote(form, 'Creating your account…');
      job = apiPost('/api/auth/signup/', {
        name: (form.elements.name && form.elements.name.value || '').trim(),
        email: (form.elements.email && form.elements.email.value || '').trim(),
        phone: (form.elements.phone && form.elements.phone.value || '').trim(),
        password: form.elements.password && form.elements.password.value || '',
        newsletter: !!(form.elements.news && form.elements.news.checked)
      }).then(function (data) {
        var email = data.user && data.user.email || (form.elements.email && form.elements.email.value || '').trim();
        form.innerHTML =
          '<div class="callout auth__verification">' +
            '<h2 style="margin-top:0">Check your inbox</h2>' +
            '<p>We sent a confirmation link to <strong>' + email.replace(/[&<>"']/g, '') + '</strong>. Confirm it before signing in.</p>' +
            '<div class="g-cluster g-mt-sm">' +
              '<button class="g-btn g-btn--secondary" type="button" data-resend-verification data-email="' + email.replace(/["&<>]/g, '') + '">Resend email</button>' +
              '<a class="g-btn g-btn--primary" href="/login">Go to sign in</a>' +
            '</div>' +
          '</div>';
        setNote(form, data.newsletter_pending
          ? 'Your account and newsletter both need email confirmation.'
          : 'Your account is ready once you confirm your email.');
      });
    } else if (isLogin) {
      setNote(form, 'Signing in…');
      job = apiPost('/api/auth/login/', {
        email: (form.elements.email && form.elements.email.value || '').trim(),
        password: form.elements.password && form.elements.password.value || '',
        keep: !!(form.elements.keep && form.elements.keep.checked)
      }).then(function (data) {
        markAccount(data.user && data.user.email);
        setNote(form, 'Signed in. Opening your workspace…');
        return adoptReaderLibrary().then(function (adopted) {
          if (adopted) setNote(form, 'Signed in. Your saved items came with you — opening your library…');
          window.setTimeout(function () {
            location.href = adopted ? '/workspace/kms/library' : '/workspace';
          }, 250);
        });
      });
    } else if (isReset && resetUid && resetToken) {
      setNote(form, 'Updating your password…');
      job = apiPost('/api/auth/password-reset/confirm/', {
        uid: resetUid,
        token: resetToken,
        password: form.elements.new_password && form.elements.new_password.value || ''
      }).then(function () {
        setNote(form, 'Password updated. You can sign in now.');
        history.replaceState({}, '', '/login');
        window.setTimeout(function () { location.hash = 'in'; }, 100);
      });
    } else if (isReset) {
      setNote(form, 'Sending the reset link…');
      var resetEmail = (form.elements.email && form.elements.email.value || '').trim();
      job = apiPost('/api/auth/password-reset/request/', { email: resetEmail }).then(function () {
        setNote(form, 'If that address has an account, a reset link has been sent.');
        form.reset();
      });
    } else if (commentKey) {
      // Posting requires an account and everything lands in moderation, so the
      // note has to say both: a comment that silently waits for a moderator
      // reads as a comment that was dropped.
      var field = form.querySelector('textarea');
      var body = field && field.value.trim();
      if (!body) {
        setNote(form, 'Write something first.');
        if (field) field.focus();
        setBusy(form, false);
        return;
      }
      setNote(form, 'Posting…');
      job = apiPost('/api/community/comments/' + encodeURIComponent(commentKey) + '/', {
        body: body
      }).then(function () {
        setNote(form, 'Posted. A moderator reads it before it appears.');
        form.reset();
      }).catch(function (err) {
        if (err && err.error === 'authentication_required') {
          setNote(form, 'Sign in to post. Everyone can read without an account.');
          return;
        }
        throw err;
      });
    } else {
      var input = form.querySelector('input[type="email"]');
      var email = input && input.value.trim();
      if (!email) {
        setNote(form, 'Add an email address and we will send a confirmation link.');
        if (input) input.focus();
        setBusy(form, false);
        return;
      }
      setNote(form, 'Sending confirmation email…');
      job = fetch('/api/newsletter/subscribe/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ email: email, source: 'website' })
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) throw data;
          return data;
        });
      }).then(function (data) {
        setNote(form, data.already_confirmed
          ? 'This email is already confirmed and subscribed.'
          : 'Check your inbox and click the confirmation link to finish subscribing.');
        if (!data.already_confirmed) form.reset();
      });
    }

    Promise.resolve(job).catch(function (err) {
      setNote(form, errorText(err));
    }).finally(function () {
      setBusy(form, false);
    });
  }, true);

  fetch('/api/auth/me/', {
    credentials: 'same-origin',
    headers: { 'Accept': 'application/json' }
  }).then(function (res) {
    return res.ok ? res.json() : null;
  }).then(function (data) {
    if (data && data.authenticated) {
      markAccount(data.user && data.user.email);
      // Any page load is a chance to finish a handover that failed earlier, and
      // for a reader who signed in on another tab it is the only chance.
      adoptReaderLibrary().then(function () {
        libPaint();
      }).catch(function () {});
    } else {
      readerSignedOut();
    }
    // A failed request is left alone deliberately: it cannot tell a signed-out
    // reader from a dropped connection, and discarding the cache on a flaky
    // network would be the worse of the two mistakes.
  }).catch(function () {
    /* The wording is still owed an answer. A browser that has never held a
       signed-in mirror has never had an account on it, so the guest note is
       safe to show; one that has could belong to a signed-in reader on a bad
       connection, and there the note stays blank rather than guess wrong.
       `libAuthed` is untouched either way — nothing is written to a session
       we have not confirmed. */
    var mirror = false;
    try { mirror = !!localStorage.getItem(LIB_MIRROR); } catch (err) {}
    if (mirror) return;
    libAuthKnown = true;
    libPaint();
    libMountAuthNote();
  });

  if (params.get('email_verified') === '1') {
    var ev1 = document.querySelector('[data-form-note]');
    if (ev1) ev1.textContent = 'Email confirmed. Your Gravitas+ account is verified.';
  } else if (params.get('email_verified') === '0') {
    var ev0 = document.querySelector('[data-form-note]');
    if (ev0) ev0.textContent = 'That account confirmation link is invalid or has expired.';
  } else if (params.get('confirmed') === '1') {
    var n1 = document.querySelector('[data-form-note]');
    if (n1) n1.textContent = 'Subscription confirmed. Welcome to the newsletter.';
  } else if (params.get('confirmed') === '0') {
    var n0 = document.querySelector('[data-form-note]');
    if (n0) n0.textContent = 'That confirmation link is invalid or has expired.';
  }

  /* ==========================================================================
     THE READER'S LIBRARY
     Browse first, sign up at the till.

     An online shop lets you fill a basket before it asks who you are. The
     public archive works the same way here: a visitor can keep an article,
     follow a topic and tick off the steps of a learning path with no account
     at all, and the account is what turns that pile into something that
     survives the browser, moves between devices, and shows up in the
     Knowledge workspace. Asking for an email address before the visitor has
     decided the site is worth anything is the fastest way to lose them.

     WHERE THE PILE LIVES

     Guest: one localStorage object, `gravitas.reader.v1`. It is the real
     store, not a queue of pending writes — a visitor who never signs up still
     gets a working library, on that device, for as long as they keep the
     browser. Signed in: the same shape, held by /api/reader/library/, with
     the local copy kept as a mirror so the header count and every save
     button paint from the first frame rather than after a round trip.

     The handover is one POST of the whole local pile on the first
     authenticated moment (sign-in, sign-up, or arriving already signed in).
     The endpoint merges idempotently, so it does not matter how many times
     that runs, in how many tabs, or whether the previous attempt failed
     halfway.

     WHY THIS IS INJECTED RATHER THAN WRITTEN INTO THE PAGES

     A save control belongs on every card on every index, plus the headline of
     every item page. Hand-written that is the same markup copied into a dozen
     files, each of which then has to be kept in step with the store, the
     signed-in state and the count in the header — and the public HTML is
     hand-authored, so there is no template to change once.

     So it is all injected from here, from selectors the design already uses:
     `.entry`, `.path-card` and `.game-card` are the card shapes, and `.step`
     is a learning-path step. If one of those is renamed the controls
     disappear, which is the correct failure: no button is much better than a
     button in the wrong place. When a shape is renamed, the selector list
     above `libMountCards` is the one place to change.

     WHAT IS SAVABLE

     Only the five real item families, recognised by page-slug prefix. This
     matters more than it looks: the home page uses `.entry` for cards that
     point at section indexes — Magazine, Lab, Learn — and a "save" on those
     would mean saving a list, which is not a thing a reader ever wants back.
     ========================================================================== */

  /* Two keys, and the distinction is load-bearing. LIB_KEY is the guest's
     pile: rows that exist nowhere else and have not reached an account yet.
     LIB_MIRROR is a signed-in reader's cache of what the server already
     holds, kept only so the header count and every save button paint on the
     first frame instead of a round trip later.

     Writing both to one key would make the two indistinguishable, and the
     Library screen in the workspace reads the guest key to warn a reader that
     something of theirs has not made it across — a warning that would then
     fire for every signed-in reader about items already safely stored. So
     adoption removes the guest key, and only the guest key is ever a claim
     that something is at risk. */
  var LIB_KEY = 'gravitas.reader.v1';
  var LIB_MIRROR = 'gravitas.reader.mirror.v1';
  var LIB_API = '/api/reader/library/';
  var LIB_HOME = '/workspace/kms/library';

  /* Slug prefix → what kind of thing it is. Also the whitelist: a link whose
     slug starts with none of these gets no save control. */
  var LIB_KINDS = [
    ['topic-', 'topic'],
    ['dossier-', 'dossier'],
    ['article-', 'article'],
    ['path-', 'path'],
    ['game-', 'lab'],
  ];

  var LIB_KIND_LABEL = {
    topic: 'Topic', dossier: 'Dossier', article: 'Article',
    path: 'Learning path', lab: 'Interactive', page: 'Page',
  };

  var lib = libRead();
  var libAuthed = false;
  /* Tri-state, because `libAuthed` alone cannot tell "signed out" from "we
     have not asked yet". The session answer arrives a fetch later than first
     paint, so anything that names where the pile lives — the page note, the
     drawer's footer, the sign-up note — has to say nothing until this is true.
     Claiming "kept on this device" and then correcting it to "kept in your
     Knowledge workspace" a moment later is a lie the reader watches happen. */
  var libAuthKnown = false;
  /* Set when the server refused a write we had already applied locally. The
     drawer says so rather than pretending: a library that silently stops
     saving is worse than one that admits it is offline. */
  var libOffline = false;

  function libBlank() { return { saved: {}, following: {}, paths: {} }; }

  /* The guest pile wins when both exist, which is the case immediately after
     somebody signs out and keeps browsing: those rows are the ones nobody
     else has a copy of. */
  function libRead() {
    return libReadKey(LIB_KEY) || libReadKey(LIB_MIRROR) || libBlank();
  }

  function libReadKey(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      var out = libBlank();
      var any = false;
      ['saved', 'following', 'paths'].forEach(function (bucket) {
        if (parsed[bucket] && typeof parsed[bucket] === 'object') {
          out[bucket] = parsed[bucket];
          if (Object.keys(parsed[bucket]).length) any = true;
        }
      });
      return any ? out : null;
    } catch (err) {
      // Private mode, blocked storage, or a shape from a future version.
      return null;
    }
  }

  function libWrite() {
    try {
      localStorage.setItem(libAuthed ? LIB_MIRROR : LIB_KEY, JSON.stringify(lib));
    } catch (err) {}
  }

  function libCount() {
    return Object.keys(lib.saved).length + Object.keys(lib.following).length;
  }

  /* ---- Identifying a thing ------------------------------------------------
     The page slug, which is the one identifier the static site and the
     database can both agree on. Hashes are dropped: the depth switch and the
     section anchors are ways of reading one item, not different items.

     Query strings are dropped too, with one exception that matters. A topic is
     now served two ways - the standalone topic-computable-universe.html, and
     the shell topic.html?slug=computable-universe, which is what cms-live.js
     links to once the CMS holds rows. Reading only the last path segment gives
     every CMS topic the key "topic", which matches no recognised prefix, so
     the save control silently stopped appearing on exactly the pages the CMS
     had taken over.

     So a shell resolves through its query parameter, and it resolves to the
     same key the standalone page produces. That equality is the point: a
     reader who saved a topic from the old URL and meets it again under the new
     one sees it already saved, and the account holds one row rather than two.

     The address is carried separately from the key, because the key is an
     identity and the address is the route that is known to work in this
     build. */
  var LIB_SHELLS = { topic: 'topic-' };
  var LIB_KEY_RE = /^[-a-zA-Z0-9_]{1,190}$/;

  function libIdentify(href) {
    if (!href) return null;
    var url;
    try { url = new URL(href, location.href); } catch (err) { return null; }
    if (url.origin !== location.origin) return null;

    var last = (url.pathname.replace(/\/+$/, '').split('/').pop() || '')
      .replace(/\.html$/, '');

    var prefix = LIB_SHELLS[last];
    if (prefix) {
      var param = (url.searchParams.get('slug') || '').trim();
      if (!param) return null;
      // The API slug carries no prefix of its own, but tolerate one anyway so
      // a future payload that includes it cannot end up doubling it.
      var key = param.indexOf(prefix) === 0 ? param : prefix + param;
      return LIB_KEY_RE.test(key) ? { key: key, url: url.pathname + url.search } : null;
    }

    return LIB_KEY_RE.test(last) ? { key: last, url: url.pathname } : null;
  }

  function libKind(slug) {
    for (var i = 0; i < LIB_KINDS.length; i++) {
      if (slug.indexOf(LIB_KINDS[i][0]) === 0) return LIB_KINDS[i][1];
    }
    return '';
  }

  function libText(node) {
    return node ? node.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  /* ---- Reading a card ----------------------------------------------------
     A saved row is a snapshot of the card as the reader saw it, because most
     of what is savable here is hand-authored HTML with no database row behind
     it. So the title, the summary and the small meta bag are lifted out of
     the card itself rather than fetched. */
  function libItemFromCard(card) {
    var id = libIdentify(card.getAttribute('href'));
    var kind = id && libKind(id.key);
    if (!kind) return null;

    var heading = card.querySelector('h2, h3, h4');
    var title = libText(heading);
    if (!title) return null;

    var summary = '';
    var paragraphs = card.querySelectorAll('p');
    for (var i = 0; i < paragraphs.length; i++) {
      var p = paragraphs[i];
      if (p.closest('.entry__meta') || p.classList.contains('g-eyebrow')) continue;
      summary = libText(p);
      if (summary) break;
    }

    var meta = {};
    var eyebrow = libText(card.querySelector('.entry__type, .g-eyebrow, .game-card__meta'));
    if (eyebrow) meta.eyebrow = eyebrow;
    var detail = libText(card.querySelector('.entry__meta span, .game-card__meta span'));
    if (detail && detail !== eyebrow) meta.detail = detail;

    return {
      item_key: id.key, kind: kind, title: title,
      url: id.url, summary: summary, meta: meta,
    };
  }

  /* The page you are on, read the same way. Used by the control under the
     headline on an article, topic, dossier, path or lab page. */
  function libItemFromPage() {
    // pathname + search, not pathname alone: on a shell page the subject lives
    // in the query string, and dropping it identifies the shell, not the topic.
    var id = libIdentify(location.pathname + location.search);
    var kind = id && libKind(id.key);
    if (!kind) return null;

    var heading = document.querySelector('#main h1, main h1');
    var title = libText(heading) || document.title.split('·')[0].trim();
    if (!title) return null;

    var lede = document.querySelector('#main .g-lead, #main .art__standfirst, main .g-lead');
    var description = document.querySelector('meta[name="description"]');
    var summary = libText(lede) || (description ? description.getAttribute('content') || '' : '');

    var meta = {};
    var eyebrow = libText(document.querySelector('#main .entry__type, #main .g-eyebrow'));
    if (eyebrow) meta.eyebrow = eyebrow;

    return {
      item_key: id.key, kind: kind, title: title,
      url: id.url, summary: summary.slice(0, 400), meta: meta,
    };
  }

  /* ---- Writing -----------------------------------------------------------
     Local first, always, then the server when there is an account. The local
     write is what makes the button feel like a button; the server write is
     what makes it true tomorrow. When the second one fails the first one
     stands and the drawer says the library is offline, because dropping the
     reader's save to stay consistent with a server that is not answering
     serves nobody. */
  function libToggle(item, relation) {
    var bucket = lib[relation];
    var had = !!bucket[item.item_key];
    if (had) delete bucket[item.item_key];
    else bucket[item.item_key] = Object.assign({ saved_at: new Date().toISOString() }, item);
    libWrite();
    libPaint();

    if (!libAuthed) return Promise.resolve(!had);
    var job = had
      ? libSend('DELETE', { relation: relation, item_key: item.item_key })
      : libSend('POST', libEnvelope(relation, [bucket[item.item_key]]));
    return job.then(function () { return !had; });
  }

  function libEnvelope(relation, items) {
    var body = {};
    body[relation] = items.map(function (item) {
      return {
        item_key: item.item_key, kind: item.kind, title: item.title,
        url: item.url, summary: item.summary, meta: item.meta,
      };
    });
    return body;
  }

  function libSend(method, body) {
    return csrfToken().then(function (token) {
      return fetch(LIB_API, {
        method: method,
        credentials: 'same-origin',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-CSRFToken': token,
        },
        body: JSON.stringify(body || {}),
      });
    }).then(function (res) {
      if (!res.ok) throw new Error('library_' + res.status);
      return res.json();
    }).then(function (data) {
      libOffline = false;
      libAdopt(data);
      return data;
    }).catch(function (err) {
      libOffline = true;
      libPaint();
      throw err;
    });
  }

  /* The server's answer is the truth once there is an account, so replace the
     mirror wholesale rather than merging field by field — a removal on
     another device has to be able to reach this one. */
  function libAdopt(data) {
    if (!data) return;
    var next = libBlank();
    (data.saved || []).forEach(function (item) { next.saved[item.item_key] = item; });
    (data.following || []).forEach(function (item) { next.following[item.item_key] = item; });
    (data.paths || []).forEach(function (path) {
      next.paths[path.item_key] = {
        done: path.done || [], total: path.total || 0,
        title: path.title || '', url: path.url || '',
      };
    });
    lib = next;
    libWrite();
    /* The server has the pile now, so the guest key is no longer a claim on
       anything. Dropping it is what stops the workspace warning about items
       that are already stored, and it is safe precisely because this runs only
       on a successful response. */
    try { localStorage.removeItem(LIB_KEY); } catch (err) {}
    libPaint();
  }

  /* ---- Learning-path progress -------------------------------------------
     Steps are ticked, not measured. The design's path page numbers its steps
     `01`…`08` in `.step__n`, so that number is the step id: stable across a
     reworded step, and readable in the stored JSON, which matters when the
     only way to inspect a reader's progress is a JSON column.

     `replace` goes to the server on every write. The endpoint unions by
     default so two devices cannot undo each other, but a reader unticking a
     step is an explicit correction and has to win. */
  function libPath(key) {
    if (!lib.paths[key]) lib.paths[key] = { done: [], total: 0, title: '', url: '' };
    return lib.paths[key];
  }

  function libToggleStep(key, step, total, title) {
    var path = libPath(key);
    path.total = total || path.total;
    path.title = title || path.title;
    path.url = '/' + key + '.html';
    var at = path.done.indexOf(step);
    if (at === -1) path.done.push(step);
    else path.done.splice(at, 1);
    path.done.sort();
    libWrite();
    libPaint();

    if (!libAuthed) return;
    libSend('POST', { paths: [{
      item_key: key, done: path.done, total: path.total,
      title: path.title, url: path.url, replace: true,
    }] }).catch(function () {});
  }

  function libPathPercent(key) {
    var path = lib.paths[key];
    if (!path || !path.total) return 0;
    return Math.round((path.done.length / path.total) * 100);
  }

  /* ==========================================================================
     CONTROLS
     ========================================================================== */

  var LIB_ICON_SAVE = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.75h12a1.25 1.25 0 0 1 1.25 1.25v15.25L12 15.9l-7.25 4.35V5A1.25 1.25 0 0 1 6 3.75Z"/></svg>';
  var LIB_ICON_FOLLOW = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.25"/><path d="M12 7.75v4.35l3 1.8"/></svg>';
  var LIB_ICON_CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  function libButton(className, html, label) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.innerHTML = html;
    button.setAttribute('aria-label', label);
    button.title = label;
    return button;
  }

  /* One toggle, wherever it appears. `sync` repaints it from the store rather
     than from what it did last, so a save made in the drawer, on another
     card for the same item, or on another device all reach this button. */
  function libToggleButton(item, relation, size) {
    var saved = relation === 'following' ? 'Following' : 'Saved';
    var idle = relation === 'following' ? 'Follow this topic' : 'Save for later';
    var icon = relation === 'following' ? LIB_ICON_FOLLOW : LIB_ICON_SAVE;

    var button = libButton('rl-toggle' + (size === 'card' ? ' rl-toggle--card' : ''), icon, idle);
    button.dataset.rlRelation = relation;
    button.dataset.rlKey = item.item_key;
    if (size !== 'card') button.append(document.createElement('span'));

    button.sync = function () {
      var on = !!lib[relation][item.item_key];
      button.setAttribute('aria-pressed', String(on));
      var label = on ? saved : idle;
      button.setAttribute('aria-label', label);
      button.title = label;
      var text = button.querySelector('span');
      if (text) text.textContent = label;
    };

    button.addEventListener('click', function (event) {
      // Card buttons sit inside the card's own anchor.
      event.preventDefault();
      event.stopPropagation();
      libToggle(item, relation).catch(function () {});
    });

    libButtons.push(button);
    button.sync();
    return button;
  }

  var libButtons = [];

  function libPaint() {
    for (var i = libButtons.length - 1; i >= 0; i--) {
      if (!libButtons[i].isConnected) { libButtons.splice(i, 1); continue; }
      libButtons[i].sync();
    }
    libPaintTrigger();
    libPaintDrawer();
    libPaintPathProgress();
  }

  /* ---- Cards -------------------------------------------------------------
     `.is-soon` cards describe something that does not exist yet and carry no
     href, so there is nothing to come back to and they get no control. */
  function libMountCards() {
    var cards = document.querySelectorAll('a.entry[href], a.path-card[href], a.game-card[href]');
    [].forEach.call(cards, function (card) {
      if (card.dataset.rlMounted) return;
      var item = libItemFromCard(card);
      if (!item) return;
      card.dataset.rlMounted = '1';

      var tray = document.createElement('div');
      tray.className = 'rl-card-tray';
      tray.append(libToggleButton(item, 'saved', 'card'));
      if (item.kind === 'topic') tray.append(libToggleButton(item, 'following', 'card'));
      card.append(tray);
      card.classList.add('rl-has-tray');
    });
  }

  /* A page that has not finished loading. The topic pages are live shells:
     their checked-in markup is a "Loading Topic…" heading and topic-live.js
     replaces the whole section once the API answers. Mounting against that
     would put the placeholder title into somebody's library, so the bar waits
     for the real headline — the observer below brings it back afterwards. */
  var LIB_PLACEHOLDER = /^(loading|topic not found|topic unavailable)/i;

  /* ---- The page itself ---------------------------------------------------
     Placed after the last element of the heading block rather than after the
     <h1>, so it reads as part of the page's own furniture and does not
     interrupt the headline and its standfirst. */
  function libMountPage() {
    var item = libItemFromPage();
    if (!item || LIB_PLACEHOLDER.test(item.title)) return;
    var existing = document.querySelector('.rl-page-bar');
    if (existing) return;

    var heading = document.querySelector('#main h1, main h1');
    if (!heading) return;
    var head = heading.parentElement;
    var tail = heading;
    ['.pill-row', '.art__meta', '.g-lead', '.art__standfirst'].forEach(function (selector) {
      var found = head.querySelector(':scope > ' + selector);
      if (found && (tail.compareDocumentPosition(found) & Node.DOCUMENT_POSITION_FOLLOWING)) tail = found;
    });

    var bar = document.createElement('div');
    bar.className = 'rl-page-bar';
    bar.append(libToggleButton(item, 'saved'));
    if (item.kind === 'topic') bar.append(libToggleButton(item, 'following'));

    var note = document.createElement('p');
    note.className = 'rl-page-bar__note';
    bar.append(note);
    libNotes.push(note);
    libPaintNote(note);

    tail.after(bar);
  }

  var libNotes = [];

  function libPaintNote(note) {
    if (!libAuthKnown) {
      note.textContent = '';
      return;
    }
    if (libAuthed) {
      note.textContent = 'Kept in your Knowledge workspace.';
      return;
    }
    var count = libCount();
    note.textContent = count
      ? 'Kept on this device. ' + count + ' ' + (count === 1 ? 'item' : 'items') +
        ' move to your account when you make one.'
      : 'No account needed. It moves with you if you make one later.';
  }

  /* ---- Learning-path steps ---------------------------------------------- */
  function libMountSteps() {
    // Not `id`: the per-step loop below binds its own `id` for the step, and
    // two different identities under one name in one function is how the wrong
    // one eventually gets read.
    var pathId = libIdentify(location.pathname + location.search);
    if (!pathId || libKind(pathId.key) !== 'path') return;
    var slug = pathId.key;
    var steps = document.querySelectorAll('#main .step, main .step');
    if (!steps.length) return;

    var title = libText(document.querySelector('#main h1, main h1'));
    var path = libPath(slug);
    path.total = steps.length;
    path.title = path.title || title;
    path.url = '/' + slug + '.html';
    libWrite();

    [].forEach.call(steps, function (step, index) {
      if (step.dataset.rlMounted) return;
      step.dataset.rlMounted = '1';
      /* Bracketed deliberately: "a" + b || c parses as ("a" + b) || c, which
         is always truthy, so an unbracketed fallback here is dead code and a
         step with no printed number would take the id "step-" — shared with
         every other such step on the page, ticking them all at once. */
      var numbered = libText(step.querySelector('.step__n')).replace(/[^0-9a-z]/gi, '');
      var id = 'step-' + (numbered || (index + 1));

      var button = libButton('rl-step', '', 'Mark this step done');
      button.append(document.createElement('i'));
      button.append(document.createElement('span'));
      button.sync = function () {
        var done = lib.paths[slug] && lib.paths[slug].done.indexOf(id) !== -1;
        button.setAttribute('aria-pressed', String(!!done));
        button.querySelector('span').textContent = done ? 'Done' : 'Mark done';
        var label = done ? 'Step done. Undo' : 'Mark this step done';
        button.setAttribute('aria-label', label);
        button.title = label;
      };
      button.addEventListener('click', function () {
        libToggleStep(slug, id, steps.length, title);
      });
      libButtons.push(button);
      button.sync();

      var holder = step.querySelector('.step__links') || step.lastElementChild || step;
      holder.append(button);
    });

    /* Appended once. A detached node means the page was redrawn underneath
       us, so the record is dropped and a fresh paragraph takes its place;
       without this check every re-mount would append another one, and since
       appending is itself a mutation the observer would wake to do it again. */
    if (libPathSummary && !libPathSummary.node.isConnected) libPathSummary = null;
    if (!libPathSummary) {
      var summary = document.createElement('p');
      summary.className = 'rl-path-summary';
      steps[steps.length - 1].after(summary);
      libPathSummary = { node: summary, key: slug, total: steps.length };
    }
  }

  var libPathSummary = null;

  /* Learn's path cards ship a hardcoded percentage from the prototype — 42%
     on a path nobody has opened. Once real progress exists it is the only
     honest number to draw there, and a reader with none should be told
     "Not started" rather than a figure they did not earn. */
  function libPaintPathProgress() {
    [].forEach.call(document.querySelectorAll('a.path-card[href]'), function (card) {
      var id = libIdentify(card.getAttribute('href'));
      if (!id || libKind(id.key) !== 'path') return;
      var percent = libPathPercent(id.key);
      var fill = card.querySelector('.progress > i');
      if (fill) fill.style.width = percent + '%';
      var caption = card.querySelector('.progress ~ p');
      if (caption) {
        caption.textContent = percent === 0 ? 'Not started'
          : percent === 100 ? 'Finished' : 'In progress: ' + percent + '%';
      }
    });

    if (libPathSummary) {
      var path = lib.paths[libPathSummary.key];
      var done = path ? path.done.length : 0;
      libPathSummary.node.textContent = done
        ? done + ' of ' + libPathSummary.total + ' steps done · ' +
          libPathPercent(libPathSummary.key) + '%' +
          (libAuthed ? '' : ' · kept on this device until you have an account')
        : 'Tick a step as you finish it. No account needed — progress follows you to one.';
    }

    /* Pruned the same way the buttons are. A live re-render detaches the old
       bar, and without this the list grows by one note per redraw, each one
       repainted for ever into a node nobody can see. */
    for (var n = libNotes.length - 1; n >= 0; n--) {
      if (!libNotes[n].isConnected) libNotes.splice(n, 1);
      else libPaintNote(libNotes[n]);
    }
  }

  /* ==========================================================================
     THE DRAWER
     The basket, and the only screen a guest has. It exists on every public
     page because the decision to sign up is made from it: the reader has to
     be able to see the pile they are about to lose.
     ========================================================================== */

  var libTrigger = null;
  var libDrawer = null;
  var libLastFocus = null;

  function libMountTrigger() {
    var actions = document.querySelector('.gh-actions');
    if (!actions || libTrigger) return;

    libTrigger = libButton('rl-trigger', LIB_ICON_SAVE, 'Saved items');
    libTrigger.append(document.createElement('b'));
    libTrigger.addEventListener('click', libOpen);

    var toggle = actions.querySelector('.theme-toggle');
    if (toggle) actions.insertBefore(libTrigger, toggle);
    else actions.append(libTrigger);
    libPaintTrigger();
  }

  function libPaintTrigger() {
    if (!libTrigger) return;
    var count = libCount();
    var badge = libTrigger.querySelector('b');
    badge.textContent = count > 99 ? '99+' : String(count);
    libTrigger.dataset.rlEmpty = count ? 'false' : 'true';
    var label = count
      ? 'Saved items (' + count + ')'
      : 'Saved items — nothing kept yet';
    libTrigger.setAttribute('aria-label', label);
    libTrigger.title = label;
  }

  function libOpen() {
    if (libDrawer) return;
    libLastFocus = document.activeElement;

    libDrawer = document.createElement('div');
    libDrawer.className = 'rl-drawer';
    libDrawer.innerHTML =
      '<div class="rl-drawer__veil" data-rl-close></div>' +
      '<aside class="rl-drawer__panel" role="dialog" aria-modal="true" aria-label="Saved items">' +
        '<header class="rl-drawer__head">' +
          '<h2>Saved</h2>' +
          '<button class="rl-drawer__close" type="button" data-rl-close aria-label="Close">' + LIB_ICON_CLOSE + '</button>' +
        '</header>' +
        '<div class="rl-drawer__body"></div>' +
        '<footer class="rl-drawer__foot"></footer>' +
      '</aside>';
    document.body.append(libDrawer);
    document.documentElement.classList.add('rl-locked');

    libDrawer.addEventListener('click', function (event) {
      if (event.target.closest('[data-rl-close]')) libClose();
    });
    document.addEventListener('keydown', libEscape);
    libPaintDrawer();
    libDrawer.querySelector('.rl-drawer__close').focus();

    // Signed in, the server is the truth and another device may have changed
    // it. Refresh in the background; the mirror is already on screen.
    if (libAuthed) libLoad();
  }

  function libEscape(event) {
    if (event.key === 'Escape') libClose();
  }

  function libClose() {
    if (!libDrawer) return;
    document.removeEventListener('keydown', libEscape);
    libDrawer.remove();
    libDrawer = null;
    document.documentElement.classList.remove('rl-locked');
    if (libLastFocus && libLastFocus.isConnected) libLastFocus.focus();
  }

  function libGroup(title, hint) {
    var section = document.createElement('section');
    section.className = 'rl-group';
    var heading = document.createElement('h3');
    heading.textContent = title;
    section.append(heading);
    if (hint) {
      var note = document.createElement('p');
      note.className = 'rl-group__hint';
      note.textContent = hint;
      section.append(note);
    }
    return section;
  }

  function libRow(item, relation) {
    var row = document.createElement('div');
    row.className = 'rl-row';

    var link = document.createElement('a');
    link.className = 'rl-row__link';
    link.href = item.url || '/' + item.item_key + '.html';
    link.append(Object.assign(document.createElement('strong'), { textContent: item.title }));
    var kindLabel = LIB_KIND_LABEL[item.kind] || item.kind;
    var line = [kindLabel, item.meta && item.meta.detail].filter(Boolean).join(' · ');
    link.append(Object.assign(document.createElement('small'), { textContent: line }));
    row.append(link);

    var drop = libButton('rl-row__drop', LIB_ICON_CLOSE,
      relation === 'following' ? 'Stop following' : 'Remove from saved');
    drop.addEventListener('click', function () {
      libToggle(item, relation).catch(function () {});
    });
    row.append(drop);
    return row;
  }

  function libPathRow(key, path) {
    var row = document.createElement('div');
    row.className = 'rl-row';

    var link = document.createElement('a');
    link.className = 'rl-row__link';
    link.href = path.url || '/' + key + '.html';
    link.append(Object.assign(document.createElement('strong'),
      { textContent: path.title || key }));
    link.append(Object.assign(document.createElement('small'),
      { textContent: path.done.length + ' of ' + (path.total || '?') + ' steps · ' + libPathPercent(key) + '%' }));

    var meter = document.createElement('div');
    meter.className = 'rl-meter';
    var fill = document.createElement('i');
    fill.style.width = Math.max(2, libPathPercent(key)) + '%';
    meter.append(fill);
    link.append(meter);
    row.append(link);
    return row;
  }

  function libPaintDrawer() {
    if (!libDrawer) return;
    var body = libDrawer.querySelector('.rl-drawer__body');
    var foot = libDrawer.querySelector('.rl-drawer__foot');
    body.innerHTML = '';
    foot.innerHTML = '';

    var saved = Object.keys(lib.saved).map(function (key) { return lib.saved[key]; });
    var following = Object.keys(lib.following).map(function (key) { return lib.following[key]; });
    var paths = Object.keys(lib.paths).filter(function (key) {
      return lib.paths[key].done.length;
    });

    if (libOffline) {
      var warning = document.createElement('p');
      warning.className = 'rl-alert';
      warning.textContent = 'Your last change is kept on this device — the server did not answer. ' +
        'It will be sent again next time you open a page.';
      body.append(warning);
    }

    if (!saved.length && !following.length && !paths.length) {
      var blank = document.createElement('div');
      blank.className = 'rl-blank';
      blank.innerHTML =
        '<p><b>Nothing kept yet.</b></p>' +
        '<p>Use the bookmark on any topic, dossier, essay, path or interactive and it lands here. ' +
        'No account needed to start — one only matters when you want the pile on another device.</p>';
      body.append(blank);
      return;
    }

    if (saved.length) {
      var savedGroup = libGroup('Saved · ' + saved.length);
      saved.sort(libNewestFirst).forEach(function (item) {
        savedGroup.append(libRow(item, 'saved'));
      });
      body.append(savedGroup);
    }

    if (following.length) {
      var followGroup = libGroup('Following · ' + following.length,
        'Topics you want more of. Once you have an account these decide what the newsletter sends you.');
      following.sort(libNewestFirst).forEach(function (item) {
        followGroup.append(libRow(item, 'following'));
      });
      body.append(followGroup);
    }

    if (paths.length) {
      var pathGroup = libGroup('Paths in progress · ' + paths.length);
      paths.forEach(function (key) { pathGroup.append(libPathRow(key, lib.paths[key])); });
      body.append(pathGroup);
    }

    if (!libAuthKnown) return;

    if (libAuthed) {
      var open = document.createElement('a');
      open.className = 'g-btn g-btn--primary g-btn--sm rl-cta';
      open.href = LIB_HOME;
      open.textContent = 'Open in your workspace';
      foot.append(open);
      var kept = document.createElement('p');
      kept.className = 'rl-foot__note';
      kept.textContent = 'Saved to your account. It follows you to any device you sign in on.';
      foot.append(kept);
      return;
    }

    var join = document.createElement('a');
    join.className = 'g-btn g-btn--primary g-btn--sm rl-cta';
    join.href = '/signup';
    join.textContent = 'Create a free account to keep these';
    foot.append(join);

    var signIn = document.createElement('p');
    signIn.className = 'rl-foot__note';
    signIn.innerHTML = 'Everything above is stored in this browser only — clearing site data loses it. ' +
      'Making an account moves the lot across as it is. ' +
      '<a href="/login">Already have one?</a>';
    foot.append(signIn);
  }

  function libNewestFirst(a, b) {
    return String(b.saved_at || '').localeCompare(String(a.saved_at || ''));
  }

  /* ==========================================================================
     THE HANDOVER
     Called from the sign-up and sign-in handlers above, and again on any page
     load that finds an existing session. Resolves to true when there was a
     guest pile to move, which is what decides whether a fresh account opens
     on its library or on the workspace it would normally land in.
     ========================================================================== */
  function adoptReaderLibrary() {
    libAuthed = true;
    libAuthKnown = true;
    var saved = Object.keys(lib.saved).map(function (key) { return lib.saved[key]; });
    var following = Object.keys(lib.following).map(function (key) { return lib.following[key]; });
    var paths = Object.keys(lib.paths).filter(function (key) { return lib.paths[key].done.length; });

    if (!saved.length && !following.length && !paths.length) {
      return libLoad().then(function () { return false; });
    }

    var body = Object.assign(
      libEnvelope('saved', saved),
      libEnvelope('following', following),
    );
    body.paths = paths.map(function (key) {
      var path = lib.paths[key];
      return {
        item_key: key, done: path.done, total: path.total,
        title: path.title, url: path.url,
      };
    });

    return libSend('POST', body).then(function () { return true; })
      .catch(function () {
        // The pile stays local and the next page load tries again. Nothing is
        // lost, and the reader is not told about a failure they cannot act on
        // in the middle of signing in.
        return false;
      });
  }

  /* Signing out has to empty the drawer.

     The mirror is a signed-in reader's cache, so on a shared machine it would
     otherwise keep showing the previous account's saved titles to whoever
     browses next — and their first save would fold those titles into a fresh
     guest pile, which the next sign-in would hand to the wrong account. So an
     authenticated-as-nobody answer drops the mirror and falls back to whatever
     guest pile this browser has of its own. */
  function readerSignedOut() {
    setJoinVisibility(true);
    libAuthed = false;
    libAuthKnown = true;
    var mirror = false;
    try { mirror = !!localStorage.getItem(LIB_MIRROR); } catch (err) {}
    if (mirror) {
      try { localStorage.removeItem(LIB_MIRROR); } catch (err) {}
      lib = libRead();
    }
    // Always repaint: even with no mirror to drop, this is the moment the
    // guest wording is allowed on screen for the first time.
    libPaint();
    libMountAuthNote();
  }

  function libLoad() {
    return fetch(LIB_API, {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' },
    }).then(function (res) {
      if (!res.ok) throw new Error('library_' + res.status);
      return res.json();
    }).then(function (data) {
      libOffline = false;
      libAdopt(data);
    }).catch(function () {
      libOffline = true;
      libPaint();
    });
  }

  /* The account page, arrived at from the drawer's call to action. A reader
     who came here to keep six things should be told that those six things are
     what they are about to keep — the sidebar sells a research workspace,
     which is the right pitch for everyone except the person already holding a
     basket. Only the note is rewritten, never the form or the copy around it,
     and only while there is something in the basket to name. */
  function libMountAuthNote() {
    var note = document.querySelector('.auth__note[data-form-note]');
    if (!note || !libAuthKnown || libAuthed) return;
    var count = libCount();
    var paths = Object.keys(lib.paths).filter(function (key) { return lib.paths[key].done.length; }).length;
    if (!count && !paths) return;

    var parts = [];
    if (count) parts.push(count + ' saved ' + (count === 1 ? 'item' : 'items'));
    if (paths) parts.push(paths + ' learning ' + (paths === 1 ? 'path' : 'paths'));
    note.textContent = parts.join(' and ') +
      ' kept in this browser will move into your account the moment it exists.';
  }

  function libMount() {
    libMountTrigger();
    libMountCards();
    libMountPage();
    libMountSteps();
    libMountAuthNote();
    libPaint();
  }

  libMount();

  /* Half this site draws itself after the first paint, so mounting once is
     not enough. cms-live.js swaps the card lists on the index pages, and
     topic-live.js replaces the entire topic page — heading, tags and all —
     with what the API returned, which takes the save bar with it. Nothing is
     wrong with that; it just means the controls have to be re-mounted rather
     than mounted, and every mount function below is written to be idempotent
     so re-running them costs a few selector lookups and changes nothing when
     there is nothing to do. */
  if (window.MutationObserver) {
    /* Guarded and deferred on purpose. Mounting a control is itself a DOM
       change, so an observer that reacted to its own work would never
       settle; the flag collapses a burst into one pass, and because every
       mount here is idempotent the pass after that one finds nothing to do
       and the cascade stops. The drawer is deliberately not repainted from
       here — that would put an unbounded loop back. */
    var libScanning = false;
    var libWatcher = new MutationObserver(function () {
      if (libScanning) return;
      libScanning = true;
      requestAnimationFrame(function () {
        libScanning = false;
        libMountCards();
        libMountPage();
        libMountSteps();
      });
    });
    libWatcher.observe(document.body, { childList: true, subtree: true });
  }

})();
