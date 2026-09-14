# Gravitas+ five-layer platform architecture

Status: **implementation baseline**. This document supersedes older workspace descriptions when they conflict with the model below.

## Product model

Gravitas+ is one platform with five product layers. A layer is a product surface, **not** a user role.

| Layer | Product surface | Audience / purpose |
|---|---|---|
| 1 | Shell / Showcase | Public website, landing pages, articles, dossiers and other published material. |
| 2 | Member Dashboard | Account home, saved material, discussions, topic participation and cross-layer progress. |
| 3 | LMS | Courses, modules, lessons, assessments, enrollment, completion and Gravitas+ certificates. |
| 4 | Research Workspace | Research projects, notes, sources, files/data rooms, journal, tasks, collaboration and project activity. |
| 5 | Core Workspace | Internal Gravitas+ operating system: administration of every layer, users/access, content production, tasks/projects, brand/strategy assets and Nextcloud-backed team operations. |

Layers 3 and 4 are independent. A user can have LMS access without Research, Research without LMS, both, or neither. There is no artificial `Learner -> Researcher` prerequisite chain.

## Community roles

Community role describes the person's place in the community. It does not grant authorization by itself.

1. **Viewer** — public, anonymous; there is intentionally no database profile for an anonymous viewer.
2. **Member** — registered community member.
3. **Learner** — community identity used for people primarily participating in learning.
4. **Researcher** — community identity used for people primarily participating in research.
5. **Gravitas+ Team** — internal community identity.

A Researcher can have no LMS access. A Learner can have a project-specific Research grant. A Team role does not silently create Core authorization. This separation prevents role labels from becoming security rules.

## Authorization model

Authorization is the intersection of three independent controls:

1. **Layer/module access** — Dashboard, LMS, Research, Core.
2. **Object/project ACL** — existing `ObjectPolicy`, `AccessGrant`, `ProjectMembership`, share-link and workspace rules remain authoritative inside a layer.
3. **Object state** — published/draft, course access mode, project visibility, enrollment state, etc.

The browser may hide unavailable navigation, but the server is authoritative.

### Layer rules

- **Dashboard**: enabled for every active registered account. Suspending a community profile removes member-platform access without deleting data.
- **LMS**: enabled by an explicit module grant or an active/completed course enrollment. Course access is still checked per course.
- **Research**: enabled by an explicit module grant or participation in an accessible research project. Existing project/object ACLs still decide which projects and items are visible.
- **Core**: internal only. Core workspace membership remains the security boundary. A module grant can mirror or explicitly disable that membership, but a module grant alone never creates Core membership.

## Reuse of the current repository

This architecture deliberately keeps the working pieces instead of replacing them:

- Layer 1 reuses `ContentItem`, translations, comments, reader library and the public Gravitas design system.
- Layer 2 reuses authentication, reader library, comments and `/api/platform/bootstrap/` as the account aggregation point.
- Layer 3 gets a new LMS domain model while keeping the same Django API conventions and Gravitas workspace shell.
- Layer 4 reuses the current Research Workspace, project cockpit, Space/Nextcloud integration, knowledge resources, mind maps, research requests and object ACL engine. The reference screenshots are an information architecture target, not a foreign skin.
- Layer 5 reuses Core operating models, Tasks & Execution, the existing Content Studio Blueprint, `ContentWorkItem`, `EntityLink`, Nextcloud integration and team APIs.

## Layer 4: Research Workspace target

The Research Workspace follows the reference information architecture while retaining Gravitas visual language:

- Dashboard / today
- Journal / calendar
- Editor / project notes
- Folder / attachments and data rooms
- Projects with card, table, timeline, graph and activity views
- Tasks
- Search
- Collaboration / researchers / opportunities
- Project detail: overview, milestones, tasks, notes, sources, files, discussions, experiments/deliverables and activity timeline

A project is a security boundary. Broad Research visibility must never reveal a private project. Project membership and object ACLs remain the final check.

## Layer 5: Core Workspace target

Core is the operating system for Gravitas+, not only a task board.

### Platform administration

Core administrators can inspect and manage:

- registered users and community roles
- account state
- Dashboard/LMS/Research access
- Core team membership through the existing team boundary
- project-level ACLs and visibility
- comments/moderation and public content
- courses/enrollments/completion/certificates
- cross-layer audit/activity events

### Gravitas operations

- Tasks & Execution
- Planning & Projects
- Content Pipeline
- Assets & Blueprints
- Team & Access
- public-site content administration
- LMS administration
- Research administration
- Nextcloud-backed assets and files

Nextcloud Deck can be used as an execution adapter, but Gravitas remains the source of cross-layer relationships. A task can link to a Research project, LMS course, public ContentItem or ContentWorkItem through the existing generic entity-link model rather than copying the object.

### Content production lifecycle

The existing Content Studio Blueprint remains the operating blueprint. `ContentWorkItem` is the dynamic production record and moves through the lifecycle from idea/discovery through research, brief/script, review/production, publishing, measurement and follow-up/repurposing. Files and brand assets remain Nextcloud-backed.

## New foundation models

### `CommunityProfile`

One-to-one with the account. Stores community role and active/suspended/invited state. It is deliberately not an authorization table.

### `ModuleGrant`

One row per account/module with access level, source, active window and administrator provenance. This gives Layer 5 an auditable way to unlock/revoke LMS or Research independently.

### `ActivityEvent`

Cross-layer audit event. It supplements project-specific audit history and records administrative/access/content/LMS events in a common timeline.

### LMS domain

- `Course`
- `CourseModule`
- `Lesson`
- `CourseEnrollment`
- `LessonProgress`
- `Assessment`
- `AssessmentAttempt`
- `Certificate`

V1 supports open/locked/paid course modes. `paid` is an access state only until a payment provider is connected; the API must never pretend a payment happened. Paid and locked courses require an administrator/external entitlement.

## API baseline

The foundation adds:

- `GET /api/platform/admin/overview/`
- `GET /api/platform/admin/users/`
- `GET|PATCH /api/platform/admin/users/<id>/`
- `GET /api/platform/admin/activity/`
- `GET|POST /api/lms/courses/`
- `GET|PATCH /api/lms/courses/<id>/`
- `POST /api/lms/courses/<id>/enroll/`
- `GET /api/lms/me/`
- `PUT /api/lms/lessons/<id>/progress/`
- `POST /api/lms/assessments/<id>/attempt/`

`/api/platform/bootstrap/` exposes the effective layer matrix and community role while preserving the legacy access keys needed by the existing frontend during migration.

## Migration strategy

The foundation migration is additive. Existing Core/Research/Nextcloud/project data is not rewritten or deleted.

- Existing accounts receive `Member` profiles.
- Existing accounts receive Dashboard access.
- Existing Core memberships are mirrored into Core module grants so Layer 5 can display their state without changing the underlying Core boundary.
- Existing Research project ownership/membership continues to imply Research availability.
- No existing project ACL is widened.

## Non-negotiable invariants

1. Community role and authorization remain separate.
2. LMS and Research access remain independent.
3. Core membership is never granted simply because someone is a Researcher, Learner or Team-role profile.
4. Layer navigation is convenience; API authorization is authoritative.
5. Existing private project/object ACLs are not widened by the migration.
6. Cross-layer relationships use references/links, not duplicated objects.
7. Paid LMS mode does not mark anything paid until an actual payment integration exists.
8. User/access changes create audit events.
9. Existing URLs keep compatibility aliases while the UI migrates to the five-layer language.
