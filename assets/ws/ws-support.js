import * as P from './ws-platform.js?v=20260918-access3';

const el = (tag, cls = '', text = '') => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== '') node.textContent = text;
  return node;
};

function shell(host, title, subtitle) {
  host.innerHTML = '';
  const doc = el('div', 'ws-doc ws-doc--wide fl-doc');
  const head = el('header', 'ws-doc__head fl-head');
  head.append(el('h1', 'ws-doc__title', title), el('p', 'ws-doc__meta', subtitle));
  doc.append(head); host.append(doc); return doc;
}

function button(label, handler, solid = false) {
  const node = el('button', solid ? 'ws-btn ws-btn--solid' : 'ws-btn', label);
  node.type = 'button'; node.addEventListener('click', handler); return node;
}

function statusBadge(value) {
  const node = el('span', 'v-badge fl-badge', P.label(value));
  if (value === 'resolved' || value === 'closed') node.dataset.tone = 'done';
  return node;
}

function ticketRow(ticket, open) {
  const row = el('button', 'fl-row fl-row--button wc-item wc-item--button');
  row.type = 'button';
  const main = el('div', 'fl-row__main wc-item__main');
  main.append(el('strong', 'wc-item__title', ticket.subject));
  main.append(el('small', 'fl-muted wc-item__meta', P.meta([P.label(ticket.status), P.label(ticket.priority), P.formatDate(ticket.updated_at)])));
  row.append(main, statusBadge(ticket.status));
  row.addEventListener('click', () => open(ticket.id));
  return row;
}

export async function renderMemberSupport(host) {
  const doc = shell(host, 'Support', 'Talk directly with the Gravitas+ team. Replies stay attached to one ticket.');
  const layout = el('div', 'fl-columns');
  const list = el('section', 'fl-panel wc-card');
  const listHead = el('div', 'fl-panel__head wc-card__head');
  listHead.append(el('h2', 'fl-panel__title wc-card__title', 'Your tickets'));
  const listBody = el('div', 'fl-panel__body wc-card__body');
  list.append(listHead, listBody);

  const detail = el('section', 'fl-panel wc-card');
  const detailHead = el('div', 'fl-panel__head wc-card__head');
  detailHead.append(el('h2', 'fl-panel__title wc-card__title', 'New ticket'));
  const detailBody = el('div', 'fl-panel__body wc-card__body');
  detail.append(detailHead, detailBody);
  layout.append(list, detail); doc.append(layout);

  const loadList = async () => {
    listBody.innerHTML = '<div class="fl-skeleton"></div>';
    try {
      const data = await P.memberTickets();
      listBody.innerHTML = '';
      const newButton = button('New ticket', () => drawNew(), true);
      listHead.querySelector('.ws-btn')?.remove();
      listHead.append(newButton);
      if (!(data.tickets || []).length) listBody.append(el('p', 'fl-muted', 'No support tickets yet.'));
      for (const ticket of data.tickets || []) listBody.append(ticketRow(ticket, openTicket));
    } catch (error) {
      listBody.innerHTML = '';
      listBody.append(el('p', 'fl-muted', error?.message || 'Tickets could not be loaded.'));
    }
  };

  const drawNew = () => {
    detailHead.querySelector('.fl-panel__title').textContent = 'New ticket';
    detailBody.innerHTML = '';
    const form = el('form', 'fl-form');
    const subject = el('input', 'v-input fl-input'); subject.placeholder = 'What do you need help with?';
    const priority = el('select', 'v-input fl-input');
    [['normal', 'Normal'], ['high', 'High']].forEach(([value,label]) => {
      const option = el('option', '', label); option.value = value; priority.append(option);
    });
    const message = el('textarea', 'v-input fl-input fl-textarea'); message.rows = 7; message.placeholder = 'Describe the issue or question.';
    const send = button('Send ticket', () => {}, true); send.type = 'submit';
    const note = el('p', 'v-note');
    form.append(subject, priority, message, send, note);
    form.addEventListener('submit', async (event) => {
      event.preventDefault(); send.disabled = true; note.textContent = 'Sending…';
      try {
        const data = await P.createMemberTicket({ subject: subject.value.trim(), message: message.value.trim(), priority: priority.value });
        await loadList(); await openTicket(data.ticket.id);
      } catch (error) {
        note.textContent = error?.message || 'Ticket could not be created.'; send.disabled = false;
      }
    });
    detailBody.append(form);
  };

  const openTicket = async (id) => {
    detailBody.innerHTML = '<div class="fl-skeleton"></div>';
    try {
      const data = await P.memberTicket(id);
      const ticket = data.ticket;
      detailHead.querySelector('.fl-panel__title').textContent = ticket.subject;
      detailBody.innerHTML = '';
      const meta = el('div', 'fl-badges'); meta.append(statusBadge(ticket.status), statusBadge(ticket.priority)); detailBody.append(meta);
      const thread = el('div', 'g-stack g-stack--sm');
      for (const message of ticket.messages || []) {
        const card = el('article', 'callout');
        card.append(el('strong', '', message.is_team_reply ? 'Gravitas+ Team' : 'You'));
        card.append(el('p', '', message.body));
        card.append(el('small', 'fl-muted', P.formatDate(message.created_at)));
        thread.append(card);
      }
      detailBody.append(thread);
      if (!['closed'].includes(ticket.status)) {
        const form = el('form', 'fl-form');
        const reply = el('textarea', 'v-input fl-input fl-textarea'); reply.rows = 4; reply.placeholder = 'Reply…';
        const send = button('Send reply', () => {}, true); send.type = 'submit';
        const resolve = button('Mark resolved', async () => {
          resolve.disabled = true;
          await P.updateMemberTicket(id, { status: 'resolved' });
          await openTicket(id); await loadList();
        });
        form.append(reply, send, resolve);
        form.addEventListener('submit', async (event) => {
          event.preventDefault(); if (!reply.value.trim()) return;
          send.disabled = true;
          try { await P.replyMemberTicket(id, reply.value.trim()); await openTicket(id); await loadList(); }
          catch { send.disabled = false; }
        });
        detailBody.append(form);
      }
    } catch (error) {
      detailBody.innerHTML = ''; detailBody.append(el('p', 'fl-muted', error?.message || 'Ticket could not be loaded.'));
    }
  };

  drawNew();
  await loadList();
}
