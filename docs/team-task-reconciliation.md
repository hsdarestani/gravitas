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
artifacts without explicit authorization. The repository now contains a
branch-only evidence workflow authorized by the user on 2026-10-15; its
artifact retention is one day. It performs no production data mutations.

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
4. Apply migrations 0066/0067 before import. Tasks now have an actual parent,
   immutable unique source_key and source_metadata retaining activity dates,
   original statuses and source references. Source-backed historical work can
   retain a KR link without an invented deadline. Canonical task schema v2
   preserves owner, dependency, parent and provenance; v1 reads preserve these
   previously unrepresented fields. Dependencies remain separate from nesting.
5. Use unique stable source IDs, reviewed destination IDs, version guards,
   audit snapshots and reversible operations. Never delete existing tasks.
6. Test the upgrade and importer on a controlled branch, validate deployment,
   then re-read live Core, Research, Nextcloud and ordinary-member permissions.

No source-document contents or production snapshots are committed with this
tool. No migration is claimed complete by adding an exporter.

## Reviewed import command

`migrate_source_tasks PLAN.json` validates without writes. Applying requires
`--apply --expected-plan-sha SHA --audit-output PRIVATE_NEW_FILE`; the SHA is
from validation. The private audit file is reserved with mode 0600 and a
before-state is fsynced before writes. Each apply uses the canonical durable
journal and a DB transaction. A Core workspace row lock serializes imports;
the plan is revalidated after locking and after canonical refresh. Existing
titles, status, due dates, owner and descriptions are retained; only missing
project/parent relationships and source provenance are added. Conflicting
relationships, stale versions and ambiguous identical titles fail closed.
Replaying the same source keys is a no-op. Prefer small, sequential batches.

An explicit project `adopt_canonical` flag uses the existing project-specific
backup, readback and ACL validation path. Global adoption stays disabled. Do
not mark this flag for a project that has not been reviewed. The source plan
and production audit stay outside the repository.

Rollback is a reviewed inverse plan based on the private before/after audit:
check current updated_at against the recorded after-state, archive created
tasks and projects rather than deleting them, and restore only relationships
added by this run. Preserve source provenance and newer changes. Stop for
review if a record has changed since import; never force a canonical ETag.
