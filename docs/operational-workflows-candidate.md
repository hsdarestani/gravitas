# Operational workflows engineering candidate

Status: draft, not deployed or accepted in production. Existing LMS and video
workflow designs are preserved. No real user task has been marked complete.

## Research content contract

Each adopted project retains its stable Nextcloud Team Folder and six current
directories. `project.md` is the central editable project description.
`02_Working/Research` contains individually indexed notes, sources, attachment
metadata, datasets, tasks, discussions, outputs, annotations, maps, map nodes,
map edges and activity. Uploaded attachment binaries retain their current paths.
Stable domain IDs remain in filenames and validated headers; memberships,
ownership, object policies and relational identities remain server controlled.
The database is a typed projection/revision cache after explicit adoption.
Existing projects retain the existing storage contract before adoption.

Platform edits use the same file export/import service as file editing. Known
external edits refresh permitted projections at relevant API boundaries and in
project-scoped Pulsar context. Arbitrary externally created files are browsable
but are not automatically promoted into new domain objects. No background
watcher is implemented. Paths referenced by attachments cannot be renamed from
the generic file browser. The file surface supports text-file editing, upload, downloads, folder creation,
conditional rename/move and recoverable archival of unreferenced user files.
Domain deletion retains a tombstone and private recovery content in its journal;
project hard deletion is rejected in favor of archival.

Writes use HTTP `If-Match` with the remote ETag; creation uses
`If-None-Match: *`. Three-way text/field merging accepts disjoint edits only.
Overlap returns base, local and remote versions. The editor supports manual
merge, keep remote, or explicit keep mine against the displayed current ETag.
Missing canonical content fails visibly instead of recreating stale content.
Canonical IDs and foreign references cannot be edited through file JSON.

Caller DAV identity is used for file listings and arbitrary downloads. Known
files also require platform object permission. Service exports apply parent
folder ACLs before content is written. Migration backups and canonical recovery journals are private. Audit content is append-only through the file editor.
Permission revocation and policy-change propagation need live acceptance tests.

## Migration and release gate

`GRAVITAS_CANONICAL_ADOPTION_ENABLED` defaults to false. Do not enable it on
production yet. The command `adopt_canonical_project --project PROJECT_ID --actor EMAIL`
inspects only; `--apply` also requires this gate and manager permission.
Adoption first writes a private snapshot, exports stable objects with readback
and ACL checks, verifies counts, then enables the project. Existing objects are
retained. Failure does not enable the new contract. Partially created remote
files may remain and must be inspected before retry.

Canonical PUTs inside the API batch and explicit adoption now use a private DAV
write-ahead journal under `06_Archive/CanonicalTransactions`. A commit witness
is written in the same database transaction as the projections. After the DB
transaction exits, committed writes are retained; failed transactions restore
prior files with exact recorded ETags, or conditionally remove files created by
that batch. Journals survive DB rollback and worker restart. Project refresh
locks the project state and recovers pending journals before reading projections.
`recover_canonical_transaction PROJECT_ID BATCH_UUID` inspects a known journal;
`--apply` performs recovery while holding the project state lock.

If the remote file changed externally, or a worker died after PUT but before its
new ETag was durably recorded, recovery stops for review instead of guessing or
overwriting. Keep the journal and both content versions. Do not remove the
journal to bypass that stop. Simulated tests cover rollback, committed replay,
new-file removal, external edits and crashes before/after PUT.

**Remaining release blockers:** Conditional ACL rollback and a full matched native
checkpoint/restore are implemented but need live provider and restore acceptance. Caller-identity binary uploads and user-file MOVE
operations do not create database projections and use native DAV conditions;
their live permissions, failure and restore behavior still need validation.
Domain deletes now use conditional, durable journals rather than an unjournaled
MOVE. Jobs must use `canonical_operation(actor)` around model and policy edits;
unprotected adopted-project saves are rejected before their SQL write. Nested
transactions finalize journals only after the outer database commit; rolled-back
outer transactions leave pending recovery journals. A recovery
checkpoint itself may fail; ambiguous states require operator reconciliation.
Live crash/DB commit failure, multi-project replay, ACL and rollback acceptance
still remain. The current code must remain a draft until these pass. Merely
setting the gate is not an acceptance decision.

Before migration, back up the database and full project folder including
attachments, policies and ETags; verify restore on staging. The migration JSON
is a content snapshot, not a full relational or binary backup. For rollback,
pause writers, reconcile any successful remote writes, disable the project's
canonical state and restore the matched DB/folder backup together. The server tool
`python3 ops/canonical_checkpoint.py backup` inspects without mutation;
`backup --apply` pauses writers and captures both DBs plus native files.
`verify --checkpoint PATH` checks integrity. `restore --checkpoint PATH --apply`
first captures a safety checkpoint, stages both DBs before any exchange, retains
old databases/directories and validates native version/schema before resuming.
Interrupted restore leaves writers paused; recover its recorded safety checkpoint.
Run staging restore and validate native IDs, ACLs, attachments and domain IDs
before treating this as accepted. No real server backup/restore has run here.

## Daily work reporting

The platform Daily reports page and Telegram `/report` share one service. Pulsar
interprets natural text against the reporter's visible owned tasks. Ambiguous
or incidental work stays unmatched; absent AI configuration preserves the raw
report. AI proposals cannot mutate tasks. The user must confirm the exact
stored revision, edit it, or cancel it. Edits invalidate stale confirmation
buttons and retain previous proposals. Confirmed corrections are new reports
linked to the original. Task changes are rechecked for access, dependency and
concurrent modifications inside a database transaction. Stable source keys and
confirmed-state checks prevent duplicate effects on webhook/button replay.
Activity records distinguish AI suggestion and user confirmation.

Daily reminders enter the existing notification outbox once per eligible member
and local day. `process_task_notifications` schedules and delivers them through
the existing channel infrastructure; no reminder is sent during implementation
verification. Defaults: Asia/Tehran, hour 18, configurable through
`GRAVITAS_DAILY_REPORT_TIMEZONE` and `GRAVITAS_DAILY_REPORT_HOUR`.
Managers have an ACL-filtered overview of reports, blockers, stale tasks and
recent completion. Ready, waiting, needs_review and retest extend existing
status choices. Scheduling, connected Telegram, provider permission failures
and authenticated mobile/browser flows still require real acceptance testing.

## Pulsar project provisioning

`setup_pulsar_research_project --actor EMAIL` inspects source files only.
`--apply` creates/reuses an accessible Pulsar project and imports actual checked-in
runtime/architecture materials as deduplicated source notes and builds a
source map linked to those actual note objects. Existing notes/maps are retained. `--project`
targets an existing project explicitly. `--adopt` remains gated. This is not a
claim that the live Research project, source map, synthesis or permissions were
created or validated: production credentials were not available.

## Acceptance and task reconciliation

Source: latest Gravitas Team Tasks reviewed in the engineering session. Do not
rewrite existing assigned task text or claim completion from this candidate.

| Hossein workstream | Honest state | Acceptance/dependency |
| --- | --- | --- |
| Video workflow | DONE (design/documentation); existing design untouched | Evidence: Gravitas Video Production Workflow Chart.png, retrieved and read; Ahmad's reusable Claude Skill and one actual final revision cycle remain separate |
| Research operational quality | Implementation candidate; needs review/retest | Resolve cross-file recovery; real DAV/ACL, file edits, projections, maps, permissions and rollback tests |
| Pulsar real Research project | Provisioning command prepared; live execution pending | Authorized existing-project inspection, real source material, notes/maps/synthesis and end-to-end validation |
| LMS course acceptance | Retest pending; no redesign | Actual learner/instructor course, notes/highlights, reminders/tasks/progress, preview/publish/schedule, mobile |
| Topic | Blocked; no upload or publication performed | Sajad approves Topic Template before preparation is applied/published |
| Daily reporting | Implementation candidate; needs review/retest | Platform and connected Telegram live confirm/edit/cancel/replay, manager ACL and daily scheduling |

The exact final graph artifact has been identified and its extracted content
confirms Final QA ↔ Revision (T19–T26). The design is DONE; this does not close
the live Research Project or final production-cycle validation task. Do
not mark LMS, Research or Pulsar operationally complete until real evidence is
attached. Do not infer Topic approval. Task mutations against the production
database have not been performed in this session.

## Verification scope

New service tests use a simulated DAV store, not a live Nextcloud server.
They cover conditional conflicts, projection import, IDs, migration counts,
viewer/outside denial, the adoption gate, approval/replay/concurrent-task checks,
correction history, dependency completion and reminder idempotency.
Existing backend tests run against isolated test settings.
The final full backend suite passes: 613 backend tests plus 5 native checkpoint regressions; live acceptance is pending.
One additional source-provisioning regression passes. Full acceptance evidence
and remaining limitations are recorded in operational-workflows-report.md. Migration drift check reports no
changes; new frontend modules pass JavaScript syntax checks.
The API coverage checker reports the same 14 query-template false positives on the base commit;
it is not a clean coverage result. Google authentication redirected to Workspace,
but the browser then returned 502 / connection refused and account entitlement
could not be verified. Independent HTTP checks returned 200 for Workspace and
`status: ok, database: ok` for the health endpoint; the latest production monitor
was successful. This does not establish an origin outage or authenticated
acceptance. LMS, Pulsar, Telegram, mobile and Nextcloud acceptance remain
unverified. Corrections now reject inaccessible, missing or unconfirmed original
reports, and the task catalog includes description, priority, acceptance criteria
and dependency IDs for better grounded proposals.

References: [HTTP conditional requests](https://www.rfc-editor.org/rfc/rfc9110.html#name-conditional-requests),
[Nextcloud WebDAV](https://docs.nextcloud.com/server/latest/developer_manual/client_apis/WebDAV/index.html).
