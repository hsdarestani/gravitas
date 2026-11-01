/* =========================================================================
   TOPIC 01 · CAN YOU TRUST AN ANSWER THAT LOOKS RIGHT?
   Two small jobs: the exercise in layer 05, and the published comments in
   layer 07.

   The exercise. Five answers about a made-up dataset, each one formatted
   exactly like the others, and for each the reader decides: accept it, or
   check it against the table. Two are right. Three are wrong in the three
   ways the essay names: a comparison misread, a unit dropped, a source that
   exists nowhere. Checking costs nothing here, which is the one way the
   exercise is kinder than a lab, so the score counts the checks as well as
   the misses: checking everything is not the lesson either. The assistant is
   deliberately unnamed. Pulsar answers from the files it was given and says
   when it cannot, so putting a fabricated citation in its mouth would be a
   lie about the product to make a point about the problem.

   The comments. A Topic used to ship with sample comments written into the
   HTML, under invented names, which is a false report of a discussion that
   never happened. This page shows only what the comments route returns for
   its key, published and moderated, and says plainly when that is nothing.
   ========================================================================= */
(function () {
  'use strict';

  /* ---- Exercise --------------------------------------------------------- */
  var box = document.getElementById('ta-test');
  if (box) {
    var rows = box.querySelectorAll('.ta-data tbody tr');
    var answers = [].slice.call(box.querySelectorAll('.ta-answer'));
    var resultEl = box.querySelector('.ta-result');
    var tally = {
      missed: box.querySelector('[data-tally="missed"]'),
      checked: box.querySelector('[data-tally="checked"]'),
      left: box.querySelector('[data-tally="left"]')
    };

    function light(id) {
      [].forEach.call(rows, function (r) { r.classList.toggle('is-lit', !!id && r.getAttribute('data-row') === id); });
    }

    function score() {
      var missed = 0, checked = 0, checkedRight = 0, left = 0;
      answers.forEach(function (a) {
        var s = a.getAttribute('data-state'), ok = a.getAttribute('data-ok') === 'true';
        if (!s) left++;
        else if (s === 'check') { checked++; if (ok) checkedRight++; }
        else if (!ok) missed++;
      });
      tally.missed.textContent = missed;
      tally.checked.textContent = checked;
      tally.left.textContent = left;
      if (left) { resultEl.textContent = ''; return; }
      // Every answer decided: reveal the ones that were accepted unseen, so a
      // reader who trusted a wrong one finds out which, not just how many.
      answers.forEach(function (a) { a.querySelector('.ta-answer__v').hidden = false; });
      if (missed) {
        resultEl.textContent = missed + (missed === 1 ? ' wrong answer' : ' wrong answers') +
          ' went into your report looking exactly like the right ones. Look again at what they have in common.';
      } else if (checkedRight === 2) {
        resultEl.textContent = 'Nothing got past you, and you checked everything, including the two answers that only read a value off the table. That is the afternoon Hulse was trying to win back.';
      } else {
        resultEl.textContent = 'Nothing wrong got past you, and you skipped a check that did not matter. That is the skill: check what compares, carries a unit, or points outside your files.';
      }
    }

    answers.forEach(function (a) {
      a.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-act]');
        if (!b) return;
        var act = b.getAttribute('data-act');
        a.setAttribute('data-state', act);
        [].forEach.call(a.querySelectorAll('button[data-act]'), function (x) {
          x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
        });
        var v = a.querySelector('.ta-answer__v');
        v.hidden = act !== 'check';
        light(act === 'check' ? a.getAttribute('data-row') : null);
        score();
      });
    });

    var reset = box.querySelector('[data-reset]');
    if (reset) reset.addEventListener('click', function () {
      answers.forEach(function (a) {
        a.removeAttribute('data-state');
        a.querySelector('.ta-answer__v').hidden = true;
        [].forEach.call(a.querySelectorAll('button[data-act]'), function (x) { x.setAttribute('aria-pressed', 'false'); });
      });
      light(null);
      score();
    });
    score();
  }

  /* ---- Published comments ----------------------------------------------- */
  var list = document.querySelector('[data-comments-for]');
  if (list && window.fetch) {
    var key = list.getAttribute('data-comments-for');
    var empty = document.querySelector('[data-comments-empty]');
    fetch('/api/community/comments/' + encodeURIComponent(key) + '/', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('comments'); return r.json(); })
      .then(function (data) {
        var items = (data && data.comments) || [];
        if (!items.length) { if (empty) empty.textContent = 'No published replies yet. The first one sets the tone.'; return; }
        if (empty) empty.remove();
        items.forEach(function (c) {
          var name = (typeof c.author === 'string' && c.author) || 'Member';
          var row = document.createElement('div');
          row.className = 'comment';
          var av = document.createElement('span');
          av.className = 'avatar';
          av.textContent = name.split(/\s+/).map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase();
          var body = document.createElement('div');
          var who = document.createElement('p');
          who.className = 'comment__who';
          who.textContent = name;
          var text = document.createElement('p');
          text.textContent = c.body || '';
          body.appendChild(who); body.appendChild(text);
          row.appendChild(av); row.appendChild(body);
          list.appendChild(row);
        });
      })
      .catch(function () {
        // A failed read is not an empty discussion, so it does not say so.
        if (empty) empty.textContent = 'Replies could not be loaded just now. They are still there; try again later.';
      });
  }
})();
