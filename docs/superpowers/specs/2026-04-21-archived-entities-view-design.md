# Archived Entities View — Design

**Status:** Draft
**Date:** 2026-04-21
**Scope:** Frontend (web/oss + web/packages/agenta-entity-ui)

## Problem

Deleting a git-based entity (apps, evaluators, testsets) in Agenta does not hard-delete it — the backend sets `deleted_at` / `deleted_by_id` on the artifact (archive). The backend already exposes:

- `POST /{id}/archive` and `POST /{id}/unarchive` for every git-based artifact
- `include_archived` query flag on every `POST /query` endpoint
- `deleted_at` / `deleted_by_id` fields on artifact responses

There is no UI today to view or restore archived artifacts. Users cannot recover a "deleted" app/evaluator/testset without engineering help.

## Goal

Ship a per-entity archived-list page for the three top-level git-based artifacts — **Apps, Evaluators, Testsets** — where users can:

1. See everything they've archived (paginated, searchable).
2. Restore a single artifact back into the active list.
3. Click a row to jump into that archived artifact's existing details page.
4. Export the archived list as CSV.

Out of scope: archived variants/revisions/environments/queries, bulk restore, permanent delete, any changes to the archive action itself.

## Non-Goals

- No new state-management pattern. Atom-based state (`jotai`) is the house style.
- No new table primitive. Use the existing `InfiniteVirtualTableFeatureShell` + `useTableManager` combo.
- No breadcrumb navigation. A back button on the page header is enough.
- No new modal/drawer UX surface. This is a full route.

## Approach

Reuse the existing `@agenta/entity-ui` adapter registry — the same pattern that powers `EntityDeleteModal`, `EntityCommitModal`, `EntitySaveModal` today. Add one new reusable view (`EntityArchivedView`) and extend the existing `EntityModalAdapter` interface with three optional archive-capability fields. Each entity's existing adapter fills those fields in; each entity gets a thin route page that mounts `EntityArchivedView` with its adapter key.

This matches how commit/delete/save are already done in the codebase — no new patterns are introduced, and no duplicate per-entity wiring is created.

## Architecture

```
web/packages/agenta-entity-ui/src/archived/        ← NEW shell package
├── EntityArchivedView.tsx     (back btn + title + InfiniteVirtualTableFeatureShell)
├── columns.tsx                (common column renderers + merges adapter.extraColumn)
├── state.ts                   (search/selection atomFamily keyed by entityType)
└── index.ts

web/packages/agenta-entity-ui/src/modals/types.ts   ← EXTEND
  - add to EntityModalAdapter:
      archivedPaginatedStore?: PaginatedEntityStore<...>
      restore?(id: string): Promise<void>
      extraColumn?: ColumnType (single entity-specific column)
      getDetailsHref?(row): string | null

web/oss/src/pages/w/[workspace_id]/p/[project_id]/apps/archived/index.tsx        ← NEW page
web/oss/src/pages/w/[workspace_id]/p/[project_id]/evaluators/archived/index.tsx  ← NEW page
web/oss/src/pages/w/[workspace_id]/p/[project_id]/testsets/archived/index.tsx    ← NEW page

+ each entity's existing adapter file fills in the four archive fields
+ each entity's existing "live" table gets an "Archived" button in primaryActions
```

## Component & Data Flow

### `EntityArchivedView` (single reusable shell)

```ts
interface EntityArchivedViewProps {
  entityType: EntityType     // 'application' | 'evaluator' | 'testset'
  onBack: () => void
  title: string              // e.g. "Archived apps"
  subtitle?: string          // e.g. "Archived apps are hidden… Restore any time."
}
```

Internals:

1. Resolves the adapter via `getEntityAdapter(entityType)`.
2. Mounts `InfiniteVirtualTableFeatureShell` with `datasetStore: adapter.archivedPaginatedStore`.
3. Columns = `buildArchivedColumns(adapter)` → common columns + `adapter.extraColumn` spliced after `Name`.
4. `useTableManager`'s `onRowClick` → `router.push(adapter.getDetailsHref(row))` when defined.
5. `primaryActions` node = `<Button onClick={exportCsv}>Export CSV</Button>`.
6. Back button calls `onBack()`.
7. Restore column cell calls `adapter.restore(row.id)`, then invalidates both the archived store and the entity's live list caches.

### Column spine (fixed)

```
Name | [adapter.extraColumn?] | Archived (deleted_at) | Archived by (deleted_by_id → user atom) | Last activity (updated_at) | Restore
```

- `Archived by` resolves `deleted_by_id` → user via the existing `@agenta/entities/shared/user` atoms (same way "created by" is resolved elsewhere).
- `extraColumn` is optional and singular. Apps pass `{title: "Type", dataIndex: "appType", render: ...}`. Evaluators/testsets pass their own or nothing.
- The `Restore` cell is a plain `Button` with `loading` state while the call is in flight. Restore is non-destructive, so no confirmation popover is needed.

### Paginated store (per adapter)

Each adapter owns one new store scoped to archived rows:

```ts
// Example for apps
export const archivedAppWorkflowPaginatedStore = createPaginatedEntityStore({
  entityName: 'archivedAppWorkflow',
  metaAtom: archivedAppWorkflowMetaAtom,   // includes search, projectId
  fetchPage: async ({meta, limit, cursor}) =>
    queryWorkflows({
      projectId: meta.projectId,
      name: meta.searchTerm,
      flags: {is_evaluator: false},
      includeArchived: true,          // maps to include_archived on wire
      archivedOnly: true,             // see "Backend contract" note below
      windowing: {limit, next: cursor},
    }),
  transformRow: toArchivedAppRow,
  isEnabled: (m) => !!m.projectId,
})
```

Same pattern for evaluators (`is_evaluator: true`) and testsets.

### Restore flow (per adapter)

```ts
adapter.restore = async (id) => {
  await unarchiveWorkflow(projectId, id)      // existing API client fn
  archivedAppWorkflowPaginatedStore.invalidate()
  await invalidateAppManagementWorkflowQueries() // existing invalidator
}
```

### Row click → existing details page

Apps: `${baseAppURL}/${row.workflowId}/overview`
Evaluators: existing evaluator details route
Testsets: existing testset viewer route

If a detail page doesn't gracefully handle archived entities today, that's a pre-existing bug and is out of scope to fix here (flag it, file a follow-up).

### Access point ("Archived" button)

On each entity's live table (`ApplicationManagementSection`, `EvaluatorsTable` usage site, `TestsetsTable` usage site), add a secondary button in the existing `primaryActions` node:

```tsx
<Button icon={<InboxOutlined />} onClick={() => router.push(archivedRoute)}>
  Archived
</Button>
```

Route map:
- `apps` page → `/w/{ws}/p/{p}/apps/archived`
- `evaluators` page → `/w/{ws}/p/{p}/evaluators/archived`
- `testsets` page → `/w/{ws}/p/{p}/testsets/archived`

## State Management

Atoms only. One atomFamily for archived-list UI state, keyed by `entityType`:

```ts
// web/packages/agenta-entity-ui/src/archived/state.ts
export const archivedSearchAtomFamily = atomFamily((entityType: EntityType) =>
  atom(''),
)
export const archivedSelectionAtomFamily = atomFamily((entityType: EntityType) =>
  atom<string[]>([]),
)
```

No new provider. No new context. Follows the same style as the commit/delete modal atoms.

## Backend Contract

One open question: the `include_archived` flag today *includes* archived rows alongside live ones. For the archived view, we want *only* archived rows. Two paths:

1. **Client-side filter** — fetch with `include_archived: true`, filter out rows where `deleted_at == null` before passing to the table. Wastes bandwidth but requires zero backend work.
2. **Add `archived_only` flag** — tiny backend change to `query-workflows/evaluators/testsets`. Clean, but requires API + SDK regeneration.

**Recommendation:** start with (1) to unblock the UI, open a follow-up ticket for (2). If (1) produces noticeable pagination weirdness (e.g. pages under-filled because most rows are live), escalate to (2) before shipping.

## Error Handling

- Restore failure → show `message.error(extractApiErrorMessage(e))` (existing helper). Row stays put; user can retry.
- Empty archived list → dedicated empty state ("Nothing archived yet") rendered by the shell when `totalCount === 0`.
- Query failure → `InfiniteVirtualTableFeatureShell` already renders error UI.

## Testing Strategy

- **Unit:** `buildArchivedColumns(adapter)` produces the right column order for each adapter shape (with/without `extraColumn`).
- **Integration (per adapter):** restore action calls the right endpoint + invalidates both stores.
- **Manual QA:** archive an app → see it disappear from live + appear in archived → restore → see it disappear from archived + reappear in live.
- Follow existing frontend test patterns; no new test infrastructure.

## Migration / Rollout

No migrations. Additive feature. No feature flag (low risk, read/restore only, no destructive action added).

## Open Questions (to resolve during implementation)

1. **`archived_only` filter on backend** — decide up front between client-side filter vs a small API extension (see Backend Contract).
2. **Details page behavior for archived artifacts** — confirm each entity's detail route handles `deleted_at != null` gracefully. If any throws, file a separate ticket.
3. **User resolution caching** — confirm the `@agenta/entities/shared/user` atom family handles unknown/deleted user IDs gracefully for the "Archived by" column.

## Follow-ups (out of scope for v1)

- Bulk restore (checkboxes in column 0 of the mockup exist but are inert in v1).
- Permanent delete from the archived view (requires backend endpoint + confirmation UX).
- Archived revisions/variants inline in version history.
- Environments and queries archived views.
