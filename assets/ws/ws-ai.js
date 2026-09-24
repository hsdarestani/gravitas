/* ==========================================================================
   GRAVITAS+ WORKSPACE  ·  PULSAR
   The workspace assistant. It answers questions about the pages in this
   workspace and cites which ones it read.

   It is named rather than labelled "Assistant" because it is one thing with
   one behaviour, not a generic slot. The name is the plus in Gravitas+, so
   the panel reads as Gravitas answering rather than as a third party bolted
   on.

   Where it lives. It used to be a tab in the dock, opened from the foot of
   the left rail, which put it bottom-left in the workspace and bottom-right
   on every other page of the site, with a different panel and different
   manners in each. Now it is the site's own floating widget, assets/chat.js:
   same launcher, same corner, hover to open, minimize rather than close, one
   tab per conversation. This module only supplies what is different about
   the workspace: where answers come from, how their sources are opened, and
   the "Save as task" action.

   The rule the answers are built around: they never come without sources.
   This is a research tool for a project whose public method is a permanent,
   linked correction log, and an assistant that produces a fluent paragraph
   nobody can check would contradict the editorial standard the rest of the
   site is built on. So every answer carries the pages it came from, and
   when no language model is configured api.ask() says that in those words
   and falls back to search rather than to invention.
   ========================================================================== */

import * as api from './ws-api.js?v=20260913-2';
import * as P from './ws-platform.js';

let context = null;

/* chat.js is a deferred classic script and this is a module, so either can
   run first. The widget announces itself; until it has, calls wait. */
function withChat(fn) {
  if (window.GravitasChat) { fn(window.GravitasChat); return; }
  document.addEventListener('gravitas-chat:ready', () => fn(window.GravitasChat), { once: true });
}

/* start() runs again on every reload, so this can be called more than once.
   Only the first call configures the widget: configuring reloads its
   conversations from storage, which would orphan a reply still on its way. */
export function installAssistant(ctx) {
  const first = !context;
  context = ctx;
  if (!first) return;
  withChat((chat) => chat.configure({
    title: 'Ask Pulsar',
    greeting: 'Ask across your pages. Answers cite the pages they came from, so you can check them. Try asking what is still open on a dossier.',
    openers: ['What is still open on my dossiers?', 'What should I do first today?'],
    placeholder: 'Ask Pulsar about these pages',
    foot: 'Answers cite their pages. Check anything that matters.',
    // Its own key: a conversation about a private dossier should not appear
    // as a tab on the public magazine.
    storageKey: 'gchat.workspace.tabs.v1',
    navigate: (href) => context.go(href),
    ask,
  }));
}

export function focusAssistant() {
  withChat((chat) => chat.open());
}

/* Opens a fresh conversation on the question. Used by the focus card and the
   Content Studio, so the reader gets an answer rather than an empty panel. */
export function askAssistant(question) {
  withChat((chat) => chat.ask(question));
}

async function ask(question) {
  let reply;
  try {
    reply = await api.ask(question);
  } catch {
    return {
      reply: 'That request did not go through. Pulsar may be down; nothing was changed in your pages.',
      links: [],
    };
  }

  const sources = reply.sources || [];
  return {
    reply: reply.answer,
    links: sources.map((source) => ({ label: source.title, href: `/workspace/page/${source.id}` })),
    // Only offered when there is something concrete to turn into a task, so
    // the button is never a dead end.
    actions: sources.length ? [saveAsTask(question)] : [],
  };
}

function saveAsTask(question) {
  return {
    label: 'Save as task',
    // Returns the label the button should now carry; the widget keeps it.
    run: async () => {
      // Tasks are Core objects the server owns. There is no local task store
      // on purpose, so this either reaches the server or says it did not.
      if (!P.canOpenCore()) return { label: 'Tasks need Core', disabled: true };
      try {
        await P.call('/operating/tasks/', { method: 'POST', body: { title: question } });
        return { label: 'Saved', disabled: true };
      } catch {
        return { label: 'Not saved, try again', disabled: false };
      }
    },
  };
}
