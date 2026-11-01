// Lab hero: same start, one condition changed.
//
// The home hero is two bodies and a cursor; the community hero is many
// bodies held by one question. The Lab needed its own figure, and it is not
// an experiment: the Lab's experiences are published through the registry
// (lab-studio.js) and nothing on this page may stand in for one. What the
// figure says is only what every Lab is, a model you can change.
//
//   The source  , one point on the left. Every run starts here, at the same
//                 speed, fanned over a small range of angles.
//   The well    , one mass the runs bend around. With nothing else in the
//                 field the fan bends, crosses and lands the same way on
//                 every visit, which is what "same rules" looks like.
//   The pointer , a second mass. Bring it near and every run is integrated
//                 again with it in the field, so the whole fan moves at once.
//                 The undisturbed fan stays behind as a faint dashed ghost,
//                 because a change only means something next to what it
//                 changed: that comparison is the Lab's point in one picture.
//
// The runs are computed, not drawn from a script: a leapfrog integration of
// each one from the source until it leaves the frame or falls into a well.
// The undisturbed fan is integrated once; the disturbed one only while the
// pointer counts. hero.js runs the grid, the starfield and the comet on this
// page as it does on the home page; this file owns only the canvas in the
// right column. It reads the same --g-canvas-* channels, so the light theme is
// ink on paper here too, and it stops drawing whenever the canvas is off
// screen or the tab is hidden.
(function () {
  var canvas = document.getElementById('lab-fan');
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

  // Pre-rendered glows, rebuilt on a theme flip and never in the frame loop.
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
    sprites = INK.body.map(function (rgb) { return sprite(rgb, 0.92, 2.2); });
    coreSprite = sprite(INK.line, 0.95, 3.4);
  }
  readInk(); buildSprites();

  // ---- System (G = 1) ------------------------------------------------------
  var K = 15;                      // runs in the fan
  var STEPS = 360, DT = 0.0105;    // per run; long enough to cross the frame
  var SPAN = 3.3;                  // framing, in model units, across the canvas
  var EDGE = 1.95;                 // a run that leaves this box has landed
  var SRC_X = -1.42, SRC_Y = 0.0, SPEED = 1.02, FAN = 0.62;
  var WELL_X = 0.1, WELL_Y = 0.04, WELL_M = 0.32;
  var CURSOR_M = 0.42, SOFT = 0.012;
  var R_NEAR = 1.25, R_FAR = 2.1;  // where the pointer starts to count

  // Two sets of runs: the undisturbed fan (B*) and the live one (P*).
  var BX = new Float32Array(K * STEPS), BY = new Float32Array(K * STEPS), BLEN = new Uint16Array(K);
  var PX = new Float32Array(K * STEPS), PY = new Float32Array(K * STEPS), PLEN = new Uint16Array(K);

  // The acceleration at (x, y), left in AX/AY so the frame loop allocates
  // nothing.
  var AX = 0, AY = 0;
  function accel(x, y, mx, my, mm) {
    var dx = WELL_X - x, dy = WELL_Y - y, r2 = dx * dx + dy * dy + SOFT;
    var f = WELL_M / (r2 * Math.sqrt(r2));
    AX = dx * f; AY = dy * f;
    if (mm > 0) {
      var ex = mx - x, ey = my - y, e2 = ex * ex + ey * ey + SOFT;
      var g = mm / (e2 * Math.sqrt(e2));
      AX += ex * g; AY += ey * g;
    }
  }

  function integrate(outX, outY, outLen, mx, my, mm) {
    for (var i = 0; i < K; i++) {
      var a = -FAN / 2 + FAN * i / (K - 1);
      var x = SRC_X, y = SRC_Y, vx = SPEED * Math.cos(a), vy = SPEED * Math.sin(a);
      var base = i * STEPS, n = 0;
      // Kick-drift-kick, so the energy of a close pass does not creep.
      accel(x, y, mx, my, mm);
      for (var s = 0; s < STEPS; s++) {
        outX[base + n] = x; outY[base + n] = y; n++;
        vx += AX * DT * 0.5; vy += AY * DT * 0.5;
        x += vx * DT; y += vy * DT;
        accel(x, y, mx, my, mm);
        vx += AX * DT * 0.5; vy += AY * DT * 0.5;
        if (!isFinite(x) || x > EDGE || x < -EDGE || y > EDGE || y < -EDGE) break;
        var wx = x - WELL_X, wy = y - WELL_Y;
        if (wx * wx + wy * wy < 0.0025) break;      // fell into the well
      }
      outLen[i] = n;
    }
  }

  // ---- Pointer: a second mass ----------------------------------------------
  var curX = 0, curY = 0, curOn = false, infl = 0, mX = 0.6, mY = -0.6;
  var W = 0, H = 0, dpr = 1, scale = 1, cx = 0, cy = 0, t0 = 0;

  function pointerTo(x, y) {
    if (!scale) return;
    var r = canvas.getBoundingClientRect();
    curX = (x - r.left - cx) / scale;
    curY = (y - r.top - cy) / scale;
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

  // ---- Drawing -------------------------------------------------------------
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

  function strokeRun(X, Y, len, i) {
    var base = i * STEPS;
    ctx.beginPath();
    ctx.moveTo(cx + X[base] * scale, cy + Y[base] * scale);
    for (var s = 2; s < len; s += 2) ctx.lineTo(cx + X[base + s] * scale, cy + Y[base + s] * scale);
    if (len > 1) ctx.lineTo(cx + X[base + len - 1] * scale, cy + Y[base + len - 1] * scale);
    ctx.stroke();
  }

  function render(now) {
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = blend;
    ctx.lineWidth = 1;
    var live = infl > 0.002, X = live ? PX : BX, Y = live ? PY : BY, LEN = live ? PLEN : BLEN;

    // The undisturbed fan, as a ghost, only while there is something to
    // compare it with.
    if (infl > 0.02) {
      ctx.setLineDash([2, 5]);
      ctx.strokeStyle = 'rgba(' + INK.line + ',' + (0.2 * infl).toFixed(3) + ')';
      for (var g = 0; g < K; g++) strokeRun(BX, BY, BLEN[g], g);
      ctx.setLineDash([]);
    }

    // The runs. The middle of the fan is Sisal, the edges White Tint, so the
    // fan reads as one family rather than fifteen separate lines.
    for (var i = 0; i < K; i++) {
      var mid = Math.abs(i - (K - 1) / 2) / ((K - 1) / 2);
      var rgb = mid < 0.35 ? INK.body[1] : INK.body[0];
      ctx.strokeStyle = 'rgba(' + rgb + ',' + (0.34 - 0.12 * mid).toFixed(3) + ')';
      strokeRun(X, Y, LEN[i], i);
    }

    // One pulse per run, travelling out from the source on a shared clock with
    // a small offset each, so the fan is seen to be drawn from one start.
    var t = (now || 0) / 1000;
    for (var p = 0; p < K; p++) {
      var len = LEN[p];
      if (len < 4) continue;
      var u = reduce ? 0.62 : ((t * 0.16 + p * 0.013) % 1);
      var at = Math.min(len - 1, Math.floor(u * STEPS));
      if (at >= len - 1 && !reduce) continue;      // landed: wait for the next pass
      var base = p * STEPS, k = base + at;
      var s = 9 + 3 * (1 - Math.abs(p - (K - 1) / 2) / ((K - 1) / 2));
      ctx.drawImage(sprites[p % 3 === 0 ? 2 : 1], cx + X[k] * scale - s, cy + Y[k] * scale - s, s * 2, s * 2);
    }

    // The well, one slow breath; the source, a fixed point; the pointer's
    // mass, only as strong as it counts.
    var b = 1 + 0.08 * Math.sin((now || 0) / 1400), wr = 22 * b;
    ctx.drawImage(coreSprite, cx + WELL_X * scale - wr, cy + WELL_Y * scale - wr, wr * 2, wr * 2);
    ctx.drawImage(sprites[0], cx + SRC_X * scale - 10, cy + SRC_Y * scale - 10, 20, 20);
    if (infl > 0.02) {
      var mr = 18 * infl;
      ctx.drawImage(sprites[2], cx + mX * scale - mr, cy + mY * scale - mr, mr * 2, mr * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---- Caption -------------------------------------------------------------
  var nameEl = document.getElementById('lab-fan-name');
  var subEl = document.getElementById('lab-fan-sub');
  var changed = false;
  function caption(c) {
    if (c === changed) return;
    changed = c;
    if (nameEl) nameEl.textContent = c ? 'One condition changed' : 'Same start, same rules';
    if (subEl) subEl.textContent = c ? 'every run follows it' : 'every run lands the same way';
  }

  // ---- Loop ----------------------------------------------------------------
  var running = false, visible = true;
  function frame(now) {
    if (!visible || document.hidden) { running = false; return; }
    if (!W) size();
    t0 = now;

    var target = 0;
    if (curOn) {
      var dx = curX - WELL_X, dy = curY - WELL_Y, d = Math.sqrt(dx * dx + dy * dy);
      target = d <= R_NEAR ? 1 : d >= R_FAR ? 0 : (R_FAR - d) / (R_FAR - R_NEAR);
      target = target * target * (3 - 2 * target);
      // The mass trails the pointer slightly, so a quick flick sweeps the fan
      // instead of teleporting it.
      mX += (curX - mX) * 0.22; mY += (curY - mY) * 0.22;
    }
    infl += (target - infl) * (target > infl ? 0.16 : 0.08);
    if (infl < 0.002) infl = 0;
    if (infl > 0) integrate(PX, PY, PLEN, mX, mY, CURSOR_M * infl);

    caption(infl > 0.16);
    render(now);
    requestAnimationFrame(frame);
  }
  function start() {
    if (running || reduce || !visible || document.hidden) return;
    running = true;
    requestAnimationFrame(frame);
  }

  integrate(BX, BY, BLEN, 0, 0, 0);
  size();
  window.addEventListener('resize', size);
  if (window.ResizeObserver) new ResizeObserver(size).observe(canvas);
  window.addEventListener('gravitas:theme', function () {
    readInk(); buildSprites();
    if (reduce || !running) render(t0);
  });

  if (reduce) {
    // No motion: the undisturbed fan at rest, each run marked part way out.
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
