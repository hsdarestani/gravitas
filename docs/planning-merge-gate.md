# Core Planning + task/project merge gate

The Planning dashboard displays both task execution and measured KR delivery.
It does **not** convert a completion ratio into the value of a KR.

## Planning fields and semantics

- Objective and KR ordering is a stable integer position, backfilled once.
- KR moves change only \`objective_id\` within the same authorized Core workspace.
  Existing Initiative, Milestone, Task, TaskComment and ActivityEvent IDs remain.
- Deleting a nonempty Objective or KR returns a conflict. Archive preserves work.
- KR tasks are aggregated via \`OperatingTask.initiative.key_result\` in one
  grouped query, independently of comments, attachments and checklist joins.
  A task linked to an archived or unmeasured KR is not proof of its completion.
- A KR progress percentage comes from \`(current - baseline)/(target - baseline)\`
  when both target and current are present. Empty targets remain unmeasured.
- Expected progress is **linear**, clamped to 0–100%, between Objective start
  (or its creation date when no start is supplied) and KR/Objective due date.
  Difference in percentage points is \`actual - expected\`; a >5-point absolute
  difference is treated as ahead/behind. Estimated day offset is
  \`variance * date_span / 100\`. It is an estimate, not a burndown,
  actual finish-date calculation or management approval.
- Reordering is non-destructive; the UI patches \`sort_order\` with gapped integer
  ranks. It does not rewrite IDs or touch canonical files.

## Audit task/project duplicates without writes

Run inside an authorized production administration session, with a private
absolute output path that does not exist yet. Do not commit the report, print
its content in public CI, or put it in a public GitHub Actions artifact.

\`\`\`sh
cd /opt/gravitas-backend
.venv/bin/python manage.py audit_work_graph \
  --workspace-id CORE_ID \
  --output /private/secure/new-work-graph-audit.json
\`\`\`

The report is generated from the live Core database projection in a
repeatable-read read-only PostgreSQL transaction, creates its output with
mode 0600 and refuses overwriting an existing file. It includes:
- Counts by task status and links to projects/KRs.
- Exact normalized task-title collisions within owner+project and near-title
  pairs for manual review. Similar titles from different owners/projects are
  **not** automatically merged.
- Candidate projects with identical normalized titles within Research scope.
- Per-task counts for Core ActivityEvent, board comments, attachments,
  checklist items and linked daily work reports.
- Canonical-project flags, canonical-file projection counts, and note counts.

It **does not** read canonical Nextcloud documents and does not move records.
Before any true merge, follow \`docs/team-task-reconciliation.md\` and:
1. Back up database and canonical DAV content; verify file readback and ACLs.
2. Review every old/new ID, owner, due date, report, comment, attachment,
   activity event, parent/dependency, project membership, note and canonical
   file. Never infer duplicates from titles alone.
3. Produce an explicit source ID -> retained ID plan and audit manifest.
   Keep alias/provenance mapping and immutable source timestamps; no cascade
   deletes, no fake due dates, no overwritten canonical ETags.
4. Perform only reversible transactional batches with before-state evidence,
   optimistic version guards, idempotency and permission checks.
5. After each batch verify task history, DailyWorkReport M2M links, canonical
   DAV parity, project-scoped visibility, task board and Planning counts.
6. Test both slow mobile and server paths, including 400/403/409 responses
   for invalid requests and a rollback when upstream Nextcloud is unavailable.

A passing CI result checks only disposable test records and source validity.
It does not prove absence of all possible production 500/502/504 errors.
