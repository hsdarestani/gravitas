// Community hero: many bodies, one question.
//
// The home hero is two bodies and a cursor, and the argument it makes is
// that the third mass is what breaks the closed form. The community page
// needed its own hero, not a copy, and the same physics carries the point
// one step further: many members held by one question, and every one of
// them close enough to the others to talk.
//
//   The well    , a single central mass. It is the week's question, and it
//                 is why anyone is in orbit at all.
//   The members , test particles on near-circular Kepler orbits, each held
//                 to its own analytic orbit by a critically damped spring,
//                 exactly as the home hero holds its pair. The disc is drawn
//                 tilted, so it reads as a system rather than a clock face.
//                 The orbits themselves are not drawn: guide ellipses over
//                 the hero grid were two sets of lines fighting each other.
//   The threads , a line between any two members close enough to be in the
//                 same conversation. They form, stretch and drop as the
//                 orbits shear past each other, which is most of what makes
//                 the figure look alive.
//
// Bring the pointer near and it is a second mass: the springs let go in
// proportion, members get pulled out of their lanes, new threads form across
// the disc. Take it away and every member is reeled back to its orbit. That
// is the claim, said in motion: one new voice changes who talks to whom.
//
// hero.js runs the grid, the stars, the meteors and the comet on this page as
// it does on the home page; this file only owns the canvas in the right
// column. It reads the same --g-canvas-* channels, so the light theme is ink
// on paper here too. Allocation-free in the frame loop, and it stops drawing
// whenever the canvas is off screen or the tab is hidden.
(function () {
  var canvas = document.getElementById('cm-swarm');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- Theme ink -----------------------------------------------------------
  var INK = { line: '241,239,236', core: '255,255,255', body: [] }, blend = 'lighter';
  function readInk() {
    var cs = getComputedStyle(document.documentElement);
    function ch(name, fallback) {
      var v = cs.getPropertyValue('--g-canvas-' + name).trim();
      return v ? v.replace(/\s+/g, ',') : fallback;
    }
    INK.line = ch('line', '241,239,236');
    INK.core = ch('core', '255,255,255');
    INK.body = [ch('body-a', '241,239,236'), ch('body-b', '212,201,190'), ch('body-c', '111,169,206')];
    blend = document.documentElement.getAttribute('data-theme') === 'light' ? 'source-over' : 'lighter';
  }

  // Pre-rendered glows, one per body colour plus the well's core. Rebuilt on
  // a theme flip, never in the frame loop.
  var SPRITE = 48, sprites = [], coreSprite = null;
  function sprite(rgb, coreA, coreR) {
    var c = document.createElement('canvas');
    c.width = c.height = SPRITE;
    var g = c.getContext('2d'), h = SPRITE / 2;
    var grad = g.createRadialGradient(h, h, 0, h, h, h);
    grad.addColorStop(0, 'rgba(' + rgb + ',0.8)');
    grad.addColorStop(0.32, 'rgba(' + rgb + ',0.2)');
    grad.addColorStop(1, 'rgba(' + rgb + ',0)');
    g.fillStyle = grad; g.fillRect(0, 0, SPRITE, SPRITE);
    g.fillStyle = 'rgba(' + INK.core + ',' + coreA + ')';
    g.beginPath(); g.arc(h, h, coreR, 0, 6.28318); g.fill();
    return c;
  }
  function buildSprites() {
    sprites = INK.body.map(function (rgb) { return sprite(rgb, 0.92, 2.4); });
    coreSprite = sprite(INK.line, 0.95, 3.4);
  }
  readInk(); buildSprites();

  // ---- System (G = 1, central mass 1) -------------------------------------
  var N = 46;
  var TILT = 0.58;                 // the disc's apparent inclination
  var SPAN = 2.65;                 // framing, in orbit units, across the canvas
  var SOFT = 0.05;
  var CURSOR_M = 1.6;
  var REST_K = 26, RELEASE = 0.93;
  var LINK = 0.46;                 // conversation distance, orbit units
  var R_NEAR = 1.0, R_FAR = 1.9;   // where the pointer starts to count
  var SIMRATE = 0.62;              // an orbit at r = 1 takes about ten seconds

  var R0 = new Float64Array(N), TH = new Float64Array(N), OM = new Float64Array(N);
  var X = new Float64Array(N), Y = new Float64Array(N);
  var VX = new Float64Array(N), VY = new Float64Array(N);
  var KIND = new Uint8Array(N), SIZE = new Float64Array(N);

  // Deterministic scatter, so the figure is the same figure on every visit.
  var seedState = 7;
  function rand() { seedState = (seedState * 16807) % 2147483647; return (seedState - 1) / 2147483646; }

  function seed() {
    for (var i = 0; i < N; i++) {
      // Lanes from just outside the well to the rim, denser in the middle.
      var u = (i + rand() * 0.8) / N;
      R0[i] = 0.42 + 0.92 * Math.pow(u, 0.85);
      TH[i] = rand() * Math.PI * 2;
      OM[i] = Math.sqrt(1 / (R0[i] * R0[i] * R0[i]));
      X[i] = R0[i] * Math.cos(TH[i]); Y[i] = R0[i] * Math.sin(TH[i]);
      VX[i] = -R0[i] * OM[i] * Math.sin(TH[i]); VY[i] = R0[i] * OM[i] * Math.cos(TH[i]);
      KIND[i] = rand() < 0.62 ? 0 : (rand() < 0.6 ? 1 : 2);
      SIZE[i] = rand() < 0.14 ? 1.25 : 0.7 + rand() * 0.3;
    }
  }

  var curX = 0, curY = 0, curOn = false, infl = 0;

  function step(dt) {
    var k = REST_K * (1 - RELEASE * infl), c = 2 * Math.sqrt(k), cm = CURSOR_M * infl;
    for (var i = 0; i < N; i++) {
      TH[i] += OM[i] * dt;
      var ct = Math.cos(TH[i]), st = Math.sin(TH[i]);
      var rx = R0[i] * ct, ry = R0[i] * st;
      var rvx = -R0[i] * OM[i] * st, rvy = R0[i] * OM[i] * ct;
      var x = X[i], y = Y[i];
      var r2 = x * x + y * y + SOFT, inv = 1 / (r2 * Math.sqrt(r2));
      var ax = -x * inv + k * (rx - x) + c * (rvx - VX[i]);
      var ay = -y * inv + k * (ry - y) + c * (rvy - VY[i]);
      if (cm > 0) {
        var ex = curX - x, ey = curY - y, e2 = ex * ex + ey * ey + SOFT;
        var ei = cm / (e2 * Math.sqrt(e2));
        ax += ex * ei; ay += ey * ei;
      }
      // Semi-implicit Euler: plenty at sixteen substeps, and the spring
      // keeps it honest over hours where energy drift would otherwise show.
      VX[i] += ax * dt; VY[i] += ay * dt;
      X[i] += VX[i] * dt; Y[i] += VY[i] * dt;
      if (!isFinite(X[i]) || X[i] * X[i] + Y[i] * Y[i] > 30) {
        X[i] = rx; Y[i] = ry; VX[i] = rvx; VY[i] = rvy;
      }
    }
  }

  // ---- Drawing -------------------------------------------------------------
  var W = 0, H = 0, dpr = 1, scale = 1, cx = 0, cy = 0, t0 = 0;
  function size() {
    var r = canvas.getBoundingClientRect();
    if (!r.width) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height; cx = W / 2; cy = H / 2;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scale = Math.min(W, H) / SPAN;
    if (reduce || !running) render(t0);
  }

  function render(now) {
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = blend;

    // Threads first, so the bodies sit on top of their own lines.
    var L2 = LINK * LINK;
    ctx.lineWidth = 1;
    for (var i = 0; i < N; i++) {
      for (var j = i + 1; j < N; j++) {
        var dx = X[j] - X[i], dy = Y[j] - Y[i], d2 = dx * dx + dy * dy;
        if (d2 > L2) continue;
        var f = 1 - Math.sqrt(d2) / LINK;
        ctx.strokeStyle = 'rgba(' + INK.line + ',' + (0.42 * f * f).toFixed(3) + ')';
        ctx.beginPath();
        ctx.moveTo(cx + X[i] * scale, cy + Y[i] * scale * TILT);
        ctx.lineTo(cx + X[j] * scale, cy + Y[j] * scale * TILT);
        ctx.stroke();
      }
    }

    // The well: one slow breath, so the centre reads as the thing holding
    // everyone rather than as a fixed dot.
    var b = 1 + 0.08 * Math.sin((now || 0) / 1400);
    var cr = 22 * b;
    ctx.drawImage(coreSprite, cx - cr, cy - cr, cr * 2, cr * 2);

    // Bodies, nearer (lower on screen) ones drawn slightly larger, which is
    // all the perspective the tilt needs.
    for (var m = 0; m < N; m++) {
      var depth = 1 + 0.18 * (Y[m] / 1.4);
      var s = 13 * SIZE[m] * depth;
      ctx.drawImage(sprites[KIND[m]], cx + X[m] * scale - s, cy + Y[m] * scale * TILT - s, s * 2, s * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---- Caption -------------------------------------------------------------
  var nameEl = document.getElementById('cm-swarm-name');
  var subEl = document.getElementById('cm-swarm-sub');
  var perturbed = false;
  function caption(p) {
    if (p === perturbed) return;
    perturbed = p;
    if (nameEl) nameEl.textContent = p ? 'Perturbed' : 'Many bodies, one question';
    if (subEl) subEl.textContent = p ? 'one new voice changes who talks to whom'
                                     : 'never the same twice';
  }

  // ---- Pointer: a second mass ----------------------------------------------
  // Same contract as the home orbit: hover with a mouse, press and drag with a
  // finger inside the play area (.lp-orbit__hit opts that patch out of
  // scrolling). The box is read fresh on every move; caching it went stale.
  function pointerTo(x, y) {
    if (!scale) return;
    var r = canvas.getBoundingClientRect();
    curX = (x - r.left - cx) / scale;
    curY = (y - r.top - cy) / (scale * TILT);
    curOn = true;
  }
  var hero = document.getElementById('top');
  if (hero && !reduce) {
    hero.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch' && !curOn) return;
      pointerTo(e.clientX, e.clientY);
    }, { passive: true });
    hero.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch') pointerTo(e.clientX, e.clientY);
    }, { passive: true });
    hero.addEventListener('pointerleave', function (e) {
      if (e.pointerType !== 'touch') curOn = false;
    }, { passive: true });
    ['pointerup', 'pointercancel'].forEach(function (ev) {
      hero.addEventListener(ev, function (e) {
        if (e.pointerType === 'touch') curOn = false;
      }, { passive: true });
    });
  }

  // ---- Loop ----------------------------------------------------------------
  var running = false, visible = true, lastT = 0;
  function frame(now) {
    if (!visible || document.hidden) { running = false; return; }
    if (!W) size();
    t0 = now;
    var dtReal = lastT ? Math.min((now - lastT) / 1000, 0.05) : 1 / 60;
    lastT = now;

    var target = 0;
    if (curOn) {
      var d = Math.sqrt(curX * curX + curY * curY);
      target = d <= R_NEAR ? 1 : d >= R_FAR ? 0 : (R_FAR - d) / (R_FAR - R_NEAR);
      target = target * target * (3 - 2 * target);
    }
    infl += (target - infl) * (target > infl ? 0.2 : 0.1);
    if (infl < 0.0005) infl = 0;

    var SUB = 16, h = dtReal * SIMRATE / SUB;
    for (var s = 0; s < SUB; s++) step(h);
    caption(infl > 0.16);
    render(now);
    requestAnimationFrame(frame);
  }
  function start() {
    if (running || reduce || !visible || document.hidden) return;
    running = true; lastT = 0;
    requestAnimationFrame(frame);
  }

  seed();
  size();
  window.addEventListener('resize', size);
  if (window.ResizeObserver) new ResizeObserver(size).observe(canvas);
  window.addEventListener('gravitas:theme', function () {
    readInk(); buildSprites();
    if (reduce || !running) render(t0);
  });

  if (reduce) {
    // No motion: the disc at rest, threads and all.
    render(0);
    return;
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      start();
    }).observe(canvas);
  }
  document.addEventListener('visibilitychange', start);
  start();
})();
