/* ==========================================================================
   COURSE COVERS
   Every course has a picture. A course team that uploads one in the Course
   Builder gets theirs, served from /api/lms/courses/:id/cover/ under a
   versioned URL. Every other course is drawn one here, so a catalog never
   shows a grey box or a stock photo nobody chose.

   The drawing follows the brand guideline rather than inventing a style:
   the deep-space gradient (Royal Black into Cosmos Blue), a well of light
   where the grid bends, the Spacetime Well texture at low opacity, a few
   Sisal contour rings for the one warm note, a sparse starfield, and the
   faceted G monogram as the watermark in the top corner. Nothing outside
   the four brand colours and the Cosmos tints the guideline derives.

   It is seeded from the course id and title, so a course keeps the same
   cover on every screen and every visit, and two courses rarely share one.
   The SVG is built as a string of numbers only — no course text is ever
   put inside it — and handed to an <img> as a data URI, so it renders like
   an uploaded cover and cannot carry markup into the page.
   ========================================================================== */

const W = 1600;
const H = 900;
const cache = new Map();

/* The supplied monogram, unaltered: assets/logos in the brand kit. */
const MONOGRAM = 'M491.17,433.95l-57.19,57.26c-57.04-33.03-122.2-50.49-188.39-50.49s-131.47,17.46-188.35,50.46L0,433.95c33-56.87,50.46-122,50.46-188.35S33,114.13,0,57.26L57.19,0c57.07,33.03,122.2,50.46,188.39,50.46S377.08,33.03,433.95.02l42.04,72.41c-69.65,40.41-149.3,61.78-230.41,61.78-44.2,0-88.05-6.39-130.09-18.75,12.34,42.01,18.72,85.87,18.72,130.14s-6.36,88.08-18.72,130.09c42.01-12.36,85.84-18.7,130.09-18.7s88.05,6.36,130.11,18.75c-8.45-28.73-14.08-58.31-16.83-88.27h-113.28v-83.76h195.15v41.89c0,66.34,17.44,131.47,50.44,188.35Z';

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function random(seed) {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (value) => Math.round(value * 10) / 10;

/* A point pulled toward the well. The pull falls off with the square of
   the distance, which is what makes the grid read as a dent, not a lens. */
function bend(x, y, fx, fy, strength, reach) {
  const dx = fx - x;
  const dy = (fy - y) * 1.6;
  const d2 = dx * dx + dy * dy;
  const d = Math.sqrt(d2) || 1;
  // Never past 70% of the way in: a point that overshot the centre would
  // pile the lines into a white blob instead of a dent.
  const pull = Math.min(strength * (reach * reach) / (d2 + reach * reach), d * 0.7);
  return [x + (dx / d) * pull, y + ((fy - y) / d) * pull];
}

function gridLines(fx, fy, strength, reach, gap) {
  const lines = [];
  for (let x = -gap; x <= W + gap; x += gap) {
    const pts = [];
    for (let y = -40; y <= H + 40; y += 18) pts.push(bend(x, y, fx, fy, strength, reach));
    lines.push(pts);
  }
  for (let y = -gap / 2; y <= H + gap; y += gap * 0.62) {
    const pts = [];
    for (let x = -40; x <= W + 40; x += 18) pts.push(bend(x, y, fx, fy, strength, reach));
    lines.push(pts);
  }
  return lines.map((pts) => `<polyline points="${pts.map(([x, y]) => `${r1(x)},${r1(y)}`).join(' ')}"/>`).join('');
}

export function generatedCoverSvg(seedText) {
  const rand = random(hash(String(seedText || 'gravitas')));
  const fx = W * (0.3 + rand() * 0.45);
  const fy = H * (0.36 + rand() * 0.3);
  const strength = 150 + rand() * 120;
  const reach = 210 + rand() * 170;
  const gap = 52 + Math.round(rand() * 4) * 8;
  const tilt = r1(-14 + rand() * 28);
  const squash = 0.3 + rand() * 0.22;
  const glow = r1(0.2 + rand() * 0.12);

  const stars = [];
  for (let i = 0; i < 90; i += 1) {
    const x = r1(rand() * W);
    const y = r1(rand() * H);
    const r = r1(0.5 + rand() * rand() * 2.2);
    const o = r1(0.15 + rand() * 0.6);
    stars.push(`<circle cx="${x}" cy="${y}" r="${r}" opacity="${o}"/>`);
  }

  const rings = [];
  let rx = 90 + rand() * 40;
  for (let i = 0; i < 6; i += 1) {
    rings.push(`<ellipse cx="${r1(fx)}" cy="${r1(fy)}" rx="${r1(rx)}" ry="${r1(rx * squash)}" opacity="${r1(0.55 - i * 0.08)}"/>`);
    rx *= 1.42;
  }

  const mono = 66;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">`
    + '<defs>'
    + `<radialGradient id="s" cx="${r1(fx / W * 100)}%" cy="${r1(fy / H * 100)}%" r="85%">`
    + '<stop offset="0" stop-color="#0b4a6b"/><stop offset=".3" stop-color="#003049"/>'
    + '<stop offset=".68" stop-color="#011f30"/><stop offset="1" stop-color="#030303"/></radialGradient>'
    + `<radialGradient id="g" cx="${r1(fx / W * 100)}%" cy="${r1(fy / H * 100)}%" r="30%">`
    + '<stop offset="0" stop-color="#f1efec" stop-opacity="${glow}"/><stop offset=".35" stop-color="#f1efec" stop-opacity=".09"/>'
    + '<stop offset="1" stop-color="#f1efec" stop-opacity="0"/></radialGradient>'
    + '</defs>'
    + `<rect width="${W}" height="${H}" fill="url(#s)"/>`
    + `<g fill="#f1efec">${stars.join('')}</g>`
    + `<g transform="rotate(${tilt} ${r1(fx)} ${r1(fy)})" fill="none" stroke="#f1efec" stroke-width="1.3" stroke-opacity=".2">${gridLines(fx, fy, strength, reach, gap)}</g>`
    + `<g fill="none" stroke="#d4c9be" stroke-width="1.6" transform="rotate(${tilt} ${r1(fx)} ${r1(fy)})">${rings.join('')}</g>`
    + `<rect width="${W}" height="${H}" fill="url(#g)"/>`
    + `<g transform="translate(${W - mono - 64} 56) scale(${r1(mono / 491.2 * 100) / 100})" fill="#f1efec" opacity=".72"><path d="${MONOGRAM}"/></g>`
    + '</svg>';
}

export function generatedCoverUrl(course) {
  const key = `${course?.id ?? ''}:${course?.title ?? ''}`;
  if (!cache.has(key)) cache.set(key, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(generatedCoverSvg(key))}`);
  return cache.get(key);
}

/* The cover as an <img>: the uploaded one when the course has it, the
   generated one otherwise, and the generated one again if the upload
   fails to load, so a broken image is never what the reader sees. */
export function courseCover(course, className = 'flc-cover', { eager = false } = {}) {
  const img = document.createElement('img');
  img.className = className;
  img.alt = '';
  img.decoding = 'async';
  // The hero cover is the first thing on the course page; lazy-loading it
  // only delays the page's largest picture. Catalog cards stay lazy.
  img.loading = eager ? 'eager' : 'lazy';
  if (eager) img.fetchPriority = 'high';
  const fallback = generatedCoverUrl(course);
  if (course?.cover_url) {
    img.src = course.cover_url;
    img.addEventListener('error', () => {
      img.src = fallback;
      img.dataset.generated = 'true';
    }, { once: true });
  } else {
    img.src = fallback;
    img.dataset.generated = 'true';
  }
  return img;
}
