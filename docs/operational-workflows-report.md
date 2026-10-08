# Gravitas operational workflows: consolidated delivery and acceptance report

## 1. Outcome

The engineering release is deployed. Full operational acceptance remains open.
Topic is deliberately blocked until Sajad approves the existing template; Video
execution waits for Ahmad's reusable Skill while its approved design is DONE.
Course publication requires explicit approval after automatic review rejected
immediate publication. Unverified acceptance is not represented as completion.

## 2. Changes and integration

PRs [150](https://github.com/hsdarestani/gravitas/pull/150),
[151](https://github.com/hsdarestani/gravitas/pull/151),
[152](https://github.com/hsdarestani/gravitas/pull/152),
[153](https://github.com/hsdarestani/gravitas/pull/153), and
[154](https://github.com/hsdarestani/gravitas/pull/154),
[155](https://github.com/hsdarestani/gravitas/pull/155), and
[156](https://github.com/hsdarestani/gravitas/pull/156) are merged.
They implement confirmed daily reporting, typed canonical file projections,
conditional conflict handling, recoverable content/ACL writes, native checkpoint
and restore rehearsal, real Pulsar source provisioning, client cache correction,
and selected-project live acceptance. The latest acceptance run is still being
verified; a merge or successful automated test is not its result.

## 3. Research architecture

Existing Django models, native ES modules and platform permission checks remain.
For adopted projects Nextcloud is the authoritative content store; database
objects are typed projections and revision caches. Identity, relationships,
memberships and permission policy remain server controlled. Other projects
retain their prior contract. Global HTTP adoption is disabled.

## 4. Canonical structure

Stable `GRV-<project ID>` Team Folders retain the six existing directories.
`project.md` contains project title metadata and editable Markdown. Typed notes,
sources, attachment/dataset metadata, tasks, discussions, outputs, annotations,
maps/nodes/edges, activity and business metadata live under `02_Working/Research`.
Existing binary paths remain. Migration snapshots and transaction journals are
private under `06_Archive`; user file archival uses `06_Archive/UserTrash`.

## 5. Synchronization

Supported existing typed files refresh at relevant API boundaries and project
context retrieval. Platform writes export to the same files. Caller DAV identity
is used for browsing, arbitrary file operations and downloads. Missing external
files produce explicit conflicts rather than silent recreation. There is no
background watcher or automatic promotion of arbitrary new files into typed
objects; those are explicit limitations of this implementation.

## 6. Revisions and recovery

Creates use `If-None-Match`; updates use exact ETags. Conservative three-way
merge combines disjoint text/field edits; overlaps expose base/local/remote
versions for keep mine, keep remote or manual resolution. A private durable
journal and database commit witness cover PUT, DELETE and ACL changes. Rollback
restores conditionally; external changes or ambiguous writes require review.
Nested transactions finalize after the outer commit. Hard project deletion is
blocked in favor of archival. Private folders retain explicit service access;
root ACL ETags are refreshed after descendant journal writes only if observed
permissions still match.

## 7. Pulsar context

Context includes permitted notes/sources, tasks with priority/due/dependency,
team, research question, discussions, outputs, maps and readable activity.
Restricted child content is filtered before synthesis; raw audit payloads are
excluded. Provider synthesis and native revocation remain live acceptance
checks. A browser answer saying no model is configured has been observed; that
message alone does not establish the server's actual provider configuration.

## 8. Telegram reporting

Telegram and platform use the same proposal/decision service. Confirm/Edit/Cancel
is mandatory; AI interpretation cannot apply task changes. Ambiguous work stays
unmatched until explicitly mapped. Stable webhook keys, ownership, ACL, task
revisions and dependency checks prevent repeated/stale effects. Original input,
proposal history, confirmer, corrections and task activity retain provenance.
Daily check-ins use the existing outbox. The selected acceptance operation sends
one check-in only to the already linked owner. Delivery and an actual human
reply/confirmation are separate evidence; no reply is fabricated.

## 9. Daily task management

The view exposes own active tasks, priority, due date, objective/KR, dependency,
blocker, latest confirmed progress, next action and artifact. Date-only deadlines
now display correctly in both the daily view and side panel. Managers see current
member reports and permitted blockers/stale tasks. Ready, Active, Waiting,
Needs review, Retest, Blocked and Done are supported.

## 10. Actual Pulsar project

Private **Pulsar Development Project 208** was created through the signed-in UI.
Production provisioning imported five actual repository source notes and one
architecture map linked to real source objects. Existing IDs and human edits
were preserved; repeat provisioning is idempotent. The five notes were also
verified in the live project UI. Native canonical adoption/acceptance runs only
against this selected project after a fresh matched checkpoint and rehearsal.
It does not invent research results or mark the parent task complete.

## 11. LMS acceptance

Existing design was preserved. The actual Introduction to AI workflows course
and lesson open and navigate. Note, highlight, reminder and personal task persist
after reload; task completion works. Course progress is correctly 33% with two
assessments outstanding; course completion is not claimed. Instructor draft save,
learner preview and schedule storage work. The test schedule was returned to
Draft and verified with an empty scheduled time. Immediate publication was
rejected by automatic approval review and was not performed. Assessment,
completion/certificate, cross-role and mobile acceptance remain open.

## 12. Topic

Content preparation is DONE. The existing task is BLOCKED and records the exact
Sajad template dependency. Upload and structure/access/navigation QA become
READY after explicit approval. No Topic content was uploaded or published.
The selected reconciliation binds a separate review task to the verified Sajad.

## 13. Video

Approved design/documentation is DONE. Evidence: Gravitas Video Production
Workflow Chart.png, including **Final QA ↔ Revision T19–T26**. Its checklist is
checked complete. A separate real reusable Claude Skill task is assigned to
Ahmad; the original composite task explicitly depends on it. That parent is not
DONE because the real Research production/revision cycle remains pending.
Selected reconciliation changes the parent to Waiting and aligns Skill priority.
Live Deck synchronization exposed a legacy fallback that changed richer states
to Draft. PR156 adds dedicated lanes and preserves richer states during legacy
Backlog metadata edits; its live deployment is in progress.

## 14. Backup, migration and deployment

Production run **37703424399** passed the full matched native checkpoint,
isolated restore rehearsal, deployment, migrations 0060–0062, selected source
provisioning and public health checks. Follow-up release of PR153 also passed.
Backup covers both PostgreSQL databases, site/backend/configuration, media and
the complete native Nextcloud volume. Rehearsal restores isolated databases and
private file trees and compares contents, duplicate multiplicity, IDs and ACL
metadata. Full restore captures a safety checkpoint, stages both databases and
all files before exchange, retains prior state and validates before resuming.
Interrupted restoration stays paused for recorded safety recovery. Global
canonical adoption remains false; selected adoption is separately gated.

## 15. Automated verification

PR153 passed **618 backend tests**, plus **9 checkpoint checks**, including the
exact SQL against PostgreSQL16. PR154 adds selected-plan preservation/replay,
external edit/conflict flow, task dependency reconciliation and owner-only
check-in regressions; the follow-up native-ceiling repair passes the complete local suite of **629 tests**. Its live rerun is still required.
Changed JavaScript syntax, workflow YAML, migration drift and inspection-only
commands pass. DAV unit fixtures simulate Nextcloud and are not live native
acceptance. The checkpoint rehearsal itself ran on the real server.

## 16. Live acceptance evidence

| Area | Verified | Still open |
| --- | --- | --- |
| A Project | Actual private project208; reload | Canonical root owner access |
| B Markdown | Editor/conflict automated regressions | Native/browser save and resolution |
| C Attachments | Conditional file API implemented | Real upload/download/reload |
| D Notes | Five actual source notes visible | Full native projection/editor cycle |
| E Tasks | Video checklist/Skill dependency and blocked Topic saved | Project-linked Research execution/history |
| F Sources | Actual repository materials and source provenance imported | Source-to-synthesis flow |
| G Maps | Linked source architecture map provisioned | Browser edit/drag/delete/reload |
| H Data room | Private boundary implemented | Invites/revocation/allowed downloads |
| I Personal | Real private owner project | Native isolation acceptance |
| J Shared | Permission regressions | Live multi-user collaboration |
| K Concurrent | Merge/recovery regressions | Selected native two-request conflict run |
| L External | Supported typed refresh implemented | Selected owner DAV edit/projection run |

The selected server integration results must be recorded after the real run;
they will not substitute for remaining browser/mobile evidence.

## 17. Live daily report and remaining issues

A real natural-language platform report was created; no task changed before
confirmation. The ambiguous Research mapping was corrected explicitly and the
revised proposal saved. Initial confirmation failed at the browser connection;
read-only production inventory proved it remained Pending. After the release,
confirmation succeeded visibly: **Report confirmed**, immutable history, and
latest progress/next action on the two related tasks. Manager overview renders.

Observed issues: project file listing returns native HTTP404; a Pulsar question
inside LMS falls back to a message claiming no language model. These are being
diagnosed rather than counted as external acceptance passes. Browser connection
failures were intermittent and do not establish an origin outage. Native backup
intentionally pauses writers; a read-only inspection raced that pause and passed
on rerun after deployment.

## 18. Task reconciliation and documents

| Work | Actual status / next step |
| --- | --- |
| Video design | DONE checklist; preserve approved T19–T26 |
| Ahmad reusable Skill | Separate assigned task; pending owner execution |
| Video real cycle | Pending Skill; retain composite execution task |
| Research/Pulsar acceptance | In progress; actual project/source evidence exists |
| LMS implementation/design | Preserved; retest not falsely completed |
| LMS immediate publishing | Needs explicit approval after automatic rejection |
| Topic preparation | DONE; content retained |
| Sajad review / Topic upload | Review pending; upload blocked until approval |
| Platform daily reporting | Actual proposal/edit/confirm and displayed progress verified |
| Telegram end to end | Real delivery and human reply/decision still to verify |

Team Tasks Hossein reconciliation and Platform Changelog were updated natively.
Other four task tabs and existing changelog date chips were verified preserved.
Final task closure requires corresponding acceptance evidence, not code merge.

## 19. Sign-off

The team-ready outcome is not yet fully certified. Complete the remaining
native/browser Research checks, actual provider synthesis, role/mobile LMS and
Telegram human confirmation. Approve the concrete course publication before
its final live publish test; automatic review rejected that action and it must
not be bypassed. Ahmad's Skill and Sajad's review remain genuine owner steps.
All independent engineering and acceptance work should continue before asking
for the final required approval.

Native acceptance update: run 37707274517 passed a fresh matched backup and isolated restore, then failed HTTP403 while creating the private journal. Adoption did not commit. The native group ceiling capped ACL allows; the follow-up repair preserves the read-only project group, verifies exclusive service membership, and grants an editor ceiling only after root ACL readback. Live rerun remains pending.

Second selected native run 37709508780 failed closed before adoption committed: Nextcloud represents a new folder with no direct ACL rules as a 404 property. The follow-up accepts that empty ACL only with positive group-folder identity, enabled ACL, ACL-manager entitlement and a current ETag; missing, denied or unsupported snapshots still fail closed. The complete local suite passes 629 tests. This repair still needs its live rerun.
