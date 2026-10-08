# Operational workflows engineering candidate

Status: implementation released through PR154. Selected native acceptance exposed
a Nextcloud permission-ceiling failure; the follow-up repair passes 636 backend
tests and awaits deployment/native retest. Existing LMS and approved video designs
are preserved. Operational composite tasks remain open.

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

File content writes use HTTP `If-Match` with the remote ETag; creation uses
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
still remain. Do not treat unverified acceptance items as complete. Merely
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
before treating this as accepted. Real matched backups and isolated restore rehearsals passed on production before releases and before selected acceptance.

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
targets an existing project explicitly. `--adopt` remains gated. The real private Pulsar Development Project (208), five existing-source notes
and one source map were provisioned idempotently. Native access, provider synthesis
and canonical adoption are tracked separately in the current acceptance report.

## Acceptance and task reconciliation

Source: latest Gravitas Team Tasks reviewed in the engineering session. Do not
rewrite existing assigned task text or claim completion from this candidate.

| Hossein workstream | Honest state | Acceptance/dependency |
| --- | --- | --- |
| Video workflow | DONE (design/documentation); existing design untouched | Evidence: Gravitas Video Production Workflow Chart.png, retrieved and read; Ahmad's reusable Claude Skill and one actual final revision cycle remain separate |
| Research operational quality | Released; native permission repair needs live retest | Resolve cross-file recovery; real DAV/ACL, file edits, projections, maps, permissions and rollback tests |
| Pulsar real Research project | Project 208 created; five notes and one map preserved | Authorized existing-project inspection, real source material, notes/maps/synthesis and end-to-end validation |
| LMS course acceptance | Learner persistence and instructor draft/preview/schedule verified; remaining acceptance open | Actual learner/instructor course, notes/highlights, reminders/tasks/progress, preview/publish/schedule, mobile |
| Topic | Blocked; no upload or publication performed | Sajad approves Topic Template before preparation is applied/published |
| Daily reporting | Released; native permission repair needs live retest | Platform and connected Telegram live confirm/edit/cancel/replay, manager ACL and daily scheduling |

The exact final graph artifact has been identified and its extracted content
confirms Final QA ↔ Revision (T19–T26). The design is DONE; this does not close
the live Research Project or final production-cycle validation task. Do
not mark LMS, Research or Pulsar operationally complete until real evidence is
attached. Do not infer Topic approval. Production task reconciliation preserves design completion, assigns Ahmad the
Skill dependency and Sajad the Topic review, and keeps composite execution pending.

## Verification scope

New service tests use a simulated DAV store, not a live Nextcloud server.
They cover conditional conflicts, projection import, IDs, migration counts,
viewer/outside denial, the adoption gate, approval/replay/concurrent-task checks,
correction history, dependency completion and reminder idempotency.
Existing backend tests run against isolated test settings.
The current full backend suite passes **636 tests**. Prior CI also passed nine
native checkpoint checks with PostgreSQL16. JavaScript syntax and diff checks pass.
Production matched native backup and isolated restore have passed repeatedly.
The real platform report was edited and confirmed, with manager overview visible.
LMS Note, Highlight, Reminder and Personal Task persisted after reload; draft,
preview and schedule-save were verified, then the schedule was cleared. Immediate
course publication was rejected by automatic approval review and remains pending
explicit approval. Real browser/mobile, human Telegram reply, project permissions
and remaining Research A–L items are individually qualified in the 19-part report.
The first selected native acceptance failed HTTP403 before adoption committed.
The fix gives the existing exclusive service account a native ceiling and approved
editors a separate ceiling only after complete root ACL readback, leaving viewers
read-only. Unit tests are not a substitute for the native rerun.

References: [HTTP conditional requests](https://www.rfc-editor.org/rfc/rfc9110.html#name-conditional-requests),
[Nextcloud WebDAV](https://docs.nextcloud.com/server/latest/developer_manual/client_apis/WebDAV/index.html).


### Native ACL collection preconditions and daily reporting follow-up

Native Nextcloud 34 returned 412 for stable quoted folder ETags: Sabre DAV only
compares If-Match for IFile, not collections. ACL writes therefore use the
service-only gravitascanonical OCS bridge, with a PostgreSQL transaction and
SHARE ROW EXCLUSIVE lock on the native ACL table. Both the full rule snapshot
and ETag must match before any native rule changes; empty ACLs also exclude
phantom inserts. Conflicts never fall back to unconditional writes. Native
rule managers perform the writes and an exact readback precedes commit.
The app accepts only the existing configured service, its native ACL-manager
entitlement, Nextcloud 34 and PostgreSQL. The deployment installs only this
owned app after the full matched checkpoint; live acceptance must still pass.

Daily requests now cover every active, authorized Core task owner with open
work, including members without a connected Telegram account. Platform requests
appear on Daily work reports; connected private accounts also receive one
outbox message per Tehran date from the existing one-minute worker after 18:00.
Late same-day Telegram connection queues the still-missing Telegram message.
Today's confirmed report suppresses requests; tomorrow starts a new cycle.
AI proposals require the individual's review and confirmation before changing
tasks. The manager sees member coverage, account connection and delivery state.
Personal history can be filtered by date and status. Human account linking and
real replies remain necessary for full Telegram end-to-end acceptance.
