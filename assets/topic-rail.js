/* Topic rail — hover to page sideways, look away and it pages itself --------
 *
 * The first build of this section pinned itself under the header and drove the
 * rail sideways from vertical scroll. It worked, and it was still the wrong
 * trade: scrolling down the landing page meant being held in one section for
 * four screens of vertical distance whether or not you cared about the Topic,
 * and the page below it was unreachable except through the rail. Forced
 * horizontal scroll is a toll booth on the way down.
 *
 * So the pinned mode is gone. The rail is the honest overflow-x scroller it
 * always rendered as before any script ran, and this file adds three things
 * on top of it:
 *
 * 1. WHEEL OVER THE RAIL MOVES THE RAIL. A vertical wheel or trackpad gesture
 *    with the pointer over the rail steps one panel sideways. With the pointer
 *    anywhere else on the page — including the heading and the margins beside
 *    the rail — the page scrolls down the way it always did. The rail never
 *    holds the page: at the first panel an upward gesture, and at the last
 *    panel a downward one, are left alone and the page continues.
 *
 *    One panel per gesture rather than delta-summing, because the track snaps
 *    (scroll-snap-type: x mandatory) and adding raw deltas to scrollLeft
 *    fights the snap engine — the rail creeps, then jumps back. A short lock
 *    after each step turns a trackpad's fifty events into one panel, which is
 *    also what a mouse wheel's single notch gives.
 *
 * 2. IT PAGES ITSELF WHILE NOBODY IS POINTING AT IT. A reader who never puts
 *    the cursor on the rail has no way to learn it holds four panels; dots and
 *    a line under a still image read as decoration. So the rail advances on a
 *    timer, wrapping at the end, and stops the moment the pointer or keyboard
 *    focus lands on it — the hint is for the reader who has not engaged, and
 *    the instant they do it is in the way. It also idles when the section is
 *    off-screen, when the tab is hidden and under prefers-reduced-motion,
 *    where a section that moves on its own is exactly what was asked against.
 *
 * 3. Keyboard focus and the dots both move the rail, and the bar (title,
 *    count, dots, progress line) is redrawn from the rail's own scrollLeft
 *    rather than from whatever we last commanded — a swipe on a phone moves
 *    the scroller without going through any of this code, and the bar has to
 *    agree with what is actually on screen.
 */
(function () {
  'use strict';

  var root = document.querySelector('[data-rail]');
  if (!root) return;

  var stage = root.querySelector('.trail__stage');
  var rail = root.querySelector('.trail__rail');
  var count = root.querySelector('[data-rail-count]');
  var label = root.querySelector('[data-rail-label]');
  if (!stage || !rail) return;

  var panels = Array.prototype.slice.call(rail.querySelectorAll('.trail__panel'));
  var dots = Array.prototype.slice.call(root.querySelectorAll('.trail__dot'));
  if (panels.length < 2) return;

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* How long one step owns the rail. Long enough that the tail of a trackpad
     flick lands inside it, short enough that two deliberate notches of a mouse
     wheel are two panels. */
  var STEP_LOCK = 480;
  var AUTO_EVERY = 5200;

  var index = -1;
  var lockedUntil = 0;
  var queued = false;
  var engaged = false;   /* pointer over the stage, or focus inside it */
  var onScreen = false;
  var timer = 0;

  function offsetOf(panel) {
    return panel.offsetLeft - panels[0].offsetLeft;
  }

  function maxScroll() {
    return Math.max(0, rail.scrollWidth - rail.clientWidth);
  }

  /* The panel whose start the rail is closest to having reached. The 48px of
     slack keeps the count from flicking back a panel while a snap settles. */
  function nearest(x) {
    var best = 0;
    for (var i = 0; i < panels.length; i++) {
      if (offsetOf(panels[i]) <= x + 48) best = i;
    }
    return best;
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

  function update() {
    var max = maxScroll();
    root.style.setProperty('--rail-p', max ? (rail.scrollLeft / max).toFixed(4) : '1');
    setIndex(nearest(rail.scrollLeft));
  }

  function goTo(i) {
    var panel = panels[i];
    if (!panel) return;
    rail.scrollTo({ left: offsetOf(panel), behavior: reduce.matches ? 'auto' : 'smooth' });
  }

  /* Autoplay ------------------------------------------------------------- */

  function autoplayWanted() {
    return onScreen && !engaged && !reduce.matches && !document.hidden;
  }

  function stopAuto() {
    if (timer) { clearInterval(timer); timer = 0; }
  }

  /* Also called after every manual step, so the timer measures time since the
     reader last did something rather than since the section appeared. */
  function restartAuto() {
    stopAuto();
    if (!autoplayWanted()) return;
    timer = setInterval(function () {
      if (!autoplayWanted()) { stopAuto(); return; }
      goTo(index >= panels.length - 1 ? 0 : index + 1);
    }, AUTO_EVERY);
  }

  /* Wheel ---------------------------------------------------------------- */

  function onWheel(e) {
    if (e.ctrlKey) return;                                  /* pinch-zoom */
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;    /* already sideways */

    var down = e.deltaY > 0;
    var at = rail.scrollLeft;
    var max = maxScroll();
    /* At either end the gesture belongs to the page again. This is the whole
       reason the section no longer traps anyone. */
    if (down && at >= max - 1) return;
    if (!down && at <= 1) return;

    e.preventDefault();
    var now = Date.now();
    if (now < lockedUntil) return;
    lockedUntil = now + STEP_LOCK;
    goTo(Math.min(panels.length - 1, Math.max(0, index + (down ? 1 : -1))));
    restartAuto();
  }

  /* Wiring --------------------------------------------------------------- */

  rail.addEventListener('scroll', function () {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(function () { queued = false; update(); });
  }, { passive: true });

  rail.addEventListener('wheel', onWheel, { passive: false });

  dots.forEach(function (dot, i) {
    dot.addEventListener('click', function () { goTo(i); restartAuto(); });
  });

  rail.addEventListener('focusin', function (e) {
    var panel = e.target.closest && e.target.closest('.trail__panel');
    if (!panel) return;
    var i = panels.indexOf(panel);
    if (i >= 0 && i !== index) goTo(i);
  });

  /* Engagement: the pointer resting anywhere on the stage — rail, dots, the
     bar — counts, and so does keyboard focus and a finger on the panels. */
  function engage() { engaged = true; stopAuto(); }
  function release() { engaged = false; restartAuto(); }

  stage.addEventListener('pointerenter', engage);
  stage.addEventListener('pointerleave', release);
  stage.addEventListener('focusin', engage);
  stage.addEventListener('focusout', function (e) {
    if (!stage.contains(e.relatedTarget)) release();
  });
  rail.addEventListener('touchstart', engage, { passive: true });
  rail.addEventListener('touchend', function () {
    /* A swipe leaves no pointer behind, so nothing would ever release it. */
    window.setTimeout(release, AUTO_EVERY);
  }, { passive: true });

  document.addEventListener('visibilitychange', restartAuto);

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      onScreen = entries[0].isIntersecting;
      restartAuto();
    }, { threshold: 0.4 }).observe(stage);
  } else {
    onScreen = true;
    restartAuto();
  }

  /* Images inside the panels settle late and change what the rail can scroll,
     so the count and the line are recomputed once they have. */
  window.addEventListener('load', update);
  window.addEventListener('resize', update);
  if ('ResizeObserver' in window) new ResizeObserver(update).observe(rail);

  if (reduce.addEventListener) reduce.addEventListener('change', restartAuto);
  else if (reduce.addListener) reduce.addListener(restartAuto);

  update();
})();
