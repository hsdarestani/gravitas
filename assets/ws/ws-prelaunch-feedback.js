/* The survey dashboard reads one cohort for every chart and the CSV.
   Question labels and scales come from the same definition as the public form. */
import * as P from './ws-platform.js?v=20261016-task1&patch=20261027reliability1';
import * as K from './ws-admin-kit.js?v=20261016-task1';
import { GROUPS, FIELDS, FIELD_BY_KEY, LEGACY_LABELS } from '../prelaunch-feedback-schema.js?v=20261122-brand1';

const el=K.el;
const endpoint='/platform/admin/prelaunch-feedback/';
const prefix='gq-feedback__';
const personaLabels=Object.fromEntries(FIELD_BY_KEY.persona.options);
const oldSections=[['video','Video'],['essay','Essay'],['sources','Sources'],['viewpoints','Viewpoints'],['pulsar','Pulsar'],['forum','Forum']];
function date(value){
  return value?new Date(value).toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short'}):'—';
}
function displayAnswer(field,value){
  if(value===undefined||value===null||value==='')return '';
  if(field.type==='score5')return String(value)+' / 5';
  if(field.type==='score10')return String(value)+' / 10';
  const option=field.options?.find(option=>option[0]===value);
  if(option)return option[1];
  if(field.type==='yesno')return value==='yes'?'Yes':value==='no'?'No':String(value);
  return String(value);
}
function row(label,value){
  const result=el('div','gq-feedback__detail-row');
  result.append(el('span','gq-feedback__detail-label',label),el('p','gq-feedback__detail-value',value));
  return result;
}
function responseCard(item){
  const details=document.createElement('details');
  details.className='gq-feedback__response';
  const summary=document.createElement('summary');
  const answers=item.answers||{};
  const persona=personaLabels[answers.persona]||'No persona selected';
  summary.append(
    el('span','gq-feedback__response-name',item.name||'Anonymous'),
    el('span','gq-feedback__response-facts',persona+' · '+date(item.created_at))
  );
  details.append(summary);
  const body=el('div','gq-feedback__response-body');
  let numberOfAnswers=0;
  for(const group of GROUPS){
    const answered=group.fields.filter(field=>{
      const value=field.key==='name'?item.name:answers[field.key];
      return value!==null&&value!==undefined&&value!=='';
    });
    if(!answered.length)continue;
    body.append(el('h3','gq-feedback__group-name',group.letter+' · '+group.title));
    answered.forEach(field=>{
      const value=field.key==='name'?item.name:answers[field.key];
      body.append(row(field.label,displayAnswer(field,value)));
      numberOfAnswers+=1;
    });
  }
  const old=LEGACY_LABELS.filter(([key])=>answers[key]!==undefined);
  if(old.length){
    body.append(el('h3','gq-feedback__group-name','Previous survey responses'));
    for(const [key,label] of old){
      if(key==='section_ratings'){
        const scores=answers.section_ratings||{};
        for(const [id,title] of oldSections){
          if(scores[id]!==undefined)body.append(row(title,String(scores[id])+' / 10'));
        }
      }else{
        body.append(row(label,String(answers[key])+ (key==='overall_rating'?' / 10':' / 5')));
      }
    }
  }
  if(!numberOfAnswers&&!old.length)body.append(el('p','gq-feedback__detail-value','No questions answered.'));
  details.append(body);
  return details;
}

const legacyGroup = {
  id: 'legacy',
  title: 'Previous survey',
  fields: [
    { key: 'overall_rating', label: 'Overall rating', type: 'score10' },
    { key: 'usability', label: 'Ease of use', type: 'score5', low: 'Easier', high: 'Harder' },
    ...oldSections.map(([key, label]) => ({ key: 'section:' + key, label, type: 'score10' }))
  ]
};
const questionGroups = [...GROUPS, legacyGroup];
const sectionOptions = questionGroups.map(({ id, title }) => [id, title]);
const textOptions = FIELDS.filter(field => field.type === 'text').map(({ key, label }) => [key, label]);
const number = new Intl.NumberFormat('en-GB');
const decimal = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
const dayLabel = new Intl.DateTimeFormat('en-GB', { month: 'short', day: 'numeric', timeZone: 'UTC' });

function pct(value, base) {
  return base ? decimal.format(value * 100 / base) + '%' : '—';
}

function dateLabel(value) {
  return dayLabel.format(new Date(value + 'T00:00:00Z'));
}

function note(text) {
  return el('p', prefix + 'note', text);
}

function secondaryAction(text, callback) {
  return K.button(text, callback, { tiny: true });
}

function questionCounts(field, stats) {
  const counts = el('p', prefix + 'question-counts');
  counts.append(el('strong', '', number.format(stats.answered) + ' of ' + number.format(stats.eligible) + ' answered'),
    document.createTextNode(' · ' + number.format(stats.unanswered) + ' blank'));
  if (stats.outside_base || field.gate) {
    const label = field.key.startsWith('section:') || legacyGroup.fields.includes(field)
      ? ' outside the identified historical cohort' : ' outside the follow-up base';
    counts.append(document.createTextNode(' · ' + number.format(stats.outside_base) + label));
  }
  return counts;
}

function optionList(options, base, bar = false) {
  const list = el('ul', prefix + 'options');
  options.forEach(({ label, count }, index) => {
    const item = el('li', prefix + 'option');
    const labelNode = el('span', prefix + 'option-label', label);
    const countNode = el('strong', prefix + 'value', number.format(count) + ' · ' + pct(count, base));
    if (bar) {
      const bar = el('div', prefix + 'track');
      const fill = el('span', prefix + 'fill');
      bar.setAttribute('aria-hidden', 'true');
      fill.style.width = (base ? count * 100 / base : 0) + '%';
      bar.append(fill);
      item.append(labelNode, countNode, bar);
    } else {
      const swatch = el('span', prefix + 'swatch');
      swatch.dataset.color = index;
      swatch.setAttribute('aria-hidden', 'true');
      labelNode.prepend(swatch);
      item.append(labelNode, countNode);
    }
    list.append(item);
  });
  return list;
}

function donut(options, base) {
  const figure = el('div', prefix + 'donut-layout');
  const ring = el('div', prefix + 'donut');
  ring.setAttribute('aria-hidden', 'true');
  let cumulative = 0;
  const stops = options.flatMap(({ count }, index) => {
    if (!count) return [];
    const from = cumulative;
    cumulative += count * 100 / base;
    return ['var(--survey-category-' + index + ') ' + from + '% ' + cumulative + '%'];
  });
  if (stops.length) ring.style.background = 'conic-gradient(' + stops.join(',') + ')';
  const hub = el('div', prefix + 'donut-hub');
  hub.append(el('strong', prefix + 'value', number.format(base)), el('span', '', 'answered'));
  ring.append(hub);
  figure.append(ring, optionList(options, base));
  return figure;
}

function columns(values, className, showCounts = true) {
  const list = el('ol', prefix + 'columns ' + prefix + className);
  const max = Math.max(1, ...values.map(value => value.count));
  list.setAttribute('aria-hidden', 'true');
  values.forEach(({ count, label, title }) => {
    const item = el('li', prefix + 'column');
    item.title = (title || label) + ' · ' + number.format(count);
    const track = el('div', prefix + 'column-track');
    const bar = el('span', prefix + 'column-bar');
    bar.style.height = (count * 100 / max) + '%';
    if (count && showCounts) bar.append(el('span', prefix + 'column-count', number.format(count)));
    track.append(bar);
    item.append(track);
    if (label) item.append(el('span', prefix + 'column-label', label));
    list.append(item);
  });
  return list;
}

function distributionDetails(label, rows, headings) {
  const details = el('details', prefix + 'chart-details');
  details.append(el('summary', '', label));
  const table = el('table', prefix + 'table');
  const head = el('thead');
  const heading = el('tr');
  headings.forEach(label => {
    const cell = el('th', '', label);
    cell.scope = 'col';
    heading.append(cell);
  });
  head.append(heading);
  const body = el('tbody');
  rows.forEach(([label, ...values]) => {
    const tr = el('tr');
    const th = el('th', '', label);
    th.scope = 'row';
    tr.append(th, ...values.map(value => el('td', '', value)));
    body.append(tr);
  });
  table.append(head, body);
  details.append(table);
  return details;
}

function questionCard(field, stats, openText) {
  const card = el('article', prefix + 'question');
  card.dataset.question = field.key;
  card.append(el('h3', '', field.label), questionCounts(field, stats));
  if (stats.options && !stats.answered) {
    card.append(note(stats.eligible ? 'No answers recorded.' : 'No eligible submissions in this cohort.'));
  }
  if (field.type === 'score5' || field.type === 'score10') {
    const options = stats.options.map(({ value, count }) => ({ label: String(value), count }));
    const min = options[0].label;
    const max = options.at(-1).label;
    const scale = min + '–' + max + ' scale';
    if (stats.answered) {
      const metric = el('p', prefix + 'mean');
      metric.append(el('strong', prefix + 'value', decimal.format(stats.average)),
        document.createTextNode(' average · ' + scale));
      card.append(metric, columns(options, 'scores'));
    } else {
      card.append(note(scale));
    }
    if (field.low && field.high) {
      const labels = el('p', prefix + 'scale');
      labels.append(el('span', '', min + ' · ' + field.low), el('span', '', max + ' · ' + field.high));
      card.append(labels);
    }
    card.append(distributionDetails('Score counts and percentages',
      options.map(({ label, count }) => [label, number.format(count), pct(count, stats.answered)]),
      ['Score', 'Count', '% of answers']));
  } else if (stats.options) {
    const options = stats.options.map(({ value, count }) => ({ label: displayAnswer(field, value), count }));
    card.append(field.type === 'yesno' || field.type === 'persona'
      ? donut(options, stats.answered) : optionList(options, stats.answered, true));
  } else if (field.type === 'text' && stats.answered) {
    card.append(secondaryAction('Read answers', () => openText(field.key)));
  } else if (field.type === 'email' || field.type === 'input') {
    card.append(note('Contact details are available in individual submissions.'));
  } else {
    card.append(note(stats.eligible ? 'No written answers recorded.' : 'No eligible submissions in this cohort.'));
  }
  return card;
}

function participation(report) {
  const card = K.card({ title: 'Participation over time',
    note: 'New submissions by initial submission date (UTC). Later edits stay on the original date.' });
  if (!report.trend.length) {
    card.body.append(note('No submissions in this cohort.'));
    return card.box;
  }
  const series = report.trend.map(({ from, to, count }) => ({
    title: from === to ? from : from + ' to ' + to, count
  }));
  const start = report.trend[0].from;
  const end = report.trend.at(-1).to;
  const axis = el('p', prefix + 'axis');
  axis.setAttribute('aria-hidden', 'true');
  axis.append(el('span', '', dateLabel(start)));
  if (end !== start) axis.append(el('span', '', dateLabel(end)));
  const range = start === end ? start : start + ' to ' + end;
  card.body.append(el('p', prefix + 'range', range), columns(series, 'trend', series.length <= 10), axis,
    distributionDetails('View exact dates and counts', series.map(({ title, count }) => [title, number.format(count)]),
      ['Date range (UTC)', 'Submissions']));
  return card.box;
}

function coverage(report, openSection) {
  const card = K.card({ title: 'Answer coverage by section',
    note: 'Share of eligible question slots answered. Names and contact details are excluded. The form does not track which optional questions were opened.' });
  const legend = el('div', prefix + 'coverage-legend');
  for (const [type, label] of [['answered', 'Answered'], ['blank', 'Blank']]) {
    const entry = el('span', '', label);
    entry.prepend(el('i', prefix + type));
    legend.append(entry);
  }
  const list = el('ul', prefix + 'coverage');
  GROUPS.forEach(group => {
    const metrics = group.fields
      .filter(({ type }) => type !== 'input' && type !== 'email')
      .map(({ key }) => report.questions[key]);
    const answered = metrics.reduce((sum, field) => sum + field.answered, 0);
    const eligible = metrics.reduce((sum, field) => sum + field.eligible, 0);
    const item = el('li', prefix + 'coverage-item');
    const link = el('button', prefix + 'section-link', group.title);
    link.type = 'button';
    link.addEventListener('click', () => openSection(group.id));
    const track = eligible ? K.C.stackedMeter([
      { value: answered, label: 'Answered', series: '1' },
      { value: eligible - answered, label: 'Blank', series: '2' }
    ]) : el('div');
    track.classList.add(prefix + 'stack');
    track.querySelector('.wc-legend')?.remove();
    track.setAttribute('aria-hidden', 'true');
    item.append(link, el('strong', prefix + 'value', pct(answered, eligible)), track,
      el('span', prefix + 'coverage-base', eligible ? number.format(answered) + ' of ' + number.format(eligible) : 'No eligible slots'));
    list.append(item);
  });
  card.body.append(legend, list);
  return card.box;
}

function textCard(item) {
  const card = el('article', prefix + 'comment');
  card.append(el('p', prefix + 'response-facts',
    (personaLabels[item.persona] || 'No persona selected') + ' · ' + date(item.created_at)));
  Object.entries(item.comments).forEach(([key, value]) => card.append(row(FIELD_BY_KEY[key].label, value)));
  return card;
}

function pager(result, onPage) {
  const controls = el('div', prefix + 'pager');
  const last = Math.max(1, Math.ceil(result.total / result.per_page));
  const previous = K.button('Previous', () => onPage(result.page - 1));
  const next = K.button('Next', () => onPage(result.page + 1));
  previous.disabled = result.page <= 1;
  next.disabled = result.page >= last;
  controls.append(previous, el('span', prefix + 'note', 'Page ' + result.page + ' of ' + last), next);
  return controls;
}

export async function renderAdminPrelaunchFeedback(host) {
  const wrap = K.page(host, {
    title: 'Pre-launch Survey',
    meta: 'Participation, answer distributions and written feedback from the public survey.',
    actions: [K.anchor('Open public form', '/prelaunch-feedback.html', { external: true })]
  });
  wrap.classList.add('gq-feedback');
  const filters = K.card({ title: 'Filter respondents',
    note: 'Date bounds are inclusive (UTC). Every chart and the CSV use this selection.' });
  const form = el('form', prefix + 'filters');
  const start = K.input('', 'date');
  const end = K.input('', 'date');
  const persona = K.select([['', 'All personas'], ...FIELD_BY_KEY.persona.options, ['unspecified', 'No answer']]);
  const video = K.select([['', 'Any answer'], ...FIELD_BY_KEY.video_watched.options, ['unspecified', 'No answer']]);
  const community = K.select([['', 'Any answer'], ['yes', 'Yes'], ['no', 'No'], ['unspecified', 'No answer']]);
  const controls = { from: start, to: end, persona, video_watched: video, community_visited: community };
  const filtersState = K.status();
  const csv = K.anchor('Export filtered CSV', '#', { external: false, solid: true });
  csv.hidden = true;
  const labels = ['From', 'To', 'Persona', 'Watched the video', 'Visited Community or Forum'];
  Object.values(controls).forEach((control, index) => {
    control.setAttribute('aria-label', labels[index]);
    form.append(K.field(labels[index], control));
  });
  const filterActions = el('div', prefix + 'filter-actions');
  filterActions.append(K.button('Reset filters', () => { form.reset(); changeFilters(); }), csv);
  form.append(filterActions);
  filters.body.append(form, filtersState);

  const dashboard = el('div', prefix + 'dashboard');
  const stats = el('div', prefix + 'stats');
  const overview = el('div', prefix + 'overview');
  const details = el('div', prefix + 'results');
  const panel = el('section', prefix + 'panel');
  const nav = K.choices([
    ['questions', 'By question'], ['text', 'Written answers'], ['responses', 'Individual submissions']
  ], 'questions', show);
  nav.setAttribute('aria-label', 'Survey result views');
  details.append(nav, panel);
  dashboard.append(stats, overview, details);
  dashboard.hidden = true;
  wrap.append(filters.box, dashboard);

  let cohort = new URLSearchParams();
  let report;
  let revision = 0;
  let textRevision = 0;
  let view = 'questions';
  let section = 'about';
  let textQuestion = '';
  let textQuery = '';

  function changeFilters() {
    cohort = new URLSearchParams();
    Object.entries(controls).forEach(([name, field]) => {
      if (field.value) cohort.set(name, field.value);
    });
    refresh();
  }

  form.addEventListener('submit', event => { event.preventDefault(); changeFilters(); });
  form.addEventListener('change', changeFilters);

  function selectView(key) {
    const buttons = Array.from(nav.querySelectorAll('button'));
    buttons[['questions', 'text', 'responses'].indexOf(key)].click();
  }

  function openSection(key) {
    section = key;
    if (view === 'questions') renderQuestions();
    else selectView('questions');
    panel.querySelector('select')?.focus();
  }

  function openText(key) {
    textQuestion = key;
    textQuery = '';
    selectView('text');
    panel.querySelector('select')?.focus();
  }

  function show(next) {
    view = next;
    if (view === 'questions') renderQuestions();
    if (view === 'text') renderText();
    if (view === 'responses') renderSubmissions(report);
  }

  function renderQuestions() {
    const select = K.select(sectionOptions, section);
    const group = questionGroups.find(({ id }) => id === section);
    const card = K.card({
      title: 'Results by question',
      note: 'Option and score percentages use valid answers to that question. The sample and blank counts use its eligible submissions.'
    });
    const grid = el('div', prefix + 'questions');
    for (const field of group.fields) grid.append(questionCard(field, report.questions[field.key], openText));
    select.addEventListener('change', () => {
      section = select.value;
      renderQuestions();
      panel.querySelector('select').focus();
    });
    card.body.append(K.field('Survey section', select));
    if (group === legacyGroup) {
      card.body.append(note('The historical cohort includes submissions with a saved answer in the previous rating scales. The form did not store question impressions.'));
    }
    card.body.append(grid);
    panel.replaceChildren(card.box);
  }

  function renderText() {
    const card = K.card({ title: 'Written answers',
      note: 'Search across all written answers in the selected cohort. Search changes this list only.' });
    const textForm = el('form', prefix + 'text-filters');
    const select = K.select([['', 'All written questions'], ...textOptions], textQuestion);
    const input = K.input(textQuery, 'search', 'Search answer text');
    input.maxLength = 200;
    textForm.append(K.field('Question', select), K.field('Search text', input),
      K.button('Search', null, { type: 'submit' }));
    const state = K.status();
    const list = el('div', prefix + 'response-list');
    card.body.append(textForm, state, list);
    panel.replaceChildren(card.box);
    textForm.addEventListener('submit', event => { event.preventDefault(); search(); });
    select.addEventListener('change', search);

    function search() {
      textQuestion = select.value;
      textQuery = input.value.trim();
      fetchText(1);
    }

    async function fetchText(page) {
      const current = ++textRevision;
      const currentCohort = revision;
      const params = new URLSearchParams(cohort);
      params.set('view', 'text');
      params.set('page', page);
      if (textQuestion) params.set('question', textQuestion);
      if (textQuery) params.set('q', textQuery);
      K.setStatus(state, 'Loading written answers…');
      list.replaceChildren();
      try {
        const result = await P.call(endpoint + '?' + params);
        if (current !== textRevision || currentCohort !== revision || !list.isConnected) return;
        K.setStatus(state, result.total ? number.format(result.total) + ' matching submissions' : 'No written answers match.');
        list.append(...result.responses.map(textCard));
        if (result.total > result.per_page) list.append(pager(result, fetchText));
      } catch (error) {
        if (current !== textRevision || currentCohort !== revision || !list.isConnected) return;
        K.setStatus(state, error.message || 'Written answers could not be loaded.', 'bad');
        list.append(K.button('Retry', () => fetchText(page)));
      }
    }

    fetchText(1);
  }

  function renderSubmissions(result) {
    const card = K.card({ title: 'Individual submissions',
      note: 'Open a submission to see the saved answers together.' });
    const list = el('div', prefix + 'response-list');
    const state = K.status();
    card.body.append(state, list);
    if (!result.total) list.append(note('No submissions in this cohort.'));
    list.append(...result.responses.map(responseCard));
    if (result.total > result.per_page) card.body.append(pager(result, fetchPage));
    panel.replaceChildren(card.box);

    async function fetchPage(page) {
      const current = revision;
      const params = new URLSearchParams(cohort);
      params.set('page', page);
      card.box.querySelectorAll('button').forEach(button => { button.disabled = true; });
      K.setStatus(state, 'Loading submissions…');
      try {
        const data = await P.call(endpoint + '?' + params);
        if (current === revision && list.isConnected) renderSubmissions(data);
      } catch (error) {
        if (current !== revision || !list.isConnected) return;
        K.setStatus(state, error.message || 'Submissions could not be loaded.', 'bad');
        state.after(K.button('Retry', () => renderSubmissions(result)));
      }
    }
  }

  async function refresh() {
    const current = ++revision;
    csv.hidden = true;
    dashboard.inert = true;
    dashboard.setAttribute('aria-busy', 'true');
    const query = new URLSearchParams(cohort);
    K.setStatus(filtersState, 'Loading survey results…');
    try {
      const result = await P.call(endpoint + '?' + query);
      if (current !== revision || !wrap.isConnected) return;
      report = result;
      stats.replaceChildren(
        K.tile({ value: number.format(result.total), label: 'Respondents', icon: 'team', featured: true,
          note: 'One per saved submission' }),
        K.tile({ value: pct(result.answered_slots, result.eligible_slots), label: 'Question response rate', icon: 'activity',
          note: number.format(result.answered_slots) + ' of ' + number.format(result.eligible_slots) + ' eligible slots' }),
        K.tile({ value: number.format(result.last_7_days), label: 'Last 7 days', icon: 'overview',
          note: 'Through today (UTC)' }),
        K.tile({ value: number.format(result.last_30_days), label: 'Last 30 days', icon: 'topic',
          note: 'Through today (UTC)' })
      );
      overview.replaceChildren(participation(result), coverage(result, openSection));
      dashboard.hidden = false;
      show(view);
      query.set('format', 'csv');
      csv.href = '/api' + endpoint + '?' + query;
      csv.hidden = false;
      K.setStatus(filtersState, result.total ? '' : 'No submissions match these filters.');
    } catch (error) {
      if (current !== revision || !wrap.isConnected) return;
      dashboard.hidden = true;
      K.setStatus(filtersState, error.message || 'Survey results could not be loaded.', 'bad');
      filtersState.append(' ', K.button('Retry', refresh, { tiny: true }));
    } finally {
      if (current === revision) {
        dashboard.inert = false;
        dashboard.removeAttribute('aria-busy');
      }
    }
  }

  await refresh();
}
