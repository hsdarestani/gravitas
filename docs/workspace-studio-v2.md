# Workspace Studio V2

The parallel frontend uses Published Version 24, source revision `faad8dcbbd463ff45e847ed77a7c6b606d7c87f8`. Its entry point is `/workspace-v2`. The Studio is opt-in through `WORKSPACE_STUDIO_ENABLED=1` and uses the same authenticated Core membership and session as the existing Workspace.

## Coverage and evidence

| Version 24 surface | Integration and local verification | Outstanding acceptance |
| --- | --- | --- |
| Shell, Focus, Showroom, Calendar, Workload and Search | Authenticated navigation and layout comparisons. Real task records drive Focus and workload. Showroom palette, scope, size and color persist per account. Team and personal day notes persist, with administrator pinning. | Verify the team's scheduling conventions and populated edge cases. |
| Project lifecycle, ideas and project planning | Canonical project creation, owner-authored closing reports, failure, archive and reopening. Ideas retain their project ID through referral and promotion. Milestones, project updates, decisions, notes, KPIs and work reports persist. Integration tests cover canonical IDs and stale edits. | Confirm project owner transfer through the native management flow and verify referral notifications with real accounts. |
| Notebook, reports and Inbox | Personal and project notebook blocks, checklist items, linked tasks, activity and image evidence persist. Tests cover private evidence and revision conflicts. Inbox uses existing task notifications and read state. | Verify image and PDF export with representative project evidence, plus notification delivery for project-level events. |
| OKRs and work graph | Canonical objective and key result owners, numeric check-ins and project or milestone links. The graph reads live references. The source and isolated preview use different objective and task data. | Compare populated graph and roadmap states with the staging dataset. |
| Workflow authoring and templates | Canonical dependencies, canvas history, private template revisions and project creation from a selected revision. Automated cases cover a three-level project forecast, milestone dates, failed linked projects and nested review loops. | Verify dates and template previews with populated staging projects. The built-in library uses the team's current assignments when users create a project. |
| Task editing and Workflow & QA | One accountable owner, multiple contributors, private tasks, checklists, notes and prerequisites. The correction test verifies submit, request changes, replacement evidence, approval and canonical history. Newly assigned contributors, assigned reviewers and correction authors receive permission-scoped notifications via the existing outbox. | Exercise the same lifecycle with real staging team accounts and verify the team's chosen delivery channels. |
| Meetings, team and profile | Weekly occurrences, collaborative agenda updates, task follow-ups, discussion references and pinned reports. Profile fields, work areas and presets persist. Administrators can add an existing active GraviQuest account to Core. | Exercise staging team identities and recurring series edits across timezone boundaries. New account provisioning requires the existing account flow. |
| Native Nextcloud and task attachments | Existing project storage calls supply folder listings, uploads and SSO links to individual files. Studio exposes read-only snapshots for canonical files through the existing revision API. | Verify DAV round-trips, exact file-ID links, Nextcloud ACLs and both canonical and native file revisions on isolated storage. |

V2 calculates a project forecast from the canvas start and task durations. Existing committed deadlines come from the canonical task and project schedule APIs. Version history restores the canvas layout and records a backup using the current task permissions.

## Local review

Use Python 3.12 and Node.js 22 or later.

```sh
python -m pip install -r backend/requirements.txt
python scripts/workspace-studio-preview.py
```

Open `http://127.0.0.1:4173/workspace-v2`. The script prints credentials for a local fixture account. Sign in through the GraviQuest form, then reload the V2 tab. Both workspaces share the disposable test database for that process.

## Team staging

Google Public DNS and Cloudflare DNS returned no A, AAAA or CNAME record for `staging.graviquest.com`. Both resolved the production domain. The preview and health requests returned an Envoy upstream connection failure. These observations establish a public DNS blocker. The state of any intended origin or proxy upstream remains unknown until the infrastructure owner identifies it and grants access. The repository's deployment job targets production.

### Provision the staging origin

1. Identify the approved existing staging origin and grant a staging deployment identity or runner permission to install the draft branch, inspect staging proxy and application logs, and restart the staging service. Confirm capacity for the isolated database, Nextcloud service and file volumes before configuring routes.
2. Create a PostgreSQL database and login named `gravitas_workspace_staging`. Scope that login to the staging database. Provision a dedicated Nextcloud instance with its own database and volume. Assign fresh staging credentials and signing material through the host or runner secret configuration.
3. Serve `staging.graviquest.com` with a certificate and staging-specific Nginx virtual host or equivalent proxy route. Publish an A or AAAA record for the approved origin, or a CNAME for the approved ingress. Route `/api/`, `/workspace-v2` and `/django-static/` to the staging Django service, preserving the original Host and HTTPS scheme. Serve `/workspace` and its subroutes from the branch's `workspace.html`, `/login` from `account.html`, and `/assets/` from the branch. Serve Nextcloud at `https://staging.graviquest.com/nextcloud` or `https://cloud-staging.graviquest.com`.
4. Install the exact draft revision in a separate release directory. For Nginx and systemd on an existing shared host, use a dedicated service and a free loopback port such as `18000`. Give the staging service user access to `/var/lib/gravitas-workspace-staging` and its release directory. Configure only that unit with the settings below.

| Staging configuration | Required value |
| --- | --- |
| Application | `DJANGO_SETTINGS_MODULE=gravitas_backend.workspace_staging_settings` and `WORKSPACE_STUDIO_ENABLED=1` |
| PostgreSQL | `GQ_STAGING_DB_HOST` points to the local dedicated database on `127.0.0.1` or to `postgres-staging`. Set `GQ_STAGING_DB_PASSWORD` and `GQ_STAGING_DB_PORT` if the port differs from `5432`. |
| Django signing | Set a distinct `GQ_STAGING_SECRET_KEY`. Stage cookies use distinct names and the staging hostname. |
| Nextcloud | Set `GQ_STAGING_NEXTCLOUD_INTERNAL_URL`, `GQ_STAGING_NEXTCLOUD_PUBLIC_URL`, `GQ_STAGING_NEXTCLOUD_ADMIN_USER` and `GQ_STAGING_NEXTCLOUD_ADMIN_PASSWORD`. The internal service can use `nextcloud-staging` or a dedicated loopback port such as `18081`. |
| Nextcloud sign-in | Configure the isolated Nextcloud OIDC provider to use issuer `https://staging.graviquest.com/api/oidc` and client ID `gravitas-nextcloud-staging`. Set `GQ_STAGING_NEXTCLOUD_OIDC_PROVIDER_ID`, `GQ_STAGING_OIDC_CLIENT_SECRET` and `GQ_STAGING_OIDC_PRIVATE_KEY_B64`. |

Start from an empty staging environment file. The staging settings use a distinct data directory, host and database login. Verify the actual PostgreSQL grant, Nextcloud upstream and volume at the host before migrating. Create dedicated staging-only accounts for Core owner, Core member and Research-only access. Outbound email is captured in memory in this configuration.

Set `PYTHONPATH=backend` from the staging release root under the staging service environment. Run `python -m django check`, `python -m django migrate --plan`, `python -m django migrate` and `python -m django collectstatic --noinput`. Start the staging unit and confirm `GET /api/health/` returns `{"status":"ok","database":"ok"}` both on the loopback upstream with the staging Host and HTTPS headers and at the public origin. Confirm valid HTTPS on both relevant hosts, sign in, and open `/workspace-v2` and `/workspace` before sharing the preview.

If an origin already exists, use the staging virtual host's configured upstream to identify its listener and service. Check the staging unit or container status and its startup and proxy error logs. A healthy loopback backend with a failing public check points to the staging virtual host, ingress, certificate or DNS. A failing loopback backend needs its own service, configuration or database connection repaired before publishing.

### QA record

| Iteration | Evidence and outcome |
| --- | --- |
| QA 001 | Fixed missing task priority defaults and empty approval-state normalization after the first local integration pass. |
| QA 002 | Authenticated Chromium verified checklist, threaded notes and workflow installation. Focus and Flowchart were captured at six widths in both themes. Integration tests covered private and cross-scope access, CSRF, dependency cycles, stale edits and V1/V2 consistency. |
| QA 003 | Compared 34 screen and dialog cases against Version 24 in authenticated Chromium, including primary navigation, all nine project views, My Work tabs, and nine dialogs. Both themes ran at 360, 390, 768, 1024, 1440 and 1920 pixels. Captures compare responsive layouts using Version 24 demo data and a disposable canonical Studio fixture. Populated team records and exhaustive interaction comparisons remain open. After correcting the calendar and meeting handlers, eight browser checks passed after reload. These covered idea creation, notebook editing, milestones, calendar notes, weekly meetings, collaborative agendas, template-based project creation and named canvas versions. |
| QA 004 | Verified all 19 baseline workflows. Passed 33 targeted Django tests and three nested-schedule cases. Authenticated local Chromium verified historical template instantiation and reload. A browser check with stubbed storage verified the exact Nextcloud file-ID link and read-only history. Public DNS and deployment access block live verification. |

Project [212](https://graviquest.com/workspace/research/projects/212/tasks) contains Development task **#1167** with its four standard steps and a **Workspace V2 · Prototype parity and QA 003** milestone. Saving **Workspace V2 · Authenticated staging and human acceptance** timed out. The project dashboard required sign-in during QA 004, so check the authenticated milestone list for that exact name before creating a milestone.

### Human acceptance checklist

- [ ] Confirm team authentication and session persistence on isolated staging as Core owner, Core member and Research-only user. Check direct links, private tasks, hidden dependencies and denied attachments.
- [ ] Create a real project and a task. Edit the same task through V1 and V2 and verify the shared ID, history, permissions and concurrent edit handling. Exercise assignment, visibility, completion, failure and reopening.
- [ ] Promote an idea, post a decision request, link a milestone to an OKR and record an OKR check-in. Reopen each record in a fresh session.
- [ ] Save a template from Stages, change the source tasks and choose **Save template revision**. Preview the earlier and current versions and create a project from each. Confirm the older version still creates its original tasks and that an overlapping edit produces a revision conflict. Draw dependencies, parallel groups and nested project nodes, then save and restore a canvas version. Check review loops and calculated handoffs.
- [ ] Submit QA, request changes as the assigned reviewer, submit a new numbered iteration, approve it, and confirm Final Approval eligibility as the assigned approver. Verify notifications and the canonical QA history.
- [ ] Edit a notebook, attach an image and export the report. Create a meeting series, edit one agenda with two members, and verify discussion links and pins on the correct day.
- [ ] Upload a permitted file to staging Nextcloud, open the exact file through SSO, verify preview, matching bytes and revision, and repeat with an account that lacks access.
- [ ] Compare populated pages, menus, error states and interaction transitions at 360, 390, 768, 1024, 1440 and 1920 pixels in both themes. Review keyboard and touch flows on the team's devices.

## Release and rollback after approval

1. Identify the approved commit and capture a matched PostgreSQL and Nextcloud checkpoint using the existing release pipeline. Validate additive migrations and test rollback against a staging copy.
2. Run the required CI and authenticated staging QA. Deploy with the toggle disabled and verify V1 and existing production health indicators.
3. Enable the V2 flag through the approved runtime configuration after the team approves activation. Smoke-test authenticated access, denied access and bidirectional task changes using designated verification records.
4. Disable the flag and reload the backend to close V2 if verification fails. Use the repository's guarded rollback to revert the deployed code if necessary. Preserve additive tables and historical V1/V2 records unless a matched database/storage restore is explicitly approved.
