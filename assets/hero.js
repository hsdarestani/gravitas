// Reveal on scroll — no-op under reduced motion (system CSS zeroes transitions)
(function () {
  var els = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) { els.forEach(function (e) { e.classList.add('is-in'); }); return; }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } });
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
  els.forEach(function (e) { io.observe(e); });

  // The mobile menu is owned by site.js, which is loaded on every page.
  // It used to be bound here as well; both handlers fired on the same tap,
  // the second read the state the first had just set, and the menu toggled
  // straight back shut — so it only ever failed on the one page that loads
  // this file.

  // ---- Hero starfield: scatter many small white dots ----
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var starBox = document.getElementById('lp-stars');
  if (starBox) {
    var STAR_COUNT = 150;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < STAR_COUNT; i++) {
      var s = document.createElement('span');
      s.className = 'lp-star';
      var size = Math.random() < 0.85 ? (Math.random() * 1.4 + 0.6)   // most are tiny
                                      : (Math.random() * 1.6 + 2.0);  // a few brighter
      var op = Math.random() * 0.5 + 0.35;
      s.style.left = (Math.random() * 100) + '%';
      s.style.top = (Math.random() * 100) + '%';
      s.style.width = size.toFixed(2) + 'px';
      s.style.height = size.toFixed(2) + 'px';
      s.style.opacity = op.toFixed(2);
      // give the larger ones a faint glow so they read as stars, not specks
      if (size > 2) s.style.boxShadow = '0 0 ' + (size * 1.5).toFixed(1) + 'px rgba(241,239,236,0.7)';
      // let ~a third twinkle, unless reduced motion
      if (!reduce && Math.random() < 0.32) {
        s.classList.add('is-twinkle');
        s.style.setProperty('--o', op.toFixed(2));
        s.style.setProperty('--dur', (Math.random() * 4 + 3).toFixed(1) + 's');
        s.style.setProperty('--delay', (Math.random() * 5).toFixed(1) + 's');
      }
      frag.appendChild(s);
    }
    starBox.appendChild(frag);
  }

  // ---- Interactive "pucker" grid: the spacetime well bends toward the cursor ----
  var heroEl = document.getElementById('top');
  var gridCanvas = document.getElementById('lp-grid');
  var finePtr = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (heroEl && gridCanvas) {
    var gctx = gridCanvas.getContext('2d');
    var gdpr = Math.min(window.devicePixelRatio || 1, 2);
    var GW = 0, GH = 0, SPACING = 46;
    // ambient well (always present, centred, static) + cursor well (follows mouse)
    var amp = { x: -9999, y: -9999, on: 0 };   // cursor influence, eased in/out
    var ptr = { x: -9999, y: -9999 };

    function sizeGrid() {
      var r = heroEl.getBoundingClientRect();
      GW = r.width; GH = r.height;
      gridCanvas.width = GW * gdpr; gridCanvas.height = GH * gdpr;
      gridCanvas.style.width = GW + 'px'; gridCanvas.style.height = GH + 'px';
      gctx.setTransform(gdpr, 0, 0, gdpr, 0, 0);
      // fewer, wider cells on small screens
      SPACING = GW < 640 ? 40 : 52;
    }
    sizeGrid();
    window.addEventListener('resize', function () { sizeGrid(); gridDirty = true; });

    // displacement: pull a point toward a well centre, strongest near it,
    // falling off smoothly with distance (an inverse-square-ish curve).
    function warpPoint(x, y) {
      var dx = x - ambient.x, dy = y - ambient.y;
      var r2 = dx * dx + dy * dy;
      var f = ambient.k / (1 + r2 / ambient.s);   // 0..k
      var nx = x - dx * f, ny = y - dy * f;
      // cursor well, only when active
      if (amp.on > 0.01) {
        var cdx = nx - amp.x, cdy = ny - amp.y;
        var cr2 = cdx * cdx + cdy * cdy;
        var cf = (CURSOR_K * amp.on) / (1 + cr2 / CURSOR_S);
        nx -= cdx * cf; ny -= cdy * cf;
      }
      return [nx, ny];
    }

    var ambient = { x: 0, y: 0, k: 0.32, s: 90000 };
    var CURSOR_K = 0.42, CURSOR_S = 12000;
    var gridInside = false;

    function setPtrFrom(e) {
      var r = heroEl.getBoundingClientRect();
      ptr.x = e.clientX - r.left;
      ptr.y = e.clientY - r.top;
    }

    // Mouse: the well follows the cursor on hover.
    if (finePtr) {
      heroEl.addEventListener('pointermove', function (e) {
        if (e.pointerType === 'touch') return;
        setPtrFrom(e);
        gridInside = true;
      });
      heroEl.addEventListener('pointerleave', function (e) {
        if (e.pointerType === 'touch') return;
        gridInside = false;
      });
    }

    // Touch: there is no hover, so the well bends where the finger presses and
    // eases back to rest when it lifts. Scrolling still works — a scroll fires
    // pointercancel, which releases the bend just like lifting off.
    heroEl.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'touch') return;
      setPtrFrom(e);
      // jump straight to the touch point instead of sliding in from the last one
      amp.x = ptr.x; amp.y = ptr.y;
      gridInside = true;
    }, { passive: true });

    heroEl.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'touch' || !gridInside) return;
      setPtrFrom(e);
    }, { passive: true });

    ['pointerup', 'pointercancel', 'pointerout'].forEach(function (ev) {
      heroEl.addEventListener(ev, function (e) {
        if (e.pointerType !== 'touch') return;
        gridInside = false;
      }, { passive: true });
    });

    var gridDirty = true, lastOn = -1, lastAx = -1, lastAy = -1;
    function drawGrid() {
      ambient.x = GW * 0.5; ambient.y = GH * 0.46;
      // ease the cursor influence in and out
      var goal = gridInside ? 1 : 0;
      amp.on += (goal - amp.on) * 0.12;
      amp.x += (ptr.x - amp.x) * 0.2;
      amp.y += (ptr.y - amp.y) * 0.2;

      // Skip the redraw when nothing about the warp has changed — the canvas
      // keeps its last frame, so an idle grid costs nothing.
      if (Math.abs(amp.on - lastOn) < 0.002 &&
          Math.abs(amp.x - lastAx) < 0.4 &&
          Math.abs(amp.y - lastAy) < 0.4 && !gridDirty) {
        requestAnimationFrame(drawGrid);
        return;
      }
      lastOn = amp.on; lastAx = amp.x; lastAy = amp.y; gridDirty = false;

      gctx.clearRect(0, 0, GW, GH);
      gctx.lineWidth = 1;
      gctx.strokeStyle = 'rgba(241,239,236,0.14)';

      var pad = SPACING * 2;
      var step = Math.max(6, Math.floor(SPACING / 5)); // sampling along each line

      // vertical lines
      for (var x = -pad; x <= GW + pad; x += SPACING) {
        gctx.beginPath();
        var started = false;
        for (var y = -pad; y <= GH + pad; y += step) {
          var p = warpPoint(x, y);
          if (!started) { gctx.moveTo(p[0], p[1]); started = true; }
          else gctx.lineTo(p[0], p[1]);
        }
        gctx.stroke();
      }
      // horizontal lines
      for (var yy = -pad; yy <= GH + pad; yy += SPACING) {
        gctx.beginPath();
        var st2 = false;
        for (var xx = -pad; xx <= GW + pad; xx += step) {
          var q = warpPoint(xx, yy);
          if (!st2) { gctx.moveTo(q[0], q[1]); st2 = true; }
          else gctx.lineTo(q[0], q[1]);
        }
        gctx.stroke();
      }
      requestAnimationFrame(drawGrid);
    }
    requestAnimationFrame(drawGrid);
  }

  // ---- Comet cursor over the hero ----
  var hero = document.getElementById('top');
  var canvas = document.getElementById('lp-comet');
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (hero && canvas && finePointer && !reduce) {
    var ctx = canvas.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = 0, H = 0;
    function sizeCanvas() {
      var r = hero.getBoundingClientRect();
      W = r.width; H = r.height;
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    sizeCanvas();
    window.addEventListener('resize', sizeCanvas);

    var head = { x: -100, y: -100 };   // where the comet is drawn (eased)
    var target = { x: -100, y: -100 }; // actual pointer position
    var inside = false;
    var particles = [];                // the tail
    var lastEmit = 0;
    var overHit = false, hoverScale = 1;
    var lastCometT = 0;
    var TAIL_LIFE = 0.42;              // seconds from emit to fully faded

    // One pre-rendered dot, scaled per particle. Building a radial gradient for
    // every particle on every frame was the comet's whole cost.
    var TSPR = 32;
    var tailSprite = (function () {
      var c = document.createElement('canvas');
      c.width = c.height = TSPR;
      var g = c.getContext('2d');
      var gr = g.createRadialGradient(TSPR/2, TSPR/2, 0, TSPR/2, TSPR/2, TSPR/2);
      gr.addColorStop(0, 'rgba(241,239,236,1)');
      gr.addColorStop(1, 'rgba(241,239,236,0)');
      g.fillStyle = gr; g.fillRect(0, 0, TSPR, TSPR);
      return c;
    })();

    hero.addEventListener('pointermove', function (e) {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      var r = hero.getBoundingClientRect();
      target.x = e.clientX - r.left;
      target.y = e.clientY - r.top;
      if (!inside) { head.x = target.x; head.y = target.y; }
      inside = true;
      // grow the comet over links/buttons so the hover reads even on light fills
      overHit = !!(e.target && e.target.closest && e.target.closest('a, button'));
      hero.classList.add('comet-on');
    });
    hero.addEventListener('pointerleave', function () {
      inside = false;
      hero.classList.remove('comet-on');
    });

    var cometWasIdle = false;
    function frame(now) {
      if (!inside && !particles.length) {
        lastCometT = 0;
        if (!cometWasIdle) { ctx.clearRect(0, 0, W, H); cometWasIdle = true; }
        requestAnimationFrame(frame);
        return;
      }
      cometWasIdle = false;
      var cdt = lastCometT ? Math.min((now - lastCometT) / 1000, 0.05) : 1 / 60;
      lastCometT = now;
      ctx.clearRect(0, 0, W, H);
      if (inside) {
        // ease the head toward the pointer — gives the tail a natural lag
        head.x += (target.x - head.x) * 0.35;
        head.y += (target.y - head.y) * 0.35;

        // emit tail particles along the motion
        if (now - lastEmit > 12) {
          lastEmit = now;
          particles.push({ x: head.x, y: head.y, life: 1, r: Math.random() * 2 + 1.5 });
          if (particles.length > 70) particles.shift();
        }
      }

      // draw tail (oldest first so the head sits on top)
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        p.life -= cdt / TAIL_LIFE;     // per second, not per frame
        if (p.life <= 0) continue;
        var rad = p.r * p.life * 3;
        ctx.globalAlpha = p.life * 0.5;
        ctx.drawImage(tailSprite, p.x - rad, p.y - rad, rad * 2, rad * 2);
      }
      ctx.globalAlpha = 1;
      particles = particles.filter(function (p) { return p.life > 0; });

      // draw the comet head — bright core + soft glow
      if (inside) {
        // ease toward a larger head when over an interactive element
        hoverScale += ((overHit ? 1.9 : 1) - hoverScale) * 0.18;
        var gr = 16 * hoverScale;
        var glow = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, gr);
        glow.addColorStop(0, 'rgba(241,239,236,0.85)');
        glow.addColorStop(0.3, 'rgba(212,201,190,0.4)');
        glow.addColorStop(1, 'rgba(212,201,190,0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(head.x, head.y, gr, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.beginPath();
        ctx.arc(head.x, head.y, 2.4 * hoverScale, 0, Math.PI * 2);
        ctx.fill();

        // a thin ring appears over hit targets — extra confirmation of "clickable"
        if (hoverScale > 1.08) {
          ctx.strokeStyle = 'rgba(241,239,236,' + ((hoverScale - 1) * 0.5).toFixed(3) + ')';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(head.x, head.y, 16 * hoverScale, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // ---- Rare meteors ------------------------------------------------------
  // Occasional small streaks that fade in and out. Deliberately infrequent —
  // one every 8–18s, never more than two at once — so it reads as a happy
  // accident rather than a weather effect.
  var meteorCanvas = document.getElementById('lp-meteors');
  if (heroEl && meteorCanvas && !reduce) {
    var mctx = meteorCanvas.getContext('2d');
    var mdpr = Math.min(window.devicePixelRatio || 1, 2);
    var MW = 0, MH = 0;

    var sizeMeteors = function () {
      var r = heroEl.getBoundingClientRect();
      MW = r.width; MH = r.height;
      meteorCanvas.width = MW * mdpr; meteorCanvas.height = MH * mdpr;
      meteorCanvas.style.width = MW + 'px'; meteorCanvas.style.height = MH + 'px';
      mctx.setTransform(mdpr, 0, 0, mdpr, 0, 0);
    };
    sizeMeteors();
    window.addEventListener('resize', sizeMeteors);

    var meteors = [];
    var nextMeteorAt = performance.now() + 2500 + Math.random() * 4000;

    var spawnMeteor = function () {
      var dir = Math.random() < 0.5 ? 1 : -1;              // travel left or right
      var ang = (0.18 + Math.random() * 0.30) * Math.PI;   // shallow-to-steep dive
      var speed = 1.5 + Math.random() * 1.5;
      meteors.push({
        x: MW * 0.05 + Math.random() * MW * 0.9,
        y: Math.random() * MH * 0.55,
        vx: Math.cos(ang) * dir * speed,
        vy: Math.sin(ang) * speed,
        len: 32 + Math.random() * 55,
        life: 0,
        max: 55 + Math.random() * 45
      });
    };

    var meteorsWereEmpty = false;
    var drawMeteors = function (now) {
      // Nothing on screen and nothing due: leave the canvas alone entirely.
      if (!meteors.length && now < nextMeteorAt) {
        if (!meteorsWereEmpty) { mctx.clearRect(0, 0, MW, MH); meteorsWereEmpty = true; }
        requestAnimationFrame(drawMeteors);
        return;
      }
      meteorsWereEmpty = false;
      mctx.clearRect(0, 0, MW, MH);

      if (now > nextMeteorAt && meteors.length < 2) {
        spawnMeteor();
        nextMeteorAt = now + 8000 + Math.random() * 10000;
      }

      for (var i = meteors.length - 1; i >= 0; i--) {
        var m = meteors[i];
        m.life++;
        m.x += m.vx; m.y += m.vy;

        var t = m.life / m.max;
        if (t >= 1) { meteors.splice(i, 1); continue; }

        // quick fade in, long fade out, and never fully bright
        var a = (t < 0.18 ? t / 0.18 : 1 - (t - 0.18) / 0.82) * 0.5;
        if (a <= 0) continue;

        var sp = Math.sqrt(m.vx * m.vx + m.vy * m.vy) || 1;
        var tailX = m.x - (m.vx / sp) * m.len;
        var tailY = m.y - (m.vy / sp) * m.len;

        var g = mctx.createLinearGradient(m.x, m.y, tailX, tailY);
        g.addColorStop(0, 'rgba(241,239,236,' + a.toFixed(3) + ')');
        g.addColorStop(1, 'rgba(241,239,236,0)');
        mctx.strokeStyle = g;
        mctx.lineWidth = 1.3;
        mctx.lineCap = 'round';
        mctx.beginPath();
        mctx.moveTo(m.x, m.y);
        mctx.lineTo(tailX, tailY);
        mctx.stroke();

        mctx.fillStyle = 'rgba(255,255,255,' + (a * 0.85).toFixed(3) + ')';
        mctx.beginPath();
        mctx.arc(m.x, m.y, 1.25, 0, Math.PI * 2);
        mctx.fill();
      }
      requestAnimationFrame(drawMeteors);
    };
    requestAnimationFrame(drawMeteors);
  }
  // Own scope: the comet above declares its own W, H, frame and step.
  // `var` is function-scoped and function declarations hoist, so without
  // this IIFE the two subsystems overwrite each other — which silently
  // stopped the comet from ever clearing its tail.
  (function () {
    // ---- Two-body orbit, perturbed by the cursor ----------------------------
    // The pair is a real Kepler two-body system: exactly periodic, exactly
    // solvable, and therefore a well-defined "original state" to return to.
    //
    //   Reference  — advanced analytically. Mean anomaly steps linearly, Kepler's
    //                equation is solved by Newton, so the closed orbit never
    //                drifts no matter how long the tab is open.
    //   Actual     — velocity Verlet on the real accelerations. While the cursor
    //                is away this is held onto the reference by a critically
    //                damped spring, so it *is* the two-body solution.
    //
    // Bring the cursor near and it becomes a third mass: it pulls on both bodies,
    // and the spring holding them to the closed orbit is released in proportion.
    // That is the whole point — two bodies have a closed form, three do not, and
    // the figure falls apart in front of you. Take the cursor away and the spring
    // reels them back onto the analytic ellipse.
    //
    // Hot path is allocation-free: flat Float64Arrays and pre-rendered sprites.
    var orbitCanvas = document.getElementById('lp-3body');
    if (orbitCanvas) {
      var octx = orbitCanvas.getContext('2d');

      // --- system constants (G = 1) ---
      var M1 = 1.0, M2 = 0.78, MT = M1 + M2;
      var SEMI = 1.0, ECC = 0.32;              // relative orbit
      var NMEAN = Math.sqrt(MT / (SEMI * SEMI * SEMI));
      var PERIOD = 2 * Math.PI / NMEAN;
      var SECS_PER_ORBIT = 7;                  // wall-clock pace
      var SIMRATE = PERIOD / SECS_PER_ORBIT;
      var SPAN = SEMI * (1 + ECC) * 1.9;       // framing, with room to be pushed

      var CURSOR_M = 4.0;                      // mass of the pointer. It was 0.72 —
                                               // lighter than either body, so it
                                               // barely pulled. Now it dominates.
      var SOFT = 0.060;                        // softening, so nothing goes singular
      var REST_K = 60;                         // stiffness of the return spring
      var RELEASE = 0.90;                      // how much of it the cursor switches off
      var R_NEAR = 0.70, R_FAR = 1.40;         // hitbox: ramps in only within the
                                               // visible orbit area (half-span 1.25)

      // Brand palette: the two bodies are White Tint and Sisal; the intruder is
      // Cosmos Blue lifted until it can actually glow against the deep field.
      var COLORS = [[241, 239, 236], [212, 201, 190], [111, 169, 206]];
      var RGB = COLORS.map(function (c) { return c[0] + ',' + c[1] + ',' + c[2]; });
      var TRAILCAP = 360;

      var SPRITE = 64;
      var SPRITE_R = [19, 16, 15];
      var glowSprites = COLORS.map(function (col, i) {
        var c = document.createElement('canvas');
        c.width = c.height = SPRITE;
        var g = c.getContext('2d');
        var rgb = col[0] + ',' + col[1] + ',' + col[2];
        var grad = g.createRadialGradient(SPRITE / 2, SPRITE / 2, 0, SPRITE / 2, SPRITE / 2, SPRITE / 2);
        grad.addColorStop(0,    'rgba(' + rgb + ',0.85)');
        grad.addColorStop(0.35, 'rgba(' + rgb + ',0.22)');
        grad.addColorStop(1,    'rgba(' + rgb + ',0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, SPRITE, SPRITE);
        g.fillStyle = 'rgba(255,255,255,' + (i === 2 ? 0.85 : 0.95) + ')';
        g.beginPath();
        g.arc(SPRITE / 2, SPRITE / 2, (i === 2 ? 2.1 : 2.6) * SPRITE / 34, 0, 6.28318);
        g.fill();
        return c;
      });

      // --- state ---
      var X = new Float64Array(2), Y = new Float64Array(2);
      var VX = new Float64Array(2), VY = new Float64Array(2);
      var AX_ = new Float64Array(2), AY_ = new Float64Array(2);
      var NAX = new Float64Array(2), NAY = new Float64Array(2);
      var RX = new Float64Array(2), RY = new Float64Array(2);       // reference pos
      var RVX = new Float64Array(2), RVY = new Float64Array(2);     // reference vel

      var TX = [new Float64Array(TRAILCAP), new Float64Array(TRAILCAP)];
      var TY = [new Float64Array(TRAILCAP), new Float64Array(TRAILCAP)];
      var thead = [0, 0], tcount = [0, 0];

      var manom = 0;                       // mean anomaly of the reference orbit
      var W = 0, H = 0, odpr = 1, scale = 1, cw = 0, ch = 0;
      var curX = 0, curY = 0, curOn = false, infl = 0;
      var lastT = 0;

      var nameEl = document.getElementById('lp-orbit-name');
      var subEl  = document.getElementById('lp-orbit-sub');
      var wasPerturbed = false;

      function sizeOrbit() {
        var r = orbitCanvas.getBoundingClientRect();
        if (!r.width) return;
        odpr = Math.min(window.devicePixelRatio || 1, 2);
        W = r.width; H = r.height;
        cw = W * 0.5; ch = H * 0.5;
        orbitCanvas.width = Math.round(W * odpr);
        orbitCanvas.height = Math.round(H * odpr);
        octx.setTransform(odpr, 0, 0, odpr, 0, 0);
        scale = Math.min(W, H) / SPAN;
        // Setting canvas.width wipes the bitmap. The animated path repaints on
        // the next frame; the reduced-motion path draws once and never again,
        // so it has to be repainted here or the figure just disappears.
        if (reduceOrbit && tcount[0] > 2) render();
      }

      // Reference two-body state from the mean anomaly. Kepler's equation by
      // Newton — 4 iterations is plenty at this eccentricity.
      function reference() {
        var m = manom % (2 * Math.PI);
        var E = m + ECC * Math.sin(m);
        for (var it = 0; it < 4; it++) {
          var f = E - ECC * Math.sin(E) - m;
          E -= f / (1 - ECC * Math.cos(E));
        }
        var cosE = Math.cos(E), sinE = Math.sin(E);
        var b = Math.sqrt(1 - ECC * ECC);
        var dx = SEMI * (cosE - ECC), dy = SEMI * b * sinE;
        var Edot = NMEAN / (1 - ECC * cosE);
        var dvx = -SEMI * sinE * Edot, dvy = SEMI * b * cosE * Edot;

        var f1 = -M2 / MT, f2 = M1 / MT;      // split about the barycentre
        RX[0] = f1 * dx; RY[0] = f1 * dy; RVX[0] = f1 * dvx; RVY[0] = f1 * dvy;
        RX[1] = f2 * dx; RY[1] = f2 * dy; RVX[1] = f2 * dvx; RVY[1] = f2 * dvy;
      }

      function seed() {
        reference();
        for (var i = 0; i < 2; i++) {
          X[i] = RX[i]; Y[i] = RY[i]; VX[i] = RVX[i]; VY[i] = RVY[i];
        }
        thead = [0, 0]; tcount = [0, 0];
      }

      // Accelerations: mutual gravity, the cursor's pull, and the spring that
      // holds the pair on the analytic orbit when the cursor isn't interfering.
      function accel(px, py, vx, vy, oax, oay) {
        var dx = px[1] - px[0], dy = py[1] - py[0];
        var r2 = dx * dx + dy * dy + SOFT;
        var inv = 1 / (r2 * Math.sqrt(r2));
        oax[0] =  M2 * dx * inv; oay[0] =  M2 * dy * inv;
        oax[1] = -M1 * dx * inv; oay[1] = -M1 * dy * inv;

        if (infl > 0.001) {
          var cm = CURSOR_M * infl;
          for (var i = 0; i < 2; i++) {
            var ex = curX - px[i], ey = curY - py[i];
            var e2 = ex * ex + ey * ey + SOFT;
            var einv = cm / (e2 * Math.sqrt(e2));
            oax[i] += ex * einv; oay[i] += ey * einv;
          }
        }

        // critically damped return to the (moving) reference state
        var k = REST_K * (1 - RELEASE * infl);
        var c = 2 * Math.sqrt(k);
        for (var j = 0; j < 2; j++) {
          oax[j] += k * (RX[j] - px[j]) + c * (RVX[j] - vx[j]);
          oay[j] += k * (RY[j] - py[j]) + c * (RVY[j] - vy[j]);
        }
      }

      function step(dt) {
        accel(X, Y, VX, VY, AX_, AY_);
        for (var i = 0; i < 2; i++) {
          X[i] += VX[i] * dt + 0.5 * AX_[i] * dt * dt;
          Y[i] += VY[i] * dt + 0.5 * AY_[i] * dt * dt;
        }
        manom += NMEAN * dt;
        reference();
        accel(X, Y, VX, VY, NAX, NAY);
        for (var j = 0; j < 2; j++) {
          VX[j] += 0.5 * (AX_[j] + NAX[j]) * dt;
          VY[j] += 0.5 * (AY_[j] + NAY[j]) * dt;
        }
      }

      function pushTrail(i, x, y) {
        TX[i][thead[i]] = x; TY[i][thead[i]] = y;
        thead[i] = (thead[i] + 1) % TRAILCAP;
        if (tcount[i] < TRAILCAP) tcount[i]++;
      }

      // Chunked so the tail can fade along its length: each chunk is one stroke at
      // its own alpha. Chunk counts and the point stride are kept deliberately low
      // — this runs every frame forever, and the trail is a smooth curve, so
      // drawing every stored point buys nothing visible.
      function drawTrail(bi, alphaMul) {
        var n = tcount[bi];
        if (n < 6) return;
        var xs = TX[bi], ys = TY[bi], h = thead[bi], rgb = RGB[bi];
        octx.lineCap = 'round'; octx.lineJoin = 'round';
        for (var pass = 0; pass < 2; pass++) {
          var chunks = pass ? 7 : 2;
          var wMul = pass ? 1.5 : 7, wAdd = pass ? 0.4 : 1.8;
          var aMul = pass ? 0.92 : 0.11;
          var stride = pass ? 2 : 3;
          for (var c = 0; c < chunks; c++) {
            var s0 = Math.floor(n * c / chunks), s1 = Math.floor(n * (c + 1) / chunks);
            if (s1 - s0 < 2) continue;
            var f = (c + 1) / chunks;
            octx.beginPath();
            var first = true;
            for (var k = s0; k <= s1 && k < n; k += stride) {
              var r = (h - n + k + TRAILCAP * 2) % TRAILCAP;
              var px = cw + xs[r] * scale, py = ch + ys[r] * scale;
              if (first) { octx.moveTo(px, py); first = false; } else octx.lineTo(px, py);
            }
            // always finish on the true endpoint so chunks join without gaps
            var re = (h - n + Math.min(s1, n - 1) + TRAILCAP * 2) % TRAILCAP;
            octx.lineTo(cw + xs[re] * scale, ch + ys[re] * scale);
            octx.strokeStyle = 'rgba(' + rgb + ',' + (aMul * f * alphaMul).toFixed(3) + ')';
            octx.lineWidth = wMul * f + wAdd;
            octx.stroke();
          }
        }
      }

      function drawBody(bi, x, y, sc) {
        var px = cw + x * scale, py = ch + y * scale;
        var r = SPRITE_R[bi] * sc;
        octx.drawImage(glowSprites[bi], px - r, py - r, r * 2, r * 2);
      }

      function render() {
        octx.clearRect(0, 0, W, H);
        octx.globalCompositeOperation = 'lighter';
        // The cursor is already drawn — it's the comet, on its own canvas above
        // this one. Drawing a second body here just doubled it and smeared a
        // hero-wide trail across the frame. The pointer's *gravity* still acts;
        // only its rendering belongs to the comet.
        drawTrail(0, 1); drawTrail(1, 1);
        drawBody(0, X[0], Y[0], 1.06);
        drawBody(1, X[1], Y[1], 0.94);
        octx.globalCompositeOperation = 'source-over';
      }

      function setCaption(p) {
        if (p === wasPerturbed) return;
        wasPerturbed = p;
        if (nameEl) nameEl.textContent = p ? 'Three-body problem' : 'Two-body orbit';
        if (subEl)  subEl.textContent  = p ? 'chaotic — no closed-form solution'
                                           : 'closed, periodic, exactly solvable';
      }

      var reduceOrbit = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      // Pointer → third mass. Distance does the gating, so the perturbation eases
      // in as you approach from anywhere in the hero; no enter/leave needed.
      // Read the box fresh each time. It was cached and only refreshed on scroll
      // and resize, so any other reflow — a late web font, an image landing, a
      // revealed section — left the mapping stale and the cursor's gravity
      // acting somewhere it wasn't. One getBoundingClientRect per pointermove is
      // cheap; being wrong is not.
      function pointerTo(clientX, clientY) {
        if (!scale) return;
        var r = orbitCanvas.getBoundingClientRect();
        curX = (clientX - r.left - cw) / scale;
        curY = (clientY - r.top - ch) / scale;
        curOn = true;
      }
      if (!reduceOrbit) {
        var heroForOrbit = document.getElementById('top');
        if (heroForOrbit) {
          heroForOrbit.addEventListener('pointermove', function (e) {
            if (e.pointerType === 'touch') return;
            pointerTo(e.clientX, e.clientY);
          }, { passive: true });
          heroForOrbit.addEventListener('pointerleave', function (e) {
            if (e.pointerType === 'touch') return;
            curOn = false;
          }, { passive: true });

          // touch: press and drag to play the third body
          heroForOrbit.addEventListener('pointerdown', function (e) {
            if (e.pointerType !== 'touch') return;
            pointerTo(e.clientX, e.clientY);
          }, { passive: true });
          heroForOrbit.addEventListener('pointermove', function (e) {
            if (e.pointerType !== 'touch' || !curOn) return;
            pointerTo(e.clientX, e.clientY);
          }, { passive: true });
          ['pointerup', 'pointercancel'].forEach(function (ev) {
            heroForOrbit.addEventListener(ev, function (e) {
              if (e.pointerType !== 'touch') return;
              curOn = false;
            }, { passive: true });
          });
        }
      }

      function frame(now) {
        if (!W) { sizeOrbit(); requestAnimationFrame(frame); return; }

        var dtReal = lastT ? Math.min((now - lastT) / 1000, 0.05) : 1 / 60;
        lastT = now;

        // ease the cursor's influence by its distance to the pair
        var target = 0;
        if (curOn) {
          var d = Math.sqrt(curX * curX + curY * curY);
          target = d <= R_NEAR ? 1 : d >= R_FAR ? 0 : (R_FAR - d) / (R_FAR - R_NEAR);
          target = target * target * (3 - 2 * target);      // smoothstep
        }
        // Matched to the pucker grid's easing, which is what makes that effect
        // feel immediate. The old fade-out of 0.045 was under half the grid's
        // rate and was most of why this read as sluggish.
        infl += (target - infl) * (target > infl ? 0.22 : 0.14);
        if (infl < 0.0005) infl = 0;

        var simDt = dtReal * SIMRATE, SUB = 16, h = simDt / SUB;
        for (var s = 0; s < SUB; s++) step(h);

        // safety: a hard perturbation can still throw a body wide — if it leaves
        // the frame entirely, put the system back rather than lose it.
        if (!isFinite(X[0]) || !isFinite(X[1]) ||
            Math.abs(X[0]) > 9 || Math.abs(Y[0]) > 9 ||
            Math.abs(X[1]) > 9 || Math.abs(Y[1]) > 9) seed();

        pushTrail(0, X[0], Y[0]);
        pushTrail(1, X[1], Y[1]);

        setCaption(infl > 0.16);
        render();
        requestAnimationFrame(frame);
      }

      sizeOrbit();
      seed();
      sizeOrbit();
      window.addEventListener('resize', sizeOrbit);
    // The canvas can change size without the window doing so — fonts arriving,
    // the grid reflowing. Watch the element itself rather than guessing.
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () { sizeOrbit(); });
      ro.observe(orbitCanvas);
    }

      if (reduceOrbit) {
        // No motion: trace one full closed orbit and leave the figure standing.
        var hh = PERIOD / TRAILCAP;
        for (var t = 0; t < TRAILCAP; t++) {
          step(hh); pushTrail(0, X[0], Y[0]); pushTrail(1, X[1], Y[1]);
        }
        render();
      } else {
        requestAnimationFrame(frame);
      }
    }
  })();

})();
