# Gravitas+ five-layer platform architecture

Status: **implemented and covered by platform validation**. This document supersedes older workspace descriptions when they conflict with the model below.

## Product model

Gravitas+ is one platform with five product layers. A layer is a product surface, **not** a user role.

| Layer | Product surface | Audience / purpose | Implemented surface |
|---|---|---|---|
| 1 | Shell / Showcase | Public website, landing pages, articles, dossiers and published material. | Existing public Gravitas site + Core CMS/translation/comment-moderation control plane. |
| 2 | Member Dashboard | Account home, saved/followed material, discussions and cross-layer progress. | Dashboard, Library, Discussions, public learning-path progress, LMS progress/certificates and Research participation. |
| 3 | LMS | Courses, modules, lessons, assessments, enrollment, completion and Gravitas+ certificates. | Catalog, course reader, lesson progress, assessments, certificates and Core authoring/enrollment administration. |
| 4 | Research Workspace | Research projects, notes, sources, files/data rooms, journal, tasks, collaboration and activity. | Journal, editor, folders, portfolio cards/table/timeline/graph/activity, tasks/search/collaboration and full project cockpit. |
| 5 | Core Workspace | Internal Gravitas+ operating system and control plane. | Operations, content pipeline, blueprints/assets, team/access, platform admin, CMS, LMS/Research admin, audit, cross-layer task links and Nextcloud Deck adapter. |

Layers 3 and 4 are independent. A user can have LMS access without Research, Research without LMS, both, or neither. There is no artificial `Learner -> Researcher` prerequisite chain.

## Community roles

Community role describes a person's place in the community. It does not grant authorization by itself.

1. **Viewer** — public, anonymous; no database profile is needed.
2. **Member** — registered community member.
3. **Learner** — community identity for people primarily participating in learning.
4. **Researcher** — community identity for people primarily participating in research.
5. **Gravitas+ Team** — internal community identity.

A Researcher can have no LMS access. A Learner can have project-specific Research access. A Team role does not silently create Core authorization.

## Authorization model

Authorization is the intersection of three independent controls:

1. **Layer/module access** — Dashboard, LMS, Research, Core.
2. **Object/project ACL** — `ObjectPolicy`, `AccessGrant`, `ProjectMembership`, share-link and workspace rules remain authoritative inside a layer.
3. **Object state** — published/draft, course access mode, project visibility, enrollment state, etc.

The browser may hide unavailable navigation, but the server is authoritative.

### Layer rules

- **Dashboard**: enabled for every active registered account. Suspending a community profile removes member-platform access without deleting data.
- **LMS**: enabled by an explicit module grant or an active/completed course enrollment. Course access is still checked per course.
- **Research**: enabled by an explicit module grant or participation in an accessible research project. Existing project/object ACLs still decide which projects and items are visible.
- **Core**: internal only. Core workspace membership remains the security boundary. A module grant can mirror or explicitly disable that membership, but a grant alone never creates Core membership.

## Layer 1 — Shell / Showcase

Public content continues to use `ContentItem`, `ContentTranslation`, public comments and the reader library. Core owner/admin accounts receive visual administration for:

- creating and editing public ContentItems;
- English base content plus German/Persian translations;
- draft/published state;
- public comment moderation;
- audit history for administrative changes.

The public site's default signed-out header remains **Sign in**. It changes to **Workspace** only after `/api/auth/me/` confirms an authenticated session.

## Layer 2 — Member Dashboard

Layer 2 is the account-level aggregation surface rather than another data silo. It displays references to the source layer:

- saved and followed public material;
- public learning-path progress stored in `LabProgress`;
- the member's public-site discussion contributions;
- LMS enrollments, course progress and certificates;
- Research project participation;
- a compact next-actions list and cross-layer account activity.

Public path progress and LMS progress are intentionally separate: a public path can be started before a user ever receives LMS access.

## Layer 3 — LMS

The LMS domain is implemented with:

- `Course`
- `CourseModule`
- `Lesson`
- `CourseEnrollment`
- `LessonProgress`
- `Assessment`
- `AssessmentAttempt`
- `Certificate`

V1 supports **open**, **locked** and **paid** access states. Paid mode never fabricates a payment: until a verified payment provider exists, a paid course returns `payment_required` and an administrator/external entitlement must create the enrollment.

Core owner/admin accounts can author course structures, manage enrollment state, mark completion and revoke/reissue certificates. Course structure locks after learners exist so historical progress cannot be silently invalidated.

## Layer 4 — Research Workspace

The supplied Modern KMS reference is implemented as information architecture while retaining Gravitas visual language:

- Overview / research dashboard
- Journal / calendar
- Editor / research notes
- Folder / attachments and data rooms
- Project portfolio: cards, table, timeline, graph and activity
- Tasks
- Search
- Collaboration / researchers / opportunities
- persistent Plusar/AI side panel

Project detail contains:

- Overview
- Milestones
- Tasks
- Notes
- Sources
- Files / secure data room
- Private Discussions
- Experiments & Deliverables
- Activity timeline

`ResearchExperiment` stores hypothesis/protocol/result state. `ProjectDiscussionMessage` stores private project-scoped discussion. Both inherit the project security boundary. Files and datasets remain Nextcloud-backed instead of being duplicated into those records.

A project remains a security boundary. Broad Research availability never reveals a private project to an unrelated account.

## Layer 5 — Core Workspace

Core is the operating system for Gravitas+, not only a task board. Existing Core operations remain and the five-layer control plane is added on top.

### Platform administration

Core owner/admin accounts can inspect and manage:

- registered users and community identities;
- account state;
- independent Dashboard/LMS/Research access;
- actual Core team membership;
- public content/translations and comment moderation;
- LMS courses, enrollments, completion and certificates;
- Research project policy, membership, secure-room settings and Nextcloud access;
- cross-layer activity/audit events.

### Gravitas operations

- Tasks & Execution
- Planning & Projects
- Content Pipeline
- Assets & Blueprints
- Team & Access
- Platform Admin
- Nextcloud-backed files and brand assets
- Nextcloud Deck execution adapter

### Content production lifecycle

`ContentWorkItem` is the dynamic production record and supports the current lifecycle:

`Idea -> Selected -> Research -> Brief -> Script -> Scientific Review -> Production -> Edit -> QA -> Published -> Archived`

The existing Content Studio Blueprint remains the operating blueprint. Research handoffs and publishing references stay connected rather than copied.

### Cross-layer task traceability

A canonical Core `OperatingTask` can be related through `EntityLink` to:

- a Research project;
- an LMS course;
- an LMS lesson;
- public-site content;
- a Content Pipeline item.

The relation manager is available in Core Platform Admin. Removing a relation removes only the link, never either source object. This keeps one task source of truth while letting Core answer what research, learning or publication a task supports.

### Nextcloud Deck

Gravitas remains the canonical task store. The Deck adapter creates/reconciles a `Gravitas+ Execution` board with Backlog, Active, Blocked and Done stacks. Stable Gravitas task identifiers are embedded in Deck cards so synchronization is idempotent. Removed canonical tasks are archived in Deck rather than left appearing active.

## API surface added/completed

### Account and access

- `GET /api/platform/bootstrap/`
- `GET /api/member/dashboard/`
- `GET /api/platform/admin/overview/`
- `GET /api/platform/admin/users/`
- `GET|PATCH /api/platform/admin/users/<id>/`
- `GET /api/platform/admin/activity/`

### Public-site administration

- `GET|POST /api/platform/admin/site/content/`
- `GET|PATCH /api/platform/admin/site/content/<id>/`
- `GET /api/platform/admin/site/comments/`
- `PATCH /api/platform/admin/site/comments/<id>/`

### LMS

- `GET|POST /api/lms/courses/`
- `GET|PATCH /api/lms/courses/<id>/`
- `POST /api/lms/courses/<id>/enroll/`
- `GET /api/lms/me/`
- `PUT /api/lms/lessons/<id>/progress/`
- `POST /api/lms/assessments/<id>/attempt/`
- `GET /api/platform/admin/lms/enrollments/`
- `PATCH /api/platform/admin/lms/enrollments/<id>/`

### Research project cockpit

- `GET /api/platform/projects/<id>/milestones/`
- `GET|POST /api/platform/projects/<id>/experiments/`
- `PATCH|DELETE /api/platform/projects/<id>/experiments/<experiment_id>/`
- `GET|POST /api/platform/projects/<id>/discussions/`
- `PATCH|DELETE /api/platform/projects/<id>/discussions/<message_id>/`
- `GET /api/platform/admin/research/projects/`
- `GET|PATCH /api/platform/admin/research/projects/<id>/`

### Core execution integrations

- `GET|POST|DELETE /api/operating/tasks/<id>/links/`
- `GET /api/platform/admin/deck/`
- `POST /api/platform/admin/deck/sync/`

## Session/logout contract

Django logout is a CSRF-protected POST. The workspace transport sends a fresh CSRF token on **every unsafe HTTP method**, including body-less POST requests such as logout. If no CSRF cookie exists, it first initializes one through `/api/auth/csrf/`. A successful workspace sign-out clears cached layer-access state before returning to the public site.

This contract prevents a failed CSRF check from looking like a successful logout followed by an authenticated public header.

## Migration strategy

The migrations are additive. Existing Core/Research/Nextcloud/project data is not rewritten or deleted.

- Existing accounts receive `Member` profiles.
- Existing accounts receive Dashboard access.
- Existing Core memberships are mirrored into Core module grants so Layer 5 can display their state without changing the underlying Core boundary.
- Existing Research project ownership/membership continues to imply Research availability unless explicitly suspended.
- No existing project ACL is widened.
- Research experiments/discussions are additive project-scoped tables.

## Non-negotiable invariants

1. Community role and authorization remain separate.
2. LMS and Research access remain independent.
3. Core membership is never granted simply because someone is a Researcher, Learner or Team-role profile.
4. Layer navigation is convenience; API authorization is authoritative.
5. Existing private project/object ACLs are not widened by migration or by Core administration.
6. Cross-layer relationships use references/links, not duplicated objects.
7. Paid LMS mode does not mark anything paid until an actual payment integration verifies it.
8. User/access/content/LMS/Research administration creates audit events.
9. Existing URLs keep compatibility aliases while the product navigation uses Dashboard / Learning / Research / Core.
10. Logout must invalidate the server session before the UI claims the account is signed out.
