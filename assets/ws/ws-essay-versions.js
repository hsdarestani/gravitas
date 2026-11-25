/* Publication history belongs to the essay and reading level. It stays
   available when an editor has no Nextcloud file open in the source picker. */
import * as P from './ws-platform.js?v=20261016-task1&patch=20261027reliability1';
import * as K from './ws-admin-kit.js?v=20261016-task1';

const { el } = K;
const versionLabel = (number) => `Version ${number}`;
const changeLabels = { insert: 'Added', delete: 'Removed', replace: 'Changed', equal: 'Context' };

export function essayVersionHistory(onRestore, retryLevels) {
  const panel = el('section', 'adm-list');
  const slot = K.select([], '');
  const status = K.status();
  const history = el('div');
  const result = el('div');
  const picker = K.field('Essay / reading level', slot);
  let retryAction = retryLevels;
  const retry = K.cardActions([K.button('Retry version history', () => retryAction(), { tiny: true })]);
  panel.append(K.heading('Version History'), picker, status, retry, history, result);
  picker.hidden = true;
  retry.hidden = true;
  K.setStatus(status, 'Select the Topic 01 research project to load version history.');

  let projectId;
  let request = 0;
  let active = null;
  let restoring = false;

  function endpoint() {
    return `/platform/projects/${projectId}/topic-essays/${slot.value}/versions/`;
  }

  function markdown(text) {
    const block = el('pre', 'v-input adm-code', text);
    block.style.height = 'auto';
    block.style.maxHeight = '28rem';
    block.style.padding = '8px 10px';
    block.style.overflow = 'auto';
    block.style.whiteSpace = 'pre-wrap';
    block.style.overflowWrap = 'anywhere';
    block.tabIndex = 0;
    return block;
  }

  function showCompare(groups, from, to) {
    result.replaceChildren(K.heading(`${versionLabel(from)} → ${versionLabel(to)}`));
    if (!groups.length) {
      result.append(el('p', 'fl-muted', 'These versions have identical Markdown.'));
      return;
    }
    for (const { changes } of groups) {
      const section = el('div', 'adm-list');
      for (const change of changes) {
        const { type } = change;
        const line = type === 'insert' ? change.new_line : change.old_line;
        section.append(K.badge(`${changeLabels[type]} · line ${line}`, {
          insert: 'ok', delete: 'bad', replace: 'warn',
        }[type]));
        if (type === 'replace') {
          section.append(el('p', 'fl-muted', 'Removed'), markdown(change.old),
            el('p', 'fl-muted', 'Added'), markdown(change.new));
        } else {
          section.append(markdown(type === 'insert' ? change.new : change.old));
        }
      }
      result.append(section);
    }
  }

  async function read(query, render) {
    const pending = ++request;
    result.replaceChildren();
    K.setStatus(status, 'Loading Markdown…');
    try {
      const data = await P.call(endpoint() + query);
      if (pending !== request) return;
      render(data);
      K.setStatus(status, '');
    } catch (error) {
      if (pending === request) K.setStatus(status, error.message || 'Markdown is unavailable.', 'bad');
    }
  }

  async function restore(item, note, button, view) {
    if (restoring || view !== request) return;
    if (!window.confirm(`Restore ${versionLabel(item.number)}? This will publish its saved Markdown as a new version and restore its source binding.`)) return;
    const url = endpoint();
    restoring = true;
    slot.disabled = true;
    button.disabled = true;
    K.setStatus(status, 'Restoring the published essay…');
    let restored;
    let resultMessage;
    try {
      restored = await P.call(url, {
        method: 'POST',
        body: { number: item.number, version: active.version, confirm: true, change_note: note.value },
      });
      await onRestore();
      resultMessage = `Restored as ${versionLabel(restored.number)}.`;
    } catch (error) {
      const reason = error.message === 'essay_publication_changed' ? 'The live version changed. Review the refreshed history.'
        : error.message === 'essay_file_already_linked' ? 'The saved source is now linked to another reading level.'
          : error.message || 'Restore could not be confirmed.';
      if (url === endpoint() && !restored && error.message === 'essay_publication_changed') await load();
      resultMessage = restored ? `Restored as ${versionLabel(restored.number)}. Refresh to update the source picker.` : reason;
    } finally {
      restoring = false;
      slot.disabled = false;
      button.disabled = false;
    }
    if (url === endpoint()) K.setStatus(status, resultMessage, restored ? 'ok' : 'bad');
  }

  function showVersion(item, content) {
    const note = K.input('');
    note.maxLength = 1000;
    const view = request;
    const button = K.button('Restore this version', () => restore(item, note, button, view), { solid: true });
    const detail = [
      ['Published', new Date(item.published_at).toLocaleString()],
      ['Publisher', item.publisher || 'Publisher unavailable'],
      ['Source path', item.source_path],
    ];
    if (item.change_note) detail.push(['Change note', item.change_note]);
    result.replaceChildren(K.heading(versionLabel(item.number)), K.defs(detail), markdown(content));
    if (item.can_restore) result.append(K.field('Restore note (optional)', note), K.cardActions([button]));
  }

  function showHistory(data) {
    const items = data.versions;
    if (!items.length) {
      history.replaceChildren(el('p', 'fl-muted', 'No versions have been published for this level.'));
      return;
    }
    const list = K.list(items.map((item) => K.row({
      title: versionLabel(item.number),
      meta: [new Date(item.published_at).toLocaleString(), item.publisher || 'Publisher unavailable', item.source_path].join(' · '),
      body: item.change_note,
      badges: [
        item.number === data.current ? K.badge('Live', 'ok') : null,
        item.restored_from ? K.badge(`Restored from version ${item.restored_from}`) : null,
      ],
      actions: [
        K.button('View Markdown', () => read(`?number=${item.number}`, ({ markdown: text }) => showVersion(item, text)), { tiny: true }),
        K.anchor('Open in Nextcloud', `/api${endpoint()}?number=${item.number}&open=source`, { tiny: true }),
      ],
    })));
    history.replaceChildren(list);
    if (items.length < 2) return;
    const choices = items.map(({ number }) => [number, versionLabel(number)]);
    const from = K.select(choices, items[1].number);
    const to = K.select(choices, items[0].number);
    const compare = K.button('Compare versions', () => {
      const [older, newer] = [from.value, to.value];
      read(`?from=${older}&to=${newer}`, ({ groups }) => showCompare(groups, older, newer));
    });
    const update = () => { compare.disabled = from.value === to.value; };
    from.addEventListener('change', update);
    to.addEventListener('change', update);
    history.append(K.fields([K.field('Compare from', from), K.field('Compare to', to)], 2), K.cardActions([compare]));
  }

  async function load() {
    const pending = ++request;
    active = null;
    history.replaceChildren();
    result.replaceChildren();
    retry.hidden = true;
    if (!slot.value) {
      K.setStatus(status, projectId ? 'Loading essay levels…' : 'Select the Topic 01 research project to load version history.');
      return;
    }
    K.setStatus(status, 'Loading version history…');
    try {
      const data = await P.call(endpoint());
      if (pending !== request) return;
      active = data;
      showHistory(data);
      K.setStatus(status, '');
    } catch (error) {
      if (pending === request) {
        retryAction = load;
        retry.hidden = false;
        K.setStatus(status, error.message || 'Version history is unavailable.', 'bad');
      }
    }
  }

  slot.addEventListener('change', load);
  return {
    panel,
    levelsUnavailable(error) {
      retryAction = retryLevels;
      retry.hidden = false;
      const denied = error.status === 403 || error.status === 404;
      K.setStatus(status, denied
        ? 'Choose the Topic 01 research project with edit access.'
        : error.message || 'Essay levels could not be loaded.', 'bad');
    },
    async setProject(id, slots = {}) {
      const existing = id === projectId ? slot.value : '';
      projectId = id;
      const options = Object.entries(slots);
      const selected = existing || (options.find(([, item]) => item.occupied) || options[0])?.[0] || '';
      slot.replaceChildren(...options.map(([key, item]) => {
        const node = el('option', null, item.label);
        node.value = key;
        return node;
      }));
      slot.value = selected;
      picker.hidden = !options.length;
      await load();
    },
  };
}
