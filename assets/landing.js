// The workspace window on the home page (chapter 04).
//
// It was a still picture: a frame, aria-hidden, that showed one page and
// nothing else. A visitor's first instinct with anything that looks like a
// window is to click it, and a picture that ignores the click reads as a
// broken app rather than as an illustration. So the rail is a real tablist
// and the four spaces are real panels, which is also the honest way to say
// "there are four places in here" without a paragraph explaining it.
//
// It is deliberately not a demo of the workspace. Nothing here fetches,
// stores or pretends to save; switching a panel is the whole of it, and the
// content of every panel is the public Topic's own material. All four panels
// sit in one grid cell, so the window keeps the height of its tallest view
// and does not jump as the visitor clicks through it. Without this script
// the markup already shows Research, so nothing breaks; it just stays put.
(function () {
  var frame = document.querySelector('.lp-ws__frame');
  if (!frame) return;
  var tabs = Array.prototype.slice.call(frame.querySelectorAll('[role="tab"]'));
  var title = frame.querySelector('[data-ws-title]');

  function show(key, focus) {
    tabs.forEach(function (t) {
      var on = t.getAttribute('data-ws') === key;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      var panel = document.getElementById(t.getAttribute('aria-controls'));
      if (panel) panel.classList.toggle('is-on', on);
      if (on) {
        if (title) title.textContent = t.textContent.trim();
        if (focus) t.focus();
      }
    });
  }

  frame.addEventListener('click', function (e) {
    var t = e.target.closest('[data-ws], [data-ws-go]');
    if (!t || !frame.contains(t)) return;
    var go = t.getAttribute('data-ws-go');
    // A jump from inside a panel moves focus to the tab it lands on, so a
    // keyboard user is not left on a button that has just been hidden.
    show(go || t.getAttribute('data-ws'), !!go);
  });

  // Roving tabindex, as a vertical tablist expects: one stop for the whole
  // rail, arrows to move along it. Left and right work too, because on a
  // phone the rail lies across the top of the window.
  frame.querySelector('[role="tablist"]').addEventListener('keydown', function (e) {
    var i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    var n = tabs.length, next = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (i + 1) % n;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (i - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next === null) return;
    e.preventDefault();
    show(tabs[next].getAttribute('data-ws'), true);
  });
})();

// The Lab chapter (02). The cards come from the registry and nowhere else:
// the Lab is a space for every Topic, its experiences are not ours to name on
// this page, and a hard-coded card would outlive the Lab it described. Only
// Labs the registry marks ready are drawn, as on lab.html. Nothing published,
// a failed request or a missing route leaves the list hidden and says nothing,
// because the chapter's copy, steps and button already stand on their own.
// Thumbnails follow the Lab page's naming, <slug>-preview.webp and
// <slug>-preview-light.webp; one that fails to load removes its frame.
(function () {
  var list = document.querySelector('[data-lab-list]');
  if (!list || !window.fetch) return;
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }
  function thumb(slug, suffix, cls) {
    var img = el('img', cls);
    img.src = 'assets/thumbnails/' + encodeURIComponent(slug) + '-preview' + suffix + '.webp';
    img.alt = ''; img.width = 1280; img.height = 720; img.loading = 'lazy'; img.decoding = 'async';
    return img;
  }
  fetch('/api/labs/', { credentials: 'same-origin', cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('registry'); return r.json(); })
    .then(function (data) {
      var labs = (Array.isArray(data && data.labs) ? data.labs : []).filter(function (l) { return l && l.ready && l.slug; });
      if (!labs.length) return;
      labs.forEach(function (lab) {
        var card = el('a', 'g-card g-card--interactive lp-lab');
        card.href = 'lab.html?lab=' + encodeURIComponent(lab.slug);
        var media = el('span', 'lp-lab__media');
        var dark = thumb(lab.slug, '', 'lp-lab__img--dark');
        var light = thumb(lab.slug, '-light', 'lp-lab__img--light');
        dark.onerror = function () { media.remove(); card.style.gridTemplateColumns = '1fr'; };
        light.onerror = function () { light.remove(); };
        media.append(dark, light);
        var body = el('span', 'lp-lab__body');
        body.append(el('span', 'lp-lab__k', 'Interactive model' + (lab.duration_text ? ' \u00b7 ' + lab.duration_text : '')));
        body.append(el('h3', '', lab.title || 'Lab'));
        if (lab.summary) body.append(el('p', '', lab.summary));
        body.append(el('span', 'lp-lab__go', 'Preview the Lab \u2192'));
        card.append(media, body);
        list.append(card);
      });
      list.hidden = false;
    })
    .catch(function () {});
})();
