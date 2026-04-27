# Archived Entities View — Design (v4)

**Status:** Draft — supersedes v1, v2, v3
**Date:** 2026-04-24
**Scope:** Frontend. No backend updates are required for the current implementation path.

## Problem

Deleting a git-based entity (apps, evaluators, testsets) in Agenta does not hard-delete — the backend sets `deleted_at` / `deleted_by_id` on the artifact (archive). The backend already exposes:

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

## Non-Goals

- No new state-management pattern. Jotai atoms remain the house style.
- No new table primitive. Reuse `InfiniteVirtualTableFeatureShell` + `useTableManager` exactly as the live tables use them.
- No new page shell beyond a small `ArchivedEntityLayout` (back button + title + optional subtitle + `children`). No breadcrumb.
- No new modal/drawer UX. Archive is a full route.
- No extension of `EntityModalAdapter`. Archive is not a modal concept.
- No bulk restore, no permanent delete, no changes to the existing archive action.
- No migration of existing callers (e.g., `Evaluators/index.tsx`, `DeleteAppModal`) off the standalone `archiveWorkflow`/`archiveTestsets` functions. Molecule consolidation is a later cleanup, not part of this slice.

## Summary of changes from v3

v3 introduced a dedicated `@agenta/entity-ui/archived` module with a new `ArchivedEntityPage` component, a new columns file, and a per-entity "config object" pattern. v4 steps back from that and reuses the three live tables' existing primitives directly:

| Dimension | v3 | v4 |
|---|---|---|
| New packaged primitive | `@agenta/entity-ui/archived` | **None** |
| Table component | New `ArchivedEntityPage` | Existing `InfiniteVirtualTableFeatureShell` + `useTableManager` |
| Columns | New `columns.tsx` with archived-specific renderers | **Extend existing column factories** with a `mode: "active" \| "archived"` param |
| Layout | Built into `ArchivedEntityPage` | **New small OSS `ArchivedEntityLayout`** (back + title + subtitle + `children`) |
| Archive/unarchive | Standalone `archiveWorkflow(...)` functions called from archive page | **Keep standalone APIs for this slice**; molecule consolidation is deferred |
| Client-side `deleted_at` filter | Documented in spec | **Kept** — use existing `include_archived: true` and filter archived rows client-side |
| Backend dependency | None | **None** — existing `include_archived` query flags and unarchive routes are enough |

The data-fetching strategy (one sibling `createPaginatedEntityStore` per entity, colocated with the live store) is the same as v3 and confirmed safe after auditing consumers of each live store.


## Why sibling stores are safe (audit summary)

We considered a shared-store approach — add an `includeArchived` atom into each live store's `metaAtom` and flip it on the archive route. This is unsafe because the live stores have many consumers beyond the live table:

- `appWorkflowPaginatedStore`: `ApplicationManagementSection` + `SelectAppSection` (New Evaluation modal)
- `evaluatorsPaginatedStore`: `Evaluators/index`, `EvaluatorsTable`, `SelectEvaluatorSection`, `CommitVariantChangesModal`, `WorkflowRevisionDrawerWrapper`, `CreateEvaluatorDrawer`, `evaluatorColumns`, and more
- `testset.paginated.store`: `TestsetsTable`, `testsetMolecule`, `testsetController`, and several sidebars / dropdowns

A global flag would cause archived items to leak into those modals and dropdowns whenever the user is on an archive route. Sibling stores avoid this: the archived store has exactly one consumer (the archive page), and the live stores are untouched.

## Architecture

```
web/oss/src/components/ArchivedEntityLayout/              ← NEW (shared OSS layout)
├── index.tsx
└── types.ts

web/oss/src/components/pages/app-management/
├── store/appWorkflowStore.ts                             ← active + archived sibling stores + getAppWorkflowTableState(mode)
├── components/ApplicationManagementSection.tsx           ← mode="active" | "archived"
└── ArchivedAppsPage.tsx                                  ← NEW

web/oss/src/components/Evaluators/
├── store/evaluatorsPaginatedStore.ts                     ← active + archived sibling stores + getEvaluatorsTableState(mode)
├── Table/EvaluatorsTable.tsx                             ← mode="active" | "archived"
└── ArchivedEvaluatorsPage.tsx                            ← NEW

web/oss/src/state/entities/testset/
└── paginatedStore.ts                                     ← active + archived sibling stores + getTestsetTableState(mode)
web/oss/src/components/pages/testset/
└── ArchivedTestsetsPage.tsx                              ← NEW

web/oss/src/pages/w/[workspace_id]/p/[project_id]/apps/archived/index.tsx        ← thin re-export
web/oss/src/pages/w/[workspace_id]/p/[project_id]/evaluators/archived/index.tsx  ← thin re-export
web/oss/src/pages/w/[workspace_id]/p/[project_id]/testsets/archived/index.tsx    ← thin re-export

+ "Archived" button in each live table's primaryActions
+ Column factory mode extensions (see Column Factories)
+ Existing standalone archive/unarchive API wrappers and existing cache invalidation helpers
```

## Sibling Paginated Store

Each archived store is still a second `createPaginatedEntityStore(...)` call, but the implementation keeps it colocated inside the existing store module instead of creating a separate `archived*.ts` file.

Current pattern:

- Apps: `appWorkflowStore.ts` exports `getAppWorkflowTableState(mode)` and keeps `archivedAppWorkflowPaginatedStore` private.
- Evaluators: `evaluatorsPaginatedStore.ts` exports `getEvaluatorsTableState(mode)` and keeps `archivedEvaluatorsPaginatedStore` private.
- Testsets: `paginatedStore.ts` exports `getTestsetTableState(mode)` and keeps `archivedTestsetPaginatedStore` private.

The archived stores fetch with `includeArchived: true` and filter `deleted_at` client-side:

```ts
const response = await queryWorkflows({
    projectId,
    name: searchTerm,
    flags: {is_evaluator: false},
    includeArchived: true,
})

const archivedRows = response.workflows.filter((workflow) => Boolean(workflow.deleted_at))
```

For testsets, the archived store walks all available `include_archived` pages with a larger page size, filters archived rows, sorts by `deleted_at`, and then slices locally for the table page. Apps and evaluators currently fetch the matching workflow list, filter archived rows, sort where needed, and slice locally.

This is intentionally frontend-only. If the backend later adds archived-only query support, these private archived stores are the single place to swap from client filtering to server filtering.

### Row type additions

Each row type (`AppWorkflowRow`, `EvaluatorTableRow`, `TestsetTableRow`) gains two optional fields:

```ts
deletedAt?: string | null
deletedById?: string | null
```

The archived store's transform/fetch path populates these fields from `deleted_at` / `deleted_by_id`. The archived-only columns that read these fields are only rendered in archived mode, so they're invisible on live pages.

## Column Factories

Each existing column factory grows a second argument: an options object with `mode`. `mode` is the only thing that branches internally.

```ts
// web/oss/src/components/pages/app-management/components/appWorkflowColumns.tsx
export interface AppWorkflowColumnActions {
    onOpen: (record: AppWorkflowRow) => void
    onOpenPlayground: (record: AppWorkflowRow) => void
    onDelete: (record: AppWorkflowRow) => void
    onRestore?: (record: AppWorkflowRow) => void   // NEW, required when mode === "archived"
}

export interface AppWorkflowColumnOptions {
    mode?: "active" | "archived"   // default "active"
}

export function createAppWorkflowColumns(
    actions: AppWorkflowColumnActions,
    {mode = "active"}: AppWorkflowColumnOptions = {},
) {
    const isArchived = mode === "archived"
    return createStandardColumns<AppWorkflowRow>([
        {type: "text", key: "name", title: "Name", render: /* existing */},
        {type: "date", key: "createdAt", title: "Created At"},
        {type: "text", key: "appType", title: "Type", render: /* existing */},
        ...(isArchived
            ? [
                  {type: "date", key: "deletedAt", title: "Archived at"},
                  {type: "user", key: "deletedById", title: "Archived by"},
              ]
            : []),
        {
            type: "actions",
            items: isArchived
                ? [
                      {key: "open", label: "Open overview", icon: <Note size={16} />, onClick: actions.onOpen},
                      {type: "divider"},
                      {key: "restore", label: "Restore", icon: <ArrowCounterClockwise size={16} />, onClick: actions.onRestore!},
                  ]
                : [
                      {key: "open_app", label: "Open overview", icon: <Note size={16} />, onClick: actions.onOpen},
                      {key: "open_playground", label: "Open in playground", icon: <Rocket size={16} />, onClick: actions.onOpenPlayground},
                      {type: "divider"},
                      {key: "delete_app", label: "Archive", icon: <Trash size={16} />, danger: true, onClick: actions.onDelete},
                  ],
            showCopyId: false,
        },
    ])
}
```

**Evaluators:** same shape. Archived mode adds `Archived at` / `Archived by`; action items swap Configure / Edit / Delete → Open details + Restore.

**Testsets:** the inline column array currently embedded in `TestsetsTable.tsx` (≈ lines 472–670) is extracted into an exported factory `createTestsetsColumns(actions, {mode})`. Active mode retains Clone / Rename / Delete / Export-per-row. Archived mode retains View + Restore. Tree expansion for revisions is active in both modes. The extraction is a pure move (no logic change); it lands in a separate commit before the archived work so its regression surface is isolated.

**"Archived by" resolution:** reuses the existing `@agenta/entities/shared/user` atom family — same atom already used by `created_by_id` cells elsewhere. Fallback for removed users is whatever that family already returns ("Former member" or equivalent; to verify during implementation).

## Restore APIs And Invalidation

The current implementation keeps restore/archive calls on existing standalone APIs instead of adding molecule actions in this slice.

Current top-level restore paths:

- Apps: `unarchiveWorkflow(projectId, workflowId)` followed by `invalidateWorkflowsListCache()`, `mutateApps()`, and `invalidateAppManagementWorkflowQueries()`.
- Evaluators: `unarchiveWorkflow(projectId, workflowId)` followed by `invalidateWorkflowsListCache()` and `invalidateEvaluatorsListCache()`. The evaluator paginated store also listens to `onEvaluatorMutation`.
- Testsets: `unarchiveTestset(testsetId)` followed by `invalidateTestsetsListCache()` and `invalidateTestsetManagementQueries()`.

Current archive paths also continue to use the existing standalone archive helpers and modals. Molecule-level `archive` / `unarchive` actions remain a consolidation follow-up, not a prerequisite.

## `ArchivedEntityLayout`

```ts
interface ArchivedEntityLayoutProps {
    title: string
    subtitle?: string
    onBack?: () => void
    children: React.ReactNode
}
```

Responsibilities:
1. Render a back button (top-left, plain text button with `ArrowLeft` icon) that calls `onBack` or `router.back()`.
2. Render `title` (large) and `subtitle` (muted, optional).
3. Render `children` in a flex column that takes remaining height.

It does **not** render search, export, empty states, or anything data-related — the table shell inside `children` already handles those via `useTableManager` + `InfiniteVirtualTableFeatureShell`.

```tsx
export function ArchivedEntityLayout({title, subtitle, onBack, children}: ArchivedEntityLayoutProps) {
    const router = useRouter()
    const handleBack = onBack ?? (() => router.back())
    return (
        <div className="flex flex-col gap-4 h-full min-h-0">
            <div className="flex flex-col gap-2">
                <Button type="text" icon={<ArrowLeft size={16} />} onClick={handleBack} className="self-start">
                    Back
                </Button>
                <Typography.Title level={2} className="!my-0">{title}</Typography.Title>
                {subtitle && <Typography.Text type="secondary">{subtitle}</Typography.Text>}
            </div>
            <div className="flex-1 min-h-0">{children}</div>
        </div>
    )
}
```

## Archive Pages (apps example)

Each archive page is a thin composition: `ArchivedEntityLayout` + the existing live section/table component in archived mode. The restore action stays inside the reused component.

```tsx
// web/oss/src/components/pages/app-management/ArchivedAppsPage.tsx
export default function ArchivedAppsPage() {
    const router = useRouter()
    const {baseAppURL} = useURL()

    return (
        <ArchivedEntityLayout
            title="Archived Apps"
            subtitle="Archived apps are hidden from your workspace but can be restored at any time."
            onBack={() => router.push(baseAppURL)}
        >
            <ApplicationManagementSection mode="archived" />
        </ArchivedEntityLayout>
    )
}
```

Evaluators and testsets follow the same shape:

- `ArchivedEvaluatorsPage` renders `EvaluatorsRegistry mode="archived"`.
- `ArchivedTestsetsPage` renders `TestsetsTable tableMode="archived"`.
- `ApplicationManagementSection`, `EvaluatorsTable`, and `TestsetsTable` choose their active or archived store via `get*TableState(mode)`.
- Testsets retains tree expansion for revisions. Archive-specific actions hide active-only clone/rename/archive/export-per-row controls and expose restore.

### Thin Next.js re-exports

```tsx
// web/oss/src/pages/w/[workspace_id]/p/[project_id]/apps/archived/index.tsx
export {default} from "@/oss/components/pages/app-management/ArchivedAppsPage"
```

Same pattern for evaluators and testsets.

## Access Point

Each live table's `primaryActions` gains an "Archived" button next to its existing "Create new":

```tsx
<Button icon={<Inbox size={16} />} onClick={() => router.push(archivedRoute)}>
    Archived
</Button>
```

| Entity | Live page | Archived route |
|---|---|---|
| Apps | `ApplicationManagementSection` | `/w/{ws}/p/{p}/apps/archived` |
| Evaluators | `Evaluators/index.tsx` | `/w/{ws}/p/{p}/evaluators/archived` |
| Testsets | `TestsetsTable` page | `/w/{ws}/p/{p}/testsets/archived` |

## Row Click → Existing Details Page

- **Apps:** `${baseAppURL}/${record.workflowId}/overview`
- **Evaluators:** existing evaluator details route (query-param-driven drawer — same as live page)
- **Testsets:** existing testset viewer route (navigates to latest revision)

### Pre-ship verification (required, not a follow-up)

Each details page must load cleanly for an archived artifact. If any route filters `deleted_at IS NULL` in its detail fetcher, that fetcher needs to be relaxed (add `include_archived: true` — or whatever the resolved backend contract is) before the archive page ships for that entity. If a route cannot be made archive-safe within this scope, the fallback is to make its row `onClick` a no-op — a known escape hatch, not a soft commitment.

## Error Handling

- **Restore failure:** `message.error(extractApiErrorMessage(e))`. Row stays in place; user can retry.
- **Empty list:** the page branches at its own layer. `InfiniteVirtualTableFeatureShell` does not expose an `emptyText` prop today, so the archive page reads the paginated store's `rows` + loading state, and when `rows.length === 0 && !isLoading && !searchTerm`, renders a small `<Empty />` block in place of the shell (still inside `ArchivedEntityLayout`). When a search is active, the shell renders its default no-match body; the page does not intercept.
- **Query failure:** `InfiniteVirtualTableFeatureShell`'s existing error UI handles this. No new wiring.
- **Restore succeeded but invalidation partially failed:** log a warning; user sees updated data on next navigation. No separate toast — success is success.

## CSV Export

Semantics inherited from `InfiniteVirtualTableFeatureShell` — same mechanism every other table uses. The archive page passes `enableExport` and `exportFilename="archived-{entity}.csv"`. Scope: currently loaded + currently filtered rows. No custom CSV logic.

If product later wants "export the entire archived set regardless of load state," that is a follow-up requiring either an accumulator or a server-side export endpoint.

## Testing

- **Unit**
  - Each column factory with `mode: "archived"` produces the expected column order and action items. `mode: "active"` matches the pre-change output exactly (regression guard).
  - Each sibling store's `fetchPage` sends `includeArchived: true` / `include_archived: true`, filters `deleted_at`, and threads `searchTerm` / `projectId` through correctly.
  - Restore handlers call the existing unarchive API wrapper and invalidate package-level plus OSS table caches.

- **Integration (per entity)**
  - Restore calls the correct unarchive endpoint.
  - Restore invalidates both sibling store and live-list cache.
  - Row click navigates to the correct details href.

- **Manual QA checklist (per entity)**
  1. Live table shows "Archived" button next to "Create new" → click lands on `/{entity}/archived`.
  2. Archive something from live → disappears from live, appears in archived.
  3. Search in archived list → search query applies and client-side archived filtering still returns only archived rows.
  4. Export CSV from archived list → downloads currently loaded rows.
  5. Click an archived row → existing details page loads without crash.
  6. Click "Restore" → row disappears from archived, reappears in live.
  7. Back button → returns to live list.
  8. Archive ~50 items, scroll archived list → pagination advances cleanly.

No new test infrastructure. Follow existing frontend test patterns.

## Rollout

Additive feature. No migrations. No feature flag (read + single-row restore only; no new destructive action).

**Implementation order:**
1. Confirm existing `include_archived` and unarchive routes are available for the target entity. No backend changes.
2. Add or reuse standalone frontend API wrapper for restore when missing.
3. Add archived sibling store inside the existing store module, plus a `get*TableState(mode)` selector.
4. Add column factory `mode` extensions + row-type additions (`deletedAt`, `deletedById`).
5. Add `ArchivedEntityLayout` component.
6. Per-entity slice (each independently shippable):
   - Apps: sibling store → archive page → access button → QA.
   - Evaluators: same sequence.
   - Testsets: table mode wiring → sibling store → archive page → access button → QA.
7. Pre-ship details-page verification for all three.

## Known Risks

1. **Client-filtered pagination/counts.** Without archived-only backend queries, the archive stores must fetch active + archived rows and filter client-side. This can make exact counts expensive and can require walking multiple backend pages before enough archived rows are collected. *Mitigation:* keep archived stores private, use local slicing/counting, use `totalCountMode: "unknown"` where exact totals are not reliable, and treat server-side archived-only filtering as a future optimization.

2. **Testset table duplication.** `createTestsetsColumns.tsx` exists, but `TestsetsTable.tsx` still carries substantial inline column/action logic for active and archived modes. *Mitigation:* keep archive fixes scoped; a later cleanup can consolidate onto the factory once behavior is stable.

3. **Standalone restore calls remain duplicated.** This slice keeps existing standalone API helpers instead of centralizing restore/archive in molecules. *Mitigation:* tracked as a follow-up; not a shipping blocker.

## Open Questions

1. **"Archived by" fallback.** The existing `@agenta/entities/shared/user` atom family's fallback is reused. Verify its fallback label ("Former member" or similar) during implementation.
2. **Restore confirmation.** v4 treats restore as non-destructive (no confirm popover). Revisit if product feedback indicates otherwise.

## Follow-ups (out of scope)

- Bulk restore from the archived list.
- Permanent delete (needs new backend endpoint + confirmation UX).
- "Export all archived rows" (fetch-all or server-side export).
- Full registry archive management beyond the frontend-only variants/revisions page.
- Environments and Queries archived views.
- Migrate existing standalone `archiveWorkflow` / `unarchiveWorkflow` / `archiveTestsets` callers onto molecule actions (consolidation).
