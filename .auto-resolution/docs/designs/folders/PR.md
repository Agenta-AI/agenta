# PR: Folders + Legacy App Integration (Migration-Aware)

## Executive Summary

This change introduces first-class folders and integrates them with the current legacy application model (`app_db.folder_id`) while documenting the migration path toward artifact-based applications on mainline.

The implementation enables hierarchical folder operations, folder-app association, and folder-aware prompts UI flows, with explicit design notes for compatibility with artifact entities.

## Change Inventory

## Backend: Folders

1. Added folder domain types, service, and DAO.
2. Added folder API router with CRUD + query endpoints.
3. Added validation and conflict handling for folder path/name constraints.
4. Added subtree path update and subtree delete SQL behavior using `ltree`.

## Backend: Legacy Applications

1. Added `folder_id` support on app create/update/read/list payloads in legacy app paths.
2. Added DB linkage from `app_db.folder_id` to `folders.id` with `SET NULL` deletion behavior.

## Frontend: Prompts Page

1. Added folder services (`create`, `fetch`, `edit`, `delete`, `query`).
2. Added folder tree composition with apps as leaves.
3. Added UI actions: create, rename, move, delete folders; move apps between folders.
4. Added modal workflows for move/delete/new-folder flows.

## Behavior Changes

1. Users can create nested folders and query by hierarchy fields.
2. Folder rename/move updates subtree paths.
3. Folder delete removes subtree; linked apps remain and lose folder association (`NULL`).
4. Prompts page now supports folder navigation and folder-aware app organization.

## Migration Compatibility

1. This branch uses legacy app storage (`app_db`).
2. `origin/main` introduces artifact-level folder support and app migration toward workflow/artifact entities.
3. Docs in this folder define the bridge strategy and unresolved decisions.

## Risks

1. Potential drift during migration if folder assignment is written in both legacy and artifact models without a strict source of truth.
2. Unclear slug uniqueness scope can create unexpected conflicts.
3. UI constraints (for move flows) may not expose all backend-supported operations.

## Validation Notes

1. Manual API scenarios exist in `api/oss/tests/manual/folders/crud.http`.
2. Automated tests for folders are not present yet; rely on the manual scenarios above for validation.
3. Validate:
  - Folder CRUD/query behavior.
  - Subtree move/delete behavior.
  - App-folder assignment and `SET NULL` behavior after folder deletion.
  - Prompts UI operations (create, rename, move, delete, search).

## Open Questions

1. What exact cutover point should retire `app_db.folder_id` in favor of artifact `folder_id`?
2. Should the backend enforce stricter delete rules when folders still contain linked entities?
3. Should root-level move operations be first-class in UI?
4. Should folder APIs support sorted/paginated queries to reduce large-tree payload size?
