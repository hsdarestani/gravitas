// Topics hero: a gravitational lens.
//
// The headline is "Pick a question. Feel its pull." The figure before this one
// drew the pull as an object, a wireframe well, and an object of lines sat on
// the hero grid as two sets of lines fighting each other. This one draws the
// pull as an effect, the one astronomers actually see: light from behind a
// mass bends around it.
//
//   The sky      , a disc of background stars drifting slowly past. They are
//                  every field a question can draw on.
//   The lens     , one mass at the centre, not drawn except for a faint core.
//                  Each star is imaged through it with the exact point-lens
//                  equation, so it appears twice: once pushed outward and
//                  stretched along the ring, once faint and inside it. Surface
//                  brightness is conserved, so a stretched image is longer,
//                  not brighter, which is what makes the arcs read as real.
//   The galaxy   , one small bright cluster that crosses behind the lens on
//                  a slow loop. When it lines up, its images close into an
//                  Einstein ring and the caption says so.
//   The pointer  , moves the lens. The whole sky re-images around it, so the
//                  reader moves the question and everything bends with it.
//
// hero.js runs the grid, the starfield and the comet on this page as it does
// on the home page; this file owns only the canvas in the right column. It
// reads the same --g-canvas-* channels, so the light theme is ink on paper
// here too. Allocation-free in the frame loop, and it stops drawing whenever
// the canvas is off screen or the tab is hidden.
(function () {
  var canvas = document.getElementById('tp-well');
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
  var SPRITE = 48, coreSprite = null;
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
  function buildSprites() { coreSprite = sprite(INK.line, 0.9, 2.4); }
  readInk(); buildSprites();

  // ---- Model ---------------------------------------------------------------
  var SPAN = 3.0;
  var E = 0.4;                     // Einstein radius
  var SKY = 1.75;                  // source disc radius
  var FADE_IN = 1.12, FADE_OUT = 1.46;
  var R_NEAR = 1.2, R_FAR = 2.0, FOLLOW = 0.7;
  var N_STAR = 1000, N_GAL = 90;
  var N = N_STAR + N_GAL;

  // Seeded, so every visit draws the same sky.
  var seed = 7;
  function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }

  var SX = new Float32Array(N), SY = new Float32Array(N), SV = new Float32Array(N);
  var SA = new Float32Array(N), SC = new Uint8Array(N);
  for (var i = 0; i < N_STAR; i++) {
    var r = SKY * Math.sqrt(rnd()), a = rnd() * Math.PI * 2;
    SX[i] = r * Math.cos(a); SY[i] = r * Math.sin(a);
    SV[i] = 0.018 + rnd() * 0.04;
    SA[i] = 0.38 + Math.pow(rnd(), 2) * 0.6;
    SC[i] = rnd() < 0.8 ? 0 : 2;
  }
  // The galaxy: offsets from its moving centre, a soft gaussian blob.
  for (var j = N_STAR; j < N; j++) {
    var u1 = rnd() || 1e-6, u2 = rnd();
    var gr = 0.06 * Math.sqrt(-2 * Math.log(u1));
    SX[j] = gr * Math.cos(u2 * Math.PI * 2); SY[j] = gr * Math.sin(u2 * Math.PI * 2) * 0.7;
    SA[j] = 0.75 + rnd() * 0.25;
    SC[j] = 1;
  }
  var GAL_T = 14;                   // seconds per crossing

  // Per-frame images: two per source.
  var M = N * 2;
  var IR = new Float32Array(M), IA = new Float32Array(M), IH = new Float32Array(M);
  var IB = new Uint8Array(M);       // bucket: colour * LEVELS + alpha level
  var LEVELS = 5;

  // ---- Pointer -------------------------------------------------------------
  var curX = 0, curY = 0, curOn = false, infl = 0, mX = 0, mY = 0;
  var W = 0, H = 0, dpr = 1, scale = 1, cx = 0, cy = 0, t0 = 0, lastT = 0;
  function pointerTo(x, y) {
    if (!scale) return;
    var rc = canvas.getBoundingClientRect();
    curX = (x - rc.left - cx) / scale;
    curY = (y - rc.top - cy) / scale;
    if (!curOn) { mX = curX; mY = curY; }
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

  function size() {
    var rc = canvas.getBoundingClientRect();
    if (!rc.width) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = rc.width; H = rc.height; cx = W / 2; cy = H / 2;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scale = Math.min(W, H) / SPAN;
    if (reduce || !running) render(t0, 0);
  }

  // ---- Drawing -------------------------------------------------------------
  var LX = 0, LY = 0, aligned = false;
  function render(now, dt) {
    var time = (now || 0) / 1000;

    // Drift the sky; wrap each star back to the far side of the disc.
    if (dt > 0) {
      for (var i = 0; i < N_STAR; i++) {
        SX[i] += SV[i] * dt;
        if (SX[i] * SX[i] + SY[i] * SY[i] > SKY * SKY && SX[i] > 0) SX[i] = -Math.sqrt(SKY * SKY - SY[i] * SY[i]);
      }
    }
    // The lens follows the pointer, capped so it stays inside the sky.
    var lx = mX * infl * FOLLOW, ly = mY * infl * FOLLOW, ld = Math.sqrt(lx * lx + ly * ly);
    if (ld > 0.8) { lx *= 0.8 / ld; ly *= 0.8 / ld; }
    LX = lx; LY = ly;

    // The galaxy's centre crosses behind the rest position of the lens.
    // It lingers near the middle, so the ring holds for a few seconds of
    // every crossing instead of flashing past.
    var gp = reduce ? 0.5 : (time % GAL_T) / GAL_T, gs = 2 * gp - 1;
    var gx = 1.5 * (gs < 0 ? -1 : 1) * Math.pow(Math.abs(gs), 1.7);
    var gy = 0.02 + 0.05 * gs;
    var gdx = gx - LX, gdy = gy - LY;
    aligned = gdx * gdx + gdy * gdy < 0.12 * 0.12;

    // Image every source through the lens.
    var n = 0;
    for (var s = 0; s < N; s++) {
      var bx = (s < N_STAR ? SX[s] : gx + SX[s]) - LX;
      var by = (s < N_STAR ? SY[s] : gy + SY[s]) - LY;
      var beta = Math.sqrt(bx * bx + by * by);
      if (beta < 1e-4) { bx = 1e-4; by = 0; beta = 1e-4; }
      var ang = Math.atan2(by, bx);
      var root = Math.sqrt(beta * beta + 4 * E * E);
      var u = beta / E, uu = Math.sqrt(u * u + 4);
      var mu0 = (u * u + 2) / (2 * u * uu);
      for (var k = 0; k < 2; k++) {
        var th = k === 0 ? (beta + root) / 2 : (root - beta) / 2;   // radius of image
        var mu = k === 0 ? mu0 + 0.5 : mu0 - 0.5;
        var tang = th / beta;                                         // tangential stretch
        var rad = Math.min(1, mu / tang);                             // radial squash dims it
        var aImg = k === 0 ? ang : ang + Math.PI;
        // Edge fade, measured from the canvas centre, not the lens.
        var px = LX + th * Math.cos(aImg), py = LY + th * Math.sin(aImg);
        var pr = Math.sqrt(px * px + py * py);
        var edge = pr <= FADE_IN ? 1 : pr >= FADE_OUT ? 0 : (FADE_OUT - pr) / (FADE_OUT - FADE_IN);
        // Inner images are real but faint; at full weight they piled into a
        // fuzzy ball around the core.
        var alpha = SA[s] * edge * (k === 0 ? 0.25 + 0.75 * rad : 0.6 * rad);
        if (alpha < 0.05) continue;
        var len = Math.max(0.6, Math.min(0.6 + 2.2 * (Math.min(tang, 60) - 1), 150)) / scale;  // arc length, model units
        IR[n] = th; IA[n] = aImg; IH[n] = Math.min(Math.PI, len / 2 / th + 0.002);
        var lvl = Math.min(LEVELS - 1, Math.floor(alpha * LEVELS));
        IB[n] = SC[s] * LEVELS + lvl;
        n++;
      }
    }

    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = blend;
    ctx.lineCap = 'round';
    var ox = cx + LX * scale, oy = cy + LY * scale;
    for (var c = 0; c < 3; c++) {
      ctx.lineWidth = c === 1 ? 2 : 1.5;
      for (var l = 0; l < LEVELS; l++) {
        var b = c * LEVELS + l;
        ctx.strokeStyle = 'rgba(' + INK.body[c] + ',' + ((l + 0.6) / LEVELS).toFixed(2) + ')';
        ctx.beginPath();
        var any = false;
        for (var q = 0; q < n; q++) {
          if (IB[q] !== b) continue;
          var R = IR[q] * scale, a0 = IA[q] - IH[q], a1 = IA[q] + IH[q];
          ctx.moveTo(ox + R * Math.cos(a0), oy + R * Math.sin(a0));
          ctx.arc(ox, oy, R, a0, a1);
          any = true;
        }
        if (any) ctx.stroke();
      }
    }

    // The question: a faint core at the lens, one slow breath.
    var br = 1 + 0.08 * Math.sin((now || 0) / 1400), qr = 12 * br;
    ctx.globalAlpha = 0.55;
    ctx.drawImage(coreSprite, ox - qr, oy - qr, qr * 2, qr * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    caption(aligned, infl > 0.2);
  }

  // ---- Caption -------------------------------------------------------------
  var nameEl = document.getElementById('tp-well-name');
  var subEl = document.getElementById('tp-well-sub');
  var shownA = null, shownL = null;
  function caption(al, leaning) {
    if (al === shownA && leaning === shownL) return;
    shownA = al; shownL = leaning;
    if (nameEl) nameEl.textContent = al ? 'Einstein ring' : 'Gravitational lens';
    if (subEl) subEl.textContent = leaning ? 'move the question, the sky follows' : 'every field bends toward one question';
  }

  // ---- Loop ----------------------------------------------------------------
  var running = false, visible = true;
  function frame(now) {
    if (!visible || document.hidden) { running = false; return; }
    if (!W) size();
    var dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 0;
    lastT = now; t0 = now;
    var target = 0;
    if (curOn) {
      var d = Math.sqrt(curX * curX + curY * curY);
      target = d <= R_NEAR ? 1 : d >= R_FAR ? 0 : (R_FAR - d) / (R_FAR - R_NEAR);
      target = target * target * (3 - 2 * target);
      mX += (curX - mX) * 0.12; mY += (curY - mY) * 0.12;
    }
    infl += (target - infl) * (target > infl ? 0.08 : 0.04);
    if (infl < 0.002) infl = 0;
    render(now, dt);
    requestAnimationFrame(frame);
  }
  function start() {
    if (running || reduce || !visible || document.hidden) return;
    running = true; lastT = 0;
    requestAnimationFrame(frame);
  }

  size();
  window.addEventListener('resize', size);
  if (window.ResizeObserver) new ResizeObserver(size).observe(canvas);
  window.addEventListener('gravitas:theme', function () {
    readInk(); buildSprites();
    if (reduce || !running) render(t0, 0);
  });
  if (reduce) { render(0, 0); return; }   // no motion: the galaxy aligned, the ring closed
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      start();
    }).observe(canvas);
  }
  document.addEventListener('visibilitychange', start);
  start();
})();
