/* ==========================================================================
   GRAVITAS+ WORKSPACE  ·  TOPIC ADMIN
   The Topics list and the Topic editor under Platform Admin.

   A Topic is the public site's unit: a question, its videos, essays,
   sources, a timeline, simulations, viewpoints and polls. The landing page,
   the Topics index and the Topic page all read the one record saved here.

   This screen used to inject its own <style> block with hand-picked rgba
   borders and rem paddings, so it looked like neither the workspace nor the
   rest of Platform Admin, and it laid all seven parts of a Topic down one
   scroll with the save button at the very bottom. It is drawn with
   ws-admin-kit.js now: the parts are tabs of one form (built up front, so
   saving reads every tab), each repeated object is a nested editor with
   its own order and remove controls, and the save bar stays in reach.

   The payload is unchanged, field for field, including the singular
   `video`/`essay`/`simulation` and left/right viewpoint mirrors older
   public pages still read.
   ========================================================================== */

import * as P from './ws-platform.js?v=20261008-operational2';
import * as K from './ws-admin-kit.js?v=20261008-operational2';

const { el } = K;
const ADMIN = '/workspace/core/admin';

function cookie(name) {
  const hit = document.cookie.split('; ').find((row) => row.startsWith(name + '='));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : '';
}

async function uploadMedia(file) {
  if (!file) throw new Error('Choose a file first.');
  await fetch('/api/auth/csrf/', { credentials: 'same-origin', cache: 'no-store' });
  const token = cookie('csrftoken') || cookie('gravitas_staging_csrftoken');
  const body = new FormData();
  body.append('file', file);
  const res = await fetch('/api/platform/admin/site/media/', {
    method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'X-CSRFToken': token }, body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('Upload failed (' + res.status + ')'));
  return data;
}

/* A URL field with an upload beside it: either paste a link or send a file
   and get its URL filled in. */
function mediaField(labelText, current = '', accept = 'image/*') {
  const url = K.input(current, 'url', 'https://… or upload a file');
  const file = K.input('', 'file');
  file.accept = accept;
  file.classList.add('adm-upload__file');
  const note = K.status();
  const upload = K.button('Upload', async () => {
    upload.disabled = true;
    K.setStatus(note, 'Uploading…');
    try {
      const data = await uploadMedia(file.files && file.files[0]);
      url.value = data.url;
      K.setStatus(note, 'Uploaded.', 'ok');
    } catch (error) {
      K.setStatus(note, error.message || 'Upload failed.', 'bad');
    } finally {
      upload.disabled = false;
    }
  }, { tiny: true });
  const row = el('div', 'adm-upload');
  row.append(url, file, upload);
  const holder = el('div', 'adm-field');
  holder.dataset.wide = '';
  holder.append(el('span', 'adm-field__label', labelText), row, note);
  return { holder, url };
}

function richEditor(labelText, html = '') {
  const outer = el('div', 'adm-field');
  outer.append(el('span', 'adm-field__label', labelText));
  const box = el('div', 'adm-rte');
  const bar = el('div', 'adm-rte__bar');
  const body = el('div', 'adm-rte__body');
  body.contentEditable = 'true';
  body.innerHTML = html || '';
  body.setAttribute('aria-label', labelText);
  const tool = (text, run) => {
    const b = el('button', null, text);
    b.type = 'button';
    b.addEventListener('mousedown', (event) => event.preventDefault());
    b.addEventListener('click', () => { body.focus(); run(); });
    bar.append(b);
  };
  [
    ['B', 'bold'], ['I', 'italic'], ['H2', 'formatBlock', 'h2'], ['H3', 'formatBlock', 'h3'],
    ['• List', 'insertUnorderedList'], ['1. List', 'insertOrderedList'], ['Quote', 'formatBlock', 'blockquote'],
  ].forEach(([text, cmd, arg]) => tool(text, () => document.execCommand(cmd, false, arg || null)));
  tool('Link', () => { const href = window.prompt('Link URL'); if (href) document.execCommand('createLink', false, href); });
  tool('Clear format', () => document.execCommand('removeFormat', false, null));
  box.append(bar, body);
  outer.append(box);
  return { outer, value: () => body.innerHTML.trim() };
}

/* ---- Repeated objects ---------------------------------------------------- */

function item(kind, title, cls) {
  const box = K.sub(title || kind);
  box.classList.add(cls);
  box.head.querySelector('.adm-sub__tools').append(...K.orderTools(box));
  return box;
}

function renameOnInput(box, input, fallback) {
  input.addEventListener('input', () => { box.titleNode.firstChild.nodeValue = input.value.trim() || fallback; });
}

function sourceRow(values = {}) {
  const row = item('Source', values.label, 'topic-source-row');
  const level = K.select([['start', 'Start here'], ['further', 'Go further'], ['primary', 'Primary']], values.level || 'start');
  const labelInput = K.input(values.label || '', 'text', 'Source label / title');
  const url = K.input(values.url || '', 'url', 'https://…');
  renameOnInput(row, labelInput, 'Source');
  row.append(K.fields([K.field('Level', level), K.field('Label', labelInput), K.field('URL', url)]));
  row._topicFields = { level, label: labelInput, url };
  return row;
}

function timelineRow(values = {}) {
  const row = item('Timeline node', [values.date, values.title].filter(Boolean).join(' · '), 'topic-timeline-row');
  const date = K.input(values.date || '', 'text', 'e.g. 1963');
  const title = K.input(values.title || '', 'text', 'Node title');
  const description = K.textarea(values.description || '', 3, 'Short explanation');
  const image = mediaField('Image', values.image_url || '', 'image/*');
  const alt = K.input(values.image_alt || '', 'text', 'Image alt text');
  row.append(
    K.fields([K.field('Date', date), K.field('Title', title)], 2),
    K.field('Description', description),
    K.fields([image.holder, K.field('Image alt text', alt)], 2),
  );
  row._topicFields = { date, title, description, imageUrl: image.url, alt };
  return row;
}

function optionRow(values = {}) {
  const row = el('div', 'adm-fields topic-poll-option');
  row.dataset.cols = '2';
  const labelInput = K.input(values.label || '', 'text', 'Poll option');
  const id = K.input(values.id || K.slugify(values.label || '') || 'option', 'text', 'Stable option ID');
  labelInput.addEventListener('input', () => { if (!id.dataset.touched) id.value = K.slugify(labelInput.value) || 'option'; });
  id.addEventListener('input', () => { id.dataset.touched = '1'; });
  const remove = K.button('Remove', () => row.remove(), { tiny: true, danger: true });
  const idField = K.field('ID', id);
  const wrap = el('div', 'adm-upload');
  wrap.append(id, remove);
  idField.replaceChildren(el('span', 'adm-field__label', 'ID'), wrap);
  row.append(K.field('Option', labelInput), idField);
  row._topicFields = { label: labelInput, id };
  return row;
}

function normalizeObjects(data, pluralKey, singularKey) {
  if (Array.isArray(data?.[pluralKey])) return data[pluralKey].filter((v) => v && typeof v === 'object');
  const single = data?.[singularKey];
  return single && typeof single === 'object' && Object.keys(single).length ? [single] : [];
}

function videoRow(values = {}) {
  const row = item('Video', values.title, 'topic-video-row');
  const title = K.input(values.title || '', 'text', 'Optional video title');
  renameOnInput(row, title, 'Video');
  const sourceType = K.select([['none', 'Not published yet'], ['youtube', 'YouTube'], ['self_hosted', 'Self-hosted']], values.source_type || 'none');
  const youtube = K.input(values.youtube_url || '', 'url', 'YouTube URL');
  const self = mediaField('Self-hosted video', values.self_hosted_url || '', 'video/*');
  const duration = K.input(values.duration || '', 'text', 'e.g. 28 minutes');
  const description = K.textarea(values.description || '', 4, 'Video description');
  const info = K.input(values.info || '', 'text', 'Additional information');
  const companionLabel = K.input(values.companion_label || '', 'text', 'Companion label');
  const companionUrl = K.input(values.companion_url || '', 'url', 'Companion URL');
  const transcriptLabel = K.input(values.transcript_label || '', 'text', 'Transcript label');
  const transcriptUrl = K.input(values.transcript_url || '', 'url', 'Transcript URL');
  const youtubeField = K.field('YouTube URL', youtube);
  const sync = () => {
    youtubeField.hidden = sourceType.value !== 'youtube';
    self.holder.hidden = sourceType.value !== 'self_hosted';
  };
  sourceType.addEventListener('change', sync);
  sync();
  row.append(
    K.fields([K.field('Title', title), K.field('Source type', sourceType), K.field('Runtime', duration), youtubeField, self.holder]),
    K.field('Description', description),
    K.fields([
      K.field('Info', info, '', { wide: true }),
      K.field('Companion label', companionLabel), K.field('Companion URL', companionUrl),
      K.field('Transcript label', transcriptLabel), K.field('Transcript URL', transcriptUrl),
    ], 2),
  );
  row._topicFields = { title, sourceType, youtube, selfUrl: self.url, duration, description, info, companionLabel, companionUrl, transcriptLabel, transcriptUrl };
  return row;
}

function essayRow(values = {}) {
  const row = item('Essay', values.title, 'topic-essay-row');
  const title = K.input(values.title || '', 'text', 'Optional essay title');
  renameOnInput(row, title, 'Essay');
  const overview = richEditor('Overview', values.overview_html || '');
  const indepth = richEditor('In depth', values.indepth_html || '');
  const image = mediaField('Essay image', values.image_url || '', 'image/*');
  const alt = K.input(values.image_alt || '', 'text', 'Image alt text');
  const asideTitle = K.input(values.aside_title || 'Try It Yourself', 'text', 'Aside title');
  const asideText = K.textarea(values.aside_text || '', 3, 'Aside text');
  row.append(
    K.field('Title', title),
    overview.outer, indepth.outer,
    K.fields([image.holder, K.field('Image alt text', alt)], 2),
    K.fields([K.field('Aside title', asideTitle), K.field('Aside text', asideText)], 2),
  );
  row._topicFields = { title, overview, indepth, imageUrl: image.url, alt, asideTitle, asideText };
  return row;
}

function simulationRow(values = {}) {
  const row = item('Simulation', values.title, 'topic-simulation-row');
  const title = K.input(values.title || 'The Simulation');
  renameOnInput(row, title, 'Simulation');
  const description = K.textarea(values.description || '', 3, 'Simulation introduction');
  const code = K.textarea(values.code || '', 16, 'Paste HTML/CSS/JavaScript or JavaScript code', { code: true });
  const codeFile = K.input('', 'file');
  codeFile.accept = '.html,.htm,.js,.txt,.css';
  codeFile.addEventListener('change', async () => {
    const file = codeFile.files && codeFile.files[0];
    if (file) code.value = await file.text();
  });
  row.append(
    K.fields([K.field('Section title', title), K.field('Load code from file', codeFile)], 2),
    K.field('Description', description),
    K.field('Code', code, 'Executed only inside the public sandboxed simulation frame.'),
  );
  row._topicFields = { title, description, code, builtin: values.builtin || '', native: values.native || '', type: values.type || '', enabled: values.enabled };
  return row;
}

function viewpointRow(values = {}) {
  const row = item('Viewpoint', values.label, 'topic-viewpoint-row');
  const labelInput = K.input(values.label || '', 'text', 'Viewpoint label');
  renameOnInput(row, labelInput, 'Viewpoint');
  const text = K.textarea(values.text || '', 6, 'Viewpoint text');
  const cite = K.input(values.cite || '', 'text', 'Citation / note');
  row.append(K.fields([K.field('Label', labelInput), K.field('Citation', cite)], 2), K.field('Text', text));
  row._topicFields = { label: labelInput, text, cite };
  return row;
}

let pollSequence = 0;
function nextPollId() {
  pollSequence += 1;
  return 'poll-' + Date.now().toString(36) + '-' + pollSequence.toString(36);
}

function pollRow(values = {}, results = null) {
  const row = item('Poll', values.question || values.poll_question, 'topic-poll-row');
  const id = K.input(values.id || nextPollId(), 'text', 'Stable poll ID');
  const question = K.input(values.question || values.poll_question || 'Where do you land?', 'text', 'Poll question');
  renameOnInput(row, question, 'Poll');
  const note = K.input(values.note || values.poll_note || '', 'text', 'Text below poll');
  const optionList = K.stack();
  optionList.classList.add('topic-poll-options');
  const options = Array.isArray(values.options) ? values.options : (Array.isArray(values.poll_options) ? values.poll_options : []);
  options.forEach((v) => optionList.append(optionRow(v)));
  row.append(
    K.fields([K.field('Question', question, '', { wide: true }), K.field('Poll ID', id), K.field('Note', note)], 2),
    K.heading('Options'), optionList,
    K.cardActions([K.button('Add poll option', () => optionList.append(optionRow()), { tiny: true })]),
  );
  if (results) {
    const total = Number(results.total_votes || 0);
    const box = el('div', 'adm-bars');
    (results.options || []).forEach((r) => {
      const line = el('div', 'adm-bar');
      const head = el('div', 'adm-bar__head');
      head.append(el('strong', null, r.label), el('span', null, `${r.votes} votes`));
      line.append(head, K.C.meter(total ? Math.round((Number(r.votes) / total) * 100) : 0));
      box.append(line);
    });
    row.append(K.heading(`Live results · ${total} votes`), box);
  }
  row._topicFields = { id, question, note, optionList };
  return row;
}

function collect(host, selector, mapper) {
  return Array.from(host.querySelectorAll(selector)).map(mapper).filter(Boolean);
}

/* ==========================================================================
   LIST
   ========================================================================== */

export async function renderAdminContent(host, { go }) {
  K.loading(host, 'Topics', { tiles: 0, cards: [12] });
  try {
    const data = await P.adminSiteContent({ kind: 'topic' });
    const items = (data.items || []).filter((entry) => entry.kind === 'topic');
    const wrap = K.page(host, {
      title: 'Topics',
      meta: 'Create, publish and manage the complete Topic experience. The landing page, the Topics index and every Topic page read from here.',
      actions: [K.link(go, 'New Topic', `${ADMIN}/content/new`, { solid: true })],
    });
    const published = items.filter((entry) => entry.status === 'published').length;
    wrap.append(K.tiles([
      K.tile({ value: items.length, label: 'Topics', icon: 'topic', featured: true, note: 'On the public site' }),
      K.tile({ value: published, label: 'Published', icon: 'share', note: 'Live on the site' }),
      K.tile({ value: items.length - published, label: 'Drafts', icon: 'notes', note: 'Not public yet' }),
    ]));
    const list = K.card({ title: 'All Topics', note: 'Open one to edit it.' });
    let filter = '';
    const listHost = el('div');
    const draw = () => {
      const shown = items.filter((entry) => !filter || entry.status === filter);
      listHost.replaceChildren(shown.length ? K.list(shown.map((entry, index) => K.row({
        title: entry.title,
        meta: P.meta([entry.slug, entry.updated_at ? `Updated ${P.formatDate(entry.updated_at)}` : '']),
        lead: K.avatar(entry.title, { mark: 'topic', series: (index % 4) + 1 }),
        badges: [K.stateBadge(entry.status || 'draft')],
        onClick: () => go(`${ADMIN}/content/${entry.id}`),
      }))) : K.empty(items.length ? 'No Topic in this state.' : 'No Topics yet.', items.length ? [] : [K.link(go, 'Create the first Topic', `${ADMIN}/content/new`)]));
    };
    list.body.append(K.toolbar([K.choices([['', 'All'], ['published', 'Published'], ['draft', 'Drafts']], '', (value) => { filter = value; draw(); })], [K.count(items.length, 'Topic')]), listHost);
    draw();
    wrap.append(K.bento([list.box]));
  } catch (error) {
    K.failure(host, 'Topics', error, () => renderAdminContent(host, { go }));
  }
}

/* ==========================================================================
   EDITOR
   ========================================================================== */

function listCard(title, note, rows, addText, make) {
  const card = K.card({ title, note });
  const list = K.stack();
  rows.forEach((row) => list.append(row));
  card.body.append(list, K.cardActions([K.button(addText, () => list.append(make()), { tiny: true })]));
  return { card, list };
}

export async function renderAdminContentEditor(host, id, { go }) {
  K.loading(host, id === 'new' ? 'New Topic' : 'Topic', { tiles: 0, cards: [12] });
  let current = null;
  if (id !== 'new') {
    try { current = (await P.adminSiteContentItem(id)).item; }
    catch (error) { K.failure(host, 'Topic unavailable', error, () => renderAdminContentEditor(host, id, { go })); return; }
  }
  const data = current && current.topic_data && typeof current.topic_data === 'object' ? current.topic_data : {};
  const wrap = K.page(host, {
    title: current ? current.title : 'New Topic',
    meta: current
      ? P.meta([K.label(current.status || 'draft'), current.slug, 'English content; German and Persian controls are hidden for now'])
      : 'English Topic content only for now. German and Persian translation controls are intentionally hidden.',
    actions: [
      K.link(go, 'All Topics', `${ADMIN}/content`),
      current && current.status === 'published' ? K.anchor('View on site', `/topic.html?slug=${encodeURIComponent(current.slug)}`) : null,
    ],
  });
  const form = el('form', 'adm-form');

  /* Topic ----------------------------------------------------------------- */
  const title = K.input(current?.title || '', 'text', 'Question / Topic title');
  const slug = K.input(current?.slug || '', 'text', 'topic-slug');
  const status = K.select([['draft', 'Draft'], ['published', 'Published']], current?.status || 'draft');
  const number = K.input(data.number || '', 'text', 'e.g. 04');
  const summary = K.textarea(current?.summary || '', 4, 'Short summary used on cards and the main landing page');
  const heroLead = K.textarea(data.hero_lead || current?.summary || '', 3, 'Lead paragraph on the Topic page');
  const tags = K.input(Array.isArray(data.tags) ? data.tags.join(', ') : '', 'text', 'Comma-separated tags');
  let touched = !!current;
  slug.addEventListener('input', () => { touched = true; });
  title.addEventListener('input', () => { if (!touched) slug.value = K.slugify(title.value); });
  const basics = K.card({ title: 'Topic', note: 'The canonical record used by the landing page, the Topics index and the Topic page.', span: 8 });
  basics.body.append(
    K.field('Title', title),
    K.field('Summary', summary),
    K.field('Topic page lead', heroLead),
  );
  const publishing = K.card({ title: 'Publishing', note: 'Address, order and labels.', span: 4 });
  publishing.body.append(K.fields([
    K.field('Status', status), K.field('Slug', slug), K.field('Topic number', number), K.field('Tags', tags, 'Comma-separated'),
  ], 1));

  /* Repeated parts -------------------------------------------------------- */
  const videos = listCard('Videos', 'As many videos as the Topic needs. Reorder or remove them independently.',
    normalizeObjects(data, 'videos', 'video').map((v) => videoRow(v)), 'Add video', () => videoRow());
  const essays = listCard('Essays', 'Each essay has its own Overview and In depth content.',
    normalizeObjects(data, 'essays', 'essay').map((v) => essayRow(v)), 'Add essay', () => essayRow());

  const sourcesIntro = K.textarea(data.sources_intro || '', 3, 'Intro text above the three source levels');
  const sources = listCard('Sources', 'Each link belongs to one of three reading levels.',
    (Array.isArray(data.sources) ? data.sources : []).map((v) => sourceRow(v)), 'Add source', () => sourceRow());
  sources.card.body.prepend(K.field('Intro', sourcesIntro));

  const timeline = listCard('Timeline', 'Nodes render as one vertical alternating timeline on the Topic page.',
    (Array.isArray(data.timeline) ? data.timeline : []).map((v) => timelineRow(v)), 'Add timeline node', () => timelineRow());

  const simulations = listCard('Simulations', 'HTML/CSS/JavaScript runs in sandboxed iframes on the public page.',
    normalizeObjects(data, 'simulations', 'simulation').map((v) => simulationRow(v)), 'Add simulation', () => simulationRow());

  const vpData = data.viewpoints && typeof data.viewpoints === 'object' ? data.viewpoints : {};
  const viewpointsIntro = K.textarea(data.viewpoints_intro || '', 3, 'Intro above viewpoints');
  const viewpointValues = Array.isArray(vpData.items) ? vpData.items : [];
  if (!viewpointValues.length) {
    if (vpData.left_label || vpData.left_text || vpData.left_cite) viewpointValues.push({ label: vpData.left_label || 'Viewpoint A', text: vpData.left_text || '', cite: vpData.left_cite || '' });
    if (vpData.right_label || vpData.right_text || vpData.right_cite) viewpointValues.push({ label: vpData.right_label || 'Viewpoint B', text: vpData.right_text || '', cite: vpData.right_cite || '' });
  }
  const viewpoints = listCard('Viewpoints', 'Cards presenting the positions a reader can take.',
    viewpointValues.map((v) => viewpointRow(v)), 'Add viewpoint', () => viewpointRow());
  viewpoints.card.box.dataset.span = '6';
  viewpoints.card.body.prepend(K.field('Intro', viewpointsIntro));

  let pollValues = Array.isArray(vpData.polls) ? vpData.polls : [];
  if (!Array.isArray(vpData.polls) && (vpData.poll_question || (Array.isArray(vpData.poll_options) && vpData.poll_options.length))) {
    pollValues = [{ id: 'main', question: vpData.poll_question || 'Where do you land?', note: vpData.poll_note || '', options: vpData.poll_options || [] }];
  }
  const pollResults = new Map((current?.poll_results_list || []).map((result) => [String(result.id || ''), result]));
  const polls = listCard('Polls', 'Independent polls, each with live results once votes arrive.',
    pollValues.map((v) => pollRow(v, pollResults.get(String(v.id || 'main')) || null)), 'Add poll', () => pollRow());
  polls.card.box.dataset.span = '6';

  const counted = (name, list) => `${name}${list.children.length ? ` · ${list.children.length}` : ''}`;
  form.append(K.tabs([
    ['topic', 'Topic'],
    ['videos', counted('Videos', videos.list)],
    ['essays', counted('Essays', essays.list)],
    ['sources', counted('Sources', sources.list)],
    ['timeline', counted('Timeline', timeline.list)],
    ['simulations', counted('Simulations', simulations.list)],
    ['viewpoints', 'Viewpoints & polls'],
  ], (key) => K.bento({
    topic: [basics.box, publishing.box],
    videos: [videos.card.box],
    essays: [essays.card.box],
    sources: [sources.card.box],
    timeline: [timeline.card.box],
    simulations: [simulations.card.box],
    viewpoints: [viewpoints.card.box, polls.card.box],
  }[key]), { name: 'Topic parts', eager: true }));

  /* Save ------------------------------------------------------------------ */
  const statusLine = K.status();
  const save = K.button(current ? 'Save Topic' : 'Create Topic', null, { solid: true, type: 'submit' });
  const back = K.link(go, 'Back to Topics', `${ADMIN}/content`);
  let del = null;
  if (current) {
    del = K.button('Delete Topic', async () => {
      if (!window.confirm('Delete this Topic? This cannot be undone.')) return;
      del.disabled = true;
      K.setStatus(statusLine, 'Deleting…');
      try {
        await P.call('/platform/admin/site/content/' + current.id + '/', { method: 'DELETE' });
        go(`${ADMIN}/content`, { replace: true });
      } catch (error) {
        K.setStatus(statusLine, error.message || 'Delete failed.', 'bad');
        del.disabled = false;
      }
    }, { danger: true });
  }
  form.append(K.foot([save, back, del], statusLine));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    save.disabled = true;
    K.setStatus(statusLine, 'Saving…');
    const videoRows = collect(videos.list, '.topic-video-row', (row) => {
      const f = row._topicFields; if (!f) return null;
      return {
        title: f.title.value.trim(), source_type: f.sourceType.value, youtube_url: f.youtube.value.trim(), self_hosted_url: f.selfUrl.value.trim(),
        description: f.description.value, duration: f.duration.value.trim(), info: f.info.value.trim(),
        companion_label: f.companionLabel.value.trim(), companion_url: f.companionUrl.value.trim(),
        transcript_label: f.transcriptLabel.value.trim(), transcript_url: f.transcriptUrl.value.trim(),
      };
    }).filter((x) => x.title || x.source_type !== 'none' || x.youtube_url || x.self_hosted_url || x.description || x.duration || x.info || x.companion_label || x.transcript_label);
    const essayRows = collect(essays.list, '.topic-essay-row', (row) => {
      const f = row._topicFields; if (!f) return null;
      return {
        title: f.title.value.trim(), overview_html: f.overview.value(), indepth_html: f.indepth.value(), image_url: f.imageUrl.value.trim(), image_alt: f.alt.value.trim(),
        aside_title: f.asideTitle.value.trim(), aside_text: f.asideText.value,
      };
    }).filter((x) => x.title || x.overview_html || x.indepth_html || x.image_url || x.aside_text);
    const sourceRows = collect(sources.list, '.topic-source-row', (row) => {
      const f = row._topicFields; if (!f) return null;
      return { level: f.level.value || 'start', level_label: f.level.selectedOptions?.[0]?.textContent || '', label: f.label.value.trim(), url: f.url.value.trim() };
    }).filter((x) => x.label);
    const timelineRows = collect(timeline.list, '.topic-timeline-row', (row) => {
      const f = row._topicFields; if (!f) return null;
      return {
        date: f.date.value.trim(), title: f.title.value.trim(), description: f.description.value.trim(),
        image_url: f.imageUrl.value.trim(), image_alt: f.alt.value.trim(),
      };
    }).filter((x) => x.title || x.date);
    const simulationRows = collect(simulations.list, '.topic-simulation-row', (row) => {
      const f = row._topicFields; if (!f) return null;
      return { title: f.title.value.trim() || 'The Simulation', description: f.description.value, builtin: f.builtin || '', native: f.native || '', type: f.type || '', enabled: f.enabled, code: f.code.value };
    }).filter((x) => x.description || x.builtin || x.native || x.type || x.enabled || x.code);
    const viewpointRows = collect(viewpoints.list, '.topic-viewpoint-row', (row) => {
      const f = row._topicFields; if (!f) return null;
      return { label: f.label.value.trim(), text: f.text.value, cite: f.cite.value.trim() };
    }).filter((x) => x.label || x.text || x.cite);
    const pollRows = collect(polls.list, '.topic-poll-row', (row) => {
      const f = row._topicFields; if (!f) return null;
      const options = Array.from(f.optionList.children).filter((node) => node._topicFields).map((option) => {
        const o = option._topicFields;
        return { label: o.label.value.trim(), id: o.id.value.trim() || K.slugify(o.label.value) };
      }).filter((x) => x.label && x.id);
      return { id: f.id.value.trim() || nextPollId(), question: f.question.value.trim(), note: f.note.value.trim(), options };
    }).filter((x) => x.question || x.options.length);
    const firstView = viewpointRows[0] || {};
    const secondView = viewpointRows[1] || {};
    const firstPoll = pollRows[0] || {};
    const topicData = {
      number: number.value.trim(),
      hero_lead: heroLead.value,
      tags: tags.value.split(',').map((v) => v.trim()).filter(Boolean),
      videos: videoRows,
      video: videoRows[0] || {},
      essays: essayRows,
      essay: essayRows[0] || {},
      sources_intro: sourcesIntro.value,
      sources: sourceRows,
      timeline: timelineRows,
      simulations: simulationRows,
      simulation: simulationRows[0] || {},
      viewpoints_intro: viewpointsIntro.value,
      viewpoints: {
        items: viewpointRows,
        left_label: firstView.label || '', left_text: firstView.text || '', left_cite: firstView.cite || '',
        right_label: secondView.label || '', right_text: secondView.text || '', right_cite: secondView.cite || '',
        polls: pollRows,
        poll_question: firstPoll.question || '',
        poll_options: firstPoll.options || [],
        poll_note: firstPoll.note || '',
      },
      landing: data.landing || {},
    };
    const payload = { title: title.value.trim(), slug: slug.value.trim(), kind: 'topic', status: status.value, summary: summary.value, body: '', topic_data: topicData, translations: [] };
    try {
      const result = current ? await P.adminUpdateSiteContent(current.id, payload) : await P.adminCreateSiteContent(payload);
      K.setStatus(statusLine, 'Topic saved. Landing, Topics and the Topic page now read this record.', 'ok');
      if (!current) go(`${ADMIN}/content/` + result.item.id, { replace: true });
    } catch (error) {
      K.setStatus(statusLine, error.message || 'Topic was not saved.', 'bad');
    } finally {
      save.disabled = false;
    }
  });
  wrap.append(form);
}
