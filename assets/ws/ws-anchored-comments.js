/* One line-anchored discussion UI reused by Core tasks and Research/Core notes.
 * Comments are separate Nextcloud JSON files, not extra copies of the objects.
 */
import * as P from './ws-platform.js?v=20261016-r2';

const el = (tag, text, cls) => {
  const item = document.createElement(tag);
  if (cls) item.className = cls;
  if (text != null) item.textContent = text;
  return item;
};
const button = (text, fn) => {
  const item = el('button', text, 'ws-btn');
  item.type = 'button';
  item.addEventListener('click', fn);
  return item;
};

export function mountAnchoredComments({ container, kind, id, fields, canEdit = false }) {
  if (!container || !['note', 'task'].includes(kind) || !fields?.length) return null;
  const root = el('section', null, 'fl-panel ws-line-comments');
  const toggle = button('Line comments', () => {
    root.hidden = !root.hidden;
    if (!root.hidden) load();
  });
  toggle.setAttribute('aria-expanded', 'false');
  root.hidden = true;
  const heading = el('h3', 'Comments on selected lines');
  const hint = el('p', 'Place the text cursor on a line, then add a comment. Save edits to the note or task first.', 'fl-muted');
  const state = el('p', '', 'fl-muted');
  const list = el('div', null, 'ws-line-comments__list');
  const form = el('form', null, 'ws-line-comments__form');
  const select = el('select');
  for (const field of fields) {
    const option = el('option', field.label);
    option.value = field.key;
    select.append(option);
  }
  const input = el('textarea');
  input.rows = 3;
  input.placeholder = 'Your comment';
  input.setAttribute('aria-label', 'Line comment');
  const submit = el('button', 'Comment on selected line', 'ws-btn ws-btn--solid');
  submit.type = 'submit';
  if (canEdit) form.append(select, input, submit);
  else form.append(el('p', 'You can read these comments but cannot add one.', 'fl-muted'));

  async function load() {
    state.textContent = 'Loading comments…';
    try {
      const result = await P.call(`/platform/anchored-comments/${kind}/${id}/`);
      list.replaceChildren();
      for (const comment of result.comments || []) {
        const row = el('div', null, 'fl-row');
        const source = comment.anchor || {};
        const title = el('strong', `${comment.author || 'Member'} · ${source.field || ''} line ${source.line || '?'}`);
        const quote = el('small', source.quote || '(empty line)', 'fl-muted');
        const body = el('p', comment.text || '');
        const jump = button('Find line', () => {
          const field = fields.find(f => f.key === source.field);
          const control = field?.element;
          if (!control) return;
          const lines = control.value.split('\n');
          let index = Number(source.line) - 1;
          if (!lines[index] || lines[index] !== source.quote) {
            index = lines.findIndex(line => line === source.quote);
          }
          if (index < 0) { state.textContent = 'This line moved or was edited.'; return; }
          const before = lines.slice(0, index).join('\n');
          const start = index === 0 ? 0 : before.length + 1;
          control.focus();
          control.setSelectionRange(start, start + lines[index].length);
        });
        row.append(title, quote, body, jump);
        list.append(row);
      }
      state.textContent = (result.comments || []).length
        ? `${result.comments.length} line comments` : 'No line comments yet.';
    } catch (error) {
      state.textContent = error?.data?.detail || error?.message || 'Comments could not be loaded.';
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const field = fields.find(f => f.key === select.value);
    if (!field) return;
    const control = field.element;
    const value = control.value || '';
    const pos = Math.max(0, Math.min(value.length, control.selectionStart || 0));
    const line = value.slice(0, pos).split('\n').length;
    const quote = value.split('\n')[line - 1] || '';
    if (!input.value.trim()) {
      state.textContent = 'Write your comment first.';
      return;
    }
    submit.disabled = true;
    state.textContent = 'Posting comment…';
    try {
      await P.call(`/platform/anchored-comments/${kind}/${id}/`, {
        method: 'POST', body: {field: field.key, line, quote, text: input.value.trim()},
      });
      input.value = '';
      await load();
    } catch (error) {
      state.textContent = error?.data?.detail || error?.data?.error || error?.message ||
        'Comment not posted. Your text is still here.';
    } finally { submit.disabled = false; }
  });

  toggle.addEventListener('click', () => toggle.setAttribute('aria-expanded', String(!root.hidden)));
  root.append(heading, hint, state, list, form);
  container.append(toggle, root);
  return { reload: load, root };
}
