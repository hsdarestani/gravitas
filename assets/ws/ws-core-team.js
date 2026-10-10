/* ==========================================================================
   GRAVITAS+ WORKSPACE  ·  CORE · TEAM & ACCESS
   Who is in Core, what role they hold, whether they can sign in, how much
   storage they use, and who could be brought in.

   This screen used to be drawn twice. ws-views drew a read-only list of
   names, and a second module, ws-actionable-ui.js, waited for that list to
   appear, deleted it, and drew the real management screen in its place with
   its own injected stylesheet. A reader saw the wrong screen first on every
   visit, and two files had to agree on markup neither owned. It is now one
   renderer, built from the Admin Kit parts every Platform Admin screen uses,
   so Team reads like Users & Access beside it.

   Every change goes through /platform/team/. The server decides who may
   change whom; the screen only hides what it already knows the server will
   refuse (an owner or a superuser edited by someone who is not one), so the
   reader is not offered a button that can only fail.
   ========================================================================== */

import * as P from './ws-platform.js?v=20261008-operational2';
import * as K from './ws-admin-kit.js?v=20261011-r1';

const { el } = K;
const TITLE = 'Team & Access';
const GB = 1024 ** 3;

function bytes(value) {
  const n = Number(value || 0);
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i > 2 ? 1 : 0)} ${units[i]}`;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function renderCoreTeam(host, { go } = {}) {
  K.loading(host, TITLE, { tiles: 5, cards: [12, 12] });
  let data;
  let storage = null;
  try {
    [data, storage] = await Promise.all([P.team(), P.teamStorage().catch(() => null)]);
  } catch (error) {
    K.failure(host, TITLE, error, () => renderCoreTeam(host, { go }));
    return;
  }
  if (!host.isConnected) return;
  draw(host, data, storage, { go, reload: () => renderCoreTeam(host, { go }) });
}

function draw(host, data, storage, ctx) {
  const viewer = data.viewer || {};
  const members = data.members || [];
  const researchers = data.researchers || [];
  const accounts = data.registered_users || [];
  const counts = data.counts || {};
  const storageOf = new Map((storage?.users || []).map((item) => [Number(item.user_id), item]));
  let filter = '';

  const wrap = K.page(host, {
    title: TITLE,
    meta: 'Core membership, roles, sign-in, password recovery and storage.',
    actions: [
      K.button('Add member', () => addMember(ctx), { solid: true }),
      ctx.go ? K.link(ctx.go, 'Platform users', '/workspace/core/admin/users') : null,
    ].filter(Boolean),
  });

  const membersCard = K.card({ title: 'Core members', note: plural(members.length, 'member') });
  const researchersCard = K.card({ title: 'External researchers', note: 'Research participants who are not Core members.' });
  const accountsCard = K.card({ title: 'Registered accounts', note: 'Accounts with neither Core membership nor Research work.' });

  const show = (next, target) => {
    filter = next;
    drawMembers();
    target.box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const tiles = K.tiles([
    K.tile({ value: counts.core_members ?? members.length, label: 'Members', icon: 'team', onClick: () => show('', membersCard) }),
    K.tile({ value: counts.core_admins ?? 0, label: 'Admins', icon: 'secure', onClick: () => show('admin', membersCard) }),
    K.tile({ value: counts.active_members ?? 0, label: 'Can sign in', icon: 'check', onClick: () => show('active', membersCard) }),
    K.tile({ value: counts.external_researchers ?? researchers.length, label: 'Researchers', icon: 'people', onClick: () => researchersCard.box.scrollIntoView({ behavior: 'smooth', block: 'start' }) }),
    K.tile({ value: counts.registered_users ?? accounts.length, label: 'Accounts', icon: 'collaboration', onClick: () => accountsCard.box.scrollIntoView({ behavior: 'smooth', block: 'start' }) }),
  ]);

  function drawMembers() {
    membersCard.body.replaceChildren();
    const shown = members.filter((member) => (
      filter === 'admin' ? ['admin', 'owner'].includes(member.role)
        : filter === 'active' ? member.is_active : true
    ));
    if (filter) {
      membersCard.body.append(K.cardActions([
        K.badge(filter === 'admin' ? 'Admins and owners' : 'Members who can sign in'),
        K.button('Show all', () => { filter = ''; drawMembers(); }, { tiny: true }),
      ]));
    }
    if (!shown.length) {
      membersCard.body.append(K.empty(members.length ? 'Nobody matches this filter.' : 'No Core members yet.'));
      return;
    }
    membersCard.body.append(K.list(shown.map((member) => memberRow(member, viewer, storageOf.get(Number(member.id)), ctx))));
  }
  drawMembers();

  researchersCard.body.append(researchers.length
    ? K.list(researchers.map((user) => K.row({
      title: user.name || user.email,
      meta: P.meta([user.email, user.institution, user.headline]),
      lead: K.avatar(user.name || user.email),
      badges: [plural(user.research_projects || 0, 'project'), K.stateBadge(user.is_active ? 'active' : 'disabled', user.is_active ? 'Active' : 'Inactive')],
      actions: [
        K.button('Add to Core', () => addExisting(user, ctx), { tiny: true, solid: true }),
        ctx.go ? K.link(ctx.go, 'Account', `/workspace/core/admin/users/${user.id}`, { tiny: true }) : null,
      ],
    })))
    : K.empty('No external researchers.'));

  accountsCard.body.append(accounts.length
    ? K.list(accounts.map((user) => K.row({
      title: user.name || user.email,
      meta: P.meta([user.email, user.date_joined ? `Joined ${P.formatDate(user.date_joined)}` : '']),
      lead: K.avatar(user.name || user.email),
      badges: [K.stateBadge(user.is_active ? 'active' : 'disabled', user.is_active ? 'Active' : 'Inactive'), user.nextcloud?.provisioned ? 'Nextcloud' : ''],
      actions: [
        K.button('Add to Core', () => addExisting(user, ctx), { tiny: true, solid: true }),
        ctx.go ? K.link(ctx.go, 'Account', `/workspace/core/admin/users/${user.id}`, { tiny: true }) : null,
      ],
    })))
    : K.empty('No unassigned accounts.'));

  wrap.append(tiles, K.bento([membersCard.box, researchersCard.box, accountsCard.box]));
}

function memberRow(member, viewer, store, ctx) {
  // The server refuses these either way; the buttons are simply not offered.
  const ownerLocked = member.role === 'owner' && !viewer.is_superuser;
  const superLocked = member.is_superuser && !viewer.is_superuser;
  const badges = [
    K.badge(P.label(member.role)),
    K.stateBadge(member.is_active ? 'active' : 'disabled', member.is_active ? 'Can sign in' : 'Signed out'),
    member.nextcloud?.provisioned ? 'Nextcloud' : '',
    store ? `${store.percentage ?? 0}% storage` : '',
  ];
  return K.row({
    title: member.name || member.email,
    meta: P.meta([member.email, member.last_login ? `Last signed in ${P.formatDate(member.last_login)}` : 'Never signed in', plural(member.research_projects || 0, 'research project')]),
    lead: K.avatar(member.name || member.email),
    badges,
    actions: [
      !ownerLocked && !superLocked ? K.button('Edit', () => editMember(member, viewer, ctx), { tiny: true }) : null,
      !superLocked ? K.button('Password', () => resetPassword(member), { tiny: true }) : null,
      !superLocked ? K.button('Storage', () => editStorage(member, store, ctx), { tiny: true }) : null,
      ctx.go ? K.link(ctx.go, 'Account', `/workspace/core/admin/users/${member.id}`, { tiny: true }) : null,
      !ownerLocked && !superLocked && member.id !== viewer.id ? K.button('Remove', () => removeMember(member, ctx), { tiny: true, danger: true }) : null,
    ],
  });
}

/* ---- Changes ---------------------------------------------------------------- */

function addMember(ctx) {
  K.dialog('Add Core member', (grid) => {
    const email = K.input('', 'email', 'name@example.com');
    email.required = true;
    const name = K.input('', 'text', 'Display name');
    const role = K.select([['member', 'Member'], ['admin', 'Admin']], 'member');
    const password = K.input('', 'password', 'Optional');
    const setup = K.toggle(true, 'Send a password setup email', 'Leave the temporary password empty to rely on the email.');
    grid.append(K.fields([K.field('Email', email), K.field('Name', name), K.field('Core role', role), K.field('Temporary password', password)], 2), setup.wrap);
    return { email, name, role, password, setup };
  }, {
    submit: 'Add member',
    onSubmit: async ({ email, name, role, password, setup }) => {
      await P.call('/platform/team/', { method: 'POST', body: {
        email: email.value.trim(), name: name.value.trim(), role: role.value,
        password: password.value, send_setup: setup.input.checked,
      } });
      ctx.reload();
    },
  });
}

async function addExisting(user, ctx) {
  try {
    await P.call('/platform/team/', { method: 'POST', body: { email: user.email, name: user.name, role: 'member', send_setup: false } });
    ctx.reload();
  } catch (error) {
    K.dialog('Could not add to Core', (grid) => {
      grid.append(K.C.note(error?.message || `${user.name || user.email} was not added.`));
    });
  }
}

function editMember(member, viewer, ctx) {
  K.dialog(`Edit ${member.name || member.email}`, (grid) => {
    const name = K.input(member.name || '');
    const email = K.input(member.email || '', 'email');
    const options = member.role === 'owner' ? [['owner', 'Owner'], ['admin', 'Admin'], ['member', 'Member']] : [['admin', 'Admin'], ['member', 'Member']];
    const role = K.select(options, member.role);
    if (member.role === 'owner' && !viewer.is_superuser) role.disabled = true;
    const active = K.toggle(member.is_active, 'Can sign in', 'Turning this off signs the account out everywhere.');
    if (member.is_superuser && !viewer.is_superuser) active.input.disabled = true;
    grid.append(K.fields([K.field('Name', name), K.field('Email', email), K.field('Core role', role)], 2), active.wrap);
    return { name, email, role, active };
  }, {
    submit: 'Save',
    onSubmit: async ({ name, email, role, active }) => {
      const body = { name: name.value.trim(), email: email.value.trim(), is_active: active.input.checked };
      if (!role.disabled) body.role = role.value;
      await P.call(`/platform/team/${member.id}/`, { method: 'PATCH', body });
      ctx.reload();
    },
  });
}

function resetPassword(member) {
  K.dialog(`Password · ${member.name || member.email}`, (grid, { line }) => {
    const temp = K.input('', 'password', 'Temporary password');
    const say = (text, tone = '') => { line.textContent = text; line.dataset.tone = tone; };
    const email = K.button('Send a setup email', async () => {
      email.disabled = true;
      say('Sending…');
      try {
        await P.call(`/platform/team/${member.id}/password-reset/`, { method: 'POST', body: { mode: 'email' } });
        say('Password setup email sent.', 'ok');
      } catch (error) {
        say(error?.message || 'The email could not be sent.', 'bad');
        email.disabled = false;
      }
    }, { solid: true });
    const set = K.button('Set temporary password', async () => {
      set.disabled = true;
      say('Updating…');
      try {
        await P.call(`/platform/team/${member.id}/password-reset/`, { method: 'POST', body: { mode: 'temporary', password: temp.value } });
        say('Temporary password set.', 'ok');
      } catch (error) {
        say(error?.data?.messages?.join(' ') || error?.message || 'The password was not changed.', 'bad');
        set.disabled = false;
      }
    });
    grid.append(K.C.note('Either send the member a link to choose a password, or set one for them to change at next sign-in.'), K.cardActions([email]), K.field('Temporary password', temp), K.cardActions([set]));
  });
}

function editStorage(member, store, ctx) {
  K.dialog(`Storage · ${member.name || member.email}`, (grid) => {
    const quota = K.input(store?.quota_bytes ? (store.quota_bytes / GB).toFixed(2) : '5', 'number');
    Object.assign(quota, { min: '0.1', max: '2048', step: '0.1' });
    grid.append(
      K.C.note(store?.quota_bytes ? `${bytes(store.used_bytes)} used of ${bytes(store.quota_bytes)} · ${store.percentage ?? 0}%` : 'Storage use is not available for this account.'),
      K.field('Quota (GB)', quota),
    );
    return { quota };
  }, {
    submit: 'Save quota',
    onSubmit: async ({ quota }) => {
      await P.call(`/platform/team/${member.id}/storage/`, { method: 'PATCH', body: { quota_bytes: Math.round(Number(quota.value) * GB) } });
      ctx.reload();
    },
  });
}

function removeMember(member, ctx) {
  K.dialog(`Remove ${member.name || member.email} from Core?`, (grid) => {
    grid.append(K.C.note('Their account and any Research access stay. Only Core membership is removed.'));
  }, {
    submit: 'Remove from Core',
    danger: true,
    onSubmit: async () => {
      await P.call(`/platform/team/${member.id}/`, { method: 'DELETE' });
      ctx.reload();
    },
  });
}
