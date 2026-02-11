# PRD: Folders for Prompt/Application Organization

## Status

Draft for iteration.

## Problem Statement

Projects currently accumulate many prompts/applications with limited information architecture.  
Users need a way to organize these entities hierarchically, navigate faster, and move entities safely without breaking existing flows.

This branch introduces `folders` and connects them to legacy applications (`app_db`).  
Mainline is evolving toward artifact-based applications, so folder behavior must remain compatible with that migration.

## Goals

1. Let users create and manage hierarchical folders.
2. Let users assign/move applications into folders.
3. Support efficient folder tree querying and subtree operations.
4. Preserve backward compatibility while migrating from `app_db` to artifact-based application entities.

## Non-Goals (for this phase)

1. Full multi-entity folder UX parity across workflows, testsets, and queries.
2. Permissions model redesign specific to folders.
3. Hard business quotas for folder count/depth beyond implemented technical guards.

## Primary Users

1. Prompt engineers organizing large prompt libraries.
2. Teams with many applications/templates that need structure by domain/use case.
3. Operators migrating projects from legacy app model to artifact-based app model.

## User Stories

1. As a user, I can create nested folders to reflect my domain taxonomy.
2. As a user, I can rename/move folders and keep descendants consistent.
3. As a user, I can move an app between folders.
4. As a user, I can delete a folder and understand what happens to contained apps.
5. As a team, we can adopt folders now without blocking the application-entity migration.

## Functional Requirements

1. Folder CRUD endpoints must exist: create, fetch, edit, delete.
2. Folder query must support filters by id(s), slug(s), parent, path, and path prefix.
3. Folder hierarchy must support nested trees with depth limit of 10.
4. Folder slug/path component length must be capped at 64.
5. Folder names must pass validation rules.
6. Moving/renaming a folder must update descendant paths atomically.
7. Deleting a folder must delete its subtree.
8. Applications must support nullable `folder_id`.
9. If a linked folder is deleted, applications must remain and `folder_id` becomes `NULL`.
10. UI must expose create/rename/move/delete folder actions in Prompts page.
11. UI must support app-to-folder moves.

## Non-Functional Requirements

1. Subtree updates/deletes should execute in bounded SQL operations (avoid per-node loops).
2. Folder queries should be index-backed for common filters (kind/path).
3. Operations should be deterministic under concurrent edits (conflict on unique path).

## Success Metrics (Initial)

1. Adoption: % of active projects with at least one non-root folder.
2. Organization: median folder depth and entities per folder.
3. Reliability: error rate for folder create/edit/move/delete APIs.
4. Migration readiness: % of app entities with valid folder linkage after migration to artifact model.

## Dependencies

1. Postgres `ltree` extension.
2. Existing app update/create API support for `folder_id`.
3. Prompt page state + SWR-based data refresh.

## Risks

1. Hybrid-model drift between `app_db` folders and artifact-based folders during migration.
2. Ambiguity in uniqueness semantics for slugs (global vs sibling-scoped).
3. UX inconsistencies (e.g., move-to-root behavior) if backend and frontend capabilities diverge.

## Open Questions (Current Scope)

1. Should users be allowed to move apps/folders to root (`parent_id = null`) from UI explicitly?
2. Should folder deletion with contained apps be blocked server-side, or continue to rely on `SET NULL` and optional UI guardrails?
3. Do we need analytics events for folder CRUD/move operations before general rollout?

## Next Steps

### Open Questions

1. How should we apply folders to other entities beyond applications?
2. Should folders be shared across entities (single cross-entity folder system) or isolated per entity type?
3. What is the final UX/API behavior for moving to the root folder, and how do we close the current move-to-root gap?
