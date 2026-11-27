# GraviQuest — Staging Feature Parity

This matrix covers the active online preview and the draft implementation. **Live** means a working staging path was exercised. **Reachable** means an HTTP or access check only. **Automated** identifies local or CI validation. **Mocked** identifies a test double. **Blocked** identifies an absent staging provider, route, or approval.

## Public platform

| Feature | Current evidence | Staging acceptance path |
| --- | --- | --- |
| Homepage, public navigation and responsive layout | **Automated**. Candidate Nginx routes and explicit frontend allowlist. The active staging root goes to Workspace V2. | After the slot switch, open `/` and check all public navigation and test writes at 390, 768 and 1440 pixels. Verify no external production destinations are opened. |
| Topics and reading levels | **Reachable / Automated**. Public Django content/essay routes can be probed; stage page remains pending. | Open `/topics` and `/topic-answer-that-looked-right`, switch all reading levels, then review polling, search and save behavior. |
| CMS publication | **Automated**. Existing CMS tests and a guarded repeatable draft fixture. | Core admin creates a synthetic Topic draft in Site Content, edits it, publishes and checks the anonymous stage page. Member access to editor endpoints must fail. |
| Essay Version History, compare and restore | **Automated**. Existing Topic/Essay tests; active staging browser and native source publication remain unverified. | Use stage-only Markdown files in a synthetic project. Publish two revisions of a designated stage essay slot, compare, open exact source file, restore and verify public contents plus the retained history. Protect existing QA publication records. |
| Survey and prelaunch feedback | **Automated**. Backend acceptance and draft public route. | Use `/prelaunch-feedback`; submit a synthetic response and check Core Admin analytics and controlled CSV access. Confirm response visibility by role. |
| Newsletter, public search and responsive accessibility | **Automated**. Candidate public routes and isolated email capture. | Submit a synthetic address, verify the staging database and captured delivery, then check public search against staging content and test mobile navigation. |

## Internal platform

| Feature | Current evidence | Staging acceptance path |
| --- | --- | --- |
| Core authentication, roles and SSO | **Live**. Named-owner login, host-scoped session, allowed and denied users, Nextcloud SSO. | Use [login](https://staging.graviquest.com/login) and a separate browser profile for each staging role. Verify denied access persists on direct URLs. |
| Workspace V1 and V2, canonical tasks/projects and contributor notifications | **Live**. Live staging API and browser checks for canonical task edits, notification deduplication, nested project handoffs, project creation and automatic Team Folders. | [Workspace V1](https://staging.graviquest.com/workspace) · [Workspace V2](https://staging.graviquest.com/workspace-v2). Create one synthetic task and verify edit persistence and history in both directions. Review the remaining Version 24 visual parity against PR #406. |
| Core Administration and team management | **Live / Automated**. Core Team access verified. Direct V2 accounts passed browser tests against disposable Django fixtures in PR #410. | [Core Team](https://staging.graviquest.com/workspace/core/team) supports current QA. Retest direct V2 account activation and reset after its candidate is staged. |
| Research Workspace and permission boundaries | **Live for access control**. Research-only role accepted for its area and denied V2 and private attachments. | In staging Research, create a synthetic project and verify viewer/editor distinctions and file access. Broad UI acceptance is pending. |
| Scheduling and workflows, templates, QA corrections and Final Approval | **Live for tested paths**. Template revision persistence, nested scheduling, assigned reviewers and correction loop passed. | Execute a synthetic workflow with separate submitter and reviewer identities. Verify approval history and a denied unassigned reviewer. Human release signoff is separate and remains open. |
| OKRs, roadmap, meetings and reporting | **Automated or partial**. Backend and V2 checks exist. Full active staging browser verification is pending. | Create synthetic check-ins, project links, one recurring meeting and report. Verify access, reload persistence, archive and history in a separate browser session. |
| Internal notifications, reports and analytics | **Live for in-app deduplication**, **mocked / captured** for external delivery. | Check one assignment and review request creates one notification. Confirm stage mail capture, no outgoing Telegram, and that dashboards show only synthetic or existing staging results. |

## Scientific, education and integrations

| Feature | Current evidence | Staging acceptance path |
| --- | --- | --- |
| Interactive Labs and Lab Studio | **Automated**. Lab logic and Studio CI, plus isolated draft fixtures. Candidate forwards published `/lab-run/` and keeps production external requests outside the public staging site. | Publish two synthetic Lab revisions, launch the interactive UI at `/lab`, compare runs, verify assets, restore and confirm public snapshot isolation. |
| Pulsar answers, context, evaluation and moderation | **Mocked; live provider blocked**. Stage denies shared provider credentials and the production forum. | Supply an independently scoped token, usage cap, evaluation dataset and isolated forum for moderation. Use a small approved live evaluation before opening general staging access. |
| Native courses and progress | **Automated**. Independent synthetic draft course and lesson command and existing LMS backend tests. | Publish the native stage course, enroll a synthetic learner, finish a lesson, reload and verify progress and permissions. |
| Open edX LMS and Studio | **Blocked**. Existing host has production Tutor only. | Use a separate Tutor project, DBs, volumes, Redis, search and stage OAuth callbacks on approved capacity. Verify enrollment and progress through the bridge. |
| Discourse forum | **Blocked**. Candidate explains unavailable isolated forum. | On isolated Discourse, use stage SSO to post, vote, reply and moderate under separate staff and member roles. Verify denial and logout propagation. |
| PostgreSQL, migrations and backup | **Live for staging DB connectivity and isolation**. Platform CI covers migration drift. Isolated host snapshot and restore are tracked in the [architecture](staging-architecture.md). | Confirm exact declared role and schema, review a migration plan against staging, and restore only into a disposable database first. |
| Nextcloud uploads, permissions, file revisions and document storage | **Live**. Auto Team Folder provisioning, native upload, exact bytes, access denial, SSO and versions. | Use a QA project and harmless document. Upload a changed document, compare revisions and verify an unrelated user receives a denial. |
| Redis and background workers | **Live for Team Folder timer**. Staging local cache differs from production Redis-backed components. | Validate worker health and retry behavior separately. Add dedicated Redis and test cross-worker locks when capacity and topology are approved. |
| Email, Telegram, GitHub, webhooks and external calls | **Captured / disabled** on staging. Real outgoing integration checks remain blocked by dedicated staging identities and destinations. | Use a captured mailbox, test bot and sandbox GitHub repository with scoped write permission. Verify delivery, retry and no production destinations. |
| Payments | **Automated staging deny guard**. No provider sandbox enabled. | Configure test-mode-only credentials and checkout target before enabling this flow. Verify signed sandbox events and prevent live production checkout links. |
| S3 storage, monitoring and recovery | Isolated document storage and stage health are live. Dedicated object-storage IAM, ongoing alerting and full-stack disaster recovery remain open. | Provision separate S3 bucket/credentials, check file ACLs and set alerts for stage app, DB, timers and disk. Restore a complete checkpoint into an idle isolated environment. |

## Evidence and team checklist

- Verify [health](https://staging.graviquest.com/api/health/) and [Nextcloud status](https://staging.graviquest.com/nextcloud/status.php) before the test.
- Confirm the candidate and QA owner in Development task #1167. Verify release metadata at `/api/staging/release/` after the managed release path is activated.
- Use named staging accounts and synthetic fixtures. Record role, URL, commit, numbered QA iteration, action, evidence and correction in the existing task.
- Protect the QA 004 slot. Review [Workspace V2 authenticated QA](https://github.com/hsdarestani/gravitas/actions/runs/45860090114), [native storage and scheduling](https://github.com/hsdarestani/gravitas/actions/runs/45860694186), [automatic Team Folder QA](https://github.com/hsdarestani/gravitas/actions/runs/45874729634), [Nextcloud revision and Ideas promotion QA](https://github.com/hsdarestani/gravitas/actions/runs/45875356292), and [named owner and HTTPS checks](https://github.com/hsdarestani/gravitas/actions/runs/45966038562).
- Follow the [Development, Staging & Production Release Guide](development-and-release-workflow.md) for staging reservation, deployment, approval and rollback.
