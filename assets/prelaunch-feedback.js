/* Prelaunch feedback: builds the survey from the shared schema, keeps the
   rail and the visible question numbers in step with what the visitor can
   see, and saves to /api/prelaunch/feedback/.

   Why it is built this way:
   - One schema (prelaunch-feedback-schema.js) feeds this form and the admin
     report, so a question can never be asked in one wording and reported in
     another. Numbers are not in the schema: they are given out at render time
     in the order the visitor actually sees, so a hidden follow-up or a closed
     "more questions" drawer never leaves a gap (Ahmad's review, 2026-11-19).
   - Every question is a fieldset or a label wrapped around its own control.
     The first version labelled every text box "Your answer", so a screen
     reader announced fifteen identical fields; the question is the label.
   - Each answer offers "Clear" only once there is something to clear. A radio
     group cannot be emptied by clicking, so the control has to exist, but it
     was printed under all thirty questions and read as noise.
   - The marks are the brand set (assets/gravitas-icons.js), copied rather
     than loaded: that file is a classic script that writes a global, and this
     page needs four glyphs, not sixty-six. The star replaces a U+2605
     character that rendered in whatever font the system had.
   - Hidden questions are disabled as well as hidden, so they neither submit
     nor take focus. gather() also re-checks every gate on its own. */
import { GROUPS, FIELDS } from './prelaunch-feedback-schema.js?v=20261122-brand1';

const form = document.getElementById('prelaunch-form');
const host = document.getElementById('fb-question-groups');
const submit = document.getElementById('fb-submit-button');
const submitLabel = submit.querySelector('[data-submit-label]');
const status = document.getElementById('fb-status');
const progress = document.getElementById('fb-count');
const meter = document.getElementById('fb-meter');
const railList = document.getElementById('fb-rail-list');
const RADIO_TYPES = ['score5', 'score10', 'persona', 'yesno', 'select'];
let savedAnswers = {};

const MARKS = {
  star: '<g transform="translate(0.707 0.124) scale(0.941115)" stroke-width="1.806"><path d="M12.00 2.60 14.59 9.04 21.51 9.51 16.18 13.96 17.88 20.69 12.00 17.00 6.12 20.69 7.82 13.96 2.49 9.51 9.41 9.04Z"/><circle cx="12" cy="12.9" r="1.647" fill="currentColor" stroke="none"/></g>',
  check: '<g transform="translate(-0.793 -1.901) scale(1.060362)" stroke-width="1.603"><path d="m3.6 12.6 5.6 5.6L20.4 6.4"/></g>',
  chevron: '<g transform="translate(-3.054 -2.465) scale(1.209200)" stroke-width="1.406"><path d="m9 4.6 7.4 7.4L9 19.4"/></g>',
  arrow: '<g transform="translate(-0.406 -0.406) scale(1.033855)" stroke-width="1.644"><path d="M3.4 12h17.2"/><path d="m14.2 5.6 6.4 6.4-6.4 6.4"/></g>',
  alert: '<g transform="translate(1.226 -0.929) scale(0.897866)" stroke-width="1.893"><path d="M10.3 4.2a2 2 0 0 1 3.4 0l8 13.8a2 2 0 0 1-1.7 3H4a2 2 0 0 1-1.7-3z"/><path d="M12 9.4v4.2"/><circle cx="12" cy="17.2" r="1.726" fill="currentColor" stroke="none"/></g>'
};
function mark(name, klass) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'g-ic ' + klass);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('shape-rendering', 'geometricPrecision');
  svg.innerHTML = MARKS[name];
  return svg;
}
function el(tag, klass, text) {
  const node = document.createElement(tag);
  if (klass) node.className = klass;
  if (text !== undefined) node.textContent = text;
  return node;
}
function fieldValue(key) {
  const control = form.elements.namedItem(key);
  if (!control) return '';
  if (control instanceof RadioNodeList) return control.value || '';
  if (control.type === 'radio') return control.checked ? control.value : '';
  return control.value || '';
}
function scaleOptions(field) {
  const from = field.type === 'score10' ? 0 : 1;
  const count = field.type === 'score10' ? 11 : 5;
  return Array.from({ length: count }, (_, i) => [String(i + from), String(i + from)]);
}

/* The question's heading: its visible number, the priority star and the
   wording. For a choice question it is the fieldset's legend, which has to be
   the fieldset's first child to name the group, so nothing wraps it; the
   number hangs in the left gutter and Clear sits at the top right, both
   positioned against the question rather than flowed beside the legend. */
function questionHead(field, wrapper, labelTag, forId) {
  const text = el(labelTag, 'fb-q__label');
  if (forId) text.htmlFor = forId;
  // Numbers are assigned after visibility changes, so hidden questions never leave gaps.
  text.append(el('span', 'fb-question__id', ''));
  const words = el('span', 'fb-q__text');
  if (field.star) {
    words.append(mark('star', 'fb-q__star'), el('span', 'g-visually-hidden', 'Priority question: '));
  }
  words.append(document.createTextNode(field.label));
  text.append(words);
  wrapper.append(text);
  return text;
}

function fieldControl(field) {
  const name = field.key;
  const isScale = field.type === 'score5' || field.type === 'score10';
  const isRadio = RADIO_TYPES.includes(field.type);
  const wrap = el(isRadio ? 'fieldset' : 'div', 'fb-question fb-q fb-q--' + field.type);
  wrap.dataset.question = name;
  if (field.gate) wrap.dataset.gate = field.gate;

  if (!isRadio) {
    const id = 'fb-field-' + name;
    questionHead(field, wrap, 'label', id);
    if (field.hint) {
      const hint = el('p', 'g-hint fb-q__hint', field.hint);
      hint.id = id + '-hint';
      wrap.append(hint);
    }
    const input = field.type === 'text' ? document.createElement('textarea') : document.createElement('input');
    input.name = name;
    input.id = id;
    input.maxLength = field.max || 2000;
    if (field.type === 'text') {
      input.className = 'g-textarea fb-q__input';
      input.rows = 3;
    } else {
      input.className = 'g-input fb-q__input';
      input.type = field.type === 'email' ? 'email' : 'text';
      input.autocomplete = field.type === 'email' ? 'email' : 'name';
      if (field.type === 'email') {
        input.inputMode = 'email';
        input.spellcheck = false;
      }
    }
    if (field.hint) input.setAttribute('aria-describedby', id + '-hint');
    wrap.append(input);
    return wrap;
  }

  questionHead(field, wrap, 'legend');
  const clear = el('button', 'fb-clear', 'Clear');
  clear.type = 'button';
  clear.dataset.clearRadio = name;
  clear.hidden = true;
  clear.setAttribute('aria-label', 'Clear answer: ' + field.label);

  const options = isScale ? scaleOptions(field)
    : field.type === 'yesno' ? [['yes', 'Yes'], ['no', 'No']] : field.options;
  const groupClass = field.type === 'persona' ? 'fb-personas'
    : isScale ? 'fb-scale fb-scale--' + (field.type === 'score10' ? 'eleven' : 'five')
    : 'fb-choices';
  const group = el('div', groupClass);
  let endsId = '';
  if (isScale) {
    endsId = 'fb-ends-' + name;
    group.setAttribute('aria-describedby', endsId);
  }
  for (const option of options) {
    const label = el('label', field.type === 'persona' ? 'fb-persona' : (isScale ? 'fb-choice' : 'fb-option'));
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = option[0];
    if (endsId) input.setAttribute('aria-describedby', endsId);
    let face;
    if (field.type === 'persona') {
      face = el('span', 'fb-persona__face');
      const top = el('span', 'fb-persona__top');
      top.append(el('strong', null, option[1]), mark('check', 'fb-persona__tick'));
      face.append(top);
      if (option[2]) face.append(el('small', null, option[2]));
    } else {
      face = el('span', 'fb-pick', option[1]);
    }
    label.append(input, face);
    group.append(label);
  }
  wrap.append(group);
  if (isScale) {
    const ends = el('p', 'fb-scale__ends');
    ends.id = endsId;
    ends.append(el('span', null, field.low), el('span', 'g-visually-hidden', ' to '), el('span', null, field.high));
    wrap.append(ends);
  }
  wrap.append(clear);
  return wrap;
}

function build() {
  GROUPS.forEach(group => {
    const section = el('section', 'fb-panel fb-group');
    section.id = 'fb-section-' + group.id;
    section.dataset.section = group.id;
    section.setAttribute('aria-labelledby', 'fb-group-' + group.id);
    const head = el('header', 'fb-panel__head');
    head.append(el('span', 'fb-panel__letter', group.letter));
    const heading = el('h2', 'fb-panel__title', group.title);
    heading.id = 'fb-group-' + group.id;
    head.append(heading, el('p', 'fb-panel__note', group.note));
    section.append(head);

    const primary = el('div', 'fb-questions');
    for (const field of group.fields.filter(item => !item.extra)) primary.append(fieldControl(field));
    section.append(primary);

    const moreQuestions = group.fields.filter(item => item.extra);
    if (moreQuestions.length) {
      const details = document.createElement('details');
      details.className = 'fb-more';
      details.dataset.more = group.id;
      const summary = document.createElement('summary');
      summary.className = 'g-btn g-btn--secondary g-btn--sm fb-more__toggle';
      summary.append(
        el('span', 'fb-more__label', moreQuestions.length + ' More Questions'),
        mark('chevron', 'fb-more__chev')
      );
      details.append(summary);
      const extra = el('div', 'fb-questions fb-questions--extra');
      moreQuestions.forEach(field => extra.append(fieldControl(field)));
      details.append(extra);
      section.append(details);
      details.addEventListener('toggle', syncState);
    }
    host.append(section);

    const item = el('li', 'fb-rail__item');
    const link = el('a', 'fb-rail__link');
    link.href = '#' + section.id;
    link.dataset.railFor = group.id;
    link.append(el('span', 'fb-rail__letter', group.letter), el('span', 'fb-rail__title', group.title));
    const done = mark('check', 'fb-rail__tick');
    link.append(done, el('span', 'g-visually-hidden fb-rail__state', ''));
    item.append(link);
    railList.append(item);
  });
  const sendItem = el('li', 'fb-rail__item fb-rail__item--send');
  const sendLink = el('a', 'fb-rail__link');
  sendLink.href = '#fb-send';
  sendLink.dataset.railFor = 'send';
  sendLink.append(mark('arrow', 'fb-rail__letter fb-rail__go'), el('span', 'fb-rail__title', 'Send'));
  sendItem.append(sendLink);
  railList.append(sendItem);

  form.querySelectorAll('[data-clear-radio]').forEach(clear => {
    clear.addEventListener('click', () => {
      const inputs = form.querySelectorAll('input[name="' + clear.dataset.clearRadio + '"]');
      inputs.forEach(input => { input.checked = false; });
      syncState();
      // The button hides itself once the answer is gone; hand focus back to
      // the first option so keyboard users are not dropped to the page top.
      if (inputs[0]) inputs[0].focus();
    });
  });
  form.addEventListener('input', syncState);
  form.addEventListener('change', syncState);
}

function gateSatisfied(field) {
  if (!field.gate) return true;
  const idx = field.gate.indexOf(':');
  const depends = field.gate.slice(0, idx);
  const allowed = field.gate.slice(idx + 1).split(',');
  return allowed.includes(fieldValue(depends));
}

function syncState() {
  for (const field of FIELDS) {
    const question = form.querySelector('[data-question="' + field.key + '"]');
    if (!question) continue;
    question.hidden = !gateSatisfied(field);
    // Hidden controls cannot accidentally submit data or receive focus.
    question.querySelectorAll('input,textarea,select').forEach(input => {
      input.disabled = question.hidden;
    });
    const clear = question.querySelector('[data-clear-radio]');
    if (clear) clear.hidden = question.hidden || fieldValue(field.key) === '';
  }
  // Do not offer an expandable panel when every extra question is gated off.
  // The Community follow-ups, for example, only apply after choosing Yes.
  // The count on the toggle is the questions it will actually open.
  for (const details of host.querySelectorAll('details.fb-more')) {
    const available = Array.from(details.querySelectorAll('.fb-question')).filter(question => !question.hidden).length;
    const label = details.querySelector('.fb-more__label');
    const text = available + (available === 1 ? ' More Question' : ' More Questions');
    if (label && label.textContent !== text) label.textContent = text;
    details.hidden = available === 0;
    if (details.hidden && details.open) details.open = false;
  }
  // Number questions in the exact order the visitor can currently see.
  // Accordion contents and conditional follow-ups do not reserve numbers when hidden.
  let visibleNumber = 0;
  for (const question of host.querySelectorAll('.fb-question')) {
    const accordion = question.closest('details');
    const visible = !question.hidden && (!accordion || accordion.open);
    const number = question.querySelector('.fb-question__id');
    if (number) number.textContent = visible ? String(++visibleNumber).padStart(2, '0') : '';
  }

  const available = FIELDS.filter(field => field.star && gateSatisfied(field));
  const completed = available.filter(field => fieldValue(field.key) !== '').length;
  const sentence = completed + ' of ' + available.length + ' answered';
  if (progress.textContent !== sentence) progress.textContent = sentence;
  if (meter.childElementCount !== available.length) {
    meter.replaceChildren(...available.map(() => el('span', 'fb-meter__seg')));
  }
  Array.from(meter.children).forEach((seg, index) => seg.classList.toggle('is-on', index < completed));

  for (const group of GROUPS) {
    const touched = group.fields.some(field => gateSatisfied(field) && fieldValue(field.key) !== '');
    const link = railList.querySelector('[data-rail-for="' + group.id + '"]');
    if (!link) continue;
    link.classList.toggle('is-touched', touched);
    link.querySelector('.fb-rail__state').textContent = touched ? ', answered' : '';
  }
}

/* The rail marks the section being read. An IntersectionObserver over the
   panels, with a band across the upper third of the viewport, so the mark
   moves when a section's head reaches reading height rather than when its
   last pixel leaves. The send panel is the page's last and shorter than the
   space below that band, so at the foot of the page it never reaches it; it
   is marked instead once most of it is on screen. */
function watchSections() {
  if (!('IntersectionObserver' in window)) return;
  const links = new Map(Array.from(railList.querySelectorAll('[data-rail-for]')).map(link => [link.dataset.railFor, link]));
  const send = document.getElementById('fb-send');
  const panels = [...host.querySelectorAll('.fb-group'), send];
  const order = panels.map(panel => panel.dataset.section || 'send');
  const visible = new Set();
  let sendShown = false;
  const highlight = () => {
    const current = sendShown ? 'send' : order.find(id => visible.has(id));
    if (!current) return;
    links.forEach((link, id) => {
      if (id === current) link.setAttribute('aria-current', 'step');
      else link.removeAttribute('aria-current');
    });
  };
  const band = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const id = entry.target.dataset.section || 'send';
      if (entry.isIntersecting) visible.add(id); else visible.delete(id);
    }
    highlight();
  }, { rootMargin: '-28% 0px -62% 0px' });
  panels.forEach(panel => band.observe(panel));
  new IntersectionObserver(([entry]) => {
    sendShown = entry.intersectionRatio >= 0.6;
    highlight();
  }, { threshold: [0, 0.6, 1] }).observe(send);
}

function display(text, state) {
  status.replaceChildren();
  if (text) {
    if (state === 'success') status.append(mark('check', 'fb-status__ic'));
    if (state === 'error') status.append(mark('alert', 'fb-status__ic'));
    status.append(el('span', null, text));
  }
  if (state) status.dataset.state = state; else status.removeAttribute('data-state');
}
function setSubmitLabel(text) { submitLabel.textContent = text; }

function populate(submission) {
  if (!submission) return;
  savedAnswers = { ...(submission.answers || {}) };
  for (const field of FIELDS) {
    const value = field.key === 'name' ? submission.name : savedAnswers[field.key];
    if (value === null || value === undefined || value === '') continue;
    if (RADIO_TYPES.includes(field.type)) {
      const options = form.querySelectorAll('input[name="' + field.key + '"]');
      Array.from(options).forEach(option => { option.checked = option.value === String(value); });
    } else {
      const control = form.elements.namedItem(field.key);
      if (control) control.value = String(value);
    }
    if (field.extra) {
      const details = form.querySelector('[data-question="' + field.key + '"]')?.closest('details');
      if (details) details.open = true;
    }
  }
  syncState();
  setSubmitLabel('Update Feedback');
  display('Your earlier answers are loaded. Change anything you like and send again to update them.', 'info');
}

function gather() {
  // Preserve answers collected through the first-generation form, without
  // silently overwriting them when a returning visitor edits new questions.
  const answers = { ...savedAnswers };
  FIELDS.forEach(field => { delete answers[field.key]; });
  for (const field of FIELDS) {
    if (field.key === 'name' || !gateSatisfied(field)) continue;
    const value = String(fieldValue(field.key)).trim();
    if (!value) continue;
    if (field.type === 'score5' || field.type === 'score10') answers[field.key] = Number(value);
    else answers[field.key] = value;
  }
  // Earlier visitors may have written video feedback before the watch gate
  // existed. Editing the expanded form must not erase that earlier answer.
  if (!fieldValue('video_watched') && savedAnswers.video_feedback && !answers.video_feedback) {
    answers.video_feedback = savedAnswers.video_feedback;
  }
  return { name: String(fieldValue('name')).trim(), answers, website: form.elements.namedItem('website').value };
}
function cookie(name) {
  const row = document.cookie.split('; ').find(x => x.startsWith(name + '='));
  return row ? decodeURIComponent(row.slice(name.length + 1)) : '';
}
async function csrf() {
  const response = await fetch('/api/auth/csrf/', {
    credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }
  });
  if (!response.ok) throw new Error('The secure connection could not be prepared.');
  const token = cookie('csrftoken') || cookie('gravitas_staging_csrftoken');
  if (!token) throw new Error('Cookies are blocked, so the feedback cannot be saved securely. Allow cookies for this site.');
  return token;
}
async function load() {
  try {
    const response = await fetch('/api/prelaunch/feedback/', {
      credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }
    });
    if (!response.ok) return;
    const data = await response.json();
    if (data.submission) populate(data.submission);
  } catch (_error) { /* The form can still be filled without the initial read. */ }
}

/* The rail and the section anchors sit under the sticky header, whose height
   moves with the type scale and the menu breakpoint. Measure it rather than
   guess it (brand book, "Sticky chrome"). */
function measureHeader() {
  const header = document.querySelector('.g-header');
  if (!header) return;
  const set = () => document.documentElement.style.setProperty('--fb-header', header.getBoundingClientRect().height + 'px');
  set();
  if ('ResizeObserver' in window) new ResizeObserver(set).observe(header);
}

build();
syncState();
watchSections();
measureHeader();

const email = form.elements.namedItem('contact_email');
function clearEmailError() {
  email.removeAttribute('aria-invalid');
  if (status.dataset.field === 'contact_email') { display(''); delete status.dataset.field; }
}
email.addEventListener('input', clearEmailError);

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submit.disabled) return;
  if (email.value.trim() && !email.checkValidity()) {
    const parent = email.closest('details');
    if (parent) parent.open = true;
    email.setAttribute('aria-invalid', 'true');
    display('That email address is not valid. Correct it, or leave the field empty.', 'error');
    status.dataset.field = 'contact_email';
    email.focus();
    return;
  }
  submit.disabled = true;
  submit.setAttribute('aria-busy', 'true');
  display('Sending your feedback…');
  try {
    const token = await csrf();
    const payload = gather();
    const response = await fetch('/api/prelaunch/feedback/', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRFToken': token },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error('The server did not confirm your feedback.');
    savedAnswers = { ...data.submission.answers };
    setSubmitLabel('Update Feedback');
    display('Thank you. Your feedback is saved, and you can update it from this browser at any time.', 'success');
  } catch (error) {
    display((error?.message || 'Your feedback could not be saved.') + ' Reload the page to see whether it arrived before sending again.', 'error');
  } finally {
    submit.disabled = false;
    submit.removeAttribute('aria-busy');
  }
});
load();
