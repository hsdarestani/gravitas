/* ==========================================================================
   AVATAR SAVE PROBE  ·  paste into the browser console on /workspace.html
   while signed in as the account that cannot save a picture.

   Why this exists. Saving a profile picture returns 502. Saving the profile
   text fields returns 200 — same account, same session, same route, same
   verb. A 502 is nginx saying the upstream gave it nothing usable, so the
   failure is below Django's view code and no amount of reading the view
   will find it. The one thing that visibly differs between the request that
   works and the request that does not is how many bytes the body carries.

   So this walks the body size up and reports where it stops working. That
   turns a guess into a number: a threshold between two sizes points at a
   buffer or a limit in the serving chain, a failure at every size including
   the smallest points at the `avatar` field itself rather than at size, and
   no failure at all points at something intermittent, which is a different
   investigation.

   Each probe sends a real, valid PNG of random noise. Random rather than
   flat colour on purpose: PNG compresses a flat square to almost nothing,
   which would make every probe the same tiny size and the whole exercise
   pointless.

   THIS WRITES. It PATCHes the profile picture several times and puts the
   original back at the end, reporting whether that restore succeeded. Run
   it on your own account.
   ========================================================================== */

(async () => {
  const API = '/api';
  const ROUTE = '/platform/researchers/me/';

  const cookie = (name) => {
    const hit = document.cookie.split('; ').find((row) => row.startsWith(name + '='));
    return hit ? decodeURIComponent(hit.slice(name.length + 1)) : '';
  };

  const csrf = async () => {
    let token = cookie('csrftoken') || cookie('gravitas_staging_csrftoken');
    if (token) return token;
    await fetch(API + '/auth/csrf/', { credentials: 'same-origin', cache: 'no-store' });
    token = cookie('csrftoken') || cookie('gravitas_staging_csrftoken');
    if (!token) throw new Error('no CSRF cookie — sign in again before running this');
    return token;
  };

  /* The same fetch the workspace makes, reporting what came back rather
     than throwing. A 502 has no JSON body, so the text is kept short and
     only as a hint of who answered (nginx, a gateway, or Django). */
  const patch = async (body) => {
    const res = await fetch(API + ROUTE, {
      method: 'PATCH',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-CSRFToken': await csrf(),
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* 502 pages are HTML */ }
    return {
      status: res.status,
      error: json?.error || null,
      hint: json ? null : text.replace(/\s+/g, ' ').trim().slice(0, 80),
    };
  };

  const noisePng = (side) => {
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(side, side);
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = Math.random() * 256;
      image.data[i + 1] = Math.random() * 256;
      image.data[i + 2] = Math.random() * 256;
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png');
  };

  const kb = (text) => Math.round(new Blob([text]).size / 102.4) / 10;

  console.log('Reading the profile as it stands…');
  const before = await fetch(API + ROUTE, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  }).then((r) => r.json());
  const original = before?.profile?.avatar || '';
  console.log('GET', ROUTE, '→ ok. Current picture:', original ? kb(original) + ' KB' : 'none');

  /* The control. If this fails too, the run says nothing about size and the
     problem moved while we were looking at it. */
  const control = await patch({ headline: before?.profile?.headline || '' });
  console.log('control · text-only PATCH →', control.status, control.error || control.hint || '');

  const rows = [];
  for (const side of [8, 32, 64, 96, 128, 160, 192, 224, 256]) {
    const uri = noisePng(side);
    const size = kb(uri);
    const result = await patch({ avatar: uri });
    rows.push({
      'image': side + '×' + side,
      'body KB': size,
      'status': result.status,
      'error': result.error || result.hint || '',
    });
    console.log(String(side).padStart(3) + 'px ·', String(size).padStart(6), 'KB →', result.status, result.error || result.hint || '');
    if (result.status === 502) break;   // the threshold is found; stop hammering it
  }

  console.table(rows);

  const restore = await patch({ avatar: original });
  console.log('restore · put the original picture back →', restore.status, restore.error || restore.hint || '');
  if (restore.status !== 200) {
    console.warn('The original picture was NOT restored. It was:', original ? original.slice(0, 64) + '…' : '(none)');
  }
})();
