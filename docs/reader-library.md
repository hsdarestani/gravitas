# The reader's library — browse first, sign up at the till

An online shop lets you fill a basket before it asks who you are, and only
makes you register at checkout. The public Gravitas+ archive works the same way
on purpose. A visitor can:

- **save** any topic, dossier, essay, learning path or interactive,
- **follow** a topic,
- **tick off** the steps of a learning path,

with no account at all. The account is what turns that pile into something that
survives the browser, moves between devices and appears in the Knowledge
workspace. Asking for an email address before the visitor has decided the site
is worth anything is the fastest way to lose them.

## The three surfaces

| Where | File | What it is |
|---|---|---|
| Public site | `assets/production-bridge.js` (reader-library block) + `assets/production-overrides.css` | the save controls, the header drawer, the guest store, the handover |
| API | `backend/core/reader_library.py`, `ReaderSavedItem` in `backend/core/models.py` | `/api/reader/library/` — GET the library, POST a merge, DELETE one entry |
| Workspace | `assets/ws/ws-library.js`, `Library` in `KMS_SECTIONS` | `/workspace/kms/library`, the signed-in view |

Nothing here is markup, and that is a choice rather than a constraint. A save
control belongs on every card of every index plus the headline of every item
page; written by hand that is the same markup copied into a dozen files, each
needing to stay in step with the store, the signed-in state and the header
count. So the controls are injected from selectors the design already uses —
`.entry`, `.path-card`, `.game-card`, `.step` — and if one of those is renamed
the control disappears, which is the right failure mode. The selector list
above `libMountCards` is the single place to update when a card shape changes.

The styles sit in `production-overrides.css` rather than `gravitas.css` for a
related reason: every selector belongs to a node this deployment injects, and
the brand system should not carry rules for elements it does not know exist.

## What is savable

Recognised by page-slug prefix, which is also the kind:

| Prefix | Kind |
|---|---|
| `topic-` | topic |
| `dossier-` | dossier |
| `article-` | article |
| `path-` | learning path |
| `game-` | lab / interactive |

Anything else gets no control. This matters on the home page, which uses
`.entry` for cards pointing at section indexes — Magazine, Lab, Learn — and a
"save" on one of those would mean saving a list.

## Storage, and the two keys

`localStorage` holds one object under one of two keys, and the distinction is
load-bearing:

- **`gravitas.reader.v1`** — the *guest's pile*. Rows that exist nowhere else
  and have not reached an account yet. Its presence is a claim that something
  is at risk, which is what `ws-library.js` reports on the Library screen.
- **`gravitas.reader.mirror.v1`** — a signed-in reader's *cache* of what the
  server already holds, kept only so the header count and every save button
  paint on the first frame instead of a round trip later.

Adoption removes the guest key. An `/api/auth/me/` answer of
`authenticated: false` removes the mirror — otherwise a shared machine would
show the previous account's saved titles to whoever browses next, and their
first save would fold those into a fresh guest pile that the next sign-in would
hand to the wrong account. A *failed* `auth/me` deliberately leaves both alone:
it cannot tell a signed-out reader from a dropped connection.

## The handover

One POST of the whole pile, at the first authenticated moment — signing up,
signing in, or loading any public page with an existing session. The endpoint
merges idempotently, so it does not matter how many times that runs, in how
many tabs, or whether a previous attempt died halfway. When a guest pile did
move across, sign-up and sign-in land on `/workspace/kms/library` instead of
the workspace root: a reader who signed up *because* they had a pile should
arrive at the pile.

## Two decisions worth knowing about

**Rows carry a snapshot, not a foreign key.** Most of what is savable is
hand-authored HTML with no `ContentItem` row behind it, so the client sends the
title, URL and a small `meta` bag as it rendered them. A row is therefore what
the reader saw when they saved it: a retitled article keeps its old title in
the library until they save it again. That is the honest reading of "saved",
and the only one that works for a page with no database record.

**Path progress lives in `LabProgress`, not in `ReaderSavedItem`.** Progress is
not an item, it is a set of ticked steps against one. `LabProgress` is already
a per-user keyed JSON blob with the write validation this needs, so a path
stores `state = {done: [...], total: n}` under its own page slug. The
`path-` prefix on the key is what separates curricula from the interactive labs
that share the table.

The server **unions** ticked steps by default, so a guest who ticked steps 1–2
on a laptop and 3 on a phone cannot have one device silently undo the other.
The public page sends `replace: true`, because a reader unticking a step is an
explicit correction and has to win.

## Where Library sits in the Knowledge index

Directly above **Sources**, at the mouth of the learning loop
(Sources → Knowledge Base → Recall → Skills). Something kept from the public
site is the step before all of them: material that has caught somebody's
attention but has not been read, distilled or scheduled. Its one forward action
is *Add to Sources*, which is what makes it more than a bookmarks list — a
bookmark that never becomes anything is a bookmark.

## Tests

`backend/core/test_reader_library.py`, run by `python -m django test core` in
the deploy workflow. The cases that matter are not "can a signed-in user save
an article" but: adopting the same pile twice, two devices disagreeing about
path progress, one reader's library being invisible to another, and a played
lab not being reported as a learning path.
