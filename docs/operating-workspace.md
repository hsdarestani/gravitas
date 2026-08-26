# Gravitas Operating Workspace

This layer implements the executive operating model without replacing the existing Research Workspace / KMS.

## Traceability hierarchy

`Strategy → Objective → Key Result → Initiative → Process / Project → Milestone / Cycle → Task`

Knowledge remains a shared layer alongside execution:

`Task / Project ↔ Note / Paper / File / Dataset / Knowledge Link`

## Five operating processes

1. Media & Content
2. Scientific Research
3. Commercial Scientific Projects
4. Technology & Infrastructure
5. Operations / Management

Each workspace receives the five fixed process definitions with the documented flow, cadence and KPI names. Process ownership can be assigned without changing the architecture.

## Core rules implemented

- Every Objective, Key Result, Initiative, Cycle, Milestone, Task and Meeting has an owner / DRI.
- Every Initiative is linked to exactly one Key Result and one operating Process.
- Every Task must be linked to an Initiative, which makes the Task traceable to its KR and Objective.
- Every Task requires a Definition of Done.
- Initiatives and Tasks have explicit priority.
- Objectives, KRs, Initiatives and Milestones support Red / Yellow / Green health.
- Tasks support dependencies and blocker reasons.
- Active P0/P1 workload is counted per owner; more than three active high-priority items produces a capacity warning.
- Meeting records store decisions; Tasks can be attached to meetings as accountable action items with owner and deadline.
- Personal and team workspace permissions are inherited from the existing Workspace / WorkspaceMembership foundation.
- Existing Research Projects and the KMS remain private and isolated using the current workspace permission model.

## UI

- `/workspace/operating` — Operating Dashboard
- `/workspace/operating/strategy` — Strategy & OKRs
- `/workspace/operating/initiatives` — Initiative portfolio
- `/workspace/operating/processes` — Five process definitions
- `/workspace/operating/cycles` — Cycles & milestones
- `/workspace/operating/tasks` — Traceable execution tasks
- `/workspace/operating/meetings` — Operating calendar and meeting records
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
- `/api/operating/tasks/`
- `/api/operating/meetings/`

Collection endpoints support GET/POST. Detail endpoints support PATCH/DELETE where applicable.

## Verification

`core.test_operating.OperatingWorkspaceTests` verifies the five-process bootstrap, full Strategy → KR → Initiative → Task trace, personal-workspace isolation, required Definition of Done and capacity warnings.

`.github/workflows/operating-production-e2e.yml` repeats the critical traceability path against production after every successful deployment using a temporary isolated account and removes the account afterward.
