// The home page's two chapters that are still being built: Lab (02) and
// Learn (03). Both have been shown as under construction since 2026-11-17, at
// the owner's request, while lab.html and learn.html keep their own heroes.
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

// Learn (03): "tell me when it opens", with a say in how keen.
//
// Three chips pick a level (1 Curious, 2 Keen, 3 Count me in; Keen is
// preselected so the form never posts without one), and the email goes with
// it to /api/learn/interest/. The server holds the address unconfirmed and
// mails a link; until that link is followed nobody writes to it, which is why
// the success line asks the visitor to check their inbox rather than saying
// they are on the list. The link comes back here with ?interest=1 or
// ?interest=0, and the note says which.
//
// The POST needs Django's CSRF cookie, fetched first from /api/auth/csrf/, the
// same way production-bridge-core.js does for sign-in.
(function () {
  var form = document.querySelector('[data-course-interest]');
  if (!form) return;
  var note = form.querySelector('[data-wish-note]');
  var input = form.querySelector('input[type="email"]');
  var submit = form.querySelector('button[type="submit"]');
  var chips = Array.prototype.slice.call(form.querySelectorAll('[data-level]'));
  var resting = note.textContent;

  function level() {
    var on = chips.filter(function (c) { return c.getAttribute('aria-pressed') === 'true'; })[0];
    return on ? Number(on.getAttribute('data-level')) : 2;
  }
  function say(text, bad) {
    note.textContent = text;
    note.classList.toggle('is-bad', !!bad);
  }
  function cookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|;\s*)' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }

  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      chips.forEach(function (c) { c.setAttribute('aria-pressed', c === chip ? 'true' : 'false'); });
    });
  });

  var params = new URLSearchParams(location.search);
  if (params.get('interest') === '1') say('Confirmed. Your spot is saved, and we\u2019ll write once it opens.');
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
    say('Saving your spot\u2026');
    fetch('/api/auth/csrf/', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function () {
        return fetch('/api/learn/interest/', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json',
                     'X-CSRFToken': cookie('csrftoken') || cookie('gravitas_staging_csrftoken') },
          body: JSON.stringify({ course: form.getAttribute('data-course'), level: level(), email: email })
        });
      })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          if (!r.ok || !data.ok) throw data;
          return data;
        });
      })
      .then(function (data) {
        if (data.already_confirmed) say('You\u2019re already on the list. We\u2019ve noted how keen you are.');
        else say('Almost there: check your inbox and confirm, and your spot is saved.');
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
