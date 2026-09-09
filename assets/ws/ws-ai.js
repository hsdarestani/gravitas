/* ==========================================================================
   GRAVITAS+ WORKSPACE  ·  ASSISTANT
   A panel that answers questions about the pages in this workspace and
   cites which ones it read.

   The rule this panel is built around: it never answers without sources.
   This is a research tool for a project whose public method is a permanent,
   linked correction log, and an assistant that produces a fluent paragraph
   nobody can check would contradict the editorial standard the rest of the
   site is built on. So every answer carries the pages it came from, and
   when no language model is configured the panel says that in those words
   and falls back to search rather than to invention.
   ========================================================================== */

import * as api from './ws-api.js';
import * as P from './ws-platform.js';

const icon = (name) => window.GravitasIcons.icon(name, 'g-wi');

let log = null;
let input = null;
let context = null;
const turns = [];

export function mountAssistant(host, ctx) {
  context = ctx;

  const wrap = document.createElement('div');
  wrap.className = 'ws-ai';

  log = document.createElement('div');
  log.className = 'ws-ai__log';
  log.setAttribute('role', 'log');
  log.setAttribute('aria-label', 'Assistant conversation');

  const compose = document.createElement('div');
  compose.className = 'ws-ai__compose';

  input = document.createElement('textarea');
  input.className = 'ws-ai__input';
  input.rows = 1;
  input.placeholder = 'Ask about these pages';
  input.setAttribute('aria-label', 'Ask the assistant');

  // Grow with the text, to a ceiling. A fixed one-line box hides the end of
  // anything longer than a sentence, which is most real questions.
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(140, input.scrollHeight) + 'px';
  });

  // Enter sends, Shift Enter breaks the line. The opposite mapping is the
  // one people complain about in every chat panel ever shipped.
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  });

  const submit = document.createElement('button');
  submit.className = 'ws-ibtn';
  submit.type = 'button';
  submit.innerHTML = icon('arrow');
  submit.setAttribute('aria-label', 'Send');
  submit.addEventListener('click', send);

  compose.append(input, submit);
  wrap.append(log, compose);
  host.append(wrap);

  draw();
}

export function focusAssistant() {
  requestAnimationFrame(() => input?.focus());
}

/* Puts a question in the box and sends it. Used by the focus card, so the
   reader gets an answer rather than an empty panel and a cursor. */
export function askAssistant(question) {
  requestAnimationFrame(() => {
    if (!input) return;
    input.focus();
    if (!question) return;
    input.value = question;
    send();
  });
}

function draw() {
  if (!log) return;
  log.innerHTML = '';

  if (!turns.length) {
    const intro = document.createElement('div');
    intro.className = 'ws-empty';
    intro.style.padding = '24px 4px';

    const title = document.createElement('p');
    title.className = 'ws-empty__title';
    title.textContent = 'Ask across your pages';

    const body = document.createElement('p');
    body.className = 'ws-empty__body';
    body.textContent = 'Answers cite the pages they came from, so you can check them. Try asking what is still open on a dossier.';

    intro.append(title, body);
    log.append(intro);
    return;
  }

  for (const turn of turns) log.append(turnEl(turn));
  log.scrollTop = log.scrollHeight;
}

function turnEl(turn) {
  const wrap = document.createElement('div');
  wrap.className = 'ws-ai__turn';
  wrap.dataset.who = turn.who;

  const who = document.createElement('p');
  who.className = 'ws-ai__who';
  who.textContent = turn.who === 'you' ? 'You' : 'Assistant';

  const text = document.createElement('div');
  text.className = 'ws-ai__text';

  if (turn.pending) {
    const dots = document.createElement('span');
    dots.className = 'ws-think';
    dots.setAttribute('aria-label', 'Thinking');
    dots.innerHTML = '<i></i><i></i><i></i>';
    text.append(dots);
    wrap.append(who, text);
    return wrap;
  }

  for (const para of String(turn.text).split('\n\n')) {
    const p = document.createElement('p');
    p.textContent = para;
    text.append(p);
  }

  wrap.append(who, text);

  if (turn.sources?.length) {
    const cites = document.createElement('div');
    cites.className = 'ws-ai__actions';
    for (const source of turn.sources) {
      const cite = document.createElement('button');
      cite.className = 'ws-ai__cite';
      cite.type = 'button';
      cite.textContent = source.title;
      cite.addEventListener('click', () => context.go(`/workspace/page/${source.id}`));
      cites.append(cite);
    }
    wrap.append(cites);
  }

  // Only offered when there is something concrete to turn into a task, so
  // the button is never a dead end.
  if (turn.who === 'assistant' && turn.sources?.length) {
    const actions = document.createElement('div');
    actions.className = 'ws-ai__actions';

    const toTask = document.createElement('button');
    toTask.className = 'ws-btn';
    toTask.type = 'button';
    toTask.textContent = 'Save as task';
    toTask.addEventListener('click', async () => {
      // Tasks are Core objects the server owns. There is no local task store
      // on purpose, so this either reaches the server or says it did not.
      if (!P.canOpenCore()) {
        toTask.textContent = 'Tasks need Core';
        toTask.disabled = true;
        return;
      }
      try {
        await P.call('/operating/tasks/', { method: 'POST', body: { title: turn.question } });
        toTask.textContent = 'Saved';
        toTask.disabled = true;
      } catch {
        toTask.textContent = 'Not saved';
      }
    });

    actions.append(toTask);
    wrap.append(actions);
  }

  return wrap;
}

async function send() {
  const question = input.value.trim();
  if (!question) return;

  input.value = '';
  input.style.height = 'auto';

  turns.push({ who: 'you', text: question });
  const pending = { who: 'assistant', pending: true };
  turns.push(pending);
  draw();

  try {
    const reply = await api.ask(question);
    Object.assign(pending, {
      pending: false,
      question,
      text: reply.answer,
      sources: reply.sources || [],
    });
  } catch {
    Object.assign(pending, {
      pending: false,
      text: 'That request did not go through. The assistant service may be down; nothing was changed in your pages.',
      sources: [],
    });
  }

  draw();
}
