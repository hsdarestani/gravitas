/* Secure, opt-in provider bindings and explicit Nextcloud push workflow.
   Server-side draft buffer is kept separate from canonical DAV until Push. */
import * as P from './ws-platform.js?v=20261016-task1';

const el = (tag, text = '', cls = '') => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  n.textContent = text;
  return n;
};
const button = (label, fn, solid = false) => {
  const n = el('button', label, solid ? 'ws-btn ws-btn--solid' : 'ws-btn');
  n.type = 'button';
  n.addEventListener('click', fn);
  return n;
};
const detail = value => String(value?.message || value || '').slice(0, 280);
const input = (placeholder = '') => {
  const n = el('input', '', 'v-input');
  n.type = 'text'; n.placeholder = placeholder; n.setAttribute('aria-label', placeholder);
  return n;
};

export async function mountProjectProviders(host, projectId, project) {
  host.textContent = 'Checking optional providers…';
  try {
    const response = await P.call(`/platform/projects/${projectId}/tools/plugins/`);
    host.replaceChildren(el('h3', 'Additional providers'));
    const list = el('div', '', 'ws-live-tools');
    host.append(list);
    const states = response.plugins || [];
    for (const tool of states) {
      const item = el('div', '', 'ws-live-tool');
      const title = tool.id.replaceAll('_', ' ');
      item.append(el('strong', title), el('small', `Mode: ${tool.mode}`));
      if (tool.state === 'setup_required') item.append(el('small', 'No executable plugin installed'));
      list.append(item);
    }
    if (!project.permissions?.can_manage) return;
    const aliases = await P.call(`/platform/projects/${projectId}/tools/providers/`);
    for (const kind of ['private_git', 'remote_db']) {
      if (!(project.selected_integrations || []).includes(kind === 'private_git' ? 'git' : 'database')) continue;
      const available = aliases.providers?.[kind] || [];
      const box = el('section', '', 'ws-live-tool');
      box.append(el('strong', kind === 'private_git' ? 'Private GitHub (read only)' : 'External database (connectivity only)'));
      if (!available.length) {
        box.append(el('small', 'No approved server-side credentials or connections available. Ask the server administrator to configure an alias.'));
        host.append(box);
        continue;
      }
      const choices = el('select', '', 'v-input');
      choices.setAttribute('aria-label', 'Approved provider');
      for (const key of available) {
        const option = el('option', key); option.value = key; choices.append(option);
      }
      const repo = kind === 'private_git' ? input('owner/private-repository') : null;
      const status = el('small');
      const connect = button('Verify and connect', async () => {
        connect.disabled = true;
        status.textContent = 'Verifying approved provider…';
        try {
          const body = { alias: choices.value };
          if (repo) body.repository = repo.value.trim();
          await P.call(`/platform/projects/${projectId}/tools/providers/${kind}/`, { method: 'POST', body });
          status.textContent = 'Verified. Credentials remain on the server.';
          await mountProjectProviders(host, projectId, project);
        } catch (error) { status.textContent = detail(error); }
        finally { connect.disabled = false; }
      }, true);
      const disconnect = button('Disconnect', async () => {
        disconnect.disabled = true;
        try {
          await P.call(`/platform/projects/${projectId}/tools/providers/${kind}/`, { method: 'DELETE' });
          await mountProjectProviders(host, projectId, project);
        } catch (error) { status.textContent = detail(error); disconnect.disabled = false; }
      });
      box.append(choices);
      if (repo) box.append(repo);
      box.append(connect, disconnect, status);
      if (kind === 'private_git') {
        const commits = button('Recent private commits', async () => {
          const out = el('div', 'Loading…', 'ws-live-tool__history');
          box.append(out);
          try {
            const res = await P.call(`/platform/projects/${projectId}/tools/private-git/commits/`);
            out.replaceChildren(...(res.commits || []).map(row => el('p', `${row.sha.slice(0,8)} · ${row.message}`)));
          } catch (error) { out.textContent = detail(error); }
        });
        box.append(commits);
      }
      host.append(box);
    }
  } catch (error) {
    host.textContent = 'Optional providers unavailable: ' + detail(error);
  }
}

export async function renderProjectDrafts(doc, projectId, project) {
  const block = el('section', '', 'fl-panel wc-card');
  block.append(el('h2', 'Buffered editing and Nextcloud push', 'fl-panel__title wc-card__title'));
  const body = el('div', '', 'fl-panel__body wc-card__body');
  block.append(body); doc.append(block);
  body.append(el('p', 'Select an adopted project file. Save changes to a private buffer; Push explicitly to Nextcloud. Concurrent changes are never silently overwritten.'));
  if (!project.permissions?.can_edit) {
    body.append(el('p', 'Editing this project requires edit access.')); return;
  }
  const state = el('p', '', 'v-note');
  const options = el('select', '', 'v-input');
  options.setAttribute('aria-label', 'Project file');
  const toolbar = el('div', '', 'fl-form-actions');
  const editor = el('textarea', '', 'v-input');
  editor.rows = 18; editor.spellcheck = false;
  editor.style.width = '100%';
  const collision = el('div', '', 'ws-live-tool');
  collision.hidden = true;
  body.append(options, toolbar, editor, state, collision);
  let draft = null;
  let fileId = null;
  let changeTimer = 0;
  let saving = Promise.resolve();
  let dirty = false;
  const api = suffix => `/platform/projects/${projectId}/drafts/${fileId}/${suffix}`;
  const save = async () => {
    if (!dirty || !draft) return;
    const content = editor.value;
    dirty = false;
    saving = P.call(api(''), { method: 'PATCH', body: { content, revision: draft.revision } }).then(data => {
      draft = data.draft;
      state.textContent = 'Saved privately · revision ' + draft.revision;
    }).catch(error => { dirty = true; state.textContent = 'Draft not saved: ' + detail(error); throw error; });
    return saving;
  };
  const ensureSaved = async () => {
    clearTimeout(changeTimer);
    await saving;
    await save();
    await saving;
  };
  editor.addEventListener('input', () => {
    dirty = true;
    state.textContent = 'Unsaved local edit…';
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => { save().catch(() => {}); }, 1500);
  });
  const open = async () => {
    if (fileId && dirty) await ensureSaved();
    fileId = Number(options.value);
    if (!fileId) return;
    const response = await P.call(api(''), { method: 'POST', body: {} });
    draft = response.draft;
    editor.value = draft.content;
    dirty = false;
    collision.hidden = true;
    state.textContent = 'Buffered draft ready · revision ' + draft.revision;
  };
  const openBtn = button('Open file draft', () => {
    open().catch(error => { state.textContent = 'Open failed: ' + detail(error); });
  });
  const saveBtn = button('Save private draft', () => {
    ensureSaved().catch(error => { state.textContent = detail(error); });
  });
  const push = button('Push to Nextcloud', async () => {
    if (!draft) return;
    push.disabled = true;
    state.textContent = 'Checking remote version…';
    try {
      await ensureSaved();
      const result = await P.call(api('push/'), { method: 'POST', body: { revision: draft.revision } });
      draft = null;
      state.textContent = 'Pushed successfully to Nextcloud. Remote ETag: ' + result.etag;
      collision.hidden = true;
      await open();
    } catch (error) {
      const conflict = error.data?.conflict;
      if (error.status === 409 && conflict?.etag) {
        collision.hidden = false;
        collision.replaceChildren(
          el('strong', 'Remote conflict: review both versions before resolving'),
          el('small', 'Latest remote content (read-only)'),
        );
        const theirs = el('textarea', conflict.remote, 'v-input');
        theirs.readOnly = true; theirs.rows = 8; theirs.style.width = '100%';
        const mine = el('textarea', editor.value, 'v-input');
        mine.rows = 8; mine.style.width = '100%';
        const resolve = button('Save reviewed merge (does not push)', async () => {
          resolve.disabled = true;
          try {
            const result = await P.call(api(''), {
              method: 'PATCH', body: {
                content: mine.value, revision: draft.revision,
                resolve_against_etag: conflict.etag,
              },
            });
            draft = result.draft; editor.value = draft.content;
            dirty = false; collision.hidden = true;
            state.textContent = 'Merged draft saved. Review and Push explicitly.';
          } catch (err) { state.textContent = detail(err); resolve.disabled = false; }
        }, true);
        collision.append(theirs, el('small', 'Your reviewed final content'), mine, resolve);
        state.textContent = 'Changes conflict. Nothing was pushed.';
      } else state.textContent = 'Push stopped: ' + detail(error);
    } finally { push.disabled = false; }
  }, true);
  const discard = button('Discard my buffered draft', async () => {
    if (!fileId) return;
    if (!confirm('Discard your private buffered draft? This does not delete the Nextcloud file.')) return;
    try {
      clearTimeout(changeTimer); dirty = false;
      await P.call(api(''), { method: 'DELETE' });
      draft = null;
      await open();
    } catch (error) { state.textContent = detail(error); }
  });
  toolbar.append(openBtn, saveBtn, push, discard);
  try {
    const list = await P.call(`/platform/projects/${projectId}/drafts/`);
    if (!list.files?.length) {
      options.replaceChildren(el('option', 'No adopted canonical files available'));
      toolbar.hidden = true; editor.hidden = true;
      state.textContent = 'No canonical files are editable here yet. The project must first complete canonical adoption.';
      return;
    }
    for (const f of list.files) {
      const o = el('option', f.path + (f.has_draft ? ' · draft saved' : ''));
      o.value = f.id; options.append(o);
    }
    await open();
  } catch (error) { state.textContent = 'Buffered sync unavailable: ' + detail(error); }
}
