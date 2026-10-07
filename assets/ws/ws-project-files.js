/* Files are the default project surface. The existing Markdown reader is
 * reused, and all saves carry an exact remote revision. Conflict drafts stay
 * in the visible editor; choosing mine/remote is an explicit guarded save. */
import { call, upload } from './ws-platform.js?v=20260914-6';
import { renderNoteMarkdown } from './ws-notes-markdown.js';
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const button = (text, fn) => { const n = el('button', 'ws-btn', text); n.type = 'button'; n.onclick = fn; return n; };
export async function renderProjectStructure(doc, projectId) {
  const box = el('section', 'fl-panel'); box.append(el('h2', null, 'Project files'), el('p', 'fl-muted', 'Everything belonging to this project lives in its own Team Folder.'));
  const status = el('p', 'fl-muted', 'Loading files…'), toolbar = el('div', 'fl-row__actions'), tree = el('div'), editor = el('section', 'fl-panel'); box.append(status, toolbar, tree, editor); doc.append(box);
  const endpoint = `/platform/projects/${projectId}`;
  let current = '', data;
  async function open(path) {
    try {
      data = await call(`${endpoint}/structure/?path=${encodeURIComponent(path)}`); current = path;
      status.textContent = `${data.root}/${path}`; tree.replaceChildren(); toolbar.replaceChildren();
      if (path) toolbar.append(button('Parent folder', () => open(path.split('/').slice(0, -1).join('/'))));
      const native = el('a', 'ws-btn', 'Open this folder in Nextcloud'); native.href = data.native_url; native.target = '_blank'; native.rel = 'noopener'; toolbar.append(native);
      if (data.enabled) toolbar.append(button('project.md', () => edit('project.md')));
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
      for (const item of data.items) {
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
    } catch (e) { status.textContent = e.message; toolbar.replaceChildren(button('Retry', () => open(path))); }
  }
  async function create(action) {
    const name = prompt(action === 'folder' ? 'Folder name' : 'File name, e.g. synthesis.md'); if (!name) return;
    try { await call(`${endpoint}/structure/`, { method: 'POST', body: { action, path: (current ? current + '/' : '') + name, content: '' } }); open(current); } catch (e) { status.textContent = e.message; }
  }
  async function edit(path, generic = false) {
    try {
      const url = `${endpoint}/file-content/?path=${encodeURIComponent(path)}${generic ? '&edit=1' : ''}`;
      const file = await call(url); let etag = file.etag;
      editor.replaceChildren(el('h3', null, path));
      const input = el('textarea', 'ws-input'); input.rows = 16; input.value = file.content; input.setAttribute('aria-label', 'Canonical file content'); input.disabled = !file.can_edit;
      const preview = el('div'); const paint = () => { preview.replaceChildren(renderNoteMarkdown(input.value)); }; input.oninput = paint;
      editor.append(input, button('Preview Markdown', paint), preview); const conflicts = el('div'); editor.append(conflicts);
      const save = async () => {
        try { const result = await call(url, { method: 'PUT', body: { content: input.value, etag } }); etag = result.etag; input.value = result.content; status.textContent = 'Saved to project files.'; conflicts.replaceChildren(); }
        catch (e) {
          const conflict = e.data?.conflict;
          if (!conflict) { status.textContent = e.message; return; }
          status.textContent = 'Another edit changed this file. Both versions are preserved below.';
          conflicts.replaceChildren(el('h3', null, 'Resolve conflict'));
          for (const [label, value] of [['Base version', conflict.base], ['Your version', input.value], ['Current remote version', conflict.remote]]) { const text = el('pre', 'fl-prose', value); conflicts.append(el('h4', null, label), text); }
          conflicts.append(button('Keep mine', () => { etag = conflict.etag; save(); }), button('Keep remote', () => { input.value = conflict.remote; etag = conflict.etag; status.textContent = 'Remote version loaded. Your previous version remains visible below.'; }), button('Manual merge in editor', () => { etag = conflict.etag; input.focus(); status.textContent = 'Merge in the editor, then Save. The remote revision will be checked again.'; }));
        }
      };
      if (file.can_edit) editor.append(button('Save', save));
    } catch (e) { status.textContent = e.message; }
  }
  await open('');
}
