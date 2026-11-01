// The workspace window on the home page (chapter 03).
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
