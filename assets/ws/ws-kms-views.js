/* ==========================================================================
   GRAVITAS+ WORKSPACE  ·  KNOWLEDGE (KMS) VIEWS
   The learning workspace. Six screens, and the order of them in the index
   is the loop they form:

     Sources → Knowledge Base → Recall & Review → Skills

   with Learning Paths above the loop deciding what to feed into it.

   The design argument, in one sentence: every screen here ends in a button
   that moves an item to the next stage of that loop, so a person never has
   to remember what the method is — the method is the only thing the
   interface lets them do next.

     A source is read, and its only action is "Distil into a note".
     A note is written, and its only action is "Cut a recall card".
     A card is rehearsed, and rehearsing it is what raises a skill.
     A skill is what a path is aiming at.

   Nothing here shows a completion percentage as an achievement. Percentages
   appear only where they change what to do next, which on these screens
   means the path you are furthest into and the cards that are overdue.
   ========================================================================== */

import * as K from './ws-kms.js';
import { el, panel, row, stats, empty, linkButton } from './ws-views.js';

const icon = (name) => window.GravitasIcons.icon(name, 'g-wi');

const KIND_LABEL = { paper: 'Paper', book: 'Book', video: 'Video', course: 'Course', talk: 'Talk' };
const STATE_LABEL = { queued: 'Not started', reading: 'Reading', distilled: 'Distilled', parked: 'Parked' };
const STEP_LABEL = { read: 'Read', note: 'Write', recall: 'Rehearse', build: 'Apply' };

function docShell(host, title, subtitle) {
  host.innerHTML = '';
  const doc = el('div', 'ws-doc ws-doc--wide');
  const head = el('header', 'ws-doc__head');
  head.append(el('h1', 'ws-doc__title', title));
  if (subtitle) head.append(el('p', 'ws-doc__meta', subtitle));
  doc.append(head);
  host.append(doc);
  return doc;
}

function dueLabel(card) {
  const days = K.daysUntil(card.due);
  if (days < 0) return `${-days} ${-days === 1 ? 'day' : 'days'} overdue`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `In ${days} days`;
}

/* A bar, not a doughnut. The comparison people make with these is between
   rows in the same column, and a bar makes that comparison by length in one
   axis, which is the only encoding the eye reads accurately without a
   legend. */
function meter(percent, tone) {
  const wrap = el('div', 'v-meter');
  if (tone) wrap.dataset.tone = tone;
  const fill = el('i');
  fill.style.width = Math.max(2, Math.min(100, percent)) + '%';
  wrap.append(fill);
  return wrap;
}

/* ==========================================================================
   OVERVIEW
   One question: what should I do in the next twenty minutes. It is answered
   in the first screen of content, before any list, and everything below
   that answer is context for it.
   ========================================================================== */

export function renderKmsOverview(host, ctx) {
  const doc = docShell(
    host,
    'Knowledge',
    'What you are reading, what you have written down, what you are about to forget, and what it adds up to.',
  );

  const counts = K.queueCounts();
  const streak = K.reviewStreak();
  const done = K.reviewedToday();
  const queue = K.dueCards();
  const next = K.nextStep();

  doc.append(stats([
    ['Due now', counts.due],
    ['Reviewed today', done],
    ['Day streak', streak],
    ['Held', `${counts.held}/${counts.total}`],
  ]));

  /* ---- The one thing to do next ----------------------------------------- */
  const focus = el('section', 'v-next');
  if (queue.length) {
    focus.append(el('p', 'v-next__kicker', 'Start here'));
    focus.append(el('h2', 'v-next__title',
      `${queue.length} ${queue.length === 1 ? 'card is' : 'cards are'} due`));
    focus.append(el('p', 'v-next__body',
      'About a minute each. Reviewing them now is worth more than reading anything new today, because these are the ones that are about to go.'));
    const start = el('button', 'ws-btn ws-btn--solid', 'Start the review');
    start.type = 'button';
    start.addEventListener('click', () => ctx.go('/workspace/kms/recall'));
    focus.append(start);
  } else if (next) {
    focus.append(el('p', 'v-next__kicker', `${next.item.title} · ${next.progress.done} of ${next.progress.total} done`));
    focus.append(el('h2', 'v-next__title', next.step.title));
    focus.append(el('p', 'v-next__body',
      'Nothing is due for review, so the next move is the next unfinished step of the path you are furthest into.'));
    const open = el('button', 'ws-btn ws-btn--solid', 'Open the path');
    open.type = 'button';
    open.addEventListener('click', () => ctx.go(`/workspace/kms/paths/${next.item.id}`));
    focus.append(open);
  } else {
    focus.append(el('p', 'v-next__kicker', 'Clear'));
    focus.append(el('h2', 'v-next__title', 'Nothing due, nothing queued'));
    focus.append(el('p', 'v-next__body',
      'Add something you have been meaning to read, or start a path. An empty knowledge workspace is a fine state to be in for a day and a bad one to be in for a month.'));
    const add = el('button', 'ws-btn ws-btn--solid', 'Add a source');
    add.type = 'button';
    add.addEventListener('click', () => ctx.go('/workspace/kms/sources'));
    focus.append(add);
  }
  doc.append(focus);

  /* ---- The loop, drawn once --------------------------------------------- */
  doc.append(loopStrip(ctx));

  const columns = el('div', 'v-columns');

  /* Reading in progress: sources opened and not yet distilled. This is the
     honest measure of a reading habit, and it is the number that quietly
     grows when somebody is collecting rather than learning. */
  const reading = K.sources().filter((item) => item.state === 'reading');
  const queued = K.sources().filter((item) => item.state === 'queued');

  const shelf = panel('On the desk', linkButton('All sources', '/workspace/kms/sources', ctx.go));
  if (reading.length || queued.length) {
    for (const item of [...reading, ...queued].slice(0, 5)) {
      shelf.body.append(row({
        title: item.title,
        sub: item.question || item.author,
        badges: [STATE_LABEL[item.state], KIND_LABEL[item.kind] || item.kind],
        onClick: () => ctx.go('/workspace/kms/sources'),
      }));
    }
    if (queued.length > 3) {
      const warn = el('p', 'v-note');
      warn.dataset.tone = 'warn';
      warn.textContent = `${queued.length} sources are queued and unopened. A queue this long is a decision being avoided, not a reading list: park the ones you are not going to read.`;
      shelf.body.append(warn);
    }
  } else {
    shelf.body.append(empty('Nothing on the desk', 'Sources are the things you have decided to read, with the question you opened them for.'));
  }
  columns.append(shelf);

  const paths = panel('Paths', linkButton('All paths', '/workspace/kms/paths', ctx.go));
  for (const item of K.paths()) {
    const progress = K.pathProgress(item);
    const node = row({
      title: item.title,
      sub: `${progress.done} of ${progress.total} steps · ${item.owner}`,
      onClick: () => ctx.go(`/workspace/kms/paths/${item.id}`),
    });
    node.querySelector('.v-row__main').append(meter(progress.percent));
    paths.body.append(node);
  }
  columns.append(paths);

  doc.append(columns);
}

/* The loop as four cells rather than a paragraph explaining it. Each cell
   navigates, so the diagram is also the navigation, which is the only way a
   diagram in a product earns its space. */
function loopStrip(ctx) {
  const strip = el('nav', 'v-loop');
  strip.setAttribute('aria-label', 'The learning loop');

  const steps = [
    { mark: 'files',  label: 'Capture',  body: 'A source, and the question you opened it for.', path: '/workspace/kms/sources' },
    { mark: 'notes',  label: 'Distil',   body: 'Close it, then write the answer from memory.',  path: '/workspace/kms/base' },
    { mark: 'cycle',  label: 'Rehearse', body: 'Cut cards, and meet them again before they go.', path: '/workspace/kms/recall' },
    { mark: 'target', label: 'Apply',    body: 'Use it on real work. That is what raises a skill.', path: '/workspace/kms/skills' },
  ];

  for (const step of steps) {
    const cell = el('button', 'v-loop__step');
    cell.type = 'button';
    cell.addEventListener('click', () => ctx.go(step.path));
    const mark = el('span', 'v-loop__icon');
    mark.innerHTML = icon(step.mark);
    cell.append(mark);
    cell.append(el('strong', null, step.label));
    cell.append(el('small', null, step.body));
    strip.append(cell);
  }
  return strip;
}

/* ==========================================================================
   LEARNING PATHS
   ========================================================================== */

export function renderKmsPaths(host, ctx) {
  const doc = docShell(
    host,
    'Learning Paths',
    'A path is a curriculum with an aim you could be tested on. It is the only screen here that plans; everything else executes.',
  );

  const bar = el('div', 'v-toolbar');
  const add = el('button', 'ws-btn ws-btn--solid', 'New path');
  add.type = 'button';
  bar.append(add);
  doc.append(bar);

  const list = el('div', 'v-grid');
  doc.append(list);

  const draw = () => {
    list.innerHTML = '';
    for (const item of K.paths()) {
      const progress = K.pathProgress(item);
      const card = el('button', 'v-path');
      card.type = 'button';
      card.addEventListener('click', () => ctx.go(`/workspace/kms/paths/${item.id}`));

      card.append(el('span', 'v-path__owner', item.owner));
      card.append(el('strong', 'v-path__title', item.title));
      card.append(el('span', 'v-path__aim', item.aim));
      card.append(meter(progress.percent));
      card.append(el('span', 'v-path__count', `${progress.done} of ${progress.total} steps`));
      list.append(card);
    }
  };

  add.addEventListener('click', () => {
    const form = pathForm((values) => {
      K.addPath(values);
      form.remove();
      draw();
    }, () => form.remove());
    bar.after(form);
    form.querySelector('input')?.focus();
  });

  draw();
}

function pathForm(onSave, onCancel) {
  const form = el('form', 'v-form');
  const title = field(form, 'Title', 'What the path is called');
  const aim = field(form, 'Aim', 'What you will be able to do when it is finished');
  const owner = field(form, 'Who it is for', 'A name, or Everyone');

  const foot = el('div', 'v-form__foot');
  const save = el('button', 'ws-btn ws-btn--solid', 'Create path');
  save.type = 'submit';
  const cancel = el('button', 'ws-btn', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', onCancel);
  foot.append(save, cancel);
  form.append(foot);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!title.value.trim()) return;
    onSave({ title: title.value.trim(), aim: aim.value.trim(), owner: owner.value.trim() || 'Everyone' });
  });
  return form;
}

function field(form, label, help) {
  const wrap = el('div', 'v-field');
  const id = 'f-' + Math.random().toString(36).slice(2, 7);
  const tag = el('label', 'v-field__label', label);
  tag.htmlFor = id;
  const input = el('input', 'v-input v-field__input');
  input.id = id;
  input.type = 'text';
  wrap.append(tag, input);
  if (help) wrap.append(el('p', 'v-field__help', help));
  form.append(wrap);
  return input;
}

export function renderKmsPath(host, id, ctx) {
  const item = K.path(id);
  if (!item) {
    docShell(host, 'Path not found', 'It may have been removed. The list of paths is still there.')
      .append(empty('Nothing here', 'Open Learning Paths from the index.'));
    return;
  }

  const doc = docShell(host, item.title, item.aim);

  const back = el('button', 'v-back', 'Learning Paths');
  back.type = 'button';
  back.addEventListener('click', () => ctx.go('/workspace/kms/paths'));
  doc.querySelector('.ws-doc__head').before(back);

  const holder = el('div');
  doc.append(holder);

  const draw = () => {
    holder.innerHTML = '';
    const fresh = K.path(id);
    const progress = K.pathProgress(fresh);

    holder.append(stats([
      ['Steps done', `${progress.done}/${progress.total}`],
      ['For', fresh.owner],
      ['Skill', fresh.skill ? (K.skills().find((s) => s.id === fresh.skill)?.name || fresh.skill) : '—'],
    ]));

    const steps = panel('Steps');

    /* Checkable in place. A path where marking a step done means opening
       another screen is a path people stop marking, and an unmarked path is
       indistinguishable from an abandoned one. */
    for (const step of fresh.steps) {
      const node = el('div', 'v-check-row');
      if (step.done) node.dataset.done = 'true';

      const box = el('input');
      box.type = 'checkbox';
      box.className = 'ws-check';
      box.checked = step.done;
      box.addEventListener('change', () => { K.toggleStep(id, step.id); draw(); });

      const main = el('div', 'v-row__main');
      main.append(el('strong', null, step.title));
      const strip = el('div', 'v-badges');
      strip.append(el('span', 'v-badge', STEP_LABEL[step.kind] || step.kind));
      main.append(strip);

      node.append(box, main);

      // A step that points at something opens it. Reading steps land in
      // Sources, writing steps land in the page itself.
      if (step.ref && step.kind === 'read') {
        const open = el('button', 'v-mini-btn', 'Open source');
        open.type = 'button';
        open.addEventListener('click', () => ctx.go('/workspace/kms/sources'));
        node.append(open);
      } else if (step.ref && (step.kind === 'note' || step.kind === 'build')) {
        const open = el('button', 'v-mini-btn', 'Open note');
        open.type = 'button';
        open.addEventListener('click', () => ctx.go(`/workspace/page/${step.ref}`));
        node.append(open);
      }

      steps.body.append(node);
    }

    const addStep = el('form', 'v-toolbar');
    const input = el('input', 'v-input');
    input.type = 'text';
    input.placeholder = 'Add a step';
    input.setAttribute('aria-label', 'Add a step to this path');
    const save = el('button', 'ws-btn', 'Add');
    save.type = 'submit';
    addStep.append(input, save);
    addStep.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = input.value.trim();
      if (!value) return;
      K.addStep(id, { title: value });
      draw();
    });
    steps.body.append(addStep);

    holder.append(steps);

    if (progress.done === progress.total && progress.total) {
      const finished = el('p', 'v-note');
      finished.dataset.tone = 'ok';
      finished.textContent = 'Every step is done. The path has told you what it can; the level in Skills now depends on whether the cards hold.';
      holder.append(finished);
    }
  };

  draw();
}

/* ==========================================================================
   SOURCES
   The reading queue. Four states, and the fourth one is the important one:
   parked. Without somewhere to put a source you are not going to read, a
   reading list becomes a guilt list and people stop opening it.
   ========================================================================== */

export function renderKmsSources(host, ctx) {
  const doc = docShell(
    host,
    'Sources',
    'Things to read, each with the question it was opened for. A source with no question is a source you will skim.',
  );

  const bar = el('div', 'v-toolbar');
  const add = el('button', 'ws-btn ws-btn--solid', 'Add a source');
  add.type = 'button';
  bar.append(add);
  doc.append(bar);

  const holder = el('div');
  doc.append(holder);

  const draw = () => {
    holder.innerHTML = '';
    const all = K.sources();

    holder.append(stats([
      ['Reading', all.filter((s) => s.state === 'reading').length],
      ['Not started', all.filter((s) => s.state === 'queued').length],
      ['Distilled', all.filter((s) => s.state === 'distilled').length],
      ['Parked', all.filter((s) => s.state === 'parked').length],
    ]));

    const groups = [
      ['reading', 'Reading now'],
      ['queued', 'Not started'],
      ['distilled', 'Distilled'],
      ['parked', 'Parked'],
    ];

    for (const [state, label] of groups) {
      const matches = all.filter((item) => item.state === state);
      if (!matches.length) continue;

      const box = panel(label);
      for (const item of matches) box.body.append(sourceRow(item, ctx, draw));
      holder.append(box);
    }

    if (!all.length) {
      holder.append(empty('No sources yet', 'Add the paper, book or talk you have been meaning to get to, and the question you want it to answer.'));
    }
  };

  add.addEventListener('click', () => {
    const form = sourceForm((values) => { K.addSource(values); form.remove(); draw(); }, () => form.remove());
    bar.after(form);
    form.querySelector('input')?.focus();
  });

  draw();
}

function sourceRow(item, ctx, redraw) {
  const node = el('div', 'v-row v-row--static');
  const main = el('div', 'v-row__main');
  main.append(el('strong', null, item.title));
  if (item.question) main.append(el('small', null, item.question));

  const strip = el('div', 'v-badges');
  strip.append(el('span', 'v-badge', KIND_LABEL[item.kind] || item.kind));
  if (item.author) strip.append(el('span', 'v-badge', item.author));
  main.append(strip);
  node.append(main);

  const actions = el('div', 'v-row__actions');

  if (item.state === 'queued') {
    actions.append(miniButton('Start reading', () => { K.setSourceState(item.id, 'reading'); redraw(); }));
    actions.append(miniButton('Park', () => { K.setSourceState(item.id, 'parked'); redraw(); }));
  } else if (item.state === 'reading') {
    /* The only forward action on something being read is to distil it. It
       creates the note, links it to the source and opens the editor in one
       press, because the gap between finishing a paper and opening a blank
       page is where the method is usually lost. */
    actions.append(miniButton('Distil into a note', async () => {
      const page = await ctx.newNote({
        space: 'kms',
        title: item.title,
        open: false,
        blocks: [
          { type: 'h2', text: 'The question' },
          { type: 'p', text: item.question || '' },
          { type: 'h2', text: 'The answer, from memory' },
          { type: 'p', text: '' },
          { type: 'h2', text: 'What this contradicts' },
          { type: 'p', text: '' },
        ],
      });
      if (page) K.attachNote(item.id, page.id);
      if (page) ctx.go(`/workspace/page/${page.id}`);
    }));
    actions.append(miniButton('Park', () => { K.setSourceState(item.id, 'parked'); redraw(); }));
  } else if (item.state === 'distilled') {
    if (item.pageId) actions.append(miniButton('Open the note', () => ctx.go(`/workspace/page/${item.pageId}`)));
  } else {
    actions.append(miniButton('Unpark', () => { K.setSourceState(item.id, 'queued'); redraw(); }));
  }

  node.append(actions);
  return node;
}

function miniButton(text, onClick) {
  const button = el('button', 'v-mini-btn', text);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

function sourceForm(onSave, onCancel) {
  const form = el('form', 'v-form');
  const title = field(form, 'Title', null);
  const author = field(form, 'Author', null);
  const question = field(form, 'The question you are opening it for', 'This is the field that decides whether you read it or skim it.');

  const kindWrap = el('div', 'v-field');
  kindWrap.append(el('label', 'v-field__label', 'Kind'));
  const kind = el('select', 'v-input v-field__input');
  for (const [value, label] of Object.entries(KIND_LABEL)) {
    const option = el('option', null, label);
    option.value = value;
    kind.append(option);
  }
  kindWrap.append(kind);
  form.append(kindWrap);

  const foot = el('div', 'v-form__foot');
  const save = el('button', 'ws-btn ws-btn--solid', 'Add to the queue');
  save.type = 'submit';
  const cancel = el('button', 'ws-btn', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', onCancel);
  foot.append(save, cancel);
  form.append(foot);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!title.value.trim()) return;
    onSave({
      title: title.value.trim(),
      author: author.value.trim(),
      question: question.value.trim(),
      kind: kind.value,
    });
  });
  return form;
}

/* ==========================================================================
   KNOWLEDGE BASE
   The same page store and the same editor as the other two workspaces, one
   branch of the tree. This screen is the list view of that branch, plus the
   one action that only makes sense here: cutting a card from a note.
   ========================================================================== */

export function renderKmsBase(host, ctx) {
  const doc = docShell(
    host,
    'Knowledge Base',
    'What you have written in your own words. Filed by what it is, not by what it was for.',
  );

  const bar = el('div', 'v-toolbar');
  const add = el('button', 'ws-btn ws-btn--solid', 'New note');
  add.type = 'button';
  add.addEventListener('click', () => ctx.newNote({ space: 'kms' }));
  bar.append(add);
  doc.append(bar);

  const pages = ctx.pages('kms');
  const notes = panel('Notes');

  if (!pages.length) {
    notes.body.append(empty(
      'Nothing distilled yet',
      'Start from a source you have finished reading. Sources has a button that opens the note with the right headings already in it.',
    ));
  } else {
    for (const page of pages) {
      const cardCount = K.cards().filter((card) => card.pageId === page.id).length;
      const node = row({
        title: page.title,
        sub: `${ctx.pathOf(page.id)} · ${ctx.when(page.updated)}`,
        badges: cardCount ? [`${cardCount} ${cardCount === 1 ? 'card' : 'cards'}`] : ['No cards yet'],
        onClick: () => ctx.go(`/workspace/page/${page.id}`),
      });
      notes.body.append(node);
    }
  }
  doc.append(notes);

  /* Cutting a card is the action that connects this screen to the next one.
     It is a form rather than a button because a card is a question and an
     answer, and asking for both here is what stops people writing cards
     that are really just headings. */
  const cut = panel('Cut a recall card');
  const form = el('form', 'v-form');
  const which = el('div', 'v-field');
  which.append(el('label', 'v-field__label', 'From which note'));
  const select = el('select', 'v-input v-field__input');
  for (const page of pages) {
    const option = el('option', null, page.title);
    option.value = page.id;
    select.append(option);
  }
  which.append(select);
  form.append(which);

  const front = field(form, 'The question', 'Write it so that answering it needs the idea, not the wording.');
  const back = field(form, 'The answer', 'One or two sentences. A card that needs a paragraph is two cards.');

  const foot = el('div', 'v-form__foot');
  const save = el('button', 'ws-btn ws-btn--solid', 'Add to the queue');
  save.type = 'submit';
  foot.append(save);
  form.append(foot);

  const said = el('p', 'v-note');
  said.hidden = true;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!front.value.trim() || !pages.length) return;
    K.addCard({ front: front.value.trim(), back: back.value.trim(), pageId: select.value });
    front.value = '';
    back.value = '';
    said.hidden = false;
    said.dataset.tone = 'ok';
    said.textContent = 'Added. It is due today, and the interval grows every time you get it right.';
  });

  cut.body.append(form, said);
  if (!pages.length) {
    cut.body.innerHTML = '';
    cut.body.append(empty('Write a note first', 'A card cut from nothing is a fact you will not be able to place when it comes back.'));
  }
  doc.append(cut);

  const where = el('p', 'v-note');
  where.dataset.tone = ctx.pagesOnServer() ? 'ok' : 'warn';
  where.textContent = ctx.pagesOnServer()
    ? 'Notes are saved to your account. Cards and paths are saved in this browser.'
    : 'Notes, cards and paths are all saved in this browser on this build. They will not follow you to another machine.';
  doc.append(where);
}

/* ==========================================================================
   RECALL & REVIEW
   One card at a time, full width, three buttons. Everything else on the
   screen is deliberately absent: a queue with a sidebar is a queue people
   read instead of answer.
   ========================================================================== */

export function renderKmsRecall(host, ctx) {
  const doc = docShell(
    host,
    'Recall & Review',
    'The cards you are closest to forgetting. Answer before you turn the card over; reading the answer first teaches nothing.',
  );

  const holder = el('div');
  doc.append(holder);

  let queue = K.dueCards();
  let index = 0;
  let revealed = false;

  const draw = () => {
    holder.innerHTML = '';

    if (!queue.length) {
      const counts = K.queueCounts();
      holder.append(stats([
        ['Reviewed today', K.reviewedToday()],
        ['Day streak', K.reviewStreak()],
        ['Due in a week', counts.soon],
        ['Held', `${counts.held}/${counts.total}`],
      ]));
      holder.append(empty(
        'Nothing due',
        'The queue is empty until something is close to being forgotten again. Coming back to an empty queue is the system working, not a wasted trip.',
      ));
      const next = el('button', 'ws-btn', 'Back to the overview');
      next.type = 'button';
      next.addEventListener('click', () => ctx.go('/workspace/kms'));
      holder.append(next);
      return;
    }

    if (index >= queue.length) {
      holder.append(el('p', 'v-next__kicker', 'Done'));
      holder.append(el('h2', 'v-next__title', `${queue.length} ${queue.length === 1 ? 'card' : 'cards'} reviewed`));
      holder.append(el('p', 'v-next__body', 'Anything you marked "again" is back in today’s queue. Everything else has moved out to its next interval.'));

      const again = el('button', 'ws-btn ws-btn--solid', 'Check for more');
      again.type = 'button';
      again.addEventListener('click', () => { queue = K.dueCards(); index = 0; revealed = false; draw(); });
      holder.append(again);
      return;
    }

    const card = queue[index];

    const progress = el('div', 'v-review__progress');
    progress.append(el('span', null, `${index + 1} of ${queue.length}`));
    progress.append(meter(((index) / queue.length) * 100));
    holder.append(progress);

    const face = el('section', 'v-review');
    face.append(el('p', 'v-review__due', dueLabel(card)));
    face.append(el('h2', 'v-review__front', card.front));

    if (revealed) {
      face.append(el('p', 'v-review__back', card.back || 'No answer was written on this card.'));

      const verdicts = el('div', 'v-review__actions');
      const gradeIt = (verdict) => {
        K.grade(card.id, verdict);
        index += 1;
        revealed = false;
        draw();
      };
      /* Three, in the order of how the last minute went. "Again" first
         because it is the honest answer most often, and putting it last
         behind two easier ones is how review systems quietly inflate. */
      verdicts.append(gradeButton('Again', 'Did not have it', () => gradeIt('again')));
      verdicts.append(gradeButton('Hard', 'Got there slowly', () => gradeIt('hard')));
      verdicts.append(gradeButton('Good', 'Straight away', () => gradeIt('good'), true));
      face.append(verdicts);

      if (card.pageId) {
        const source = el('button', 'v-mini-btn', 'Open the note this came from');
        source.type = 'button';
        source.addEventListener('click', () => ctx.go(`/workspace/page/${card.pageId}`));
        face.append(source);
      }
    } else {
      const show = el('button', 'ws-btn ws-btn--solid', 'Show the answer');
      show.type = 'button';
      show.addEventListener('click', () => { revealed = true; draw(); });
      face.append(show);
    }

    holder.append(face);
  };

  /* Space reveals, then 1-2-3 grade. The whole point of a review queue is
     that it can be run without the hand leaving the keyboard; a queue that
     needs the mouse for every card takes twice as long and gets skipped. */
  const keys = (event) => {
    if (!queue.length || index >= queue.length) return;
    if (event.target.closest('input, textarea, [contenteditable]')) return;
    if (event.key === ' ' && !revealed) { event.preventDefault(); revealed = true; draw(); return; }
    if (!revealed) return;
    const map = { 1: 'again', 2: 'hard', 3: 'good' };
    const verdict = map[event.key];
    if (!verdict) return;
    event.preventDefault();
    K.grade(queue[index].id, verdict);
    index += 1;
    revealed = false;
    draw();
  };
  addEventListener('keydown', keys);
  // The shell empties #ws-view on every navigation, so the listener is
  // removed when this subtree leaves the document rather than being left to
  // grade cards on a screen that is no longer open.
  new MutationObserver((records, self) => {
    if (!host.isConnected || !doc.isConnected) { removeEventListener('keydown', keys); self.disconnect(); }
  }).observe(host, { childList: true });

  draw();
}

function gradeButton(label, hint, onClick, solid) {
  const button = el('button', 'v-verdict' + (solid ? ' v-verdict--good' : ''));
  button.type = 'button';
  button.append(el('strong', null, label));
  button.append(el('small', null, hint));
  button.addEventListener('click', onClick);
  return button;
}

/* ==========================================================================
   SKILLS
   The only screen in the workspace that makes a claim about a person, so it
   is the one that has to show its working. Every level is followed by the
   two counts it was computed from.
   ========================================================================== */

export function renderKmsSkills(host, ctx) {
  const doc = docShell(
    host,
    'Skills',
    'What the reading and the rehearsing add up to. Levels are computed from cards held and path steps finished, never typed in.',
  );

  const list = el('div', 'v-grid');

  for (const skill of K.skills()) {
    const measured = K.skillLevel(skill.id);
    const card = el('article', 'v-skill');

    card.append(el('span', 'v-skill__level', K.LEVEL_NAME[measured.level]));
    card.append(el('strong', 'v-skill__name', skill.name));
    card.append(el('p', 'v-skill__note', skill.note));

    card.append(meter((measured.level / 4) * 100, measured.level >= skill.target ? 'ok' : null));

    const facts = el('div', 'v-skill__facts');
    facts.append(skillFact('Held', `${measured.held} of ${measured.cards}`));
    facts.append(skillFact('Applied', `${measured.applied} of ${measured.steps}`));
    facts.append(skillFact('Target', K.LEVEL_NAME[skill.target]));
    card.append(facts);

    /* The gap, stated as the next action rather than as a deficit. Which of
       the two halves is lower decides both the sentence and the button, and
       that is the whole value of splitting the level in two: "get better at
       this" is not an instruction, "rehearse these four cards" is.

       Comparing the two halves rather than testing a card count against a
       fixed number matters. A skill with one card, held, and two path steps
       finished is not short on rehearsal, and telling its owner to rehearse
       more sends them to an empty queue. */
    const advice = el('p', 'v-skill__advice');
    const rehearsalIsShort = measured.retained <= measured.practised;

    if (measured.level >= skill.target) {
      advice.textContent = 'At target. Keeping it there costs only the review queue.';
    } else if (measured.retained < measured.practised) {
      advice.textContent = 'It has been used more than it has been retained. The next level needs the cards to hold.';
    } else if (measured.practised < measured.retained) {
      advice.textContent = 'It holds, but it has not been used on enough real work. Finish a path step that applies it.';
    } else {
      advice.textContent = 'Both halves are level. Either more cards holding or another path step finished will move it.';
    }
    card.append(advice);

    const open = el('button', 'v-mini-btn', rehearsalIsShort ? 'Go to the review queue' : 'Open the path');
    open.type = 'button';
    open.addEventListener('click', () => {
      if (rehearsalIsShort) return ctx.go('/workspace/kms/recall');
      const owning = K.paths().find((item) => item.skill === skill.id);
      ctx.go(owning ? `/workspace/kms/paths/${owning.id}` : '/workspace/kms/paths');
    });
    card.append(open);

    list.append(card);
  }

  doc.append(list);

  const how = el('p', 'v-note');
  how.textContent = 'A level is the lower of two things: how much of the knowledge is held in long-term review, and how many path steps have actually applied it. Either one alone is easy to fake, which is why neither one alone counts.';
  doc.append(how);
}

function skillFact(label, value) {
  const cell = el('div', 'v-skill__fact');
  cell.append(el('span', null, label));
  cell.append(el('b', null, value));
  return cell;
}
