# RFC: Folder Entity and Migration Bridge to Application Artifacts

## Status

Draft.

## Context

This branch introduces a first-class `folders` entity and connects it to legacy applications via `app_db.folder_id`.

`origin/main` has progressed toward artifact-based applications (workflow-backed application entities), with folder scope being extended to artifact tables.  
We need a coherent design that supports current branch behavior and the migration target.

## Current State (Branch)

## Data Model

1. `folders` table:
  - Hierarchical path stored as `ltree`.
  - `parent_id` self-reference by `(project_id, id)`.
  - `kind` enum currently containing `applications`.
2. `app_db.folder_id`:
  - Nullable FK to `folders.id`.
  - `ondelete=SET NULL`.

## Folder Domain/API

1. API endpoints at `/folders`:
  - `POST /`
  - `GET /{folder_id}`
  - `PUT /{folder_id}`
  - `DELETE /{folder_id}`
  - `POST /query`
2. Validation:
  - Name regex guard.
  - Max depth 10.
  - Max slug length 64.
3. DAO behavior:
  - Subtree path updates via SQL `ltree` operation.
  - Subtree deletes via single SQL delete on path prefix.

## Frontend Integration

1. Prompts page uses SWR query to fetch folders and apps.
2. Folder tree is built client-side and merged with app leaves.
3. UI supports create/rename/move/delete folder and move app between folders.
4. UI currently guards against deleting non-empty folders containing apps.

## Mainline Extension (origin/main)

1. Folder scope has been introduced for artifact DTOs (`FolderScope` mixed into artifact models).
2. Migration `f6a7b8c9d0e1` adds `folder_id` to:
  - `workflow_artifacts`
  - `testset_artifacts`
  - `query_artifacts`
3. Migration `a7b8c9d0e1f2` performs old-app to workflow-based application migration.
4. Applications core moved from legacy service shape to workflow-backed applications service.

## Proposed Architecture

1. Keep `folders` as shared hierarchical taxonomy per project.
2. Treat application folders as artifact folder assignment in target state.
3. Maintain backward compatibility during transition:
  - Legacy reads/writes may still touch `app_db.folder_id`.
  - New system reads/writes should use artifact `folder_id`.
4. Prefer a single logical API contract for clients, with backend bridging hidden behind services.

## API Contract Considerations

1. Preserve `folder_id` field on application payloads across migration.
2. Keep folder CRUD/query endpoints stable.
3. Avoid exposing storage-specific naming (`app_db` vs artifacts) in public API.

## Known Gaps / Risks

1. Artifact folder assignment appears partially wired in mainline:
  - Edit path updates `artifact.folder_id`.
  - Create/query paths need verification for full folder semantics.
2. Uniqueness semantics differ by implementation points:
  - Migration defines `(project_id, parent_id, slug)` uniqueness.
  - Model code has a global `(project_id, slug)` uniqueness variant.
3. UI and backend behavior differ for some actions:
  - Backend can support `parent_id = null` move semantics.
  - UI currently forces destination selection for move flows.

## Open Questions

1. Should folder queries support explicit ordering/pagination for large trees?
2. Should folder deletion fail when linked entities exist, or continue with `SET NULL` semantics?
3. Do we need per-kind root folder conventions (e.g., `applications`, `evaluators`) now or later?
