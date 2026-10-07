# Gravitas operational workflows: consolidated engineering and acceptance report

## 1. Executive summary

The requested operational outcome is **not yet complete**. The implementation is
in draft PR [#150](https://github.com/hsdarestani/gravitas/pull/150), with automated
regression checks passing. It has not been deployed, production projects have
not been migrated, and real Research/LMS/Telegram acceptance has not passed.
The approved Video design is DONE; Ahmad's Skill and final-cycle validation are
separate dependencies. Topic remains blocked on Sajad's review.

## 2. Commits and changes

Base: `6e8732e1cda1d6282addd9afe6de925736a95bce`.
Published candidate commits before this report: `d37a864`, `bc47291`, `e91943a`.
The follow-up commit containing this report adds recoverable canonical deletion,
outer-transaction commit handling, guarded background writes, project metadata
projections, text-file editing/upload/archival, richer task context, scoped
Pulsar team/activity context, source-map provisioning and regression coverage.
The PR is draft; these changes are not production behavior yet.

## 3. Research Workspace architecture

Existing Django domain models, native ES-module UI and `platform_access` remain
in place. Explicitly adopted projects use Nextcloud content as the authoritative
content store; database objects are typed projections and revision caches.
Ownership, memberships, policies and identity relationships remain server
controlled. Existing projects keep their current contract until adoption.

## 4. Canonical file structure

The stable project Team Folder and existing six directories are retained.
`project.md` contains the editable project title header and description. Typed content is indexed
under `02_Working/Research`: notes, sources, attachment metadata, datasets,
tasks, discussions, outputs, annotations, mind maps/nodes/edges, activity and
project metadata. Binary attachments retain their paths. Migration snapshots and
transaction journals are private under `06_Archive`. User-file archival goes to
`06_Archive/UserTrash`, with native Nextcloud restoration.

Project title and business metadata are editable canonical fields. Permission
and relationship metadata remain server controlled. Externally created arbitrary files are browsable;
they are not automatically promoted to new typed domain objects.

## 5. Nextcloud synchronization

Permitted projections refresh at relevant API boundaries and in project-scoped
Pulsar retrieval. Platform edits export to the same indexed content. Conditional
read/write checks prevent silent overwrites or recreation of externally deleted
files. Listings, arbitrary file operations and downloads use the caller's DAV
identity. There is no background external-file watcher. Live revocation and
ACL propagation have not been accepted.

## 6. Versioning and conflicts

Creation uses `If-None-Match: *`; updates use exact remote ETags. Disjoint text or
field edits can merge conservatively; overlapping edits return base/local/remote
versions. The editor supports keep mine, keep remote and manual merge against
the displayed revision. Revisions retain content/provenance.

A private write-ahead journal plus a database commit witness covers canonical
PUT and domain DELETE. Failed batches restore old content or remove newly
created content conditionally. External changes and ambiguous writes stop for
review. Nested transactions finalize only after the outer commit; rollback
leaves a durable pending journal for recovery before the next projection read.
Jobs use `canonical_operation(actor)` around model and policy edits. Unprotected
adopted-project saves fail before SQL. Project hard deletion is rejected in favor
of archival. Conditional ACL snapshots and changes now share the durable journal;
rollback preserves external ACL changes and pauses ambiguous writes for review.
Policy, grant and membership changes propagate through the same boundary. Root
ACLs explicitly enumerate permitted users so old Team Folder group membership
does not provide fallback access. Adoption stays disabled pending native acceptance.

## 7. Pulsar integration

Project context includes permitted notes/sources, open tasks with priority,
deadline/dependency/blocker, team, research question/project deadline,
discussions, experiments, maps/nodes and readable activity. Child ACLs are checked
before including audit events; raw audit payloads are excluded. Context refreshes
canonical projections first. Real provider, revoked-access and project-synthesis
acceptance remain unverified.

## 8. Daily Telegram reports

Natural reporting uses the same service as the platform. Pulsar proposes
interpretation and task links; it cannot apply updates. Confirm/Edit/Cancel is
mandatory. Unknown/ambiguous work remains unmatched and can be mapped explicitly.
Exact report/task revisions, ownership, current ACL and dependencies are checked
on confirmation. Stable webhook source keys and terminal-state checks prevent
repeat effects. Original text, interpretation, proposal history, confirmer,
corrections, task activities, blockers, next steps and artifacts retain provenance.
Daily check-ins use the existing outbox once per eligible user/local day. No
implementation test sent a real Telegram message. Live delivery/replay is pending.

## 9. Task management

The daily view shows priority/status/deadline/project/dependency, objective and
KR, latest confirmed progress, next action and artifact. Confirmation refreshes
this view. Managers receive ACL-filtered reports, blockers and stale-task context.
Ready, active, waiting, blocked, needs_review, retest and done are supported.
Production task IDs/statuses have not been changed or reconciled in the database.

## 10. Pulsar Research Project

`setup_pulsar_research_project --actor EMAIL --project PROJECT_ID` inspects;
`--apply` imports actual checked-in runtime/architecture materials, preserves
existing source-note edits and creates a map linked to real source objects.
Repeat provisioning preserves IDs and map links. It does not invent team tasks,
deadlines, completion or research results. The command has not run against
production. A real source-to-synthesis/data-room acceptance run is still needed.

## 11. LMS retest

Existing LMS design and implementation were preserved. Existing automated LMS
regressions pass within the full backend suite. No authenticated real Gravitas
course was created or accepted in this session. Learner/instructor modules,
lessons, progress, notes/highlights, reminders/tasks, completion/dashboard,
preview/publish/schedule, reload persistence, ACL and mobile are **BLOCKED for
live retest**, not PASS. No fabricated live-course evidence is attached.

## 12. Topic

Prepared content is retained. Status: BLOCKED, owner dependency Sajad's Topic
Template review. Next step: READY to upload approved content and run structure,
access/navigation QA after approval. No upload/publication was performed.

## 13. Video Production

Design/documentation: DONE. Retrieved artifact: **Gravitas Video Production
Workflow Chart.png**. Its extracted content explicitly confirms
“Final QA ↔ Revision (T19–T26)”. Approved design was not rebuilt. Ahmad's reusable
Claude Skill: WAITING ON OWNER. One real final revision-cycle validation and the
live Research Project evidence remain pending; design completion does not close
those execution tasks.

## 14. Migration

No production migration, adoption or data rewrite occurred. Migrations 0060–0062
are additive candidate schema changes. Adoption defaults to disabled and creates
an inspection snapshot before export/readback and activation. Snapshot JSON is
not a full binary/relational backup. A matched DB/folder backup and a tested
complete restore are prerequisites. `ops/canonical_checkpoint.py` now captures
both PostgreSQL databases, site/backend/configuration and the complete native Nextcloud volume
in one writer-paused checkpoint. Restore verifies integrity/image compatibility,
captures a safety checkpoint, stages both databases before exchanging either,
retains prior databases/directories and validates native schema/version before
resuming writers. Interrupted restores stay paused and can recover from their
recorded safety checkpoint. Pre-deployment capture and isolated database/native-file restore rehearsal are now wired into deployment; live execution is pending.

## 15. Automated checks

GitHub Actions full backend run: **613 tests, OK**, 23.552 seconds. Conditional ACL tests cover
rollback, committed replay, external changes, ambiguous writes, missing snapshots,
XML escaping and multi-status property failure. Native checkpoint regression: **5 tests, OK**. Actual-source provisioning
regression: **1 test, OK**, also included in the final full run (preserves human edits, IDs and source-map links).
Migration drift: no changes. Changed frontend modules: syntax passes.
The API coverage checker retains 14 known baseline query-template false positives.
DAV journal tests use an in-memory simulation, not a live Nextcloud instance.

## 16. Manual and acceptance results

The existing production browser returns `502 Bad Gateway / Connection refused`
for Workspace. Independent health checks return `status: ok, database: ok`.
An origin outage has not been established. Signed-in account/entitlements could
not be verified, so no live test below is claimed PASS.

| Research test | Result | Missing live evidence |
| --- | --- | --- |
| A Project creation | BLOCKED | Actual project, reload, canonical folder |
| B Markdown | BLOCKED | Actual editor save/reload/external edit |
| C Attachments | BLOCKED | Upload/download/ACL/native path |
| D Notes | BLOCKED | Project-linked creation/edit/reload |
| E Tasks | BLOCKED | Project links/status/progress/history |
| F Sources | BLOCKED | Real source association/persistence |
| G Mind map | BLOCKED | Create/edit/drag/drop/delete, reload |
| H Data room | BLOCKED | Invites/access/revocation/downloads |
| I Personal project | BLOCKED | Owner/private isolation |
| J Shared project | BLOCKED | Collaboration and child ACL |
| K Concurrent edit | BLOCKED | Two real clients, merge/conflict/recovery |
| L External update | BLOCKED | Real Nextcloud changes/projection/context |

Daily Telegram + platform acceptance: BLOCKED. Actual Pulsar project acceptance:
BLOCKED. Actual LMS course/mobile acceptance: BLOCKED. Video final cycle:
WAITING ON OWNER. Topic: intentionally waiting on review.

## 17. Remaining blockers

External: this browser cannot load Workspace; no verified production DB/DAV
session; read-only Actions inspection has been added using the existing deployment identity; real Telegram/provider and
mobile tests are unavailable. Ahmad owns the Skill; Sajad owns Topic review.

ACL rollback, native matched checkpoint/restore and wider metadata coverage are
implemented and tested locally. Native provider/restore acceptance is pending.
Arbitrary externally created files do not automatically become domain objects;
that is a remaining product gap, not an external blocker. Live tests may reveal
additional failures. The draft must not be deployed as an accepted canonical
migration merely because automated tests pass.

## 18. Hossein task matrix

| Work item | Status | Evidence / owner / dependency / next action |
| --- | --- | --- |
| Video design/documentation | DONE | Final chart retrieved/read; Hossein; preserve approved design |
| Reusable Video Claude Skill | WAITING ON OWNER | Ahmad; approved workflow; build Skill |
| Video final cycle/real Research capture | BLOCKED | Skill + live access; Hossein/Ahmad; run final revision cycle |
| Canonical Research implementation | IN PROGRESS | PR #150; engineering owner Hossein; validate native checkpoint/ACL and external-create semantics |
| Canonical conflict/recovery local regressions | RETEST PASSED (automated only) | Canonical and ACL regressions; not live acceptance |
| Research operational QA A–L | BLOCKED | Live access/DAV required; execute evidence-backed tests |
| Pulsar provisioning implementation | RETEST PASSED (automated only) | Real-source preservation regression; live run not started |
| Actual Pulsar project/synthesis acceptance | NOT STARTED (live execution blocked) | Authenticated project inspection and provisioning required |
| LMS real-course acceptance | BLOCKED | Existing design; live learner/instructor/mobile retest required |
| Daily reporting implementation | IN PROGRESS | Confirm/Edit/Cancel and provenance regressions; live QA pending |
| Daily Telegram/platform acceptance | BLOCKED | Connected real channel/provider and account required |
| Topic preparation | DONE (per existing approved state) | Prepared content retained |
| Topic upload + QA | WAITING ON OWNER | Sajad Template review; READY after approval; no publish |

The Team Tasks document now records these distinctions in Hossein's tab; other
tabs and existing task text are preserved. No production task was marked done.

## 19. Operational sign-off conditions

Completion requires resolving the remaining internal engineering, then validated
release/backup/restore, real Research A–L, actual Pulsar source-to-synthesis flow,
a real LMS course across both roles/mobile, and real daily Telegram/platform
confirmation/correction/replay. Attach evidence to actual task IDs before
closing them. The Platform Changelog distinguishes this candidate from a release.
The team's reliable daily use has **not** been proven by this session.
