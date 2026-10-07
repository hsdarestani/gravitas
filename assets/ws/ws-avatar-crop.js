/* ==========================================================================
   GRAVITAS+ WORKSPACE  ·  AVATAR CROPPER
   The dialog that stands between "choose a picture" and the PATCH that
   saves one.

   Before this existed the picker did a centre crop and sent the result.
   That is the right guess often enough to be worth keeping as the starting
   position — it is exactly where this dialog opens — but it is only a
   guess, and it was wrong in the two cases people actually hit: a group
   photo, where the face is nowhere near the middle, and a phone portrait,
   where the centre of a 3:4 frame is a chest rather than a head. There was
   no recourse. The only way to move the crop was to open an image editor,
   crop a square there, and come back.

   So the picture is framed here now, and the framing obeys the rules the
   rest of the workspace obeys:

   NOTHING LEAVES UNTIL IT IS CONFIRMED.  The file is read into an object
   URL and never sent on its own. Cancel discards it; only "Use picture"
   produces a data URI for the caller to save.

   WHAT YOU SEE IS WHAT IS STORED.  The preview and the 256px export run
   the same transform through the same drawImage call, differing only in
   the square they are given. There is no second interpretation of the
   numbers on save, which is the usual way a cropper ends up shipping a
   frame nobody chose.

   THE FRAME CANNOT BREAK.  Zoom is held at or above the scale that covers
   the square and the offsets are clamped to the image on every change, so
   there is no transparent wedge to produce and no empty corner to explain.

   Rotation is applied by re-drawing the source into an upright canvas
   rather than by carrying an angle through the transform. A quarter turn
   is the only rotation offered, it is what a sideways phone photo needs,
   and paying one canvas redraw for it keeps the pan and zoom maths free of
   a rotation term they would otherwise carry forever.

   The export is still WebP at 256px, and still re-encoded rather than
   passed through: that is what drops the EXIF block, which on a phone
   photo carries the GPS coordinates of wherever it was taken. Nobody
   uploading a headshot intends to publish their home address.
   ========================================================================== */

import { el } from './ws-views.js';

const OUT_PX = 256;          // what is stored, and what every avatar slot wants
const QUALITY = 0.86;
const MAX_ZOOM = 6;
const STAGE_PX = 288;        // the preview square, in CSS pixels

/* The file, as something canvas can draw. An object URL rather than a data
   URI: a twelve-megapixel JPEG base64-encodes to a string several megabytes
   long, and nothing here needs that string — only the pixels. */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (!img.naturalWidth || !img.naturalHeight) reject(new Error('not_an_image'));
      else resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('not_an_image'));
    };
    img.src = url;
  });
}

/* A quarter turn, baked into a new source. `turns` is signed and taken
   modulo four, so the caller can just keep adding. */
function turn(source, turns) {
  const step = ((turns % 4) + 4) % 4;
  if (!step) return source;
  const w = source.width || source.naturalWidth;
  const h = source.height || source.naturalHeight;
  const swap = step % 2 === 1;
  const canvas = document.createElement('canvas');
  canvas.width = swap ? h : w;
  canvas.height = swap ? w : h;
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((step * Math.PI) / 2);
  ctx.drawImage(source, -w / 2, -h / 2, w, h);
  return canvas;
}

/* Geometry is kept in square units: the crop square is 1 wide, and the
   image is placed inside it. Zoom 1 is the scale at which the image's
   shorter side exactly fills the square, so the shorter side always
   measures `zoom` and the longer one measures more. Offsets are the
   image's top-left corner in the same units, and are therefore never
   positive and never further out than the image's own size allows.

   Holding it this way is what lets one set of numbers drive both a 288px
   preview and a 256px export: each multiplies by its own square. */
function sizeOf(source, zoom) {
  const w = source.width || source.naturalWidth;
  const h = source.height || source.naturalHeight;
  const short = Math.min(w, h);
  return { w: (w / short) * zoom, h: (h / short) * zoom };
}

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/* Resolves to a 256px square data URI, or to null if the dialog was
   dismissed. Rejects only when the file is not an image at all — the
   caller shows that as a message next to the picker. */
export function cropAvatar(file) {
  return loadImage(file).then((image) => new Promise((resolve) => {
    let source = image;
    let turns = 0;
    let zoom = 1;
    let nx = 0;
    let ny = 0;

    const overlay = el('div', 'v-crop');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Frame your picture');

    const box = el('div', 'v-crop__box');
    const head = el('header', 'v-crop__head');
    head.append(el('h2', 'v-crop__title', 'Frame your picture'));
    head.append(el('p', 'v-crop__hint', 'Drag to move, scroll or use the slider to zoom. The circle is what other people will see.'));

    const stage = el('div', 'v-crop__stage');
    stage.tabIndex = 0;
    stage.setAttribute('aria-label', 'Crop area. Drag, or use the arrow keys to move the picture.');
    const canvas = el('canvas', 'v-crop__canvas');
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(STAGE_PX * ratio);
    canvas.height = Math.round(STAGE_PX * ratio);
    stage.append(canvas, el('div', 'v-crop__mask'));

    /* One draw for both squares. `side` is the side of the square being
       drawn into, in that canvas's own pixels; everything else is the
       shared state above. */
    const paint = (target, side) => {
      const ctx = target.getContext('2d');
      const { w, h } = sizeOf(source, zoom);
      ctx.clearRect(0, 0, side, side);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(source, nx * side, ny * side, w * side, h * side);
    };

    const settle = () => {
      const { w, h } = sizeOf(source, zoom);
      nx = clamp(nx, 1 - w, 0);
      ny = clamp(ny, 1 - h, 0);
      paint(canvas, canvas.width);
    };

    const centre = () => {
      const { w, h } = sizeOf(source, zoom);
      nx = (1 - w) / 2;
      ny = (1 - h) / 2;
    };

    /* Zoom about a point, so that whatever is under the cursor — or the
       middle of the frame, for the slider — stays where it is. Zooming
       about the origin instead is the version that feels like the picture
       is running away from the pointer. */
    const zoomTo = (next, px = 0.5, py = 0.5) => {
      const before = sizeOf(source, zoom);
      const fx = (px - nx) / before.w;
      const fy = (py - ny) / before.h;
      zoom = clamp(next, 1, MAX_ZOOM);
      const after = sizeOf(source, zoom);
      nx = px - fx * after.w;
      ny = py - fy * after.h;
      slider.value = String(Math.round(zoom * 100));
      settle();
    };

    /* Pointer panning. Pointer events rather than mouse events because the
       same three handlers then cover a trackpad, a touchscreen and a pen,
       and pointer capture keeps the drag alive when the cursor leaves the
       288px square — which it does constantly, since dragging to the edge
       is how you reach the edge of a picture. */
    let drag = null;
    stage.addEventListener('pointerdown', (event) => {
      if (event.button != null && event.button !== 0) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      stage.setPointerCapture(event.pointerId);
      stage.dataset.dragging = 'true';
      event.preventDefault();
    });
    stage.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      nx += (event.clientX - drag.x) / STAGE_PX;
      ny += (event.clientY - drag.y) / STAGE_PX;
      drag.x = event.clientX;
      drag.y = event.clientY;
      settle();
    });
    const endDrag = (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      drag = null;
      delete stage.dataset.dragging;
    };
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);

    stage.addEventListener('wheel', (event) => {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      zoomTo(
        zoom * Math.exp(-event.deltaY * 0.0015),
        (event.clientX - rect.left) / rect.width,
        (event.clientY - rect.top) / rect.height,
      );
    }, { passive: false });

    const NUDGE = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    stage.addEventListener('keydown', (event) => {
      const move = NUDGE[event.key];
      if (!move) return;
      event.preventDefault();
      const step = event.shiftKey ? 0.05 : 0.01;
      nx += move[0] * step;
      ny += move[1] * step;
      settle();
    });

    const tools = el('div', 'v-crop__tools');

    const slider = el('input', 'v-crop__zoom');
    slider.type = 'range';
    slider.min = '100';
    slider.max = String(MAX_ZOOM * 100);
    slider.step = '1';
    slider.value = '100';
    slider.setAttribute('aria-label', 'Zoom');
    slider.addEventListener('input', () => zoomTo(Number(slider.value) / 100));

    /* Worded, not drawn. The icon set has no rotate and no reset mark, and
       three buttons all falling back to the same default glyph is worse
       than three short words. */
    const tool = (label, onClick) => {
      const btn = el('button', 'ws-btn v-crop__tool', label);
      btn.type = 'button';
      btn.addEventListener('click', onClick);
      return btn;
    };

    /* A rotation re-centres rather than trying to carry the old offsets
       through the turn. Where the old frame lands after a quarter turn is
       not a place anybody asked for, and the centre at least is a position
       with a reason behind it. */
    const rotate = (by) => {
      turns += by;
      source = turn(image, turns);
      centre();
      settle();
    };

    const reset = () => {
      turns = 0;
      source = image;
      zoom = 1;
      slider.value = '100';
      centre();
      settle();
    };

    tools.append(
      tool('Rotate left', () => rotate(-1)),
      tool('Rotate right', () => rotate(1)),
      slider,
      tool('Reset', reset),
    );

    const foot = el('footer', 'v-crop__foot');
    const cancel = el('button', 'ws-btn', 'Cancel');
    cancel.type = 'button';
    const confirm = el('button', 'ws-btn ws-btn--solid', 'Use picture');
    confirm.type = 'button';
    foot.append(cancel, confirm);

    box.append(head, stage, tools, foot);
    overlay.append(box);

    const previous = document.activeElement;
    const close = (value) => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      if (previous?.focus) previous.focus();
      resolve(value);
    };

    /* Captured, so Escape closes this dialog rather than reaching the
       shell's own Escape handling and closing something behind it. */
    function onKey(event) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close(null);
      }
    }

    cancel.addEventListener('click', () => close(null));
    overlay.addEventListener('pointerdown', (event) => {
      if (event.target === overlay) close(null);
    });
    document.addEventListener('keydown', onKey, true);

    confirm.addEventListener('click', () => {
      const out = document.createElement('canvas');
      out.width = OUT_PX;
      out.height = OUT_PX;
      paint(out, OUT_PX);
      close(out.toDataURL('image/webp', QUALITY));
    });

    document.body.append(overlay);
    centre();
    settle();
    window.requestAnimationFrame(() => stage.focus());
  }));
}
