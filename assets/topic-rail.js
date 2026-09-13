/* Topic rail — driving the horizontal pass from vertical scroll -------------
 *
 * The markup in index.html renders, on its own, as a normal horizontal
 * scroller with snap points: no script, no pinning, still usable. Everything
 * this file adds is the desktop upgrade — the section pins under the header
 * and the rail is pulled sideways by how far you have scrolled into it, then
 * lets go and the page continues down.
 *
 * Three decisions worth keeping:
 *
 * 1. The scroll is never intercepted. There is no wheel handler, no
 *    preventDefault, no scroll-jacking library. A tall track element supplies
 *    exactly as much vertical distance as the rail needs horizontally, the
 *    stage sticks inside it, and the transform is a pure function of
 *    scroll position. The browser keeps its own scrolling: trackpad momentum,
 *    Page Down, find-in-page and the scrollbar all behave normally, and if
 *    this script fails the page is only a horizontal scroller again.
 *
 * 2. It opts out rather than degrades. Under 900px, or with
 *    prefers-reduced-motion, the pinned mode is never installed — a pinned
 *    section on a phone fights the browser's own address-bar resizing, and a
 *    reader who asked for less motion should not be handed a section that
 *    moves sideways when they scroll down.
 *
 * 3. Keyboard focus moves the rail. Tabbing into a link three panels along
 *    would otherwise focus something parked off-screen, so focusin scrolls
 *    the window to that panel's offset instead. Same code path as the dots.
 *
 * Measurement lives in one place (measure) because it has to agree with
 * itself: the track's height is the stage's height plus the horizontal
 * distance, and the transform is clamped to that same distance. When those
 * two drift apart you get either a dead gap at the end or a rail that never
 * reaches its last panel.
 */
(function () {
  'use strict';

  var root = document.querySelector('[data-rail]');
  if (!root) return;

  var track = root.querySelector('.trail__track');
  var stage = root.querySelector('.trail__stage');
  var rail = root.querySelector('.trail__rail');
  var count = root.querySelector('[data-rail-count]');
  var label = root.querySelector('[data-rail-label]');
  if (!track || !stage || !rail) return;

  var panels = Array.prototype.slice.call(rail.querySelectorAll('.trail__panel'));
  var dots = Array.prototype.slice.call(root.querySelectorAll('.trail__dot'));
  if (panels.length < 2) return;

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var wide = window.matchMedia('(min-width: 900px)');
  var pinned = false;
  var distance = 0;
  var index = -1;
  var queued = false;

  function headerHeight() {
    var header = document.querySelector('.g-header');
    return header ? header.getBoundingClientRect().height : 0;
  }

  /* Where each panel starts, measured against the rail's own left edge, so it
     is independent of how far the rail has already been translated. */
  function offsetOf(panel) {
    return panel.offsetLeft - panels[0].offsetLeft;
  }

  function setIndex(next) {
    if (next === index) return;
    index = next;
    if (count) count.textContent = String(next + 1).padStart(2, '0') + ' / ' + String(panels.length).padStart(2, '0');
    if (label) label.textContent = panels[next].getAttribute('data-rail-title') || '';
    dots.forEach(function (dot, i) {
      dot.setAttribute('aria-current', i === next ? 'true' : 'false');
    });
  }

  function nearest(x) {
    var best = 0;
    for (var i = 0; i < panels.length; i++) {
      if (offsetOf(panels[i]) <= x + 48) best = i;
    }
    return best;
  }

  function measure() {
    if (!pinned) {
      track.style.height = '';
      root.style.setProperty('--rail-x', '0px');
      return;
    }
    var last = panels[panels.length - 1];
    distance = Math.max(0, offsetOf(last) + last.offsetWidth - rail.clientWidth);
    track.style.height = (stage.offsetHeight + distance) + 'px';
    update();
  }

  function update() {
    if (!pinned) {
      setIndex(nearest(rail.scrollLeft));
      return;
    }
    var top = track.getBoundingClientRect().top;
    var travelled = Math.min(Math.max(headerHeight() - top, 0), distance);
    root.style.setProperty('--rail-x', travelled + 'px');
    root.style.setProperty('--rail-p', distance ? (travelled / distance).toFixed(4) : '1');
    setIndex(nearest(travelled));
  }

  function onScroll() {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(function () {
      queued = false;
      update();
    });
  }

  /* Both modes answer "go to panel i" — pinned mode by scrolling the window to
     the point in the track where that panel is aligned, native mode by letting
     the scroller do it. */
  function goTo(i) {
    var panel = panels[i];
    if (!panel) return;
    if (!pinned) {
      rail.scrollTo({ left: offsetOf(panel), behavior: reduce.matches ? 'auto' : 'smooth' });
      return;
    }
    var trackTop = track.getBoundingClientRect().top + window.pageYOffset;
    window.scrollTo({
      top: trackTop - headerHeight() + Math.min(offsetOf(panel), distance),
      behavior: reduce.matches ? 'auto' : 'smooth'
    });
  }

  function apply() {
    var next = wide.matches && !reduce.matches;
    if (next === pinned) { measure(); return; }
    pinned = next;
    root.setAttribute('data-rail', pinned ? 'pinned' : 'native');
    if (!pinned) rail.scrollLeft = 0;
    index = -1;
    measure();
    update();
  }

  dots.forEach(function (dot, i) {
    dot.addEventListener('click', function () { goTo(i); });
  });

  rail.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', measure);

  rail.addEventListener('focusin', function (e) {
    var panel = e.target.closest && e.target.closest('.trail__panel');
    if (!panel) return;
    var i = panels.indexOf(panel);
    if (i >= 0 && i !== index) goTo(i);
  });

  /* Images inside the panels change the rail's height, and a taller stage
     means a taller track. Re-measure once they have all settled. */
  window.addEventListener('load', measure);
  if ('ResizeObserver' in window) new ResizeObserver(measure).observe(rail);

  [wide, reduce].forEach(function (query) {
    if (query.addEventListener) query.addEventListener('change', apply);
    else if (query.addListener) query.addListener(apply);
  });

  apply();
})();
