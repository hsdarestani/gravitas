// The home page's two chapters that are still being built: Lab (02) and
// Learn (03). Both have been shown as under construction since 2026-11-17, at
// the owner's request, while /lab and /learn keep their own heroes.
//
// The workspace window that used to open this file (chapter 04, a tablist
// over four illustrated spaces) left with the chapter the same day: the
// workspace is off the public site and opens only by its address. It is in
// git history at 4576ac56 if the chapter returns.

// Lab (02). The card shows one Lab by title and nothing else, and that title
// comes from the registry and nowhere else: which experiments exist is not
// this page's to decide, and a hard-coded name would outlive the Lab it named.
// The first Lab the registry marks ready wins. Nothing published, a failed
// request or a missing route leaves the placeholder title in the markup,
// which is written to stand on its own.
(function () {
  var title = document.querySelector('[data-lab-title]');
  if (!title || !window.fetch) return;
  fetch('/api/labs/', { credentials: 'same-origin', cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('registry'); return r.json(); })
    .then(function (data) {
      var lab = (Array.isArray(data && data.labs) ? data.labs : []).filter(function (l) { return l && l.ready && l.title; })[0];
      if (lab) title.textContent = String(lab.title);
    })
    .catch(function () {});
})();

// Learn (03): "tell me when it opens".
//
// Only the email is asked. Until 2026-11-18 four chips also asked how keen the
// visitor was; the owner took them off, so no level is sent and the server
// stores its default. The email goes to /api/learn/interest/, which keeps the
// address. Since 2026-11-26 nothing is mailed back (owner's decision), so the
// success line simply thanks the visitor. Confirmation links sent before then
// still come back here with ?interest=1 or ?interest=0, and the note says which.
//
// The POST needs Django's CSRF cookie, fetched first from /api/auth/csrf/, the
// same way production-bridge-core.js does for sign-in.
(function () {
  var form = document.querySelector('[data-course-interest]');
  if (!form) return;
  var note = form.querySelector('[data-wish-note]');
  var input = form.querySelector('input[type="email"]');
  var submit = form.querySelector('button[type="submit"]');
  var resting = note.textContent;

  function say(text, bad) {
    note.textContent = text;
    note.classList.toggle('is-bad', !!bad);
  }
  // Split rather than a RegExp built from a string: an earlier version wrote
  // '\s' inside the string, which JavaScript reads as a plain 's', so any
  // cookie after the first was never found and the POST lost its CSRF token.
  function cookie(name) {
    var parts = document.cookie ? document.cookie.split(';') : [];
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].trim();
      if (kv.indexOf(name + '=') === 0) return decodeURIComponent(kv.slice(name.length + 1));
    }
    return '';
  }

  var params = new URLSearchParams(location.search);
  if (params.get('interest') === '1') say('Confirmed. We\u2019ll write once it opens.');
  else if (params.get('interest') === '0') say('That link has expired. Leave your email again and we\u2019ll send a fresh one.', true);
  if (params.has('interest') && history.replaceState) history.replaceState({}, '', location.pathname + '#learn');

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = input.value.trim();
    if (!email || !input.checkValidity()) {
      input.setAttribute('aria-invalid', 'true');
      say('That email doesn\u2019t look quite right.', true);
      input.focus();
      return;
    }
    input.removeAttribute('aria-invalid');
    submit.disabled = true;
    say('Sending\u2026');
    fetch('/api/auth/csrf/', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function () {
        return fetch('/api/learn/interest/', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json',
                     'X-CSRFToken': cookie('csrftoken') || cookie('gravitas_staging_csrftoken') },
          body: JSON.stringify({ course: form.getAttribute('data-course'), email: email })
        });
      })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          if (!r.ok || !data.ok) throw data;
          return data;
        });
      })
      .then(function (data) {
        if (data.already_confirmed) say('You\u2019re already on the list. We\u2019ll write once it opens.');
        else say('Got it, thanks. We’ll let you know when it opens.');
        input.value = '';
      })
      .catch(function (err) {
        var code = err && err.error;
        if (code === 'invalid_email') say('That email doesn\u2019t look quite right.', true);
        else say('We couldn\u2019t save that just now. Please try again in a moment.', true);
      })
      .then(function () {
        submit.disabled = false;
        if (!note.classList.contains('is-bad') && !note.textContent) say(resting);
      });
  });
})();
