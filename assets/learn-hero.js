// Learn hero: many sources, one order.
//
// The page's own first sentence is the brief: the archive is searchable but
// not ordered, and a path is the ordered version. So the figure is exactly
// that and nothing more.
//
//   The archive  , a scatter of small bodies, each drifting on its own slow
//                  loop. Nothing joins them, which is what "searchable but not
//                  ordered" looks like.
//   The path     , eight stations threaded through the scatter on one smooth
//                  curve, numbered in the order you take them. Each station is
//                  tied by a faint line to the two sources nearest it, because
//                  a step is made of the archive, not laid over it. Eight is
//                  the length of AI in Research, the path that is open.
//   The traveller, one pulse that walks the curve from the first station to
//                  the last, lighting each as it passes, then starts again.
//   The pointer  , a mass. Bring it near and the archive and the stations are
//                  pulled towards it, so the curve bends; take it away and
//                  everything settles back. The numbering never changes,
//                  which is the claim: the route can bend, the order holds.
//
// hero.js runs the grid, the starfield and the comet on this page as it does
// on the home page; this file owns only the canvas in the right column. It
// reads the same --g-canvas-* channels, so the light theme is ink on paper
// here too. Allocation-free in the frame loop, and it stops drawing whenever
// the canvas is off screen or the tab is hidden.
(function () {
  var canvas = document.getElementById('ln-path');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- Theme ink -----------------------------------------------------------
  var INK = { line: '241,239,236', core: '255,255,255', body: [] }, blend = 'lighter', MONO = 'monospace';
  function readInk() {
    var cs = getComputedStyle(document.documentElement);
    function ch(name, fallback) {
      var v = cs.getPropertyValue('--g-canvas-' + name).trim();
      return v ? v.replace(/\s+/g, ',') : fallback;
    }
    INK.line = ch('line', '241,239,236');
    INK.core = ch('core', '255,255,255');
    INK.body = [ch('body-a', '241,239,236'), ch('body-b', '212,201,190'), ch('body-c', '111,169,206')];
    MONO = cs.getPropertyValue('--g-font-mono').trim() || 'monospace';
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
    coreSprite = sprite(INK.line, 0.95, 3.2);
  }
  readInk(); buildSprites();

  // ---- The figure, in model units ------------------------------------------
  var SPAN = 3.0;                  // framing across the canvas
  var N = 64;                      // sources in the archive
  var S = 8;                       // stations on the path
  var SEG = 22;                    // curve samples between two stations
  var M = (S - 1) * SEG + 1;
  var PULL = 0.075, PULL_MAX = 0.32, SOFT = 0.07;
  var R_NEAR = 1.1, R_FAR = 1.9;
  var TRIP = 9.5, REST = 2.2;      // seconds on the path, seconds lit at the end

  var AX0 = new Float32Array(N), AY0 = new Float32Array(N), APH = new Float32Array(N), AW = new Float32Array(N);
  var AX = new Float32Array(N), AY = new Float32Array(N), AK = new Uint8Array(N), AS = new Float32Array(N);
  var SX0 = new Float32Array(S), SY0 = new Float32Array(S), SX = new Float32Array(S), SY = new Float32Array(S);
  var NEAR = new Uint8Array(S * 2);
  var CX = new Float32Array(M), CY = new Float32Array(M);

  // Deterministic scatter, so the figure is the same figure on every visit.
  var seedState = 11;
  function rand() { seedState = (seedState * 16807) % 2147483647; return (seedState - 1) / 2147483646; }

  function seed() {
    // Stations on a gentle S from lower left to upper right.
    for (var k = 0; k < S; k++) {
      var u = k / (S - 1);
      SX0[k] = -1.08 + 2.16 * u;
      SY0[k] = 0.78 - 1.56 * u + 0.34 * Math.sin(u * Math.PI * 2);
    }
    // Sources fill a disc, but keep a little clear of the stations so the
    // numbers stay legible.
    var placed = 0, guard = 0;
    while (placed < N && guard++ < 4000) {
      var r = 1.42 * Math.sqrt(rand()), a = rand() * Math.PI * 2;
      var x = r * Math.cos(a), y = r * Math.sin(a) * 0.86, ok = true;
      for (var s = 0; s < S && ok; s++) {
        var dx = x - SX0[s], dy = y - SY0[s];
        if (dx * dx + dy * dy < 0.028) ok = false;
      }
      if (!ok) continue;
      AX0[placed] = x; AY0[placed] = y;
      APH[placed] = rand() * Math.PI * 2; AW[placed] = 0.18 + rand() * 0.22;
      AK[placed] = rand() < 0.6 ? 0 : (rand() < 0.55 ? 1 : 2);
      AS[placed] = rand() < 0.12 ? 1.15 : 0.55 + rand() * 0.3;
      placed++;
    }
    N = placed;
    // The two sources nearest each station.
    for (var t = 0; t < S; t++) {
      var b1 = -1, b2 = -1, d1 = 1e9, d2 = 1e9;
      for (var i = 0; i < N; i++) {
        var ex = AX0[i] - SX0[t], ey = AY0[i] - SY0[t], d = ex * ex + ey * ey;
        if (d < d1) { d2 = d1; b2 = b1; d1 = d; b1 = i; }
        else if (d < d2) { d2 = d; b2 = i; }
      }
      NEAR[t * 2] = b1; NEAR[t * 2 + 1] = b2;
    }
  }

  // ---- Pointer: a mass that bends the route --------------------------------
  var curX = 0, curY = 0, curOn = false, infl = 0, mX = 0, mY = 0;
  var W = 0, H = 0, dpr = 1, scale = 1, cx = 0, cy = 0, t0 = 0;

  // Displacement towards the mass, capped so nothing is swallowed by it.
  var DX = 0, DY = 0;
  function pull(x, y) {
    DX = 0; DY = 0;
    if (infl <= 0) return;
    var ex = mX - x, ey = mY - y, e2 = ex * ex + ey * ey;
    var e = Math.sqrt(e2) || 1, f = PULL * infl / (e2 + SOFT);
    var len = Math.min(PULL_MAX * infl, f * e, e * 0.85);
    DX = ex / e * len; DY = ey / e * len;
  }

  function place(time) {
    for (var i = 0; i < N; i++) {
      var w = AW[i] * time + APH[i];
      var x = AX0[i] + 0.028 * Math.cos(w), y = AY0[i] + 0.022 * Math.sin(w * 1.3);
      pull(x, y); AX[i] = x + DX; AY[i] = y + DY;
    }
    for (var s = 0; s < S; s++) {
      pull(SX0[s], SY0[s]); SX[s] = SX0[s] + DX; SY[s] = SY0[s] + DY;
    }
    // Catmull-Rom through the stations, ends clamped.
    var m = 0;
    for (var k = 0; k < S - 1; k++) {
      var p0 = k > 0 ? k - 1 : 0, p3 = k + 2 < S ? k + 2 : S - 1;
      for (var j = 0; j < SEG; j++) {
        var t = j / SEG, t2 = t * t, t3 = t2 * t;
        CX[m] = 0.5 * (2 * SX[k] + (-SX[p0] + SX[k + 1]) * t + (2 * SX[p0] - 5 * SX[k] + 4 * SX[k + 1] - SX[p3]) * t2 + (-SX[p0] + 3 * SX[k] - 3 * SX[k + 1] + SX[p3]) * t3);
        CY[m] = 0.5 * (2 * SY[k] + (-SY[p0] + SY[k + 1]) * t + (2 * SY[p0] - 5 * SY[k] + 4 * SY[k + 1] - SY[p3]) * t2 + (-SY[p0] + 3 * SY[k] - 3 * SY[k + 1] + SY[p3]) * t3);
        m++;
      }
    }
    CX[m] = SX[S - 1]; CY[m] = SY[S - 1];
  }

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

  var LABELS = ['01', '02', '03', '04', '05', '06', '07', '08'];

  function render(now) {
    var time = (now || 0) / 1000;
    place(reduce ? 0 : time);
    // How far along the curve the traveller is, 0..1, and how lit the trip
    // is as a whole (it fades out before the next one starts).
    var cyc = reduce ? TRIP : time % (TRIP + REST);
    var prog = Math.min(1, cyc / TRIP);
    prog = prog < 0.5 ? 2 * prog * prog : 1 - Math.pow(-2 * prog + 2, 2) / 2;
    var fade = cyc > TRIP + REST - 0.6 ? (TRIP + REST - cyc) / 0.6 : 1;
    var head = Math.floor(prog * (M - 1));

    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = blend;
    ctx.lineWidth = 1;

    // Ties from each station to the sources it is made of.
    for (var t = 0; t < S; t++) {
      for (var q = 0; q < 2; q++) {
        var a = NEAR[t * 2 + q];
        ctx.strokeStyle = 'rgba(' + INK.line + ',0.16)';
        ctx.beginPath();
        ctx.moveTo(cx + SX[t] * scale, cy + SY[t] * scale);
        ctx.lineTo(cx + AX[a] * scale, cy + AY[a] * scale);
        ctx.stroke();
      }
    }

    // The route ahead, faint and dashed; the route behind, solid.
    ctx.setLineDash([2, 5]);
    ctx.strokeStyle = 'rgba(' + INK.line + ',0.26)';
    ctx.beginPath();
    ctx.moveTo(cx + CX[head] * scale, cy + CY[head] * scale);
    for (var m = head + 1; m < M; m++) ctx.lineTo(cx + CX[m] * scale, cy + CY[m] * scale);
    ctx.stroke();
    ctx.setLineDash([]);
    if (head > 0) {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(' + INK.body[1] + ',' + (0.7 * fade).toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(cx + CX[0] * scale, cy + CY[0] * scale);
      for (var n = 1; n <= head; n++) ctx.lineTo(cx + CX[n] * scale, cy + CY[n] * scale);
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    // The archive.
    for (var i = 0; i < N; i++) {
      var s = 9 * AS[i];
      ctx.globalAlpha = 0.7;
      ctx.drawImage(sprites[AK[i]], cx + AX[i] * scale - s, cy + AY[i] * scale - s, s * 2, s * 2);
    }
    ctx.globalAlpha = 1;

    // Stations: lit once the traveller has reached them.
    ctx.font = '500 ' + Math.max(10, Math.round(scale * 0.075)) + 'px ' + MONO;
    ctx.textBaseline = 'middle';
    for (var k = 0; k < S; k++) {
      var lit = head >= k * SEG ? fade : 0;
      var r = 12 + 6 * lit;
      ctx.globalAlpha = 0.45 + 0.55 * lit;
      ctx.drawImage(lit ? sprites[1] : sprites[0], cx + SX[k] * scale - r, cy + SY[k] * scale - r, r * 2, r * 2);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(' + INK.line + ',' + (0.42 + 0.5 * lit).toFixed(3) + ')';
      ctx.fillText(LABELS[k], cx + SX[k] * scale + 10, cy + SY[k] * scale - 13);
      ctx.globalCompositeOperation = blend;
    }
    ctx.globalAlpha = 1;

    // The traveller.
    if (fade > 0 && !reduce) {
      var hr = 16;
      ctx.drawImage(coreSprite, cx + CX[head] * scale - hr, cy + CY[head] * scale - hr, hr * 2, hr * 2);
    }
    if (infl > 0.02) {
      var mr = 18 * infl;
      ctx.drawImage(sprites[2], cx + mX * scale - mr, cy + mY * scale - mr, mr * 2, mr * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---- Caption -------------------------------------------------------------
  var nameEl = document.getElementById('ln-path-name');
  var subEl = document.getElementById('ln-path-sub');
  var bent = false;
  function caption(b) {
    if (b === bent) return;
    bent = b;
    if (nameEl) nameEl.textContent = b ? 'Pulled off course' : 'Many sources, one order';
    if (subEl) subEl.textContent = b ? 'the route bends, the order holds' : 'eight steps, start to finish';
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
    caption(infl > 0.2);
    render(now);
    requestAnimationFrame(frame);
  }
  function start() {
    if (running || reduce || !visible || document.hidden) return;
    running = true;
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
    // No motion: the whole route walked and every station lit.
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
