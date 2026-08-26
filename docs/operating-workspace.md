# Gravitas Operating Workspace

This layer implements the executive operating model without replacing the existing Research Workspace / KMS.

## Traceability hierarchy

`Strategy → Objective → Key Result → Initiative → Process / Project → Milestone / Cycle → Task`

For commercial execution the documented extra level is supported:

`Project → Milestone → Work Package → Task`

Knowledge remains the shared research layer alongside execution:

`Project ↔ Note / Paper / File / Dataset / Knowledge Link`

The source Operating Model names Strategy as the top of the hierarchy but does not define a separate Strategy-record schema. The product therefore represents the quarterly strategy through the Strategy & OKR area, quarter-scoped Objectives and their Key Results rather than inventing unsupported Strategy fields.

## Five operating processes

1. Media & Content
2. Scientific Research
3. Commercial Scientific Projects
4. Technology & Infrastructure
5. Operations / Management

Each workspace receives the five fixed process definitions with the documented flow, cadence and KPI names. Process ownership can be assigned without changing the architecture. Initiatives also carry a validated process stage so real work can move through the documented flow.

## Core rules implemented

- Every Objective, Key Result, Initiative, Cycle, Milestone, Work Package, Task, Risk and Meeting has an owner / DRI.
- Every Initiative is linked to exactly one Key Result and one operating Process.
- Every Initiative has Priority, Status, Red / Yellow / Green Health and an operating-process Stage.
- Every Task must be linked to an Initiative, which makes the Task traceable to its KR, Objective and Process.
- Every Task requires Priority and Definition of Done.
- Every Task requires either a Cycle or Due Date, enforced both by API validation and a database constraint.
- Tasks support dependencies, blocker reasons, Milestone, Work Package, Project and Meeting links.
- A Task attached to a Meeting is an Action Item and must have a deadline; Owner is already mandatory.
- Commercial execution supports Project → Milestone → Work Package → Task.
- Objectives, KRs, Initiatives and Milestones support Red / Yellow / Green health.
- The Operations layer has an explicit Risk register with owner, health, mitigation, status and due date. The detailed risk fields are an implementation choice because the executive source requires Risk control but does not prescribe a risk-record schema.
- Active P0/P1 Initiatives are treated as the owner's main active priorities. Three is the capacity ceiling; a fourth active P0/P1 Initiative is rejected until capacity is freed or the work remains lower priority / non-active.
- Meeting records store decisions; Tasks can be attached to meetings as accountable action items.
- Personal and team workspace permissions are inherited from the existing Workspace / WorkspaceMembership foundation.
- Existing Research Projects and the KMS remain private and isolated using the current workspace permission model.

## Operating calendar

The dashboard exposes the documented recurring operating rhythm: Gravitas Weekly, Content Editorial, Active Project Review when needed, Scientific Review, biweekly Tech Sprint Planning / Review, Monthly Operating Review, quarter-start Strategy & OKR Planning and quarter-end OKR Review & Retrospective.

Meetings are modeled for decisions, blockers and alignment. Status reporting remains async by design.

## UI

- `/workspace/operating` — Operating Dashboard, portfolio health, capacity, milestones and Risk register
- `/workspace/operating/strategy` — Strategy & OKRs
- `/workspace/operating/initiatives` — Initiative portfolio and process-stage controls
- `/workspace/operating/processes` — Five process definitions, flow, cadence and KPIs
- `/workspace/operating/cycles` — Cycles, milestones and Work Packages
- `/workspace/operating/tasks` — Traceable execution Tasks
- `/workspace/operating/meetings` — Operating calendar, meeting records and Action Item creation
- `/workspace` — Research & Knowledge workspace

## API

All routes are authenticated and scoped to an accessible workspace.

- `/api/operating/dashboard/`
- `/api/operating/processes/`
- `/api/operating/objectives/`
- `/api/operating/key-results/`
- `/api/operating/initiatives/`
- `/api/operating/cycles/`
- `/api/operating/milestones/`
- `/api/operating/work-packages/`
- `/api/operating/tasks/`
- `/api/operating/risks/`
- `/api/operating/meetings/`

Collection endpoints support GET/POST. Detail endpoints support PATCH/DELETE where applicable.

## Verification

`core.test_operating.OperatingWorkspaceTests` verifies the five-process bootstrap, full Objective → KR → Initiative → Task trace, process-stage defaults, personal-workspace isolation, required Task fields, Cycle/Due-Date enforcement, the three-main-priority capacity gate, commercial Milestone → Work Package → Task execution, Risk register and meeting Action Item deadlines.

`.github/workflows/operating-production-e2e.yml` repeats the critical traceability path against production after every successful deployment using a temporary isolated account, including Milestone, Work Package and Risk creation, and removes the account afterward.
