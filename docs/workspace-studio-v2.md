# Workspace Studio V2

The parallel frontend uses Published Version 24, source revision `faad8dcbbd463ff45e847ed77a7c6b606d7c87f8`. Its entry point is `/workspace-v2`. The Studio is opt-in through `WORKSPACE_STUDIO_ENABLED=1` and uses the same authenticated Core membership and session as the existing Workspace.

## Coverage

| Prototype surface | Integrated behavior | Remaining acceptance work |
| --- | --- | --- |
| Shell, navigation, themes and search | Original HTML structure, styles, SVGs, fonts, responsive navigation and search. A hash route can reopen an authorized project or task. | Compare individual dialogs and edge cases across themes and viewport sizes. |
| My Work, Focus, Tasks, personal calendar, Showroom and workload | Uses canonical task owners, dates, statuses, dependencies and permissions. Views share the same task IDs. | Verify planned workload against the team's scheduling conventions. Contributor assignments and saved Showroom preferences need integration. |
| Inbox and Daily Log | Reads canonical task notifications, persists read state, and displays the member's confirmed work reports. | Wire notebook editing, imported activity, report media, calendar notes and pinning. |
| Meetings, Calendar and Archive | Reads canonical meetings. Creates, edits and completes single meetings. Links task follow-ups through the existing task relation. Archive lists projects, meetings and tasks. | Weekly meeting series, collaborative agenda, pinning and discussion links. |
| Work areas, projects, graph, OKRs and administration | Reads Core processes and accessible projects, canonical objective metrics, milestones, and team membership. | Project creation and lifecycle, ideas and promotion, project notes/reports/KPIs, OKR check-ins and links, and team/profile editing. |
| Flowchart, Stages and Board | Reads canonical tasks and their dependencies. Updates task status. Saves layout, rectangles, visual arrows, parallel groups and a project planning start against the original project. | Nested project nodes, version history for canvas layouts, authoring project-level templates, and review loop controls. |
| Task details and canonical workflows | Creates and edits tasks, checks items, shares threaded notes, uploads task attachments, blocks, archives and restores. Workflow templates attach to an existing task. QA uses canonical numbered iterations, revisions and final approval gates. | Validate native Nextcloud file previews and deliverable revisions. Expand role assignments and individual QA acceptance criteria. |

V2 shows a project forecast from the selected layout start and task durations. Existing scheduled dates come from the canonical task and project schedule APIs. The forecast does not overwrite existing task deadlines. Project layout is presentation metadata linked to the canonical project, and permissions remain server-side.

## Review gate

To reproduce the local authenticated preview, use Python 3.12 and Node.js 22 or later.

```sh
python -m pip install -r backend/requirements.txt
python scripts/workspace-studio-preview.py
```

Open `http://127.0.0.1:4173/workspace-v2`. The script prints credentials for a local fixture account. Use the GraviQuest sign-in form, then reload the V2 tab. Both workspaces share the disposable database for the duration of the process.

A team-accessible preview requires an isolated staging backend with real team authentication and a staging database. The repository's available deployment workflow targets production.

### QA record

| Iteration | Evidence and findings | Corrections and review state |
| --- | --- | --- |
| QA 001 | Source baseline captures and first local integration pass. Task creation failed without a default priority. The browser QA panel failed when the existing API returned an empty approval object. | Defaulted missing create fields and normalized the approval state. Iteration superseded by QA 002. |
| QA 002 | Authenticated local Chromium exercised persistent checklist edits, threaded notes and workflow installation. Focus and Flowchart were captured at six widths in both themes. API tests cover private and cross-scope access, CSRF, dependency cycles, stale edits and V1/V2 consistency. | Use the PR checks and screenshot package for automated evidence. Team-accessible staging and human verification are pending. |

### Human QA checklist

- Compare Focus, Showroom, projects, task details, templates, calendars, navigation, admin and empty/error states at 360, 390, 768, 1024, 1440 and 1920 pixels in each theme.
- Sign in as a Core owner, Core member and Research-only user. Verify denied URLs, workspace scope, private tasks, private prerequisites and attachment ACLs after identity changes.
- Create and assign a task in V2, edit it in V1 and reload V2. Check status, stable ID, comments, checklist and audit history. Exercise two editors and repeat a create request.
- Draw parallel stages and connect more than one prerequisite. Verify readiness, cycle rejection, dates and drag persistence. Check ordinary and archived work.
- Submit QA 001, request corrections as a second user, submit QA 002, approve it, and use Final approval. Verify the task and QA history in V1.
- Confirm production storage and notifications in staging with the team's approved test records. Resolve the remaining coverage rows before requesting Final Approval.

## Release and rollback after approval

1. Identify the approved commit and capture a matched PostgreSQL and Nextcloud checkpoint using the existing release pipeline. Validate additive migrations and test rollback against a staging copy.
2. Run the required CI and authenticated staging QA. Deploy with the toggle disabled and verify V1 and existing production health indicators.
3. Enable the V2 flag through the approved runtime configuration after the team approves activation. Smoke-test authenticated access, denied access and bidirectional task changes using designated verification records.
4. Disable the flag and reload the backend to close V2 if verification fails. Use the repository's guarded rollback to revert the deployed code if necessary. Preserve additive tables and historical V1/V2 records unless a matched database/storage restore is explicitly approved.
