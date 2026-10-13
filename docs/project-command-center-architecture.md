# GraviQuest Project Command Center and Pulsar

Date: 2026-10-13
Status: incremental implementation on feature branch; production acceptance pending.
Reference: Sajjad's Zim PM Overview screenshots, not a copied data model.

## Product contract

Project and task content is **file first**. Adopted Research projects use native
Nextcloud Team Folder files: `project.md` and typed text files under
`02_Working/Research/`. CanonicalFile and revisions in PostgreSQL are
projections, ACL metadata and conflict/merge caches, **not** a second writable
source. The existing DAV ETag, native file-id, write-ahead journal, transaction
witness and guarded recovery must remain operational. Never silently switch to
stale database content when a canonical read or recovery fails.

Each OperatingTask is the **same object** whether visited via Research,
Core, Kanban, deadlines or Pulsar. New visual representations must not create a
separate duplicate task registry. Some task attributes are currently projected
through Core and have not all been moved into the versioned text contract; see
the migration work below.

## Inventory mapped to the Zim reference

| Zim view/capability | GraviQuest implementation state |
| --- | --- |
| Project gallery / portfolio KPIs | Existing Research/Cockpit; cross-project team portfolio requires scoped aggregation |
| Nested task list and subtasks | Existing tasks and checklists; richer hierarchy needs canonical schema |
| Kanban | New Command center board is read/write via existing task object, without drag/drop yet |
| Search, status/owner filters | New Command center basic filters; saveable multi-facet filters pending |
| Project task details | New scoped update endpoint: status, priority, owner, due date, blocker, dependencies |
| Timeline / Gantt | New **deadline timeline**, NOT duration Gantt; start/duration/dependency drag pending |
| Week planner | New seven-day due-date planner; time-block scheduling not implemented |
| Team load / attention | New member grouping and overdue/blocked counts |
| Time tracking / work logs | Existing daily work reports are distinct; per-task stopwatch and approved time log pending |
| Milestones / dependencies | Existing typed relationships; dependency editing supported in scoped API |
| Nextcloud & Markdown editor | Existing canonical project-file UI, DAV concurrency controls, explicit adoption |
| AI project assistant | New project-scoped Pulsar panel using the established agent runtime and approval flow |
| Calendar sync, urgent-important, budget, balance, reviews | Planned, require explicit schema and acceptance tests |

## Pulsar boundary

Pulsar receives `surface=projects`, `skill=project_task`, `metadata.project_id`
and a stable project-specific thread key. Permission checks occur on the server
for the user, project, task and every source. The runtime currently limits
project context and should progressively retrieve ACL-verified files and task
summaries rather than concatenate entire team corpora into prompts.

Summaries must cite actual project/task sources. Write operations require the
existing ActionPolicy approval checks, explicit action preview, and canonical
journal commits. Never grant Pulsar broader permissions than its invoking user.

## Production blocker, Project 208

At 2026-10-13T14:52Z the selected operational acceptance workflow failed while
calling `adopt_project(208)` -> `refresh_project` -> `recover_journal`.
It raised `canonical_recovery_review_required` for batch
`8f5cea56-3c4e-4365-a8ad-2d0106d063f5`.
The browser error `canonical_storage_unavailable` may be the surface-level
result of that failure. Do **not** delete the journal, force an ETag, or bypass
the middleware; that could overwrite a legitimate Nextcloud edit.

First run the **read-only** inspection command on the production backend:
`python manage.py recover_canonical_transaction 208 8f5cea56-3c4e-4365-a8ad-2d0106d063f5`
Check the private native journal, every affected file's content/identity and
DB commit witness. Exact *original bytes plus the same native file ID* after an
ETag-only ACL rebase can be safely treated as already restored (covered by a
regression test). Any different content/identity requires human reconciliation.
Use `--apply` only for a journal proven safe, after fresh backup, and validate
the target's Nextcloud, project.md, ACL and editor read/write with two users.

## Remaining delivery work (not completed by this branch)

1. Freeze canonical task schema including owner, parent/subtask, start/end,
   planned minutes, tracked minutes, work-log entries, dependencies, milestones,
   categories and task IDs. Version it, migrate existing adopted files with
   readback/backups and preserve external Nextcloud edits. No double writes.
2. Implement real Gantt (bar editing, milestone grouping, dependencies),
   calendar time-block planning and weekly planner with date/time zones.
3. Persist approved per-task time sessions, budget vs actual, daily work log
   reconciliation, weekly review, blockers, and portfolio analytics.
4. Team dashboard showing member load and schedule with project ACLs; build
   full Zim-style multi-facet filters and stored filters.
5. Expand Pulsar retrieval beyond 20 open tasks using paginated, ACL-aware
   structured search/hybrid retrieval over canonical files and work logs.
6. Agent read, draft and mutation tool contracts with confirmation,
   idempotency, conflict surfacing, undo/audit and evaluation suites.
7. Nextcloud native DAV edits + platform UI + Pulsar three-way concurrency
   acceptance; load tests, failed jobs and production deployment/recovery.
8. Research/Pulsar project sync with existing
   `setup_pulsar_research_project` command, after actor/project verification.

No "fully released" claim should be made until production acceptance passes.
