/* Previous project file snapshots are read-only until explicitly copied
 * into an editor draft. Saving always goes through If-Match conflict checks. */
import { call } from './ws-platform.js?v=20261011-r4';

const element = (tag, text = '') => {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
};

export async function showProjectFileHistory({ endpoint, path, editor, input, etag, canEdit, repaint, report }) {
  editor.querySelector('.project-version-history')?.remove();
  const panel = element('section');
  panel.className = 'project-version-history fl-panel';
  panel.append(element('h4', 'Version history'));
  editor.append(panel);
  const url = endpoint + '/file-revisions/?path=' + encodeURIComponent(path);
  try {
    const result = await call(url);
    if (result.current_etag !== etag) {
      panel.append(element('p', 'The Nextcloud file changed since this editor was opened. Saving will require conflict resolution.'));
    }
    if (!result.revisions.length) panel.append(element('p', 'No earlier snapshots have been recorded yet.'));
    for (const revision of result.revisions) {
      const action = element('button', new Date(revision.created_at).toLocaleString() + ' · ' + revision.source);
      action.type = 'button';
      action.className = 'ws-btn';
      action.addEventListener('click', async () => {
        try {
          const response = await call(url + '&revision_id=' + revision.id);
          panel.querySelector('.project-version-preview')?.remove();
          const wrapper = element('div');
          wrapper.className = 'project-version-preview';
          wrapper.append(element('p', 'Historical snapshot (read only)'));
          const preview = element('textarea');
          preview.className = 'ws-input';
          preview.rows = 9;
          preview.readOnly = true;
          preview.value = response.revision.content;
          wrapper.append(preview);
          if (canEdit) {
            const restore = element('button', 'Use as editor draft');
            restore.type = 'button';
            restore.className = 'ws-btn';
            restore.addEventListener('click', () => {
              if (!confirm('Replace your unsaved editor draft? Nothing is written until you press Save.')) return;
              input.value = preview.value;
              repaint();
              report('Historical snapshot loaded as a draft. Save checks the live Nextcloud revision.');
            });
            wrapper.append(restore);
          }
          panel.append(wrapper);
        } catch (error) { report('Revision preview failed: ' + error.message); }
      });
      panel.append(action);
    }
  } catch (error) { panel.append(element('p', 'Version history unavailable: ' + error.message)); }
}
