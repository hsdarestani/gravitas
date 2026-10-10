/* ==========================================================================
   GRAVITAS+ WORKSPACE  ·  CORE · TEAM & ACCESS
   Who is in Core, what role they hold, whether they can sign in, how much
   storage they use, and who could be brought in.

   This screen used to be drawn twice. ws-views drew a read-only list of
   names, and ws-actionable-ui.js waited for it to appear, deleted it, and
   drew this management screen in its place. It is now one renderer, called
   by the router. The markup, wording and styles (the au- classes, ws.css)
   are the ones the screen already had; only who draws it changed.

   Every change goes through /platform/team/. The server decides who may
   change whom; the screen hides only what it knows the server will refuse.
   ========================================================================== */

import * as P from './ws-platform.js?v=20261011-r4';

const VERSION = '20260915-1';
const page = { host: null, go: null };

function el(tag, cls = '', text = '') {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== '') node.textContent = text;
  return node;
}

function navigate(path) {
  if (page.go) page.go(path);
}

function button(label, handler, solid = false, tiny = false) {
  const node = el('button', `${solid ? 'ws-btn ws-btn--solid' : 'ws-btn'}${tiny ? ' ws-btn--tiny' : ''}`, label);
  node.type = 'button';
  node.addEventListener('click', handler);
  return node;
}

function input(value = '', type = 'text', placeholder = '') {
  const node = el('input', 'v-input fl-input');
  node.type = type;
  node.value = value ?? '';
  node.placeholder = placeholder;
  return node;
}

function select(options, value) {
  const node = el('select', 'v-input fl-input');
  for (const [key, label] of options) {
    const option = el('option', '', label);
    option.value = key;
    option.selected = String(key) === String(value ?? '');
    node.append(option);
  }
  return node;
}

function checkbox(checked, label) {
  const wrap = el('label', 'au-check');
  const control = document.createElement('input');
  control.type = 'checkbox';
  control.checked = !!checked;
  wrap.append(control, el('span', '', label));
  return { wrap, control };
}

export function teamPanel(title, note = '') {
  const box = el('section', 'au-panel');
  const head = el('div', 'au-panel__head');
  const left = el('div');
  left.append(el('h2', '', title));
  if (note) left.append(el('small', 'au-row__meta', note));
  head.append(left);
  const body = el('div', 'au-panel__body');
  box.append(head, body);
  return { box, head, body };
}

export function teamRow(title, meta, badges = [], actions = []) {
  const row = el('div', 'au-row');
  const main = el('div', 'au-row__main');
  main.append(el('strong', '', title));
  if (meta) main.append(el('span', 'au-row__meta', meta));
  if (badges.filter(Boolean).length) {
    const strip = el('div', 'au-badges');
    for (const text of badges.filter(Boolean)) strip.append(el('span', 'au-badge', text));
    main.append(strip);
  }
  row.append(main);
  if (actions.length) {
    const tools = el('div', 'au-row__actions');
    for (const action of actions) tools.append(action);
    row.append(tools);
  }
  return row;
}

function field(label, control, hint = '') {
  const wrap = el('label', 'au-field');
  wrap.append(el('span', '', label), control);
  if (hint) wrap.append(el('small', 'au-row__meta', hint));
  return wrap;
}

function openModal(title, build) {
  const layer = el('div', 'au-modal-layer');
  const modal = el('section', 'au-modal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', title);
  const head = el('div', 'au-modal__head');
  head.append(el('h2', '', title));
  const close = button('Close', () => layer.remove(), false, true);
  head.append(close);
  modal.append(head);
  build(modal, () => layer.remove());
  layer.append(modal);
  layer.addEventListener('pointerdown', (event) => { if (event.target === layer) layer.remove(); });
  const escape = (event) => {
    if (event.key === 'Escape') {
      layer.remove();
      removeEventListener('keydown', escape);
    }
  };
  addEventListener('keydown', escape);
  document.body.append(layer);
  requestAnimationFrame(() => modal.querySelector('input,select,button')?.focus());
}

function fmtBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / (1024 ** index)).toFixed(index > 2 ? 1 : 0)} ${units[index]}`;
}

async function refreshTeam() {
  if (page.host?.isConnected) await renderCoreTeam(page.host, { go: page.go });
}

function addExistingToCore(user) {
  return async () => {
    try {
      await P.call('/platform/team/', { method: 'POST', body: { email: user.email, name: user.name, role: 'member', send_setup: false } });
      await refreshTeam();
    } catch (error) {
      alert(error?.message || 'The member could not be added.');
    }
  };
}

function openAddMember() {
  openModal('Add Core member', (modal, close) => {
    const form = el('form', 'au-form');
    const email = input('', 'email', 'name@example.com');
    const name = input('', 'text', 'Display name');
    const role = select([['member', 'Member'], ['admin', 'Admin']], 'member');
    const password = input('', 'password', 'Optional temporary password');
    const setup = checkbox(true, 'Send password setup email');
    const grid = el('div', 'au-grid');
    grid.append(field('Email', email), field('Name', name), field('Core role', role), field('Temporary password', password, 'Leave blank to use the setup email.'));
    const status = el('p', 'au-status');
    const save = button('Add member', () => {}, true);
    save.type = 'submit';
    const actions = el('div', 'au-modal__actions');
    actions.append(save, button('Cancel', close));
    form.append(grid, setup.wrap, actions, status);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      save.disabled = true;
      status.textContent = 'Saving…';
      try {
        await P.call('/platform/team/', { method: 'POST', body: {
          email: email.value.trim(), name: name.value.trim(), role: role.value,
          password: password.value, send_setup: setup.control.checked,
        } });
        status.textContent = 'Member added.';
        status.dataset.tone = 'ok';
        setTimeout(async () => { close(); await refreshTeam(); }, 250);
      } catch (error) {
        status.textContent = error?.message || 'Member was not added.';
        status.dataset.tone = 'bad';
        save.disabled = false;
      }
    });
    modal.append(form);
  });
}

function openMemberEditor(member, viewer) {
  openModal(`Edit ${member.name}`, (modal, close) => {
    const form = el('form', 'au-form');
    const name = input(member.name);
    const email = input(member.email, 'email');
    const roleOptions = member.role === 'owner' ? [['owner', 'Owner'], ['admin', 'Admin'], ['member', 'Member']] : [['admin', 'Admin'], ['member', 'Member']];
    const role = select(roleOptions, member.role);
    if (member.role === 'owner' && !viewer?.is_superuser) role.disabled = true;
    const active = checkbox(member.is_active, 'Account can sign in');
    if (member.is_superuser && !viewer?.is_superuser) active.control.disabled = true;
    const grid = el('div', 'au-grid');
    grid.append(field('Name', name), field('Email', email), field('Core role', role));
    const status = el('p', 'au-status');
    const save = button('Save', () => {}, true);
    save.type = 'submit';
    const actions = el('div', 'au-modal__actions');
    actions.append(save, button('Cancel', close));
    form.append(grid, active.wrap, actions, status);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      save.disabled = true;
      status.textContent = 'Saving…';
      const body = { name: name.value.trim(), email: email.value.trim(), is_active: active.control.checked };
      if (!role.disabled) body.role = role.value;
      try {
        await P.call(`/platform/team/${member.id}/`, { method: 'PATCH', body });
        status.textContent = 'Saved.';
        status.dataset.tone = 'ok';
        setTimeout(async () => { close(); await refreshTeam(); }, 220);
      } catch (error) {
        status.textContent = error?.message || 'Changes were not saved.';
        status.dataset.tone = 'bad';
        save.disabled = false;
      }
    });
    modal.append(form);
  });
}

function openPasswordReset(member) {
  openModal(`Password · ${member.name}`, (modal, close) => {
    const status = el('p', 'au-status');
    const send = button('Send setup email', async () => {
      send.disabled = true;
      status.textContent = 'Sending…';
      try {
        await P.call(`/platform/team/${member.id}/password-reset/`, { method: 'POST', body: { mode: 'email' } });
        status.textContent = 'Password setup email sent.';
        status.dataset.tone = 'ok';
      } catch (error) {
        status.textContent = error?.message || 'Email could not be sent.';
        status.dataset.tone = 'bad';
        send.disabled = false;
      }
    }, true);
    const temp = input('', 'password', 'Temporary password');
    const setTemp = button('Set temporary password', async () => {
      setTemp.disabled = true;
      status.textContent = 'Updating…';
      try {
        await P.call(`/platform/team/${member.id}/password-reset/`, { method: 'POST', body: { mode: 'temporary', password: temp.value } });
        status.textContent = 'Temporary password set.';
        status.dataset.tone = 'ok';
      } catch (error) {
        status.textContent = error?.data?.messages?.join(' ') || error?.message || 'Password was not changed.';
        status.dataset.tone = 'bad';
        setTemp.disabled = false;
      }
    });
    const form = el('div', 'au-form');
    form.append(send, field('Temporary password', temp), setTemp, status, button('Close', close));
    modal.append(form);
  });
}

function openStorageEditor(member, storage) {
  openModal(`Storage · ${member.name}`, (modal, close) => {
    const row = storage || {};
    const quotaGb = input(row.quota_bytes ? (row.quota_bytes / (1024 ** 3)).toFixed(2) : '5', 'number');
    quotaGb.min = '0.1'; quotaGb.max = '2048'; quotaGb.step = '0.1';
    const status = el('p', 'au-status');
    const save = button('Save quota', async () => {
      save.disabled = true;
      status.textContent = 'Saving…';
      try {
        const quotaBytes = Math.round(Number(quotaGb.value) * (1024 ** 3));
        await P.call(`/platform/team/${member.id}/storage/`, { method: 'PATCH', body: { quota_bytes: quotaBytes } });
        status.textContent = 'Quota saved.';
        status.dataset.tone = 'ok';
        setTimeout(async () => { close(); await refreshTeam(); }, 220);
      } catch (error) {
        status.textContent = error?.message || 'Quota was not saved.';
        status.dataset.tone = 'bad';
        save.disabled = false;
      }
    }, true);
    const info = el('p', 'au-row__meta', row.quota_bytes ? `${fmtBytes(row.used_bytes)} used of ${fmtBytes(row.quota_bytes)} · ${row.percentage ?? 0}%` : 'Storage usage is unavailable.');
    const form = el('div', 'au-form');
    form.append(info, field('Quota (GB)', quotaGb), save, status, button('Close', close));
    modal.append(form);
  });
}

async function removeMember(member) {
  if (!confirm(`Remove ${member.name} from Core? The account and Research access will remain.`)) return;
  try {
    await P.call(`/platform/team/${member.id}/`, { method: 'DELETE' });
    await refreshTeam();
  } catch (error) {
    alert(error?.message || 'The member could not be removed.');
  }
}

function teamStat(value, label, target, filter = '') {
  const node = el('button', 'au-team__stat');
  node.type = 'button';
  node.append(el('strong', '', String(value ?? 0)), el('span', '', label));
  node.addEventListener('click', () => {
    const section = document.getElementById(target);
    if (!section) return;
    if (filter) section.dataset.filter = filter;
    for (const row of section.querySelectorAll('.au-row')) {
      row.hidden = filter === 'admin' ? !['admin', 'owner'].some((role) => row.dataset.role === role)
        : filter === 'active' ? row.dataset.active !== 'true' : false;
    }
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  return node;
}

export async function renderCoreTeam(host, { go } = {}) {
  page.host = host;
  page.go = go;
  host.innerHTML = '';
  const doc = el('div', 'ws-doc ws-doc--wide');
  const head = el('header', 'ws-doc__head');
  head.append(el('h1', 'ws-doc__title', 'Team & Access'));
  head.append(el('p', 'ws-doc__meta', 'Manage Core membership, roles, account state, password recovery and storage from one place.'));
  doc.append(head);
  const wait = el('div', 'ws-skel');
  for (let i = 0; i < 6; i += 1) wait.append(el('i'));
  doc.append(wait);
  host.append(doc);
  try {
    const [data, storageData] = await Promise.all([P.team(), P.teamStorage().catch(() => null)]);
    if (!doc.isConnected) return;
    wait.remove();
    const root = el('div', 'au-team');
    root.dataset.auTeamRoot = VERSION;
    const toolbar = el('div', 'au-team__toolbar');
    const left = el('div', 'au-row__actions');
    left.append(button('Add member', openAddMember, true), button('Refresh', refreshTeam));
    const right = el('div', 'au-row__actions');
    right.append(button('Platform users', () => navigate('/workspace/core/admin/users')));
    toolbar.append(left, right);
    root.append(toolbar);

    const counts = data.counts || {};
    const statGrid = el('div', 'au-team__stats');
    statGrid.append(
      teamStat(counts.core_members, 'Members', 'au-core-members'),
      teamStat(counts.core_admins, 'Admins', 'au-core-members', 'admin'),
      teamStat(counts.active_members, 'Active', 'au-core-members', 'active'),
      teamStat(counts.external_researchers, 'Researchers', 'au-researchers'),
      teamStat(counts.registered_users, 'Accounts', 'au-accounts'),
    );
    root.append(statGrid);

    const storageByUser = new Map((storageData?.users || []).map((item) => [Number(item.user_id), item]));
    const membersPanel = teamPanel('Core members', `${(data.members || []).length} member${(data.members || []).length === 1 ? '' : 's'}`);
    membersPanel.box.id = 'au-core-members';
    if (!(data.members || []).length) membersPanel.body.append(el('div', 'au-empty', 'No Core members found.'));
    for (const member of data.members || []) {
      const storage = storageByUser.get(Number(member.id));
      const badges = [P.label(member.role), member.is_active ? 'Active' : 'Inactive', member.nextcloud?.provisioned ? 'Nextcloud' : '', `${member.research_projects || 0} research`];
      if (storage) badges.push(`${storage.percentage ?? 0}% storage`);
      const actions = [];
      const protectedOwner = member.role === 'owner' && !data.viewer?.is_superuser;
      const protectedSuper = member.is_superuser && !data.viewer?.is_superuser;
      if (!protectedOwner && !protectedSuper) actions.push(button('Edit', () => openMemberEditor(member, data.viewer), false, true));
      if (!protectedSuper) actions.push(button('Password', () => openPasswordReset(member), false, true));
      if (!protectedSuper) actions.push(button('Storage', () => openStorageEditor(member, storage), false, true));
      actions.push(button('Account', () => navigate(`/workspace/core/admin/users/${member.id}`), false, true));
      if (!protectedOwner && !protectedSuper && member.id !== data.viewer?.id) actions.push(button('Remove', () => removeMember(member), false, true));
      const row = teamRow(member.name, P.meta?.([member.email, member.last_login ? `Last login ${P.formatDate(member.last_login)}` : 'Never signed in']) || member.email, badges, actions);
      row.dataset.role = member.role;
      row.dataset.active = String(!!member.is_active);
      membersPanel.body.append(row);
    }
    root.append(membersPanel.box);

    const researchersPanel = teamPanel('External researchers', 'Research participants who are not Core members.');
    researchersPanel.box.id = 'au-researchers';
    if (!(data.researchers || []).length) researchersPanel.body.append(el('div', 'au-empty', 'No external researchers.'));
    for (const user of data.researchers || []) {
      researchersPanel.body.append(teamRow(user.name, P.meta?.([user.email, user.institution, user.headline]) || user.email, [`${user.research_projects || 0} projects`, user.is_active ? 'Active' : 'Inactive'], [
        button('Add to Core', addExistingToCore(user), true, true),
        button('Account', () => navigate(`/workspace/core/admin/users/${user.id}`), false, true),
      ]));
    }
    root.append(researchersPanel.box);

    const accountsPanel = teamPanel('Registered accounts', 'Accounts without Core membership or Research participation.');
    accountsPanel.box.id = 'au-accounts';
    if (!(data.registered_users || []).length) accountsPanel.body.append(el('div', 'au-empty', 'No unassigned registered accounts.'));
    for (const user of data.registered_users || []) {
      accountsPanel.body.append(teamRow(user.name, P.meta?.([user.email, user.date_joined ? `Joined ${P.formatDate(user.date_joined)}` : '']) || user.email, [user.is_active ? 'Active' : 'Inactive', user.nextcloud?.provisioned ? 'Nextcloud' : ''], [
        button('Add to Core', addExistingToCore(user), true, true),
        button('Account', () => navigate(`/workspace/core/admin/users/${user.id}`), false, true),
      ]));
    }
    root.append(accountsPanel.box);
    doc.append(root);
  } catch (error) {
    if (!doc.isConnected) return;
    wait.remove();
    const alert = el('div', 'ws-alert');
    alert.append(el('strong', 'ws-alert__title', 'Team controls unavailable'), el('p', '', error?.message || 'The team service did not answer.'), button('Retry', () => renderCoreTeam(host, { go })));
    doc.append(alert);
  }
}
