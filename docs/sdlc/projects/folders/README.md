# Folders Design Docs

This folder captures the design for introducing folder-based organization while the codebase is in a hybrid state:

- New entity: `folders`
- Legacy entity still in use on this branch: `app_db`
- Mainline extension (already on `origin/main`): artifact-based application model

## Why These Docs Exist

The current branch introduces folders and integrates them with legacy applications (`app_db.folder_id`).  
At the same time, `origin/main` has moved applications onto workflow/artifact primitives, and folder support is being extended there via artifact-level `folder_id`.

These docs align both realities so we can iterate without losing migration intent.

## Documents

- [PRD.md](PRD.md): Product requirements, user goals, constraints, success metrics, and open product questions.
- [RFC.md](RFC.md): Technical architecture, APIs, data model, migration strategy, and open technical questions.
- [PR.md](PR.md): PR-style summary for reviewers, including risks and validation guidance.

## Snapshot: Current Branch vs Main

- Current branch:
  - `folders` domain and API exist (`/folders` CRUD + query).
  - `app_db.folder_id` links applications to folders.
  - Prompts UI uses folders for browsing/moving/creating.
- `origin/main`:
  - Applications are represented via workflow artifacts (application alias on artifact model).
  - `folder_id` has been added to artifact tables (`workflow_artifacts`, `testset_artifacts`, `query_artifacts`) via migration `f6a7b8c9d0e1`.
  - Legacy applications are migrated to the workflow model via migration `a7b8c9d0e1f2`.

## Open Questions (Cross-Cutting)

1. What should be the canonical owner of folder assignment for applications long-term (`app_db`, artifacts, or both during transition)?
2. Do we want one shared folder tree across entity types or separate trees by `FolderKind`?
3. What compatibility contract should clients rely on during migration (dual-read, dual-write, versioned endpoints)?
