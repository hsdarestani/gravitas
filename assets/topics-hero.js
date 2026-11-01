// Topics hero: one question, all the way down.
//
// Every Topic is one question with seven layers around it, from the video at
// the top to the discussion at the bottom, and a reader stops at the depth
// that suits them. The figure is that sentence drawn as the brand's own
// picture, the spacetime well.
//
//   The well    , seven rings, one per layer, narrowing as they go down, and
//                 a few meridians tying them into one surface. The rings are
//                 the layers of Topic 01, in its order.
//   The reader  , one body that spirals in from the rim and down through the
//                 rings, lighting each as it passes. The caption names the
//                 layer it is in, so the figure reads as a Topic being read.
//   The pointer , a mass. Bring it near and the throat of the well leans
//                 towards it, deeper rings more than shallow ones; the
//                 question at the bottom stays where it is. Take it away and
//                 the well rights itself.
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

  // ---- The well, in model units --------------------------------------------
  var LAYERS = ['Video', 'Essay', 'Sources', 'Timeline', 'Try It', 'Viewpoints', 'Discussion'];
  var L = LAYERS.length;
  var SPAN = 3.0;
  var TILT = 0.3;                  // ellipse height over width: the well seen from above the rim
  var MER = 14;                    // meridians
  var SEG = 48;                    // points per ring
  var TRIP = 12, REST = 1.6;       // seconds down the well, seconds at the bottom
  var R_NEAR = 1.2, R_FAR = 2.0, LEAN = 0.55;

  // Ring k: radius and depth. The radius falls off like the embedding of a
  // point mass, fast near the throat, so the stack reads as a well and not a
  // cone.
  var RR = new Float32Array(L), RD = new Float32Array(L);
  for (var k = 0; k < L; k++) {
    var u = k / (L - 1);
    RR[k] = 1.32 * (1 - 0.86 * Math.pow(u, 0.75));
    RD[k] = -0.62 + 1.28 * Math.pow(u, 1.35);
  }
  // Each ring's centre, after the lean.
  var OX = new Float32Array(L), OY = new Float32Array(L);
  var COS = new Float32Array(SEG + 1), SIN = new Float32Array(SEG + 1);
  for (var s = 0; s <= SEG; s++) { COS[s] = Math.cos(s / SEG * Math.PI * 2); SIN[s] = Math.sin(s / SEG * Math.PI * 2); }

  // ---- Pointer -------------------------------------------------------------
  var curX = 0, curY = 0, curOn = false, infl = 0, mX = 0, mY = 0;
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

  function lean() {
    // The throat leans towards the mass; the rim barely moves, the bottom
    // most, so the well bends rather than slides.
    var lx = 0, ly = 0;
    if (infl > 0) {
      var d = Math.sqrt(mX * mX + mY * mY) || 1, pull = Math.min(d, 1.2) / d;
      lx = mX * pull * LEAN * infl; ly = mY * pull * LEAN * infl * 0.5;
    }
    for (var k = 0; k < L; k++) {
      var w = Math.pow(k / (L - 1), 1.4);
      OX[k] = lx * w; OY[k] = RD[k] + ly * w;
    }
  }

  // Where the reader is: a continuous depth through the rings, and an angle
  // that winds faster as the rings narrow, the way a coin rolls down a well.
  var PX = 0, PY = 0, DEPTH = 0;
  function reader(p) {
    var d = p * (L - 1), k = Math.min(L - 2, Math.floor(d)), f = d - k;
    var r = RR[k] + (RR[k + 1] - RR[k]) * f;
    var ox = OX[k] + (OX[k + 1] - OX[k]) * f, oy = OY[k] + (OY[k + 1] - OY[k]) * f;
    var a = -Math.PI / 2 + p * Math.PI * 2 * 3.2 + p * p * Math.PI * 2;
    PX = ox + r * Math.cos(a); PY = oy + r * Math.sin(a) * TILT; DEPTH = d;
  }

  function render(now) {
    var time = (now || 0) / 1000;
    lean();
    var cyc = reduce ? TRIP : time % (TRIP + REST);
    var p = Math.min(1, cyc / TRIP);
    p = p * p * (3 - 2 * p) * 0.6 + p * 0.4;          // eases in at the rim and out at the throat
    var fade = cyc > TRIP + REST - 0.5 ? (TRIP + REST - cyc) / 0.5 : 1;
    reader(p);

    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = blend;
    ctx.lineWidth = 1;

    // Meridians, tying the rings into one surface.
    ctx.strokeStyle = 'rgba(' + INK.line + ',0.1)';
    for (var m = 0; m < MER; m++) {
      var si = Math.round(m / MER * SEG);
      ctx.beginPath();
      for (var k = 0; k < L; k++) {
        var x = cx + (OX[k] + RR[k] * COS[si]) * scale, y = cy + (OY[k] + RR[k] * SIN[si] * TILT) * scale;
        if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }

    // Rings: the one the reader is in is brightest, the ones above it stay
    // lit, the ones below wait.
    var cur = Math.min(L - 1, Math.round(DEPTH));
    for (var r = 0; r < L; r++) {
      var passed = DEPTH >= r - 0.5, here = r === cur;
      var a = here ? 0.75 : passed ? 0.38 : 0.16;
      ctx.strokeStyle = 'rgba(' + (here || passed ? INK.body[1] : INK.line) + ',' + (a * (here ? fade : 1)).toFixed(3) + ')';
      ctx.lineWidth = here ? 1.6 : 1;
      ctx.beginPath();
      for (var s = 0; s <= SEG; s++) {
        var px = cx + (OX[r] + RR[r] * COS[s]) * scale, py = cy + (OY[r] + RR[r] * SIN[s] * TILT) * scale;
        if (s) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.stroke();
    }
    ctx.lineWidth = 1;

    // The question at the bottom, one slow breath.
    var b = 1 + 0.08 * Math.sin((now || 0) / 1400), qr = 20 * b;
    ctx.drawImage(coreSprite, cx + OX[L - 1] * scale - qr, cy + OY[L - 1] * scale - qr, qr * 2, qr * 2);

    // The reader.
    if (fade > 0) {
      var rr = 15;
      ctx.globalAlpha = fade;
      ctx.drawImage(sprites[1], cx + PX * scale - rr, cy + PY * scale - rr, rr * 2, rr * 2);
      ctx.globalAlpha = 1;
    }
    if (infl > 0.02) {
      var mr = 18 * infl;
      ctx.drawImage(sprites[2], cx + mX * scale - mr, cy + mY * scale - mr, mr * 2, mr * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    caption(cur, infl > 0.2);
  }

  // ---- Caption -------------------------------------------------------------
  var nameEl = document.getElementById('tp-well-name');
  var subEl = document.getElementById('tp-well-sub');
  var shownLayer = -1, shownLean = false;
  function caption(layer, leaning) {
    if (layer === shownLayer && leaning === shownLean) return;
    shownLayer = layer; shownLean = leaning;
    if (nameEl) nameEl.textContent = 'Layer ' + ('0' + (layer + 1)).slice(-2) + ' · ' + LAYERS[layer];
    if (subEl) subEl.textContent = leaning ? 'another angle, the same question' : 'one question, all the way down';
  }

  // ---- Loop ----------------------------------------------------------------
  var running = false, visible = true;
  function frame(now) {
    if (!visible || document.hidden) { running = false; return; }
    if (!W) size();
    t0 = now;
    var target = 0;
    if (curOn) {
      var d = Math.sqrt(curX * curX + curY * curY);
      target = d <= R_NEAR ? 1 : d >= R_FAR ? 0 : (R_FAR - d) / (R_FAR - R_NEAR);
      target = target * target * (3 - 2 * target);
      mX += (curX - mX) * 0.2; mY += (curY - mY) * 0.2;
    }
    infl += (target - infl) * (target > infl ? 0.12 : 0.06);
    if (infl < 0.002) infl = 0;
    render(now);
    requestAnimationFrame(frame);
  }
  function start() {
    if (running || reduce || !visible || document.hidden) return;
    running = true;
    requestAnimationFrame(frame);
  }

  size();
  window.addEventListener('resize', size);
  if (window.ResizeObserver) new ResizeObserver(size).observe(canvas);
  window.addEventListener('gravitas:theme', function () {
    readInk(); buildSprites();
    if (reduce || !running) render(t0);
  });

  if (reduce) {
    // No motion: the reader at the bottom, every layer passed.
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
