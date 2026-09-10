# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

The Gravitas+ site (`gravitasplus.com`): a static public frontend, a signed-in
workspace built as ES modules, and a Django backend under `backend/`. Deployed
by SSH/rsync to a Strato VPS via `.github/workflows/deploy.yml` on every push to
`main`, which also bootstraps nginx, PostgreSQL, certbot and the systemd units.

**There is no build step and no package manager.** No `package.json`, no
bundler, no CSS preprocessor. HTML files load `assets/*.css` and `assets/*.js`
directly; the workspace loads `assets/ws/*.js` as native ES modules. Never
introduce a dependency, a transpile step or a framework — a file must run in the
browser exactly as it sits on disk.

## Commands

Backend tests (Django's own runner, SQLite via `test_settings`):

```powershell
cd backend
$env:DJANGO_SETTINGS_MODULE = 'gravitas_backend.test_settings'
python -m django test core                       # everything
python -m django test core.test_space_v1         # one module
python -m django test core.test_space_v1.SpaceFilesystemTests.test_nested_categories_keep_parent_paths
python -m django makemigrations core --check --dry-run
python -m django check
```

Frontend syntax gate (what CI runs — plain `node --check` misparses these as
CommonJS):

```bash
for m in assets/ws/*.js; do node --input-type=module --check < "$m"; done
node --check assets/site.js assets/hero.js assets/production-bridge.js
```

Local preview, serving this working tree with the production nginx routing and
proxying `/api/`, `/admin/`, `/content/` to a real backend:

```bash
node scripts/preview-server.mjs                          # proxies to production
node scripts/preview-server.mjs --api http://127.0.0.1:8000
node scripts/preview-server.mjs --api off                # static only
```

Frontend/backend contract check (textual, no DB, no network) — fails on a UI
call to an unregistered route:

```bash
node scripts/check-api-coverage.mjs            # --strict also fails on orphan routes
```

`scripts/audit-live-content.js` is not a CLI script. Paste it into the browser
console on `/workspace.html` while signed in to see which routes actually hold
rows.

Seed or remove the private workspace demo for an existing account:

```bash
cd backend && DJANGO_SETTINGS_MODULE=gravitas_backend.settings \
  python -m django seed_workspace_demo --user researcher@example.com [--remove]
```

## Backend architecture

Single Django app, `backend/core/`, no DRF — views are plain functions returning
`JsonResponse`, registered in two URLconfs:

- `backend/gravitas_backend/urls.py` registers OIDC, AI, `space/*` and a few
  canonical wrappers **before** `path('api/', include('core.urls'))`, so those
  deliberately shadow same-named legacy routes in `core/urls.py`. Reading only
  one of the two files gives a wrong picture of what is live.
- `core/urls.py` calls `install_runtime()` from `platform_runtime_v3` at import
  time, before the V2 modules import their workspace helper. Order matters here.

The domain is layered rather than flat, and the layer names carry meaning:

| Layer | Modules | Purpose |
|---|---|---|
| Content | `models.py`, `content_api.py` | public site: articles, comments, newsletter |
| Platform | `platform_models.py`, `platform_api.py`, `platform_runtime_v3.py` | organizations, workspaces, researchers, projects |
| Operating | `operating_models.py`, `operating_api*.py`, `roadmap_*.py` | Objective → Key Result → Initiative → Task, documented in `docs/operating-workspace.md` |
| Space | `space_*.py` | the page/file tree |
| Nextcloud | `nextcloud_*.py`, `oidc_provider.py`, `cloud.py` | external storage plus the OIDC provider Nextcloud signs in against |

`platform_access.py` is the single authorization surface: `ROLE_RANK`,
`TARGET_MODELS` and `can_view`. Access decisions belong there, not in views.

Two workspace purposes exist server-side: **Core** (explicit internal
membership) and **Research** (per-project/object ACL). The frontend hides
entries the reader cannot open, but the check is always the server's.

## Frontend architecture

Public pages are standalone HTML sharing `assets/gravitas.css` (the brand design
system, treated as unchanged) plus `site.css`/`hero.css`. `README.md` documents
the editorial decisions behind them — the dossier as the unit, the depth switch,
the seven layers — and is worth reading before restructuring a page.

The workspace is `workspace.html` plus `assets/ws/`:

```
ws-app.js        shell: router, panes, index tree, editor, dock
ws-nav.js        the three workspaces (Core, Research, Knowledge) and their sections
ws-platform.js   platform API — no fallback, by design
ws-api.js        page store — localStorage fallback, by design
ws-views.js      screens over platform data
ws-core-assets.js / ws-kms.js / ws-kms-views.js   Core assets and the Knowledge workspace
ws-home.js       dashboard (Home and each workspace Overview are one screen)
ws-palette.js · ws-ai.js · ws-settings.js · ws-seed.js
```

Rendering is direct DOM work. The discipline that makes that survivable: **every
view owns one container and redraws it whole from state.**

The two data layers differ on purpose and the difference is load-bearing.
`ws-platform.js` hits registered routes and, on failure, renders what failed
plus a retry — never invented data, because a fabricated Core dashboard is a
false report on a real team's work. `ws-api.js` hits `/api/platform/space/…`,
which `space_api.py` implements but is registered only in the project URLconf,
and falls back to a real `localStorage` store while saying so in the status bar;
`adopt()` lifts local pages to the account once the routes answer. There is
deliberately no local task store.

Icons come from `assets/gravitas-icons.js`. Theme is set inline in `<head>`
before first paint to avoid a wrong-theme frame.

## Upstream sync — read before editing public HTML or shared assets

This repository is a production mirror, not the design source. Two GitHub
Actions pull the visual layer from `kiaa-raad/gravitasplus` (revision recorded
in `.upstream-gravitasplus`), on a 15-minute schedule:

- `sync-kiaa-raad-frontend.yml` / `scripts/sync-kiaa-raad-frontend.sh` mirrors
  changed `*.html` and `assets/**`, and re-copies a `CANONICAL_VISUAL_CORE` list
  (including `index.html`, `assets/gravitas.css`, `assets/site.css`)
  **unconditionally on every run**.
- `apply-kiarash-design.yml` re-applies specific deltas on top.

So a hand edit to a synced file will be silently reverted. Production-only
behaviour lives in the files the sync excludes: `assets/production-bridge.js`
(prototype forms → real Django calls), `assets/production-overrides.css`,
`assets/production-cleanup.js`, `assets/local-fonts.css`, `assets/fonts/`,
`assets/upstream-*.css`. Put changes there, or upstream.

## Conventions

- Module headers in `assets/ws/` and `scripts/` are long prose comments
  explaining *why* a design was chosen and what failed before. Match that
  register when adding a module; keep the reasoning, not just the what.
- Never render a value the backend does not have. The dashboard shows status
  and deadline rather than a progress bar because the project payload carries no
  percentage. A screen that does not know yet shows loading, never failure.
- The workspace makes exactly one request outside Gravitas: Open-Meteo for
  weather, keyless, city coordinates only, switchable off, silent on failure.
- Migrations are checked in CI with `makemigrations --check`; a model change
  without its migration fails the deploy.
- No `MEDIA_ROOT`, no `FileField`, no Pillow in this deployment. The researcher
  avatar is a `TextField` holding a data URI, cropped and resized client-side
  to 256px.
- Beyond the deploy workflow there are around thirty validation and E2E
  workflows in `.github/workflows/` (space, roadmap/OKR, initiative planner,
  Nextcloud SSO, demo readiness, production E2E). When touching one of those
  areas, check its workflow for the exact test module it gates on.
