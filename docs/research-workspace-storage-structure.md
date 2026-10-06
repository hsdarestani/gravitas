# Research workspace storage and note structure

This document is the implementation contract for Research. It exists to keep Gravitas, Nextcloud, project views, and the global Research views on one model instead of allowing each surface to invent its own copy.

## Canonical ownership model

Gravitas is the source of truth for metadata and access control. Nextcloud is the binary and Markdown storage/mirror layer.

A Research project can be private to one person or shared with project members. That changes its ACL, not its storage structure. Project membership roles are owner, editor, and viewer. Individual child objects may further restrict access, but Research workspace membership alone never grants access to a project.

The canonical object chain is:

`Workspace -> ResearchProject -> Collection -> KnowledgeResource -> links/activity`

Notes, papers, files, and datasets are KnowledgeResource rows. A project note is one canonical note with a project_id. It must not be copied into a second "global note" record merely so it can appear in the Research Notes screen.

## Notes surfaces

`/workspace/research/notes` is the unified notebook for notes the current user may view.

It contains:

- Personal notes owned by the user.
- Notes belonging to projects the user can view.
- Shared project notes with editability derived from the user's actual project/object role.

`/workspace/research/projects/<id>/notes` is a project-filtered view of those same canonical note rows.

Creating a note from the global notebook creates a Personal note. Creating a note from inside a project creates a project note. The same project note must then appear in both the project view and the global Research notebook for every permitted member.

The note owner's copy can mirror to the native Nextcloud Notes app and to the managed Space Markdown tree. Shared collaborators edit the canonical Gravitas note according to ACL; they are never redirected into another user's private native Notes account.

## Project data room

Every Research project has one stable Nextcloud Team Folder mount:

`GRV-<six digit project id>/`

Example:

`GRV-000207/`

Every project, whether private or shared, has these canonical top-level folders:

```text
GRV-000207/
├── 01_Client_Input/
├── 02_Working/
├── 03_Datasets/
├── 04_Analysis/
├── 05_Deliverables/
└── 06_Archive/
```

The Data room action inside a project must open that project's Team Folder directly. It must never open the generic Nextcloud Files home page.

Existing projects are backfilled idempotently when their Nextcloud project storage is synchronized. User-created folders are preserved.

## Upload routing

If a project upload does not explicitly choose a Collection:

- ordinary files go to `02_Working`
- datasets go to `03_Datasets`

An explicit project Collection always wins.

Loose project-root uploads are not part of the supported structure.

## Personal Space versus collaborative storage

A user's managed `Space/` tree is a personal filing/index surface. It may contain project sidecars and Markdown mirrors for navigation, search, desktop sync, and AI context.

The shared project data itself remains in the stable `GRV-xxxxxx` Team Folder. A mutable Personal Space path must never become the collaborative project root.

These two surfaces complement each other:

- Personal Space: the user's filing/index view.
- Project Team Folder: shared project storage and project ACL boundary.

## Invariants

1. One canonical object, multiple views. No duplicate note/file records just to support another screen.
2. Project visibility is enforced by ACL, not by changing folder topology.
3. Global Research views show every object the user can view, including shared project objects.
4. Project views are filters of the same canonical objects.
5. Nextcloud URLs from a project are deep links to that project, never generic home links.
6. New and existing projects converge on the same six-folder structure.
7. Gravitas permissions remain authoritative when the same data is exposed through Nextcloud.
