import * as P from './ws-platform.js?v=20260926-calendar2';

const el = (tag, cls = '', text = '') => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== '' && text != null) node.textContent = text;
  return node;
};

const button = (label, handler, solid = false) => {
  const node = el('button', solid ? 'ws-btn ws-btn--solid' : 'ws-btn', label);
  node.type = 'button';
  node.addEventListener('click', handler);
  return node;
};

const eventStart = (event) => event?.start?.dateTime || event?.start?.date || '';
const eventEnd = (event) => event?.end?.dateTime || event?.end?.date || '';

function formatWhen(event) {
  const raw = eventStart(event);
  if (!raw) return 'No date';
  const allDay = !!event?.start?.date && !event?.start?.dateTime;
  const date = new Date(allDay ? raw + 'T00:00:00' : raw);
  if (Number.isNaN(date.getTime())) return raw;
  if (allDay) {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function eventIsPast(event) {
  const raw = eventEnd(event) || eventStart(event);
  if (!raw) return false;
  const allDay = raw.length === 10;
  const date = new Date(allDay ? raw + 'T23:59:59' : raw);
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
}

function closeDialog(dialog) {
  dialog?.remove();
}

function makeDialog(title) {
  const dialog = el('div', 'task-card-dialog calendar-meeting-dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.tabIndex = -1;
  const frame = el('div', 'task-card-dialog__frame');
  const head = el('header', 'task-card-dialog__head');
  head.append(el('h2', null, title), button('Close', () => closeDialog(dialog)));
  const body = el('div', 'task-card-dialog__body');
  frame.append(head, body);
  dialog.append(frame);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeDialog(dialog);
  });
  document.body.append(dialog);
  requestAnimationFrame(() => dialog.focus());
  return { dialog, body };
}

function attachmentRow(minute, item, rerender) {
  const row = el('div', 'calendar-minute-attachment');
  const link = el('a', null, item.name);
  link.href = item.download_url;
  link.target = '_blank';
  link.rel = 'noopener';
  const meta = el('span', 'fl-muted', item.size ? Math.max(1, Math.round(item.size / 1024)) + ' KB' : '');
  const remove = button('Remove', async () => {
    remove.disabled = true;
    try {
      await P.deleteGoogleCalendarMinuteAttachment(minute.id, item.id);
      minute.attachments = (minute.attachments || []).filter((row) => row.id !== item.id);
      rerender();
    } catch (error) {
      remove.disabled = false;
      alert(error?.data?.error || error?.message || 'File could not be removed.');
    }
  });
  remove.classList.add('ws-btn--tiny');
  row.append(link, meta, remove);
  return row;
}

function openMinutes(event, onSaved) {
  const { dialog, body } = makeDialog(event.title || 'Meeting minutes');
  const minute = event.minute || null;

  const meta = el('div', 'calendar-meeting-meta');
  meta.append(el('strong', null, formatWhen(event)));
  if (event.location) meta.append(el('span', 'fl-muted', event.location));
  body.append(meta);

  const links = el('div', 'calendar-meeting-links');
  if (event.conference_link) {
    const join = el('a', 'ws-btn ws-btn--solid', 'Join meeting');
    join.href = event.conference_link;
    join.target = '_blank';
    join.rel = 'noopener';
    links.append(join);
  }
  if (event.html_link) {
    const open = el('a', 'ws-btn', 'Open in Google Calendar');
    open.href = event.html_link;
    open.target = '_blank';
    open.rel = 'noopener';
    links.append(open);
  }
  if (links.childNodes.length) body.append(links);

  const notesLabel = el('label', 'task-board__field');
  const notes = el('textarea', 'v-input task-board__textarea');
  notes.rows = 10;
  notes.placeholder = 'Decisions, discussion notes, action points, follow-up…';
  notes.value = minute?.notes || '';
  notesLabel.append(el('span', 'task-board__label', 'Minutes'), notes);

  const linkLabel = el('label', 'task-board__field');
  const reference = el('input', 'v-input task-board__input');
  reference.type = 'url';
  reference.placeholder = 'https://…';
  reference.value = minute?.reference_url || '';
  linkLabel.append(el('span', 'task-board__label', 'Reference link'), reference);

  const note = el('p', 'v-note');
  const save = button('Save minutes', async () => {
    save.disabled = true;
    note.textContent = 'Saving…';
    try {
      const result = await P.saveGoogleCalendarMinute({
        event_id: event.id,
        notes: notes.value.trim(),
        reference_url: reference.value.trim(),
      });
      event.minute = result.minute;
      note.textContent = 'Saved.';
      onSaved?.(event);
      renderFiles();
    } catch (error) {
      note.textContent = error?.data?.error || error?.message || 'Minutes could not be saved.';
    } finally {
      save.disabled = false;
    }
  }, true);

  const filePanel = el('section', 'calendar-minute-files');
  const filesTitle = el('h3', null, 'Files');
  const fileList = el('div', 'calendar-minute-file-list');
  const uploadRow = el('div', 'calendar-minute-upload');
  const picker = el('input', 'v-input');
  picker.type = 'file';
  const uploadButton = button('Upload file', async () => {
    const file = picker.files?.[0];
    if (!file) {
      note.textContent = 'Choose a file first.';
      return;
    }
    uploadButton.disabled = true;
    note.textContent = 'Uploading…';
    try {
      if (!event.minute?.id) {
        const saved = await P.saveGoogleCalendarMinute({
          event_id: event.id,
          notes: notes.value.trim(),
          reference_url: reference.value.trim(),
        });
        event.minute = saved.minute;
      }
      const result = await P.uploadGoogleCalendarMinuteAttachment(event.minute.id, file);
      event.minute.attachments = [...(event.minute.attachments || []), result.attachment];
      picker.value = '';
      note.textContent = 'File uploaded.';
      onSaved?.(event);
      renderFiles();
    } catch (error) {
      note.textContent = error?.data?.error || error?.message || 'Upload failed.';
    } finally {
      uploadButton.disabled = false;
    }
  });
  uploadRow.append(picker, uploadButton);
  filePanel.append(filesTitle, fileList, uploadRow);

  function renderFiles() {
    fileList.innerHTML = '';
    const current = event.minute;
    const files = current?.attachments || [];
    if (!files.length) {
      fileList.append(el('p', 'fl-muted', 'No files attached yet.'));
      return;
    }
    for (const item of files) fileList.append(attachmentRow(current, item, renderFiles));
  }

  body.append(notesLabel, linkLabel, save, note, filePanel);
  renderFiles();
}

function meetingCard(event, onSaved) {
  const card = el('article', 'calendar-meeting-card');
  if (eventIsPast(event)) card.dataset.past = 'true';
  const head = el('div', 'calendar-meeting-card__head');
  const title = el('div');
  title.append(el('h3', null, event.title || 'Untitled meeting'));
  title.append(el('p', 'fl-muted', formatWhen(event)));
  head.append(title);

  const status = el('span', 'v-badge', event.minute ? 'Minutes saved' : 'No minutes yet');
  head.append(status);
  card.append(head);

  const meta = el('div', 'calendar-meeting-card__meta');
  if (event.location) meta.append(el('span', null, event.location));
  const people = (event.attendees || []).filter((row) => !row.self);
  if (people.length) {
    meta.append(el('span', null, people.slice(0, 4).map((row) => row.name || row.email).filter(Boolean).join(', ')));
  }
  if (meta.childNodes.length) card.append(meta);

  if (event.minute?.notes) {
    const preview = event.minute.notes.replace(/\s+/g, ' ').trim();
    if (preview) card.append(el('p', 'calendar-meeting-card__preview', preview.slice(0, 220)));
  }

  const actions = el('div', 'calendar-meeting-card__actions');
  actions.append(button(event.minute ? 'Edit minutes' : 'Add minutes', () => openMinutes(event, onSaved), true));
  if (event.conference_link) {
    const join = el('a', 'ws-btn', 'Join');
    join.href = event.conference_link;
    join.target = '_blank';
    join.rel = 'noopener';
    actions.append(join);
  }
  if (event.html_link) {
    const open = el('a', 'ws-btn', 'Google Calendar');
    open.href = event.html_link;
    open.target = '_blank';
    open.rel = 'noopener';
    actions.append(open);
  }
  card.append(actions);
  return card;
}

export async function renderCoreMeetings(host) {
  host.innerHTML = '';
  const doc = el('div', 'ws-doc ws-doc--wide');
  const head = el('header', 'ws-doc__head');
  head.append(
    el('h1', 'ws-doc__title', 'Meetings'),
    el('p', 'ws-doc__meta', 'Meetings come from your Google Calendar. Keep shared minutes, files and reference links in Gravitas+.'),
  );
  doc.append(head);
  const holder = el('div');
  holder.append(el('div', 'ws-skel'));
  doc.append(holder);
  host.append(doc);

  const load = async () => {
    holder.innerHTML = '';
    let data;
    try {
      data = await P.googleCalendarEvents();
    } catch (error) {
      const alert = el('div', 'ws-alert');
      alert.append(el('p', 'ws-alert__title', 'Could not load Google Calendar'));
      const code = error?.data?.error || error?.message || '';
      const friendly = code === 'calendar_reconnect_required'
        ? 'Google Calendar access expired. Reconnect your account.'
        : code === 'calendar_permission_denied'
          ? 'Google did not allow Calendar access. Reconnect and approve Calendar permission.'
          : 'The Calendar connection could not be read.';
      alert.append(el('p', null, friendly));
      alert.append(button('Reconnect Google Calendar', () => {
        location.href = '/api/calendar/google/connect/?next=' + encodeURIComponent('/workspace/core/meetings');
      }, true));
      holder.append(alert);
      return;
    }

    if (!data.connected) {
      const empty = el('div', 'ws-empty');
      empty.append(
        el('p', 'ws-empty__title', 'Connect Google Calendar'),
        el('p', 'ws-empty__body', 'Connect once to see your Calendar meetings here and keep their minutes in Gravitas+.'),
        button('Connect Google Calendar', () => {
          location.href = '/api/calendar/google/connect/?next=' + encodeURIComponent('/workspace/core/meetings');
        }, true),
      );
      holder.append(empty);
      return;
    }

    const events = data.events || [];
    const upcoming = events.filter((event) => !eventIsPast(event));
    const past = events.filter(eventIsPast);
    const withMinutes = events.filter((event) => !!event.minute);

    const stats = el('div', 'v-stats wc-tiles');
    for (const [label, value] of [
      ['Upcoming', upcoming.length],
      ['Past', past.length],
      ['With minutes', withMinutes.length],
    ]) {
      const cell = el('div', 'v-stat wc-tile');
      const tileHead = el('div', 'wc-tile__head');
      tileHead.append(el('span', 'v-stat__label wc-tile__label', label));
      cell.append(tileHead, el('b', 'v-stat__value wc-tile__value', String(value)));
      stats.append(cell);
    }
    holder.append(stats);

    const toolbar = el('div', 'v-toolbar calendar-meeting-toolbar');
    const search = el('input', 'v-input');
    search.type = 'search';
    search.placeholder = 'Search meetings';
    const account = el('span', 'fl-muted', data.google_email ? 'Google Calendar · ' + data.google_email : 'Google Calendar connected');
    const reconnect = button('Reconnect', () => {
      location.href = '/api/calendar/google/connect/?next=' + encodeURIComponent('/workspace/core/meetings');
    });
    toolbar.append(search, account, reconnect);
    holder.append(toolbar);

    const list = el('div', 'calendar-meeting-list');
    holder.append(list);

    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const visible = events.filter((event) => {
        if (!q) return true;
        return [
          event.title, event.location, event.description,
          ...(event.attendees || []).flatMap((row) => [row.name, row.email]),
        ].filter(Boolean).join(' ').toLowerCase().includes(q);
      });
      list.innerHTML = '';
      if (!visible.length) {
        list.append(el('div', 'ws-empty', q ? 'No matching meetings.' : 'No Calendar meetings found in the current range.'));
        return;
      }

      const nowFirst = [...visible].sort((a, b) => {
        const ap = eventIsPast(a), bp = eventIsPast(b);
        if (ap !== bp) return ap ? 1 : -1;
        const at = new Date(eventStart(a) || 0).getTime();
        const bt = new Date(eventStart(b) || 0).getTime();
        return ap ? bt - at : at - bt;
      });
      for (const event of nowFirst) {
        list.append(meetingCard(event, () => draw()));
      }
    };
    search.addEventListener('input', draw);
    draw();
  };

  await load();
}
