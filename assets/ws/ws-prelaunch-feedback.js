/* Prelaunch survey review in the existing Core Platform Admin design system. */
import * as P from './ws-platform.js?v=20261016-task1&patch=20261027reliability1';
import * as K from './ws-admin-kit.js?v=20261016-task1';

const el = K.el;
const endpoint = '/platform/admin/prelaunch-feedback/';
const surveySections = [
  ['video', 'Video'], ['essay', 'Essay'], ['sources', 'Sources'],
  ['viewpoints', 'Viewpoints'], ['pulsar', 'Pulsar'], ['forum', 'Forum']
];
const questionLabels = [
  ['video_feedback', 'Video feedback'],
  ['visual_feedback', 'Visual design'],
  ['scientific_content_feedback', 'Scientific content'],
  ['first_impression', 'First impression'],
];
const labels = {
  a1: 'Curious Explorer', a2: 'Early-Career Researcher',
  a3: 'Working Scientist', other: 'Other', unspecified: 'Unspecified'
};
function formatDate(value) {
  return value ? new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}
function mean(value) {
  return typeof value === 'number' ? value.toFixed(1) : '—';
}
function rating(value, suffix = '/10') {
  return typeof value === 'number' ? String(value) + suffix : 'Not rated';
}
function line(label, value) {
  const row = el('div', 'gq-feedback__detail-row');
  row.append(el('span', 'gq-feedback__detail-label', label), el('p', 'gq-feedback__detail-value', value));
  return row;
}
function responseCard(item) {
  const details = document.createElement('details');
  details.className = 'gq-feedback__response';
  const summary = document.createElement('summary');
  const person = el('span', 'gq-feedback__response-name', item.name || 'Anonymous');
  const facts = el('span', 'gq-feedback__response-facts');
  const persona = labels[item.answers?.persona] || labels.unspecified;
  facts.textContent = persona + ' · ' + rating(item.answers?.overall_rating) + ' · ' + formatDate(item.created_at);
  summary.append(person, facts);
  details.append(summary);
  const body = el('div', 'gq-feedback__response-body');
  body.append(line('Name', item.name || 'Anonymous'), line('Persona', persona));
  if (item.answers?.persona_other) body.append(line('Persona — other', item.answers.persona_other));
  for (const [key, title] of questionLabels) {
    body.append(line(title, item.answers?.[key] || 'No answer'));
  }
  body.append(
    line('Overall experience', rating(item.answers?.overall_rating)),
    line('Ease of use', rating(item.answers?.usability, '/5 (1 = very easy; 5 = very confusing)')),
    line('Expectation difference', rating(item.answers?.expectations_difference, '/5 (1 = as expected; 5 = completely different)'))
  );
  const scores = item.answers?.section_ratings || {};
  for (const [key, title] of surveySections) body.append(line(title, rating(scores[key])));
  details.append(body);
  return details;
}

export async function renderAdminPrelaunchFeedback(host, { go } = {}) {
  let page = 1;
  let persona = '';
  const wrap = K.page(host, {
    title: 'Prelaunch Feedback',
    meta: 'Anonymous or named answers from the public GraviQuest feedback landing page.',
    actions: [K.anchor('Open public form', '/prelaunch-feedback.html', { external: true }), K.anchor('Export CSV', '/api/platform/admin/prelaunch-feedback/?format=csv', { external: false })],
  });
  const stats = el('div', 'gq-feedback__stats');
  const intro = K.card({ title: 'At a glance', span: 12, note: 'Scores and persona distribution across all submitted feedback.' });
  const section = K.card({ title: 'Section ratings', span: 12, note: 'Averages only include visitors who chose to rate that section.' });
  const responses = K.card({ title: 'Individual responses', span: 12, note: 'Select a response to see all answers. Blank questions were skipped.' });
  const toolbar = el('div', 'gq-feedback__toolbar');
  const select = K.select([
    ['', 'All personas'], ['a1', 'Curious Explorer'], ['a2', 'Early-Career Researcher'],
    ['a3', 'Working Scientist'], ['other', 'Other'], ['unspecified', 'Unspecified']
  ], persona);
  select.setAttribute('aria-label', 'Filter by persona');
  const state = K.status();
  toolbar.append(select, state);
  const list = el('div', 'gq-feedback__response-list');
  const pager = el('div', 'gq-feedback__pager');
  const previous = K.button('Previous', () => { page = Math.max(1, page - 1); refresh(); });
  const next = K.button('Next', () => { page += 1; refresh(); });
  const counter = el('span', 'gq-feedback__count');
  pager.append(previous, counter, next);
  responses.body.append(toolbar, list, pager);
  wrap.append(stats, K.bento([intro.box, section.box, responses.box]));
  select.addEventListener('change', () => { persona = select.value; page = 1; refresh(); });

  async function refresh() {
    K.setStatus(state, 'Loading responses…');
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (persona) params.set('persona', persona);
      const data = await P.call(endpoint + '?' + params.toString());
      K.setStatus(state, '');
      stats.replaceChildren(
        K.tile({ value: data.total || 0, label: 'Total responses', icon: 'team', featured: true }),
        K.tile({ value: mean(data.averages?.overall_rating), label: 'Overall / 10', icon: 'topic' }),
        K.tile({ value: mean(data.averages?.usability), label: 'Ease / 5', icon: 'activity', note: 'Lower = easier' }),
        K.tile({ value: mean(data.averages?.expectations_difference), label: 'Difference / 5', icon: 'overview' })
      );
      intro.body.replaceChildren();
      const personaCounts = el('div', 'gq-feedback__chips');
      for (const key of ['a1', 'a2', 'a3', 'other', 'unspecified']) {
        const count = data.persona_counts?.[key] || 0;
        const chip = el('span', 'gq-feedback__chip', labels[key] + ': ' + count);
        personaCounts.append(chip);
      }
      intro.body.append(personaCounts);
      const scoreGrid = el('div', 'gq-feedback__sections');
      for (const [key, title] of surveySections) {
        const item = el('div', 'gq-feedback__section');
        item.append(el('span', null, title), el('strong', null, mean(data.averages?.['section:' + key]) + ' / 10'));
        scoreGrid.append(item);
      }
      section.body.replaceChildren(scoreGrid);
      list.replaceChildren();
      if (!data.responses?.length) list.append(K.empty('No responses match this filter yet.'));
      else data.responses.forEach(item => list.append(responseCard(item)));
      counter.textContent = 'Page ' + page + ' · ' + (data.filtered_total || 0) + ' response(s)';
      previous.disabled = page <= 1;
      next.disabled = page * (data.per_page || 50) >= (data.filtered_total || 0);
    } catch (error) {
      K.setStatus(state, error?.message || 'Responses could not be loaded.', 'bad');
      list.replaceChildren(K.empty('Could not load feedback.', [K.button('Retry', refresh)]));
    }
  }
  await refresh();
}
