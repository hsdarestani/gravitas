/* ==========================================================================
   GRAVITAS+ WORKSPACE  ·  SETTINGS
   Profile picture, profile fields, password, and the preferences that live
   in this browser.

   Two things here touch the account rather than the interface, and both are
   treated as such. The password form asks for the current one, because being
   signed in on a borrowed machine should not be enough to lock the owner
   out. The picture is resized in the browser before it is sent, so what
   leaves is a 256px square rather than whatever came off a phone camera.

   The screen is split into sections, each its own route under
   /workspace/settings/, listed in the shell's index pane. It was one column
   of five panels, and the reader who came to change a password had to
   scroll past a profile form to find out whether the page could do it at
   all. Splitting it also means each section loads only what it needs: an
   account without research access used to get a failure for the whole
   screen, theme switch included, because the profile request went first.
   ========================================================================== */

import * as P from './ws-platform.js?v=20261011-r2';
import { el, panel, empty, skeleton, failure } from './ws-views.js?v=20261011-r2';
import { WEATHER_PLACES, weatherPlace, weatherEnabled } from './ws-home.js?v=20261011-r2';
import { cropAvatar } from './ws-avatar-crop.js?v=20261011-r2';

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

/* An on/off setting: what it does on the left, the switch on the right.
   The native checkbox stays in the DOM, visually hidden, with role=switch,
   so keyboard and screen readers get a real control and the track is only
   paint. The description is part of the label, so it is announced too. */
function toggle(label, help, checked) {
  const row = el('label', 'v-toggle');
  const text = el('span', 'v-toggle__text');
  text.append(el('span', 'v-toggle__label', label));
  if (help) text.append(el('span', 'v-toggle__help', help));

  const input = el('input', 'v-toggle__input');
  input.type = 'checkbox';
  input.setAttribute('role', 'switch');
  input.checked = !!checked;

  const track = el('span', 'v-toggle__track');
  track.setAttribute('aria-hidden', 'true');

  row.append(text, input, track);
  row.input = input;
  return row;
}

/* A short sentence under a panel's title saying what the panel is for. */
function lede(text) {
  return el('p', 'v-settings__lede', text);
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
  const box = panel('Picture');
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
  const box = panel('Details');
  const form = el('form', 'v-form');

  const headline = field({ label: 'Headline', value: profile.headline, help: 'One line. It appears beside your name in the research network.' });
  const bio = field({ label: 'About', type: 'textarea', value: profile.bio, help: 'A few sentences on what you work on.' });
  const institution = field({ label: 'Institution', value: profile.institution, autocomplete: 'organization' });
  const phone = field({ label: 'Mobile', value: profile.phone, help: 'Optional.' });
  phone.input.type = 'tel';
  phone.input.autocomplete = 'tel';
  const orcid = field({ label: 'ORCID', value: profile.orcid, help: 'Optional. The identifier only, not the full address.' });
  orcid.input.placeholder = '0000-0000-0000-0000';
  orcid.input.spellcheck = false;

  // Mobile and ORCID are short and both optional, so they share a row on
  // a wide screen and stack on a narrow one.
  const pair = el('div', 'v-field-pair');
  pair.append(phone, orcid);

  const visible = toggle(
    'Show my profile in the research network',
    'When this is off, other researchers cannot find your profile.',
    profile.is_public,
  );
  const box2 = visible.input;

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

  form.append(headline, bio, institution, pair, visible, foot(save, status));
  box.body.append(form);
  return box;
}

function foot(...nodes) {
  const row = el('div', 'v-form__foot');
  row.append(...nodes);
  return row;
}

/* ==========================================================================
   TASK NOTIFICATIONS
   ========================================================================== */

/* Two panels from one request: what to be told about and where, then the
   Telegram link, which has a state of its own (connected, not connected,
   not configured on the server) and actions that save immediately. Mixing
   those immediate buttons into the form that waits for Save made it
   unclear which clicks had already taken effect. */
function notificationPanels() {
  const holder = el('div', 'v-settings__stack');
  skeleton(4, holder);

  const draw = async () => {
    let data;
    try {
      data = await P.call('/task-notifications/settings/');
    } catch (err) {
      holder.innerHTML = '';
      holder.append(failure('your notification settings', err, draw));
      return;
    }
    holder.innerHTML = '';

    const settings = data.settings || {};

    /* ---- What and where ---- */
    const prefs = panel('Task notifications');
    const form = el('div', 'v-form');

    const changes = toggle('Changes to my tasks',
      'When someone else edits a task assigned to you. Your own edits are not echoed back.',
      settings.task_changes_enabled);
    const reminders = toggle('Deadline reminders',
      'One day before a task is due, and on the due date.',
      settings.due_reminders_enabled);
    const email = toggle('Email',
      P.platform.user?.email ? 'Sent to ' + P.platform.user.email + '.' : 'Sent to your account address.',
      settings.email_enabled);
    const telegram = toggle('Telegram',
      settings.telegram_connected ? 'Sent to your connected Telegram account.' : 'Connect Telegram below first.',
      settings.telegram_enabled);

    const save = el('button', 'ws-btn ws-btn--solid', 'Save notification settings');
    save.type = 'button';
    const saveStatus = note('');
    save.addEventListener('click', async () => {
      save.disabled = true;
      saveStatus.textContent = 'Saving…';
      saveStatus.dataset.tone = '';
      try {
        await P.call('/task-notifications/settings/', {
          method: 'PATCH',
          body: {
            email_enabled: email.input.checked,
            telegram_enabled: telegram.input.checked,
            task_changes_enabled: changes.input.checked,
            due_reminders_enabled: reminders.input.checked,
          },
        });
        saveStatus.textContent = 'Notification settings saved.';
        saveStatus.dataset.tone = 'ok';
      } catch {
        saveStatus.textContent = 'Notification settings were not saved.';
        saveStatus.dataset.tone = 'bad';
      } finally {
        save.disabled = false;
      }
    });

    form.append(
      el('h3', 'v-settings__group', 'Notify me about'),
      changes,
      reminders,
      el('h3', 'v-settings__group', 'Send them by'),
      email,
      telegram,
      foot(save, saveStatus),
    );
    prefs.body.append(form);

    /* ---- Telegram ---- */
    const link = panel('Telegram');
    const linkBody = el('div', 'v-form');
    const state = settings.telegram_connected
      ? ['ok', 'Connected' + (settings.telegram_username ? ' as @' + settings.telegram_username : '') + '.']
      : settings.telegram_bot_configured
        ? ['', 'Not connected.']
        : ['warn', 'The Telegram bot is not set up on the server yet, so this cannot be connected.'];
    linkBody.append(note(state[1], state[0]));

    const actions = el('div', 'v-form__foot');
    if (!settings.telegram_connected && settings.telegram_connect_url) {
      const connect = el('a', 'ws-btn ws-btn--solid', 'Connect Telegram');
      connect.href = settings.telegram_connect_url;
      connect.target = '_blank';
      connect.rel = 'noopener';
      actions.append(connect);
    }
    if (settings.telegram_connected) {
      const disconnect = el('button', 'ws-btn', 'Disconnect');
      disconnect.type = 'button';
      disconnect.addEventListener('click', async () => {
        disconnect.disabled = true;
        try {
          await P.call('/task-notifications/settings/', {
            method: 'PATCH',
            body: { disconnect_telegram: true },
          });
          await draw();
        } catch {
          disconnect.disabled = false;
        }
      });
      actions.append(disconnect);
    }
    const refresh = el('button', 'ws-btn', 'Check again');
    refresh.type = 'button';
    refresh.addEventListener('click', draw);
    actions.append(refresh);
    linkBody.append(actions);
    if (!settings.telegram_connected && settings.telegram_connect_url) {
      linkBody.append(el('p', 'v-field__help',
        'Connecting opens Telegram in a new tab. Come back here and choose Check again once you have started the bot.'));
    }
    link.body.append(linkBody);

    holder.append(prefs, link);
  };

  draw();
  return holder;
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
   stores them. Each panel says so, because a theme that does not follow the
   reader to another machine is otherwise reported as a bug.
   ========================================================================== */

function themePanel(ctx) {
  const box = panel('Theme');
  const form = el('div', 'v-form');
  form.append(lede('Saved in this browser only.'));

  const group = el('div', 'v-choices');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Theme');
  const saved = (() => { try { return localStorage.getItem('gravitas-theme'); } catch { return null; } })();
  const currently = saved || 'system';
  for (const [value, text] of [['dark', 'Dark'], ['light', 'Light'], ['system', 'Match the system']]) {
    const btn = el('button', 'v-choice', text);
    btn.type = 'button';
    btn.setAttribute('aria-pressed', String(currently === value));
    btn.addEventListener('click', () => {
      try {
        if (value === 'system') localStorage.removeItem('gravitas-theme');
        else localStorage.setItem('gravitas-theme', value);
      } catch { /* denied */ }
      const resolved = value === 'system'
        ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
        : value;
      document.documentElement.setAttribute('data-theme', resolved);
      for (const other of group.children) other.setAttribute('aria-pressed', 'false');
      btn.setAttribute('aria-pressed', 'true');
      ctx.refreshTheme?.();
    });
    group.append(btn);
  }
  form.append(group);

  box.body.append(form);
  return box;
}

function weatherPanel() {
  const box = panel('Weather on the dashboard');
  const form = el('div', 'v-form');

  const place = el('div', 'v-field');
  const id = 'pref-place';
  const tag = el('label', 'v-field__label', 'City');
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

  const status = note('');
  select.addEventListener('change', () => {
    try {
      if (select.value === 'off') {
        localStorage.setItem('gravitas.ws.weather', 'off');
      } else {
        localStorage.setItem('gravitas.ws.weather', 'on');
        localStorage.setItem('gravitas.ws.place', select.value);
      }
      status.textContent = 'Saved in this browser.';
      status.dataset.tone = 'ok';
    } catch {
      status.textContent = 'This browser is not letting the page store settings.';
      status.dataset.tone = 'bad';
    }
  });

  place.append(tag, select);
  place.append(el('p', 'v-field__help',
    'The forecast comes from Open-Meteo. It sends the coordinates of the chosen city and nothing else: no account, no page, no browser location prompt.'));
  form.append(place, status);

  box.body.append(form);
  return box;
}

/* ==========================================================================
   SIGN OUT
   ========================================================================== */

function sessionPanel() {
  const box = panel('Session');
  const form = el('div', 'v-form');
  const who = P.platform.user?.email;
  form.append(note(who ? `Signed in as ${who}.` : 'Signed in.'));

  const signOut = el('button', 'ws-btn', 'Sign out');
  signOut.type = 'button';
  signOut.addEventListener('click', async () => {
    signOut.disabled = true;
    try { await P.call('/auth/logout/', { method: 'POST' }); } catch { /* going anyway */ }
    location.href = '/';
  });
  form.append(foot(signOut));

  box.body.append(form);
  return box;
}

/* ==========================================================================
   THE SCREEN
   ========================================================================== */

/* The sections, in the order the index lists them. The shell reads this
   list to draw the index pane and the crumbs, and the router uses
   settingsSection() to turn an unknown or missing segment into Profile
   rather than into a blank screen. */
export const SETTINGS_SECTIONS = [
  {
    id: 'profile', label: 'Profile', icon: 'people',
    hint: 'Picture and public details',
    lede: 'How you appear to other researchers in the research network.',
  },
  {
    id: 'security', label: 'Security', icon: 'secure',
    hint: 'Password and sign-out',
    lede: 'Your password and this session.',
  },
  {
    id: 'notifications', label: 'Notifications', icon: 'alert',
    hint: 'Task updates, email, Telegram',
    lede: 'What you are told about, and where it is sent.',
  },
  {
    id: 'appearance', label: 'Appearance', icon: 'theme',
    hint: 'Theme and dashboard weather',
    lede: 'How the workspace looks in this browser.',
  },
].map((section) => ({ ...section, path: `/workspace/settings/${section.id}` }));

export function settingsSection(id) {
  return SETTINGS_SECTIONS.find((section) => section.id === id) || SETTINGS_SECTIONS[0];
}

/* On a narrow screen the index pane is closed by default, and a settings
   screen whose only way to the other sections is a pane the reader may
   not know to open is a dead end. The same list is drawn here as tabs;
   CSS shows it only while the index pane is closed, so it never appears
   twice. */
function sectionTabs(active, go) {
  const nav = el('nav', 'v-settings__tabs');
  nav.setAttribute('aria-label', 'Settings sections');
  for (const section of SETTINGS_SECTIONS) {
    const link = el('a', 'v-settings__tab', section.label);
    link.href = section.path;
    if (section.id === active.id) link.setAttribute('aria-current', 'page');
    link.addEventListener('click', (event) => { event.preventDefault(); go(section.path); });
    nav.append(link);
  }
  return nav;
}

export function renderSettings(host, ctx) {
  const section = settingsSection(location.pathname.split('/')[3]);

  host.innerHTML = '';
  const doc = el('div', 'ws-doc ws-doc--narrow v-settings');
  const head = el('header', 'ws-doc__head');
  head.append(el('h1', 'ws-doc__title', section.label));
  head.append(el('p', 'ws-doc__meta', section.lede));
  doc.append(sectionTabs(section, ctx.go), head);
  host.append(doc);

  const holder = el('div', 'v-settings__stack');
  doc.append(holder);

  if (section.id === 'profile') {
    skeleton(6, holder);
    const draw = async () => {
      try {
        const data = await P.myProfile();
        holder.innerHTML = '';
        const profile = data.profile || {};
        holder.append(avatarPanel(profile, ctx.onProfileChange));
        holder.append(profilePanel(profile, ctx.onProfileChange));
      } catch (err) {
        holder.innerHTML = '';
        holder.append(failure('your profile', err, draw));
      }
    };
    draw();
  } else if (section.id === 'security') {
    holder.append(passwordPanel(), sessionPanel());
  } else if (section.id === 'notifications') {
    holder.append(notificationPanels());
  } else {
    holder.append(themePanel(ctx), weatherPanel());
  }
}
