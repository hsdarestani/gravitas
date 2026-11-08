/* Topic rail — the "Start here" reel under the landing hero -----------------
 *
 * The earlier version of this file did two things on top of the scroller: it
 * took the mouse wheel while the pointer was over the rail, and it paged the
 * rail on a timer while nobody was pointing at it. Both were reasons the
 * section was removed on 2026-11-02, and neither came back with it on
 * 2026-11-06. A vertical wheel always scrolls the page; nothing moves unless
 * the reader moves it.
 *
 * What is left is small:
 *
 * 1. The named steps, the arrow buttons and the Left/Right keys (with focus
 *    on the rail) move the rail one panel. A swipe or a sideways trackpad
 *    gesture moves it natively, without this file.
 * 2. The bar (steps, count, arrows, progress line) and the .is-current panel
 *    are redrawn from the rail's own scrollLeft, never from what we last
 *    asked for, so a swipe that bypassed this code still agrees with the bar.
 * 3. Two fixes from the previous build stay, because the bugs they fixed are
 *    still real: scroll to the snap point itself (start less scroll-padding,
 *    clamped), and switch snapping off for the length of a programmatic
 *    scroll so Firefox cannot re-aim it mid-flight.
 */
(function () {
  'use strict';

  var root = document.querySelector('[data-rail]');
  if (!root) return;
  var rail = root.querySelector('.trail__rail');
  if (!rail) return;

  var panels = Array.prototype.slice.call(rail.querySelectorAll('.trail__panel'));
  var steps = Array.prototype.slice.call(root.querySelectorAll('.trail__step'));
  var prev = root.querySelector('[data-rail-prev]');
  var next = root.querySelector('[data-rail-next]');
  var count = root.querySelector('[data-rail-count]');
  if (panels.length < 2) return;

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var index = -1;
  var heading = -1;   /* the panel a programmatic scroll is bound for */
  var settle = 0;
  var queued = false;

  function pad2(n) { return String(n).padStart(2, '0'); }
  function maxScroll() { return Math.max(0, rail.scrollWidth - rail.clientWidth); }

  function snapLeft(panel) {
    var pad = parseFloat(getComputedStyle(rail).scrollPaddingLeft) || 0;
    var x = panel.getBoundingClientRect().left - rail.getBoundingClientRect().left
      - rail.clientLeft + rail.scrollLeft - pad;
    return Math.round(Math.min(maxScroll(), Math.max(0, x)));
  }

  /* The panel whose snap point the rail is nearest. At the end of the track
     the last panel cannot reach the left edge, so the end is the answer. */
  function nearest(x) {
    if (x >= maxScroll() - 1) return panels.length - 1;
    var best = 0, bestD = Infinity;
    for (var i = 0; i < panels.length; i++) {
      var d = Math.abs(snapLeft(panels[i]) - x);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function setIndex(i) {
    if (i === index) return;
    index = i;
    if (count) count.textContent = pad2(i + 1) + ' / ' + pad2(panels.length);
    steps.forEach(function (s, k) { s.setAttribute('aria-current', k === i ? 'true' : 'false'); });
    panels.forEach(function (p, k) { p.classList.toggle('is-current', k === i); });
    if (prev) prev.disabled = i === 0;
    if (next) next.disabled = i === panels.length - 1;
    var cur = steps[i];
    if (cur && cur.parentNode.scrollWidth > cur.parentNode.clientWidth) {
      cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  function update() {
    var max = maxScroll();
    root.style.setProperty('--rail-p', max ? (rail.scrollLeft / max).toFixed(4) : '1');
    setIndex(heading >= 0 ? heading : nearest(rail.scrollLeft));
  }

  function landed() {
    window.clearTimeout(settle);
    settle = 0;
    heading = -1;
    rail.classList.remove('is-paging');
    update();
  }

  function goTo(i) {
    i = Math.max(0, Math.min(panels.length - 1, i));
    heading = i;
    rail.classList.add('is-paging');
    rail.scrollTo({ left: snapLeft(panels[i]), behavior: reduce.matches ? 'auto' : 'smooth' });
    setIndex(i);
    /* scrollend never fires when the rail was already there, or where it is
       not supported; this is the backstop. */
    window.clearTimeout(settle);
    settle = window.setTimeout(landed, 900);
  }

  function step(d) { goTo((heading >= 0 ? heading : index) + d); }

  rail.addEventListener('scroll', function () {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(function () { queued = false; update(); });
  }, { passive: true });
  rail.addEventListener('scrollend', function () { if (heading >= 0) landed(); });

  steps.forEach(function (s, i) { s.addEventListener('click', function () { goTo(i); }); });
  if (prev) prev.addEventListener('click', function () { step(-1); });
  if (next) next.addEventListener('click', function () { step(1); });

  rail.addEventListener('keydown', function (e) {
    if (e.target !== rail) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
  });

  /* Tabbing into a panel that is only peeking brings it into view. */
  rail.addEventListener('focusin', function (e) {
    var panel = e.target.closest && e.target.closest('.trail__panel');
    var i = panel ? panels.indexOf(panel) : -1;
    if (i >= 0 && i !== index) goTo(i);
  });

  /* Clicking the peeking panel's edge moves to it, rather than following
     whatever link happened to be under the pointer. */
  panels.forEach(function (p, i) {
    p.addEventListener('click', function (e) {
      if (i === index) return;
      e.preventDefault();
      goTo(i);
    });
  });

  window.addEventListener('load', update);
  window.addEventListener('resize', update);
  if ('ResizeObserver' in window) new ResizeObserver(update).observe(rail);

  root.classList.add('is-live');
  update();
})();
