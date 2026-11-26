# Workspace Studio V2

The parallel frontend uses Published Version 24, source revision `faad8dcbbd463ff45e847ed77a7c6b606d7c87f8`. Its entry point is `/workspace-v2`. The Studio is opt-in through `WORKSPACE_STUDIO_ENABLED=1` and uses the same authenticated Core membership and session as the existing Workspace.

## Coverage and evidence

| Version 24 surface | Integration and local verification | Outstanding acceptance |
| --- | --- | --- |
| Shell, Focus, Showroom, Calendar, Workload and Search | Authenticated navigation and layout comparisons. Real task records drive Focus and workload. Showroom palette, scope, size and color persist per account. Team and personal day notes persist, with administrator pinning. | Verify the team's scheduling conventions and populated edge cases. |
| Project lifecycle, ideas and project planning | Canonical project creation, owner-authored closing reports, failure, archive and reopening. Ideas retain their project ID through referral and promotion. Milestones, project updates, decisions, notes, KPIs and work reports persist. Integration tests cover canonical IDs and stale edits. | Confirm project owner transfer through the native management flow and verify referral notifications with real accounts. |
| Notebook, reports and Inbox | Personal and project notebook blocks, checklist items, linked tasks, activity and image evidence persist. Tests cover private evidence and revision conflicts. Inbox uses existing task notifications and read state. | Verify image and PDF export with representative project evidence, plus notification delivery for project-level events. |
| OKRs and work graph | Canonical objective and key result owners, numeric check-ins and project or milestone links. The graph reads live references. The source and isolated preview use different objective and task data. | Compare populated graph and roadmap states with the staging dataset. |
| Workflow authoring and templates | Canonical project dependencies, canvas geometry and arrows, parallel groups, review loops, nested project handoffs and named canvas history. Templates from Version 24 instantiate new canonical tasks. Project-authored copies preserve accessible tasks and layout. | Exercise all nested scheduling combinations and template revision workflows. The original suggested demo people were omitted from the built-in library. |
| Task editing and Workflow & QA | One accountable owner, multiple contributors, private tasks and explicit members, checklists, notes, prerequisites and revision checks. Assigned part reviewers and final approvers are enforced through both API paths. | Exercise a complete staged reviewer correction cycle with real team roles, including evidence revisions, notifications and cross-workspace verification. |
| Meetings, team and profile | Weekly occurrences, collaborative agenda updates, task follow-ups, discussion references and pinned reports. Profile fields, work areas and presets persist. Administrators can add an existing active GraviQuest account to Core. | Exercise staging team identities and recurring series edits across timezone boundaries. New account provisioning requires the existing account flow. |
| Native Nextcloud and task attachments | Existing project storage calls supply live folder listings, uploads and SSO links to individual files. Local integration tests verify task attachment bytes and denied downloads. | Verify DAV round-trips, file-ID links, Nextcloud ACLs and deliverable revision history in isolated staging with actual Nextcloud access. |

V2 calculates a project forecast from the canvas start and task durations. Existing committed deadlines come from the canonical task and project schedule APIs. Version history restores the canvas layout and records a backup using the current task permissions.

## Local review

Use Python 3.12 and Node.js 22 or later.

```sh
python -m pip install -r backend/requirements.txt
python scripts/workspace-studio-preview.py
```

Open `http://127.0.0.1:4173/workspace-v2`. The script prints credentials for a local fixture account. Sign in through the GraviQuest form, then reload the V2 tab. Both workspaces share the disposable test database for that process.

Team staging requires a reachable staging origin, an isolated PostgreSQL database and project storage, and team sign-in. Both `/workspace-v2` and `/api/health/` on `staging.graviquest.com` returned HTTP 503 with an upstream connection failure before response headers. The available repository deployment job targets production. Staging infrastructure access is required to identify and restore the upstream and verify an authenticated team URL.

### QA record

| Iteration | Evidence and outcome |
| --- | --- |
| QA 001 | Fixed missing task priority defaults and empty approval-state normalization after the first local integration pass. |
| QA 002 | Authenticated Chromium verified checklist, threaded notes and workflow installation. Focus and Flowchart were captured at six widths in both themes. Integration tests covered private and cross-scope access, CSRF, dependency cycles, stale edits and V1/V2 consistency. |
| QA 003 | Compared 34 screen and dialog cases against Version 24 in authenticated Chromium, including primary navigation, all nine project views, My Work tabs, and nine dialogs. Both themes ran at 360, 390, 768, 1024, 1440 and 1920 pixels. Captures compare responsive layouts using Version 24 demo data and a disposable canonical Studio fixture. Populated team records and exhaustive interaction comparisons remain open. After correcting the calendar and meeting handlers, eight browser checks passed after reload. These covered idea creation, notebook editing, milestones, calendar notes, weekly meetings, collaborative agendas, template-based project creation and named canvas versions. |

Project [212](https://graviquest.com/workspace/research/projects/212/tasks) contains Development task **#1167** with its four standard steps and a **Workspace V2 · Prototype parity and QA 003** milestone. The staging and human acceptance milestone submission timed out and lacks a verified saved record.

### Human acceptance checklist

- [ ] Confirm team authentication and session persistence on isolated staging as Core owner, Core member and Research-only user. Check direct links, private tasks, hidden dependencies and denied attachments.
- [ ] Create a real project and a task. Edit the same task through V1 and V2 and verify the shared ID, history, permissions and concurrent edit handling. Exercise assignment, visibility, completion, failure and reopening.
- [ ] Promote an idea, post a decision request, link a milestone to an OKR and record an OKR check-in. Reopen each record in a fresh session.
- [ ] Create a template from a workflow, instantiate it, draw dependencies, parallel groups and nested project nodes, then save and restore a canvas version. Check review loops and calculated handoffs.
- [ ] Submit QA, request changes as the assigned reviewer, submit a new numbered iteration, approve it, and confirm Final Approval eligibility as the assigned approver. Verify notifications and the canonical QA history.
- [ ] Edit a notebook, attach an image and export the report. Create a meeting series, edit one agenda with two members, and verify discussion links and pins on the correct day.
- [ ] Upload a permitted file to staging Nextcloud, open the exact file through SSO, verify preview, matching bytes and revision, and repeat with an account that lacks access.
- [ ] Compare populated pages, menus, error states and interaction transitions at 360, 390, 768, 1024, 1440 and 1920 pixels in both themes. Review keyboard and touch flows on the team's devices.

## Release and rollback after approval

1. Identify the approved commit and capture a matched PostgreSQL and Nextcloud checkpoint using the existing release pipeline. Validate additive migrations and test rollback against a staging copy.
2. Run the required CI and authenticated staging QA. Deploy with the toggle disabled and verify V1 and existing production health indicators.
3. Enable the V2 flag through the approved runtime configuration after the team approves activation. Smoke-test authenticated access, denied access and bidirectional task changes using designated verification records.
4. Disable the flag and reload the backend to close V2 if verification fails. Use the repository's guarded rollback to revert the deployed code if necessary. Preserve additive tables and historical V1/V2 records unless a matched database/storage restore is explicitly approved.
