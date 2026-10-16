/* Files are the default project surface. The existing Markdown reader is
 * reused, and all saves carry an exact remote revision. Conflict drafts stay
 * in the visible editor; choosing mine/remote is an explicit guarded save. */
import { call, upload } from './ws-platform.js?v=20261016-task1';
import { nextcloudSsoUrl } from './ws-nextcloud-sso.js?v=20261016-task1';
import { renderNoteMarkdown } from './ws-notes-markdown.js?v=20261016-task1';
import { showProjectFileHistory } from './ws-project-history.js?v=20261016-task1';
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const button = (text, fn) => { const n = el('button', 'ws-btn', text); n.type = 'button'; n.onclick = fn; return n; };
export async function renderProjectStructure(doc, projectId) {
  const box = el('section', 'fl-panel wc-card project-files'); box.append(el('h2', 'fl-panel__title', 'Project folder'), el('p', 'fl-muted', 'Browse folders, project.md and working documents here. The Attachments tab lists uploaded files and datasets. Both belong to this project.'));
  const status = el('p', 'fl-muted', 'Loading files…'), toolbar = el('div', 'fl-row__actions'), tree = el('div', 'project-files__list'), editor = el('section', 'fl-panel'); editor.hidden = true; box.append(status, toolbar, tree, editor); doc.append(box);
  const endpoint = `/platform/projects/${projectId}`;
  let current = '', data;
  async function open(path) {
    try {
      data = await call(`${endpoint}/structure/?path=${encodeURIComponent(path)}`); current = path; editor.hidden = true;
      status.textContent = `${data.root}/${path}`; tree.replaceChildren(); toolbar.replaceChildren();
      if (path) toolbar.append(button('Parent folder', () => open(path.split('/').slice(0, -1).join('/'))));
      const native = el('a', 'ws-btn', 'Open this folder in Nextcloud'); native.href = nextcloudSsoUrl(data.native_url); native.target = '_blank'; native.rel = 'noopener'; toolbar.append(native);
      if (data.enabled) {
        if (!path) toolbar.append(button('Edit project.md in Markdown editor', () => edit('project.md')));
        const notebookLink = el('a', 'ws-btn', 'Open shared Notes editor');
        notebookLink.href = '/workspace/research/notes';
        notebookLink.title = 'Open the same Notes editor used in Core; project source files stay here.';
        toolbar.append(notebookLink);
      }
      else {
        status.textContent += ' · Project files are available; content migration is pending.';
        if (data.can_adopt) toolbar.append(button('Adopt canonical files', async () => {
          if (!confirm('Back up existing content, verify canonical files and activate file-first storage for this project?')) return;
          try { await call(`${endpoint}/structure/`, { method: 'POST', body: { action: 'adopt' } }); open(''); } catch (e) { status.textContent = e.message; }
        }));
      }
      if (data.can_edit) {
        toolbar.append(button('New folder', () => create('folder')), button('New file', () => create('file')));
        const picker = el('input'); picker.type = 'file'; picker.hidden = true;
        picker.onchange = async () => {
          const file = picker.files[0]; if (!file) return;
          const form = new FormData(); form.append('action', 'upload'); form.append('path', (current ? current + '/' : '') + file.name); form.append('file', file);
          try { await upload(`${endpoint}/structure/`, form); await open(current); status.textContent = 'File uploaded.'; } catch (e) { status.textContent = e.message; }
        };
        toolbar.append(picker, button('Upload file', () => picker.click()));
      }
      if (!data.items?.length) tree.append(el('p', 'fl-muted', 'This folder is empty.'));
      for (const item of data.items || []) {
        const row = el('div', 'fl-row');
        if (item.folder) row.append(button(`${item.name}/`, () => open(item.path)));
        else if (item.canonical || /\.(md|txt|json|csv)$/i.test(item.name)) row.append(button(item.name, () => edit(item.path, !item.canonical)));
        else { const link = el('a', 'ws-btn', item.name); link.href = `/api${endpoint}/file-content/?path=${encodeURIComponent(item.path)}`; link.target = '_blank'; link.rel = 'noopener'; row.append(link); }
        if (!item.canonical && data.can_edit && !['01_Client_Input', '02_Working', '03_Datasets', '04_Analysis', '05_Deliverables', '06_Archive', 'project.md'].includes(item.path) && !item.path.startsWith('02_Working/Research') && !'02_Working/Research'.startsWith(item.path + '/') && !item.path.startsWith('06_Archive')) {
          row.append(button('Move to archive', async () => {
            if (!confirm(`Move ${item.name} to the project archive? You can restore it in Nextcloud.`)) return;
            try { await call(`${endpoint}/structure/`, { method: 'POST', body: { action: 'trash', path: item.path, etag: item.etag } }); await open(current); } catch (e) { status.textContent = e.message; }
          }));
          row.append(button('Rename or move', async () => {
          const target = prompt('New project-relative path', item.path); if (!target || target === item.path) return;
          try { await call(`${endpoint}/structure/`, { method: 'POST', body: { action: 'move', path: item.path, target, etag: item.etag } }); open(current); } catch (e) { status.textContent = e.message; }
          }));
        }
        row.append(el('small', 'fl-muted', item.size ? `${item.size} bytes` : '')); tree.append(row);
      }
    } catch (e) { status.textContent = e.message === 'cloud_unavailable' ? 'Project storage is temporarily unavailable. Retry in a moment.' : e.message; toolbar.replaceChildren(button('Retry', () => open(path))); }
  }
  async function create(action) {
    const name = prompt(action === 'folder' ? 'Folder name' : 'File name, e.g. synthesis.md'); if (!name) return;
    try { await call(`${endpoint}/structure/`, { method: 'POST', body: { action, path: (current ? current + '/' : '') + name, content: '' } }); open(current); } catch (e) { status.textContent = e.message; }
  }
  async function edit(path, generic = false) {
    try {
      const url = `${endpoint}/file-content/?path=${encodeURIComponent(path)}${generic ? '&edit=1' : ''}`;
      const file = await call(url); let etag = file.etag;
      editor.hidden = false; editor.replaceChildren(el('h3', null, path));
      const input = el('textarea', 'ws-input');
      input.rows = 16; input.value = file.content;
      input.setAttribute('aria-label', 'Canonical file content');
      input.disabled = !file.can_edit;
      const draftKey = 'gq.project-draft.' + projectId + ':' + path;
      const storeDraft = () => {
        try { sessionStorage.setItem(draftKey, JSON.stringify({ content: input.value, etag })); }
        catch { /* browser storage unavailable */ }
      };
      const clearDraft = () => {
        try { sessionStorage.removeItem(draftKey); } catch {}
      };
      try {
        const restored = JSON.parse(sessionStorage.getItem(draftKey) || 'null');
        if (restored && typeof restored.content === 'string' && restored.content !== file.content) {
          input.value = restored.content;
          etag = restored.etag || etag;
          status.textContent = 'Unsaved project-file draft restored; review before saving';
        }
      } catch { /* invalid draft should not block editing */ }
      const preview = el('div');
      const paint = () => { preview.replaceChildren(renderNoteMarkdown(input.value)); };
      input.oninput = () => {
        storeDraft(); paint();
        status.textContent = 'Editing · unsaved draft retained in this browser tab';
      };
      const split = el('div', 'fl-row');
      split.style.flexWrap = 'wrap';
      split.style.alignItems = 'flex-start';
      input.style.flex = '1 1 320px'; preview.style.flex = '1 1 320px';
      split.append(input, preview);
      const tools = el('div', 'fl-row__actions');
      tools.append(button('Refresh preview', paint));
      tools.append(button('Copy file link', async () => {
        const link = new URL('/workspace/research/projects/' + projectId + '/structure', location.origin);
        link.searchParams.set('file', path);
        try { await navigator.clipboard.writeText(link.href); status.textContent = 'Link copied'; }
        catch { status.textContent = link.href; }
      }));
      editor.append(split, tools);
      paint();
      const conflicts = el('div'); editor.append(conflicts);
      let saving = false;
      const save = async () => {
        if (saving || !file.can_edit) return;
        const submitted = input.value;
        saving = true;
        storeDraft();
        try {
          const result = await call(url, { method: 'PUT', body: { content: submitted, etag } });
          if (result.content !== submitted || !result.etag) throw new Error('Could not confirm saved revision');
          etag = result.etag;
          if (input.value === submitted) {
            clearDraft();
            status.textContent = 'Saved to versioned project file';
          } else {
            storeDraft();
            status.textContent = 'Earlier revision saved; newer edits remain unsaved';
          }
          conflicts.replaceChildren();
        }
        catch (e) {
          storeDraft();
          const conflict = e.data?.conflict;
          if (!conflict) { status.textContent = 'Not confirmed: ' + e.message + '. Draft retained.'; return; }
          status.textContent = 'Another edit changed this file. Both versions are preserved below.';
          conflicts.replaceChildren(el('h3', null, 'Resolve conflict'));
          for (const [label, value] of [['Base version', conflict.base], ['Your version', input.value], ['Current remote version', conflict.remote]]) { const text = el('pre', 'fl-prose', value); conflicts.append(el('h4', null, label), text); }
          conflicts.append(button('Keep mine', () => { etag = conflict.etag; save(); }), button('Keep remote', () => { input.value = conflict.remote; etag = conflict.etag; status.textContent = 'Remote version loaded. Your previous version remains visible below.'; }), button('Manual merge in editor', () => { etag = conflict.etag; input.focus(); status.textContent = 'Merge in the editor, then Save. The remote revision will be checked again.'; }));
        } finally { saving = false; }
      };
      input.addEventListener('keydown', event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          save();
        }
      });
      if (!generic) editor.append(button('Version history', () => showProjectFileHistory({ endpoint, path, editor, input, etag, canEdit: file.can_edit, repaint: paint, report: message => { status.textContent = message; } })));
      if (file.can_edit) editor.append(button('Save Ctrl+S', save));
      const address = new URL(location.href);
      address.searchParams.set('file', path);
      history.replaceState(history.state, '', address.pathname + address.search + address.hash);
    } catch (e) { status.textContent = e.message; }
  }
  await open('');
  const target = new URLSearchParams(location.search).get('file');
  if (target && target.length < 800 && !target.startsWith('/') && !target.includes('..')) {
    await edit(target, target !== 'project.md');
  }
}
