# Team task reconciliation: read-only evidence first

The existing `export_open_tasks` command omits Done and Archived records and
project relationships needed for semantic reconciliation. The optional mode
below includes those records without changing the existing default output:

```sh
python -m django export_open_tasks --reconciliation > /private/path/task-reconciliation.json
```

Run only in an authorized server session. Output contains non-public team
task descriptions, comments and project context. Keep it in an authorized
private destination; do not publish it in repository files, CI logs or public
artifacts. This change adds no workflow, remote execution, data import or
production deployment.

The mode requires exactly one canonical Core workspace; use `--workspace-id`
to select one if multiple exist. It reads all statuses from that Core and
team-associated projects in the same organization's shared Research workspace.
Personal workspace content and projects from other organizations are excluded.
It includes original task IDs, owner IDs, statuses, dates, checklist states,
comments, source context, project membership, strategy links, note titles and
canonical-file metadata. It excludes note bodies, arbitrary note metadata,
account email addresses, credentials and time records.

On PostgreSQL it uses a repeatable-read, read-only transaction. No workspace
provisioning, Nextcloud adoption, DAV writes or synchronization are invoked.
The result is a database projection snapshot; the output explicitly says that
canonical DAV readback is still required before project mutations. Do not
treat an old artifact or a DB projection as evidence of current file parity.

## Subsequent migration gate

1. Obtain current evidence through an authorized private route, then match by
   meaning, ownership, project, deliverable, dates, history and source links.
2. Resolve uncertain matches and repeated historical records before writes.
   Similar titles from different contributors are not duplicates by default.
3. Preserve reported Done separately from production acceptance. Activity dates
   and reported hours must never become due dates or verified time entries.
4. Current OperatingTask has no parent relationship; checklist items cannot
   represent individual multi-state statuses or activity dates. Canonical v1
   task files omit owner and dependency. Implement and validate a compatible
   schema upgrade before any import that needs those attributes; do not use a
   lossy checkbox representation or bypass the canonical API's 409 guard.
5. Use unique stable source IDs, reviewed destination IDs, version guards,
   audit snapshots and reversible operations. Never delete existing tasks.
6. Test the upgrade and importer on a controlled branch, validate deployment,
   then re-read live Core, Research, Nextcloud and ordinary-member permissions.

No source-document contents or production snapshots are committed with this
tool. No migration is claimed complete by adding an exporter.
