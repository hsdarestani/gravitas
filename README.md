# Gravitas+ — site architecture

Open `index.html`. Static files, no build step, no dependencies. A GitHub Pages
workflow is included in `.github/workflows/deploy.yml`.

```
index.html                        Home
dossiers.html                     Dossier index (filter + search)
dossier-computable-universe.html  A full worked dossier — all seven layers
dossier-machine-hypothesis.html   Dossier 03 — the roadmap's starting topic
account.html                      Sign in / create an account
magazine.html                     Article archive
article-hypothesis-or-sentence.html  A full article — the Magazine template
lab.html                          Interactive lab
game-hypothesis-machine.html      A game you can actually play
learn.html                        The four learning paths
path-ai-in-research.html          One path, expanded
community.html                    Roles, weekly experiment, events
newsletter.html                   Subscribe + archive
about.html                        What this is, and the editorial rules
assets/                           gravitas.css · site.css · hero.css · site.js · hero.js
```

---

## The two decisions that shaped everything

### 1. The dossier is the unit, not the video

The roadmap says a video is the *beginning* of a path. So the site is not
organised around episodes — it is organised around **questions**. A dossier is
one question with every layer wrapped around it:

| Layer | What it does |
|---|---|
| 01 Film | the way in |
| 02 Essay | the argument, at two depths |
| 03 Sources | three levels — start here / go further / primary |
| 04 Timeline | how the question developed |
| 05 Simulation | something to break |
| 06 Viewpoints | the strongest case *against* our own reading, plus a poll |
| 07 Discussion | comments, this week's question, a public correction log |

`dossier-computable-universe.html` is built out in full so the pattern is
concrete rather than described.

### 2. One page, two audiences — not two sites

The brief asks for a clear entry for the general reader *and* real depth for
researchers. The obvious answer — a separate "for researchers" section — is the
wrong one: it splits the audience at the door, halves the value of every piece,
and makes people classify themselves before they know what is inside.

Instead there is a **depth switch** in the header. It re-renders the page in
place: the essay has an overview version and an in-depth version carrying the
mathematics, the code and the primary citations. The choice persists across
pages, and neither version is a teaser — both are the whole argument.

---

## Navigation

Five items: **Dossiers · Magazine · Lab · Learn · Community**

The roadmap lists six spaces, but Newsletter is an *action*, not a place, so it
is a persistent CTA in the header and footer rather than a nav slot. There is
deliberately no "Watch" item either: here a video opens a dossier, it is not a
destination of its own.

## What actually works

Not mockups:

- **Depth switch** — swaps the essay, persists across pages
- **Filtering** — type chips plus free-text search, live count, empty state
- **Hypothesis Machine** — the 2-4-6 task with a physics skin. It counts how many
  of your tests were *confirming* versus *falsifying*, and tells you the ratio at
  the end. Most players find they spent their effort trying to be right rather
  than trying to be wrong, which is the whole lesson.
- **Lorenz simulation** — two identical systems started a hair apart. Set the
  initial precision and watch the prediction horizon collapse; divergence time is
  reported live.
- **Hero** — two-body orbit, pucker grid with click-ripple, comet cursor
- **Generative card art** — lab cards draw themselves instead of shipping photos

Polls, comments and sign-up forms are front-end only, and say so on screen rather
than pretending to be live.

## Verified

- No console errors on any page
- No broken internal links
- Exactly one `h1` per page
- No horizontal overflow at 360 / 390 / 768 / 1024 / 1440 / 1920px
- Mobile menu opens and closes on selection on every page
- Reduced motion honoured throughout

## Notes

- `gravitas.css` is the brand design system, unchanged. Everything new is in `site.css`.
- Copy is placeholder-grade in places — the architecture is the deliverable.
- To go live you need a backend for: newsletter, accounts, comments, polls.


---

## Changes in this pass

**The depth switch is now contextual.** It was rendering on all eleven pages but
only doing something on one. A persistent control that is inert nine times out of
eleven teaches people to ignore it, and then it is invisible on the pages where
it matters. It now appears only on the dossier and the magazine — the two places
that respond to it.

**The magazine gained a second axis.** Depth now works there as reading level
alongside the topic filters: technical pieces recede in Overview and come forward
In depth. They are dimmed rather than hidden, because a list whose count silently
drops looks broken.

**A real article page.** `article-hypothesis-or-sentence.html` is the lead essay
built out — two depths, its own graded sources, and a hand-off to the dossier,
the game and the open question. It doubles as the Magazine template.

**Nothing is a dead click any more.** Cards for content that does not exist yet
keep their place, but lose their `href`, gain a **Planned** chip, and cannot be
clicked or focused. Six cited papers were wired to real DOIs and arXiv entries
(Turing 1936, Feynman 1982, Lorenz 1963, Deutsch 1985, Lloyd 2002, Landauer
1961) — a citation that goes nowhere looks like scholarship and isn't.

**A real bug, found and fixed.** The mobile menu never opened on the home page.
`site.js` and `hero.js` both bound the hamburger; both fired on the same tap, the
second read the state the first had just set, and it toggled straight back shut —
so it failed on exactly the one page that loads `hero.js`. The duplicate is gone.

## Verified

| | |
|---|---|
| Pages | 12 |
| Broken links | 0 |
| Unreachable pages | 0 |
| Clickable dead links | 0 |
| Horizontal overflow | none at 360 / 390 / 768 / 1024 / 1440 / 1920px |
| Console errors | none on any page |
| Accessibility | one `h1` per page, skip link, `lang`, no unlabelled buttons, no missing `alt` |
| Mobile menu | opens, closes on selection, navigates |
| Depth switch | +597px of content on the dossier, persists across pages |
| Dossier simulation | animating and responds to its control |

The only remaining `href="#"` are the five social icons — outbound profiles for
you to fill in, not missing pages.

## Second pass

**Dossier 03 is now built out.** The roadmap names AI and ML in scientific
research as the starting point, but the site was leading with *Is the universe
computable?* — a strategic mismatch. `dossier-machine-hypothesis.html` carries
all seven layers and the roadmap's harder questions rather than a
tools-and-prompts tour.

Its simulation earns its place: a hidden relationship, noisy measurements, and a
model whose flexibility you control. Raise it and the fit keeps improving while
the prediction gets worse — the essay's argument made touchable rather than
asserted. Measured across the range, fit-error falls monotonically while
prediction-error turns around and climbs.

**The link wiring now lives in the build.** Last pass I repaired the dead links
by editing the output, so the next rebuild wiped every one of them. Source
wiring, the contact address, the community actions and the defusing of unbuilt
cards are all part of `defuse.py` now, and the build is idempotent — running it
twice gives the same clean result.

## Known gaps

Content, not structure: two dossiers of four, one article, one path of four, one
game of six. The generators mean the next dossier is data entry rather than a
rebuild.


---

## Third pass

**Hero** now reads *Science, and the gravity of questions underneath it*, with
**gravity** carrying the emphasis.

**Grids no longer orphan a card.** `auto-fit` packs as many as will fit and
strands the remainder on a row of its own — that is where the 5+1 and 4+1 came
from. Each grid now declares a column count that divides its item count: six
spaces as 3+3, six roles as 3+3, five programmes as 3+2. Verified at six widths;
every row fills its full width, and the headings no longer count the items
("One path through the site", "What we make", "Roles").

**Join was rebuilt.** It was a form dropped on a flat band. It now uses the
hero's own treatment — the spacetime well and starfield behind it, real vertical
room, and the six roles shown as things you become rather than a sentence
describing them.

**Sign in / create an account** (`account.html`). One page, two panels, switched
rather than navigated, deep-linkable via `#in` and `#up`, with role selection at
sign-up. A **Sign in** action sits in the header on all fourteen pages.

**The host is only on About.** Name and photo removed from the hero, the footer,
the dossier byline and the sample comment, ready for other contributors.

**Design-system corrections.** Dossier 03's poll was a bespoke component; it now
uses the same result-bar poll as the other dossiers. The lab's number entry
suppressed the browser spin buttons — small grey chrome that was the ugliest
thing on the page — and reads as a value you are about to test. Both dossier
simulations were pinned to the top of their panel and are now vertically centred
(20px above and below).

**Removed:** the Overview / In depth control from the Magazine; "English first"
from the footer and About.


---

## Fourth pass

**The depth switch moved out of the header** into a labelled bar at the top of
the section it governs. In the header it was permanent chrome competing with
navigation on all fourteen pages; in place it reads as a property of the content
and can say what it does.

**Switching depth no longer disturbs the layout.** The rule was
`[data-level="deep"] { display: block }`, which stamped on whatever the element's
own layout was — a flex source row became a block, its level badge lost
`flex: none` and stretched, and the text beside it shifted. `revert` had the same
fault in reverse (an `li` came back as `list-item`, not the author's `flex`). The
rule now only ever *hides* the other side, so every visible element keeps exactly
the display its own CSS gives it. Measured across a switch: badge width and link
position identical, `display: flex` in both states. It also means the content is
all visible with no JavaScript at all.

**Dossier 04's simulation fills its panel.** The attractor was drawn from a fixed
baseline at 62% of the height and extends upward from there, so the bottom of the
box was empty — the panel was centred but the figure inside it was not. It now
measures the trajectory's own bounds and derives scale and offset from them:
16px of padding on all four sides, at any size.

**About has a team section** with the photo, built as a list rather than a
one-off block, with an open slot for the contributors to come.

**Also:** TikTok added to the footer on all fourteen pages; the sign-in row's
checkbox and "Forgotten password" now share a baseline; the role cards at sign-up
are all the same height.


---

## Fifth pass

**The Lorenz simulation sits still.** Fitting the view to the live trail meant
scale and offset were recomputed every frame as the trail grew, so the whole
figure breathed — that was the tweaking. It now frames the attractor's known
extent once, on resize only, so the view is constant: 42px above, 40px below,
zero drift between samples. (Hoisting caught me out on the way: `var VIEW` was
declared after its first use, so the script threw and nothing drew at all.)

**Dossier 03 was never actually designed.** I had invented `dsr-head`,
`dsr-rail` and `tl` class names that exist nowhere in the stylesheet, so the
page fell back to unstyled defaults — content against the top edge, and a
section rail with no spacing between its links. It is now built from the same
components as Dossier 04 (`head_block`, `.layer`, `.dossier-nav`, `.split`,
`.video`), and the timeline is a dated list rather than a decorated one.

**Also:** footer icons reordered — YouTube, Instagram, TikTok, X, LinkedIn,
Telegram. About's introduction cut to about a third, team cards enlarged with
LinkedIn and Google Scholar links. The host's comment restored in Dossier 04.
Sign-in row separated from the submit button. The community's "How it works"
card now sits level with the poll (0px difference). The join block reduced to one
dominant line and one quiet answer. The magazine drop cap set to a true two-line
cap, so nothing is left hanging under it.

---

## Private workspace demo content

For an existing account, seed the private demo idempotently with
`cd backend && DJANGO_SETTINGS_MODULE=gravitas_backend.settings python -m django seed_workspace_demo --user researcher@example.com`.
Remove only seeded content with the same command plus `--remove`. The command is
never run automatically and does not create or expose credentials.

---

## The workspace

`workspace.html` plus `assets/ws/`. Same rules as the rest of the repository:
static files, no build step, no dependencies.

The structure is the platform's, unchanged. **Home**, then two workspaces:

| | Sections |
|---|---|
| **Core** (internal team) | Overview · Tasks & Execution · Content Pipeline · Planning & Projects · Team & Access |
| **Research** | Overview · Projects · Files & Data Rooms · Pages · Collaboration |

Core is gated on `access.core` from `/api/platform/bootstrap/`, and Team &
Access on the owner or admin role. Both checks are the server's; hiding the
entries only avoids offering a door that will not open. Every route the
previous workspace published still resolves to the same screen.

```
workspace.html             the shell
assets/ws/ws.css           every workspace style, on gravitas.css tokens
assets/ws/ws-app.js        router, panes, index tree, editor, dock
assets/ws/ws-nav.js        the two workspaces and their sections
assets/ws/ws-platform.js   the platform API: bootstrap, dashboards, projects
assets/ws/ws-views.js      the screens that render backend data
assets/ws/ws-api.js        the page store, with a local fallback
assets/ws/ws-palette.js    command palette
assets/ws/ws-ai.js         assistant panel
assets/ws/ws-seed.js       the pages a cold workspace opens with
```

### What changed, and what did not

Only the presentation. The old shell put a flat list of links in a sidebar and
rebuilt the page underneath it; this one puts the sections in an index tree
beside a document pane, with a command palette over the top. The workspaces,
the sections, the routes, the access rules and the backend calls are the same.

The theme control is the site's own: same `.theme-toggle` class and the same
moon and sun marks as the public header. The wordmark is the site's `.g-logo`
SVG, filled `currentColor`. Icons are the twenty-nine marks in
`assets/gravitas-icons.js`, drawn to the brand book's geometry.

### Two data layers, and why

`ws-platform.js` talks to the platform. Those routes are registered and answer
today, so there is no fallback and there should not be: a Core dashboard
invented in the browser would be a fabricated report on a real team's work. A
failed call renders what failed and a retry.

`ws-api.js` handles pages, and does have a fallback. `backend/core/space_api.py`
implements the space views, but `backend/core/urls.py` never registers a path
for them, so every `/api/platform/space/…` request answers 404. The old
frontend called them anyway and showed a permanent spinner. This one detects
it, says so in the status bar, and keeps working against a real `localStorage`
store. Wiring those routes is the whole fix; `adopt()` lifts existing local
pages to the account once they are live.

There is deliberately no local task store. Tasks are Core objects the server
owns, and a browser-local task list would render identically to the real one
and disagree with it the moment two people looked at the same board.

### The dashboard

Home and the Overview of each workspace are the same screen with different
sources: greeting, live clock, weather, a focus line, what is due, what is
next, and what is running. `assets/ws/ws-home.js`.

The focus line is arithmetic over real due dates, not prose from a model, and
the card says so under it. An assistant button is beside it for the cases
where a real answer is wanted. Projects show status and deadline rather than a
progress bar, because the project payload carries no percentage and a bar
drawn from a status enum would be a number the system does not have.

Weather is the one request the workspace makes outside Gravitas. It goes to
Open-Meteo, which needs no key, and sends the coordinates of a chosen city and
nothing else: no account, no page, no browser location prompt. It defaults to
Potsdam, the address in the legal notice, and Settings can change the city or
switch it off. It fails silently and stays hidden.

### Settings

Reached from the account button at the foot of the rail, under the Assistant.
Profile picture, profile fields, password, and the preferences that live in
this browser.

The picture is cropped square and resized to 256px in the browser before it is
sent. That keeps it under the column cap, drops the EXIF block a phone photo
carries (which includes where it was taken), and produces the one shape every
place that shows it wants.

Two endpoints were added for this:

| Endpoint | What it does |
|---|---|
| `PATCH /api/platform/researchers/me/` | now also accepts `avatar`, validated for type, encoding and size |
| `POST /api/auth/password-change/` | changes the password of a signed-in user |

The password endpoint requires the current password, which the reset-by-email
flow cannot, because there the person is by definition locked out. It keeps the
current session alive and invalidates every other one.

The avatar is a `TextField` holding a data URI rather than a `FileField`. This
deployment configures no `MEDIA_ROOT` and serves no media URL, and Pillow is
not installed, so an `ImageField` would add three pieces of deployment surface
for one small image. **Migration `0012_researcher_avatar` must be applied.**

### What was removed

The previous workspace loaded 24 stylesheets and about 20 scripts, in layers
named `platform-v2`, `platform-v3`, and then four more whose names began with
`fix`. Behaviour was defined in one file and redefined in a later one, so
reading it meant knowing the order the script tags happened to be in. Those 46
files are gone. Nothing outside the workspace referenced any of them.
