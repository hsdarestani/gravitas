/* ==========================================================================
   GRAVITAS+ WORKSPACE  ·  SETTINGS
   Profile picture, profile fields, password, and the preferences that live
   in this browser.

   Two things here touch the account rather than the interface, and both are
   treated as such. The password form asks for the current one, because being
   signed in on a borrowed machine should not be enough to lock the owner
   out. The picture is resized in the browser before it is sent, so what
   leaves is a 256px square rather than whatever came off a phone camera.
   ========================================================================== */

import * as P from './ws-platform.js';
import { el, panel, empty, skeleton, failure } from './ws-views.js';
import { WEATHER_PLACES, weatherPlace, weatherEnabled } from './ws-home.js';
import { cropAvatar } from './ws-avatar-crop.js';

const icon = (name) => window.GravitasIcons.icon(name, 'g-wi');

/* A field: label above the control, helper under it, error under that.
   Placeholder-as-label is never used, here or anywhere in the workspace. */
function field({ label, type = 'text', value = '', help, autocomplete }) {
  const wrap = el('div', 'v-field');
  const id = 'f-' + Math.random().toString(36).slice(2, 8);

  const tag = el('label', 'v-field__label', label);
  tag.htmlFor = id;

  const input = el(type === 'textarea' ? 'textarea' : 'input', 'v-input v-field__input');
  input.id = id;
  if (type !== 'textarea') input.type = type;
  if (autocomplete) input.autocomplete = autocomplete;
  input.value = value || '';
  if (type === 'textarea') input.rows = 3;

  wrap.append(tag, input);
  if (help) wrap.append(el('p', 'v-field__help', help));

  const error = el('p', 'v-field__error');
  error.hidden = true;
  wrap.append(error);

  wrap.input = input;
  wrap.setError = (text) => {
    error.textContent = text || '';
    error.hidden = !text;
    input.setAttribute('aria-invalid', text ? 'true' : 'false');
  };
  return wrap;
}

function note(text, tone) {
  const line = el('p', 'v-note', text);
  if (tone) line.dataset.tone = tone;
  return line;
}

/* ==========================================================================
   AVATAR
   ========================================================================== */

/* The picture is framed, resized and re-encoded in the browser before it is
   sent; ws-avatar-crop.js owns that and explains why at length. What matters
   here is that this panel never sends the file it was handed — it sends a
   256px square the account holder confirmed, and sends nothing at all if
   they dismissed the dialog. */

function avatarPanel(profile, onSaved) {
  const box = panel('Profile picture');
  const body = el('div', 'v-avatar-edit');

  const preview = el('div', 'v-avatar-lg');
  const paint = (uri) => {
    preview.innerHTML = '';
    if (uri) {
      const img = el('img');
      img.src = uri;
      img.alt = '';
      preview.append(img);
    } else {
      const who = P.platform.user;
      const initial = ((who?.name || who?.email || 'G').trim()[0] || 'G').toUpperCase();
      preview.append(el('span', null, initial));
    }
  };
  paint(profile.avatar);

  const controls = el('div', 'v-avatar-edit__controls');

  const picker = el('input');
  picker.type = 'file';
  picker.accept = 'image/png,image/jpeg,image/webp,image/gif';
  picker.hidden = true;

  const choose = el('button', 'ws-btn ws-btn--solid', profile.avatar ? 'Change picture' : 'Choose a picture');
  choose.type = 'button';
  choose.addEventListener('click', () => picker.click());

  const clear = el('button', 'ws-btn', 'Remove');
  clear.type = 'button';
  clear.hidden = !profile.avatar;

  const status = note('PNG, JPEG, WebP or GIF. You frame it here, and it is resized to a 256 pixel square before it is sent.');

  const save = async (uri) => {
    status.textContent = 'Saving…';
    status.dataset.tone = '';

    let data;
    try {
      data = await P.call('/platform/researchers/me/', { method: 'PATCH', body: { avatar: uri } });
    } catch (err) {
      /* Named when the server named a reason, and carrying the bare code
         when it did not. "The picture was not saved" on its own was a dead
         end for anybody trying to report the problem: a 403 from the layer
         guard, a CSRF rejection and a 500 all read identically. The code is
         ugly in the interface and it is the only thing that tells the two
         apart, so it goes in — after the sentence, in brackets. */
      console.error('avatar save failed', err);
      const known = MESSAGES[err.message];
      const code = err.status ? `HTTP ${err.status}` : err.message;
      status.textContent = known || `The picture was not saved (${code}).`;
      status.dataset.tone = 'bad';
      return;
    }

    paint(data.profile.avatar);
    clear.hidden = !data.profile.avatar;
    choose.textContent = data.profile.avatar ? 'Change picture' : 'Choose a picture';
    status.textContent = uri ? 'Picture saved.' : 'Picture removed.';
    status.dataset.tone = 'ok';

    /* Outside the request's own error handling, and defended separately.
       This repaints the rail, and when it was inside the try a failure
       anywhere in that redraw was reported as "the picture was not saved"
       — about a picture that was, in fact, already saved. */
    try {
      onSaved?.(data.profile);
    } catch (err) {
      console.error('profile change handler failed', err);
    }
  };

  picker.addEventListener('change', async () => {
    const file = picker.files?.[0];
    picker.value = '';   // so choosing the same file twice fires again
    if (!file) return;
    status.textContent = 'Opening…';
    status.dataset.tone = '';
    try {
      const uri = await cropAvatar(file);
      /* Dismissed. Nothing was sent and nothing changed, so the panel says
         so rather than leaving "Opening…" standing as if it were working. */
      if (!uri) {
        status.textContent = 'No change. The picture was not sent.';
        status.dataset.tone = '';
        return;
      }
      save(uri);
    } catch {
      status.textContent = 'That file could not be read as an image.';
      status.dataset.tone = 'bad';
    }
  });

  clear.addEventListener('click', () => save(''));

  controls.append(choose, clear);
  body.append(preview, wrapSide(controls, status));
  box.body.append(body, picker);
  return box;
}

function wrapSide(...nodes) {
  const side = el('div', 'v-avatar-edit__side');
  side.append(...nodes);
  return side;
}

const MESSAGES = {
  avatar_must_be_data_uri: 'That file could not be read as an image.',
  avatar_unsupported_type: 'Use a PNG, JPEG, WebP or GIF.',
  avatar_not_base64: 'That file could not be read as an image.',
  avatar_too_large: 'That picture is still too large after resizing. Try a smaller one.',
  research_access_required: 'This account cannot edit a profile yet. Ask a Gravitas+ administrator for research access.',
  current_password_incorrect: 'That is not your current password.',
  password_rejected: 'That password was rejected. Use something longer and less common.',
  authentication_required: 'Your session has ended. Sign in again.',
};

/* ==========================================================================
   PROFILE
   ========================================================================== */

function profilePanel(profile, onSaved) {
  const box = panel('Profile');
  const form = el('form', 'v-form');

  const headline = field({ label: 'Headline', value: profile.headline, help: 'One line. It appears beside your name in the research network.' });
  const bio = field({ label: 'About', type: 'textarea', value: profile.bio });
  const institution = field({ label: 'Institution', value: profile.institution });
  const phone = field({ label: 'Mobile', value: profile.phone, help: 'Optional. You can add or update it at any time.' });
  phone.input.type = 'tel';
  phone.input.autocomplete = 'tel';
  const orcid = field({ label: 'ORCID', value: profile.orcid, help: 'Optional. The identifier only, not the full address.' });

  const visible = el('label', 'v-check-row');
  const box2 = el('input', 'ws-check');
  box2.type = 'checkbox';
  box2.checked = !!profile.is_public;
  visible.append(box2, el('span', null, 'Show my profile in the research network'));

  const save = el('button', 'ws-btn ws-btn--solid', 'Save profile');
  save.type = 'submit';
  const status = note('');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    save.disabled = true;
    status.textContent = 'Saving…';
    status.dataset.tone = '';
    try {
      const data = await P.call('/platform/researchers/me/', {
        method: 'PATCH',
        body: {
          headline: headline.input.value,
          bio: bio.input.value,
          institution: institution.input.value,
          phone: phone.input.value,
          orcid: orcid.input.value,
          is_public: box2.checked,
        },
      });
      status.textContent = 'Profile saved.';
      status.dataset.tone = 'ok';
      onSaved?.(data.profile);
    } catch (err) {
      status.textContent = MESSAGES[err.message] || 'The profile was not saved.';
      status.dataset.tone = 'bad';
    } finally {
      save.disabled = false;
    }
  });

  form.append(headline, bio, institution, phone, orcid, visible, foot(save, status));
  box.body.append(form);
  return box;
}

function foot(...nodes) {
  const row = el('div', 'v-form__foot');
  row.append(...nodes);
  return row;
}

/* ==========================================================================
   PASSWORD
   ========================================================================== */

function passwordPanel() {
  const box = panel('Password');
  const form = el('form', 'v-form');

  const current = field({ label: 'Current password', type: 'password', autocomplete: 'current-password' });
  const next = field({ label: 'New password', type: 'password', autocomplete: 'new-password', help: 'At least eight characters, and not one of the common ones.' });
  const again = field({ label: 'Repeat the new password', type: 'password', autocomplete: 'new-password' });

  const save = el('button', 'ws-btn ws-btn--solid', 'Change password');
  save.type = 'submit';
  const status = note('Changing your password signs out every other session. This one stays open.');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    current.setError('');
    next.setError('');
    again.setError('');

    // Checked here because it costs nothing and the server cannot check it:
    // only this form knows the reader typed it twice.
    if (next.input.value !== again.input.value) {
      again.setError('The two new passwords do not match.');
      again.input.focus();
      return;
    }

    save.disabled = true;
    status.textContent = 'Changing…';
    status.dataset.tone = '';
    try {
      await P.call('/auth/password-change/', {
        method: 'POST',
        body: { current_password: current.input.value, password: next.input.value },
      });
      form.reset();
      status.textContent = 'Password changed.';
      status.dataset.tone = 'ok';
    } catch (err) {
      if (err.message === 'current_password_incorrect') {
        current.setError(MESSAGES.current_password_incorrect);
        current.input.focus();
        status.textContent = '';
      } else if (err.message === 'password_rejected') {
        next.setError(MESSAGES.password_rejected);
        next.input.focus();
        status.textContent = '';
      } else {
        status.textContent = MESSAGES[err.message] || 'The password was not changed.';
        status.dataset.tone = 'bad';
      }
    } finally {
      save.disabled = false;
    }
  });

  form.append(current, next, again, foot(save, status));
  box.body.append(form);
  return box;
}

/* ==========================================================================
   PREFERENCES
   These live in this browser rather than on the account, which is the honest
   place for them: they are about this screen, and there is no endpoint that
   stores them.
   ========================================================================== */

function preferencesPanel(ctx) {
  const box = panel('This browser');
  const form = el('div', 'v-form');

  // Theme
  const theme = el('div', 'v-field');
  theme.append(el('span', 'v-field__label', 'Theme'));
  const group = el('div', 'v-choices');
  for (const [value, text] of [['dark', 'Dark'], ['light', 'Light'], ['system', 'Match the system']]) {
    const btn = el('button', 'v-choice', text);
    btn.type = 'button';
    const saved = (() => { try { return localStorage.getItem('gravitas-theme'); } catch { return null; } })();
    const currently = saved || 'system';
    if (currently === value) btn.setAttribute('aria-pressed', 'true');
    btn.addEventListener('click', () => {
      try {
        if (value === 'system') localStorage.removeItem('gravitas-theme');
        else localStorage.setItem('gravitas-theme', value);
      } catch { /* denied */ }
      const resolved = value === 'system'
        ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
        : value;
      document.documentElement.setAttribute('data-theme', resolved);
      for (const other of group.children) other.removeAttribute('aria-pressed');
      btn.setAttribute('aria-pressed', 'true');
      ctx.refreshTheme?.();
    });
    group.append(btn);
  }
  theme.append(group);
  form.append(theme);

  // Weather
  const place = el('div', 'v-field');
  const id = 'pref-place';
  const tag = el('label', 'v-field__label', 'Weather on the dashboard');
  tag.htmlFor = id;

  const select = el('select', 'v-input');
  select.id = id;
  const off = el('option', null, 'Do not show weather');
  off.value = 'off';
  select.append(off);
  for (const [key, entry] of Object.entries(WEATHER_PLACES)) {
    const option = el('option', null, entry.label);
    option.value = key;
    select.append(option);
  }
  select.value = weatherEnabled() ? weatherPlace() : 'off';
  select.addEventListener('change', () => {
    try {
      if (select.value === 'off') {
        localStorage.setItem('gravitas.ws.weather', 'off');
      } else {
        localStorage.setItem('gravitas.ws.weather', 'on');
        localStorage.setItem('gravitas.ws.place', select.value);
      }
    } catch { /* denied */ }
  });

  place.append(tag, select);
  place.append(el('p', 'v-field__help',
    'The forecast comes from Open-Meteo. It sends the coordinates of the chosen city and nothing else: no account, no page, no browser location prompt.'));
  form.append(place);

  box.body.append(form);
  return box;
}

/* ==========================================================================
   THE SCREEN
   ========================================================================== */

export function renderSettings(host, ctx) {
  host.innerHTML = '';
  const doc = el('div', 'ws-doc ws-doc--narrow');
  const head = el('header', 'ws-doc__head');
  head.append(el('h1', 'ws-doc__title', 'Settings'));
  head.append(el('p', 'ws-doc__meta', P.platform.user?.email || ''));
  doc.append(head);
  host.append(doc);

  const holder = el('div');
  doc.append(holder);
  skeleton(6, holder);

  const draw = async () => {
    try {
      const data = await P.myProfile();
      holder.innerHTML = '';
      const profile = data.profile || {};
      holder.append(avatarPanel(profile, ctx.onProfileChange));
      holder.append(profilePanel(profile, ctx.onProfileChange));
      holder.append(passwordPanel());
      holder.append(preferencesPanel(ctx));

      const out = el('div', 'v-form__foot');
      const signOut = el('button', 'ws-btn', 'Sign out');
      signOut.type = 'button';
      signOut.addEventListener('click', async () => {
        try { await P.call('/auth/logout/', { method: 'POST' }); } catch { /* going anyway */ }
        location.href = '/';
      });
      out.append(signOut);
      holder.append(out);
    } catch (err) {
      holder.innerHTML = '';
      holder.append(failure('your settings', err, draw));
    }
  };
  draw();
}
