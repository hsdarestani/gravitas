# Execution Intelligence

## Audit and integration

The original `ws-task-timeline.js` rendered all task rows, placed its ruler in
the scrolling document, and drew one start-to-completion/today bar. A start
timestamp did not establish all intervening active/blocked intervals. The view
did not expose recorded status changes, nested execution rollups, milestone
delivery risk, or bottleneck analysis.

The application is native browser ES modules and plain Django views. There is
no frontend framework, package manager, or build step. The new experience is
part of the existing Core Tasks and project command center. Tree, Board, Week,
Graph, task dialogs, the canonical task outbox and explicit Deck sync remain.

Existing infrastructure reused:

- `OperatingTask`: owner, project, parent, finish-to-start predecessor,
  milestone, actual lifecycle dates and date provenance.
- `OperatingMilestone`: existing planning/roadmap records, owners and targets.
  Migration 0073 already imported first-quarter roadmap milestones. Analytics
  reads current database rows rather than seeding another milestone collection.
- `ActivityEvent` and `ProjectAuditEvent`: task history and project audit data.
- `KnowledgeResource` notes: `task_schedule_v1` and `task_time_log_v1`, using the
  existing validated Markdown parsers and note ACLs.
- `platform_access`: the existing object policy and inherited permission rules.
- Existing SSH/VPS deployment workflow, including migration and rollback steps.

## Implemented experience

Timeline has a single scroll container, sticky ruler and identity cells,
44-pixel virtual rows, hierarchy expansion, keyboard row navigation, daily /
weekly / monthly / quarterly zoom, Today, fit actions, planned bands, known
state segments, completion/deadline markers, milestone references and contextual
finish-to-start connections. There is no task-by-day DOM matrix. Dependency
connections are capped at 200 visible connections to limit clutter.

Timeline and Bottleneck Analysis use the same authorized server snapshot.
Controls filter by title/ID, project, owner, status, priority, milestone and date
range. Filter state is reflected in URL `ei_*` parameters. Cards filter their
underlying tasks. Dates and inactivity use the configured workspace timezone;
calendar dates do not shift when viewed from another timezone.

The task insight drawer includes overview, lifecycle/work-log measurements,
data completeness, activity history, predecessor/successor/subtask links,
milestone links, diagnostics and the score breakdown. Existing editors remain
available. Status, blocker, predecessor, milestone, deadline, task weight and
planned schedule edits use server APIs with confirmations and revision checks.
Historical date corrections remain in the existing authorized full task editor.

Milestones use explicit task associations plus descendants, never title
similarity. Progress weights apply to linked leaf tasks only; explicit task
weights override the documented default of 1. A blocked critical task remains
a risk even if many smaller tasks have completed. A milestone click exposes its
unfinished work and the recorded risk factors, with direct task drill-down.

The responsive view uses hierarchical task cards rather than shrinking a Gantt
chart onto a phone. Cards are paged in groups of 100; the insight panel fills
the viewport. Desktop chart virtualization is independent of mobile cards.

## Measurements and historical quality

- Lead time: creation to completion; open elapsed lead time is separate.
- Cycle time: first recorded active timestamp to completion; open elapsed
  cycle time is separate. Estimated starts do not establish precise cycles.
- Active, waiting and blocked time: sum of known state intervals, measured in
  calendar seconds. Active-state time is explicitly not labor effort.
- Work: recorded work-log intervals unioned per person; parallel work by
  different people remains separate effort. Missing logs are unavailable.
- Inactivity: time since a meaningful human event. Sync, canonical refresh,
  background jobs and `updated_at` do not establish human activity. The stalled
  flag is computed separately from the canonical task status.
- Schedule variance: local calendar completion date versus the current
  deadline, or elapsed lateness for open work. Due-date revisions remain audited.
- Reopens: recorded completed-to-open transitions. Missing past transitions
  cannot be reconstructed precisely and are not fabricated.

Unknown history is drawn as an outlined gap and excluded from state durations.
A start timestamp can establish a cycle boundary without proving a continuous
active interval. A completed task with no completion timestamp does not extend
to today. Estimated completion timestamps do not yield precise lead/cycle time.
The API reports state coverage, provenance, source issues, as-of time and event
count. It sends the latest 12 events per task by default and up to 200 when
explicitly requested for a selected task.

Future model saves capture changed fields in the existing audit stream in the
same database transaction. Initial empty fields are not interpreted as explicit
historical clears. Repeated unchanged syncs produce no extra lifecycle changes.
Deck facts are marked `nextcloud`; canonical projection imports are marked
`canonical_sync`, even when an authenticated user initiated a refresh.

## Risk and forecasting

The explainable score is bounded to 100 points: recorded blocked duration 25,
business-day inactivity 20, deadline 20, downstream reach 15, milestone impact
10, priority 10. Unknown evidence contributes zero. Each contribution is shown
in the task drawer; a score opens the task rather than representing an
unexplained prediction.

Milestone status distinguishes an already missed target (`delayed`) from
recorded future risk (`at_risk`). Blocking, inactivity, overdue work and
unresolved predecessors are evidence-based signals, not claims of causality.

Historical forecasts require at least eight completed tasks in the same project
and priority with at least 80% known state coverage. They use median calendar
cycle time and an interquartile range, are explicitly limited confidence, and
are suppressed for blocked tasks, unresolved predecessors, parent rollups and
tasks already older than their cohort median. A milestone forecast requires
forecasts for every unfinished linked leaf and states its parallel-work
assumption. Missing evidence returns “Insufficient historical data for a
reliable forecast.” These are critical dependencies, not a claimed mathematical
critical path. Other dependency types are not introduced into the existing
finish-to-start model.

## Files, schema and API

Frontend: `ws-execution.js`, `ws-execution-gantt.js`, `ws-execution.css`; existing
timeline entrypoint and Core/project views now mount the integrated experience.
Importer URLs carry one consistent version per module to preserve shared state.

Backend: `execution_history.py`, `execution_analytics.py`, `execution_api.py`,
`execution_models.py`; task saves, milestone saves, schedule writes, Deck
ingestion and canonical middleware retain their existing domain boundaries.

Migration `0089_execution_intelligence` adds nullable `OperatingTask.execution_weight`
and a workspace `ExecutionSettings` row. It does not alter task data or insert
production milestones. Weights are internal execution configuration; they are
not written into Deck's title/lane/deadline fields. Existing plans remain in
their original Markdown notes, including Core plans without a project.

Read endpoints:

- `GET /api/operating/execution/`
- `GET /api/platform/projects/<id>/execution/`
- `GET /api/operating/execution/settings/`

Write endpoints reuse existing task, milestone and project schedule APIs.
`PATCH /api/operating/execution/settings/` is workspace-manager-only;
`POST /api/operating/execution/schedules/` edits permitted unassigned Core plans.
Schedules and settings use optimistic revision tokens. Historical changes are
recorded. Configuration includes IANA timezone, weekday calendar and inactivity
threshold; holidays are explicitly not configured.

Access checks run before task counts, relationships or milestone progress are
exposed. The bulk policy reader uses request-scoped preloaded policies/grants
with the existing decision rules, rather than skipping per-object security.
Core task details and dependency candidates respect private task policies too.
Analytics responses use `Cache-Control: private, no-store` and do not trigger
DAV refresh or write any analytics back to external tasks.

## Verification and deployment

Automated acceptance lives in `core.test_execution_intelligence`,
`scripts/test-execution-gantt.mjs` and
`scripts/reliability/execution-browser.mjs`. The GitHub workflow
`execution-intelligence.yml` creates an isolated database, runs backend and
geometry checks, exercises real desktop/mobile Chromium interactions and
server persistence, and uploads screenshots/results. The fixture scripts
explicitly refuse production settings.

The implementation was inspected interactively against the real local Django
backend with 1,005 explicitly labeled acceptance tasks. At the bottom of the
chart, the ruler remained within one pixel of the scroll container edge, and
task identities remained within one pixel of the left edge while scrolling
horizontally. Only 20–28 task rows were mounted at a time.

Local validation passed all 1,095 backend tests (three existing skips). The
Execution Intelligence Acceptance CI passed at both 1440×1100 and 390×844 with
1,005 tasks, exact lifecycle durations, weighted milestone drill-down, server
persistence, and zero document overflow. The existing Workspace Reliability
desktop/mobile browser suite and PostgreSQL concurrency suite also passed.

Pull request: https://github.com/hsdarestani/gravitas/pull/319. Final commit and
deployment outcome are recorded in the delivery report. Production Nextcloud service credentials are not
present in the local environment; local sync regressions use the repository's
existing integration fixtures. No fixture data is intended for production.
