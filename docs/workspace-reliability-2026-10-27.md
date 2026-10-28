# Workspace reliability investigation — 27 October 2026

Implementation and acceptance evidence: [PR #276](https://github.com/hsdarestani/gravitas/pull/276).
PR #271 was already merged. Its fixed task-frame geometry, focus handling and filter preservation are retained. Concurrent changes subsequently merged into main (AutoResearch placement and retry-safe subtask creation) were merged into this branch rather than overwritten.

## Confirmed root causes and changes

| Root cause | Resulting failure | Correction |
|---|---|---|
| Versioned imports created separate platform request caches; Home also had two full module URLs | Duplicate reads and independent timer/state ownership | Canonical platform/Home imports; shared request state during deployment overlap; a regression checks complete URLs, including every query parameter |
| Navigation caches were invalidated before writes, but not after commit; uploads bypassed invalidation | A GET started during a save could leave an old board cached after the server committed | Invalidate before and after writes/uploads, including late completion of uncertain writes; stale generations cannot repopulate the cache |
| Deadlines raced response headers only; JSON parsing and CSRF preparation could remain pending | Indefinite saving/loading; malformed proxy responses could resemble successful empty responses | Bound the complete confirmation and CSRF preparation; coalesce CSRF; validate task confirmation identity/revision; never replay uncertain writes |
| Editors submitted unchanged fields and server updates lacked an editor revision guard | Another editor's work could be overwritten | Submit changed fields; lock the task row and check `expected_updated_at` inside the transaction; return 409 with the current task; retain the draft |
| Task save and activity logging were not one transaction on every path | A failed activity write could leave a partially acknowledged task change | Transactional update/create boundaries, with regression coverage for rollback |
| Creation serialized its response before assigning board order and updating the revision | An immediate edit using the returned revision could be rejected as stale | Return the actual committed creation revision |
| Project refresh replaced live DOM before optional renderers completed | Failed/late refresh could replace the active page or lose state | Build in a staging container and commit only the current render; retain the existing view on failure; preserve scroll at commit time |
| Research task PATCH still synchronously refreshed native files, while a changed native revision could import over an already confirmed queued task edit | Slow Command Center saves and risk to confirmed local data | Use the existing durable task outbox for project-scoped edits too; mirror immutable audit rows before clearing it; reject conflicting native imports while a task has unsynchronized edits |
| Command Center refreshed cockpit, work time and schedules serially and repainted unrelated content | Avoidable waits, disappearing drafts, repeated saves | Parallel reads, refresh generations, per-task write guards, stable mode/filter controls, targeted optional-data repainting |
| Permission flags repeatedly walked the same policy inheritance chain | Repeated SQL per cockpit task/deliverable/mind map | Derive role/edit/manage flags from one authoritative evaluation; no cross-request permission cache |
| Closed task dialogs could leave optional-section observers alive; late detail responses still built detached editors | Retained DOM/closures and unnecessary work | Explicit observer disposal and navigation cleanup; stop rendering a closed editor |
| Protected parent deletion raised an uncaught model exception | 500 when deleting a task with dependent subtasks | Return an explicit 409 and roll back deletion/activity/outbox changes; keep all tasks intact |
| Malformed dates, relation IDs and text values reached model/SQL operations | Avoidable 500s on create/edit | Shared validation before ORM operations, with tests that no task changes on rejection |
| Django settings named a WSGI module absent from the repository | A real local browser server could not start despite backend unit tests passing | Add the standard WSGI entry point and exercise it in real-server CI |
| Every backend code change ran an offline matched native checkpoint | Planned upstream outages during otherwise routine code releases | Narrow, fail-closed API-only hot-reload path with a verified code archive, rollback, worker turnover checks and uninterrupted health probes; schema/settings/dependency/native-format changes retain matched checkpoints; the native read-guard exception verifies unchanged format/export ASTs |
| Production browser checks depended on a chain skipped by static-only deployments | Successful deployments could have no production browser acceptance | Run the existing production browser smoke after every successful deployment |

## Measured evidence

These are different measurement environments and must not be combined into a production percentile claim.

| Measurement | Before | After / verified result | Environment |
|---|---:|---:|---|
| Concurrent identical navigation reads through two module URLs | 2 requests | 1 request | Controlled real-module transport test |
| Permission SQL for the same task role/edit/manage flags | 21 queries | 7 queries | Django regression fixture; equal permissions and immediate revocation verified |
| Task modal vertical movement while comments arrive and receive focus | PR #271 already stabilized this | 0 px at both tested widths | Real Chromium + Django/SQLite CI |
| Save confirmation, desktop 1440×1000 | No comparable pre-change sample | 157 ms; one PATCH; fresh-page server read matched | First successful CI browser run |
| Save confirmation, mobile 390×844 | No comparable pre-change sample | 108 ms; one PATCH; fresh-page server read matched | First successful CI browser run |
| Response-body hang | No deadline after headers | Confirmation deadline covers body parsing | Executable transport regression |

The first full local baseline passed 944 tests. The local release suite ran 972 tests and passed (two PostgreSQL-only cases intentionally skipped on SQLite). A separate PostgreSQL job passed 49 tests, including simultaneous editors and checklist transaction boundaries. The desktop/mobile browser suite passed stale-editor rejection, conflict-draft retention, typing during delayed real confirmation, and zero leaked task observers; the measured first-save confirmations in that run were 163 ms and 105 ms. Nine executable request-runtime regressions also pass. After integrating the concurrently merged subtask fixes, 974 tests passed locally. The final PR checks repeat these gates on the release commit.

## Production diagnosis before release

Read-only diagnostics ran under the existing production SSH boundary. No task bodies, credentials or raw private log lines were exported.

- Nginx tail: 77 HTTP 502 responses and one task-board HTTP 500; no HTTP 504 observed in that sample.
- Nginx upstream errors: 74 connection refusals and three resets. No worker-timeout signatures; backend restart counter was zero.
- 502 bursts occurred around 13:20–13:22 and 13:29–13:31 UTC. The 13:29 deployment entered its offline checkpoint step at 13:29:33 and proceeded to frontend deployment at 13:31:44. The checkpoint implementation explicitly stops backend units. This supports deployment-induced upstream unavailability, rather than a demonstrated worker-capacity bottleneck.
- Full-middleware task reads: preview 126 ms, detail 46 ms, history 17 ms, comments 15 ms, attachments 15 ms, checklist 16 ms. These are individual read-only samples, not p95s.
- Project cockpit sample: 499 ms. Other sampled project panels returned in 15–198 ms; the managed external-dataset panel returned an explicit 409.
- Task synchronization timer was active; 37 reported worker runs had no reported failures/deferred jobs. One existing native revision conflict remained recorded. Both versions must be reviewed; this release does not silently overwrite it.

## Coverage and safety boundaries

The import graph was inspected across all 54 Workspace JavaScript modules. Every module was reachable; no whole module was deleted merely because it looked old. Duplicate request/permission work and redundant form tracking were removed without deleting user data or product capabilities. Task CSS geometry from PR #271 remains intact.

Automated browser coverage uses real Chromium, real HTTP requests and a real Django database at desktop/mobile sizes. It checks task save/read-after-reload, focused comment input, all eight Command Center modes, retained search filters, page overflow and 13 account/Core/Research/Learning navigation routes. Additional checks exercise a second editor's server commit, a rejected stale save with the draft retained, typing during a deliberately delayed real save response, and zero retained task observers after close. The delayed-response test forwards the actual server response; it does not invent a saved task.

Production inspection uses the signed-in browser and anonymized read-only endpoint profiles. Production browser acceptance uses the repository's disposable test identity lifecycle, creates one task owned by that identity, verifies desktop/mobile edits through independent server reads and page reloads, and deletes that fixture in a finally block. The actual rollback function is also rehearsed against a temporary tree: same-size/same-timestamp changed code is restored using checksums, newly introduced code is removed, and runtime/static/database files remain intact.

The release does not claim exhaustive interaction coverage for every external Nextcloud/Google/payment/provider flow, nor does a short healthy observation establish a long-term 5xx rate. API-only releases avoid the offline checkpoint; stateful releases still require the matched backup procedure.

## Reproduce

```sh
node scripts/test-workspace-request-runtime.mjs
PYTHONPATH=backend DJANGO_SETTINGS_MODULE=gravitas_backend.test_settings python -m django test core
PYTHONPATH=backend DJANGO_SETTINGS_MODULE=gravitas_backend.test_settings python -m django makemigrations core --check --dry-run
node scripts/check-api-coverage.mjs
```

The `Workspace Reliability` workflow installs Chromium outside the application, creates an isolated SQLite fixture, starts the actual backend/frontend and uploads screenshots plus assertion results. It introduces no application build step or browser runtime dependency.
# Production deployment follow-up (28 October)

Production browser run 40716441604 confirmed real server persistence on desktop
(259 ms total, server write 29 ms) and mobile viewport (189 ms total, server
write 24 ms), each with independent API read and hard reload. It cleaned its
task fixture and observed no page errors. The run still failed acceptance:
immediate post-login navigation aborted the initial bootstrap request, and
self-service account deletion correctly returned 409 for the disposable user's
protected personal workspace. The follow-up waits for that bootstrap to settle
and uses the existing strictly named, run-scoped E2E leaf-to-root cleanup, also
repairing earlier completed failed browser fixtures. It keeps request-failure
assertions and never selects active runs or real account names.

Final API rollout after PR #282: deployment 40714590946 succeeded with 31 public
TLS health samples and zero failed samples across both drained transitions.
The complete backend suite ran 998 tests successfully; PostgreSQL concurrency
and real Nginx draining also passed their dedicated jobs. This supersedes the
earlier failed/incorrectly labelled release attempts below. The production
browser harness subsequently reached login but timed out waiting for navigation;
its DOMContentLoaded navigation could precede the dynamically inserted auth
handler. The follow-up waits for the real page load and asserts the actual login
POST response before checking navigation; it also waits for outstanding section
requests before navigating again. Failure logs expose only path/query keys,
never credential-bearing query values.

Live verification after PR #281: task #1119 was attached to Topic 01 (213) via
the actual UI. The server returned a confirmed save, a hard reload retained
the project, and read-only SQL diagnostics later showed the native file exists
and no task sync witness remains (`1|complete|0||1`). The sync worker reported
44 recent runs, zero failures and zero deferrals. One unrelated pre-existing
native revision conflict remains preserved for review.

Deployment 40711828024 exposed two additional release defects: fixed port 8001
was already occupied (five bind errors, no standby worker boots), and Bash
negated assertions did not invoke errexit. Public probes recorded 27 HTTP 400s
from the wrong listener. This release was incorrectly labelled healthy and is
not zero-error evidence. PR #282 replaces those assertions with tested failure
returns, allocates an unused port, proves the standby master owns its listener,
requires three workers and a public-Host health response, and records sanitized
probe statuses. Tests prove a healthy foreign listener cannot satisfy readiness.
The live browser harness also lacked Django settings in its disposable-access
command; that command now sets the module explicitly.

Read-only inspection of task #1119 confirmed its committed project is null,
although the failing form had selected Topic 01. This is a first attachment,
not an edit to an already project-owned task. The deferred boundary now locks
the task before choosing its scope and atomically commits first attachment plus
the destination sync witness, while retaining the view's authorization and
stale-revision checks. Existing cross-project native file moves remain strict;
an existing native identity cannot accidentally use the first-attachment path.
Tests verify attachment, independent DB state, no request-time DAV, eventual
native export, stale-editor rollback, and denied access with no queued writes.
The precise pre-save error is `canonical_task_projection_file_missing`:
`refresh_task_scope()` required a task file in the destination before that task
had ever been attached to it. Middleware exposed this as the generic 503
`canonical_storage_unavailable`; it was not proof that Nextcloud was offline.

PR #276 was merged as f129254d. Deployment 40708391277 passed backend tests but
correctly rejected the API reload: one direct health connection was reset during
Gunicorn gthread HUP (1 failed probe in 4). Its code archive rollback completed;
the frontend was not published. This is not a successful production acceptance.

The follow-up release keeps an independent copy of the previous API serving on
8001, validates it, gracefully switches Nginx to it, and waits for original Nginx
workers to finish their in-flight requests before reloading the primary API.
It switches back only after primary readiness and drains Nginx again before
stopping the temporary pool. Public TLS health is sampled throughout both
switches; failures still fail the release. Rollback routes through the standby
before restoring code and never restores an old data snapshot. An interrupted
standby is retained and blocks subsequent automated replacement.

A real Nginx regression test holds a POST open across the switch, asserts one
server-side write and a complete response, monitors concurrent reads, and verifies
that stopping the original upstream after draining leaves the new route healthy.
