# Archived Entities View — Design (v4)

**Status:** Draft — supersedes v1, v2, v3
**Date:** 2026-04-24
**Scope:** Frontend, plus a small backend prerequisite (see Backend Dependency).

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
- No migration of existing callers (e.g., `Evaluators/index.tsx`, `DeleteAppModal`) off the standalone `archiveWorkflow`/`archiveTestsets` functions onto the new molecule actions. The new molecule actions are additive.

## Summary of changes from v3

v3 introduced a dedicated `@agenta/entity-ui/archived` module with a new `ArchivedEntityPage` component, a new columns file, and a per-entity "config object" pattern. v4 steps back from that and reuses the three live tables' existing primitives directly:

| Dimension | v3 | v4 |
|---|---|---|
| New packaged primitive | `@agenta/entity-ui/archived` | **None** |
| Table component | New `ArchivedEntityPage` | Existing `InfiniteVirtualTableFeatureShell` + `useTableManager` |
| Columns | New `columns.tsx` with archived-specific renderers | **Extend existing column factories** with a `mode: "active" \| "archived"` param |
| Layout | Built into `ArchivedEntityPage` | **New small OSS `ArchivedEntityLayout`** (back + title + subtitle + `children`) |
| Archive/unarchive | Standalone `archiveWorkflow(...)` functions called from archive page | **Promoted to molecule actions** on `workflowMolecule` and `testsetMolecule` |
| Client-side `deleted_at` filter | Documented in spec | **Removed** — relies on backend support |
| Backend dependency | None | **New `archived_only: true` flag on `POST /query`** (see Backend Dependency) |

The data-fetching strategy (one sibling `createPaginatedEntityStore` per entity, colocated with the live store) is the same as v3 and confirmed safe after auditing consumers of each live store.

## Backend Dependency

v4 assumes the backend can return archived-only rows. This is the one non-frontend prerequisite and must be confirmed before implementation starts.

**Contract shape:** add a new boolean `archived_only: true` alongside `include_archived` on the `POST /query` endpoints for workflows and testsets. When true, the endpoint returns rows where `deleted_at IS NOT NULL`.

We cannot overload `include_archived: true` to mean archived-only. Existing frontend callers already use `include_archived: true` to **broaden** results (live + archived together) — see `web/oss/src/components/EvalRunDetails/atoms/query.ts:391` and `web/oss/src/components/EvalRunDetails/components/CompareRunsMenu.tsx:567`. Changing that semantics silently would break those surfaces.

The sibling stores in this spec pass `archivedOnly: true` (wire name aligns with backend). The frontend does no client-side `deleted_at` filtering.

**Blocker:** if backend hasn't shipped the `archived_only` flag at frontend implementation time, the archive pages cannot ship — they would otherwise render live + archived mixed, which is an unacceptable UX. The implementation plan opens with verifying the backend contract and does not start the frontend slice until it is confirmed.

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
├── store/archivedAppWorkflowStore.ts                     ← NEW sibling store
└── ArchivedAppsPage.tsx                                  ← NEW

web/oss/src/components/Evaluators/
├── store/archivedEvaluatorsStore.ts                      ← NEW sibling store
└── ArchivedEvaluatorsPage.tsx                            ← NEW

web/oss/src/state/entities/testset/
└── archivedPaginatedStore.ts                             ← NEW sibling store
web/oss/src/components/pages/testset/
└── ArchivedTestsetsPage.tsx                              ← NEW

web/oss/src/pages/w/[workspace_id]/p/[project_id]/apps/archived/index.tsx        ← thin re-export
web/oss/src/pages/w/[workspace_id]/p/[project_id]/evaluators/archived/index.tsx  ← thin re-export
web/oss/src/pages/w/[workspace_id]/p/[project_id]/testsets/archived/index.tsx    ← thin re-export

+ "Archived" button in each live table's primaryActions
+ Column factory mode extensions (see Column Factories)
+ Molecule action additions (see Molecule Extensions)
```

## Sibling Paginated Store

Each archived store is a second `createPaginatedEntityStore(...)` call that lives next to its live sibling. It shares nothing with the live store except the underlying API function.

```ts
// web/oss/src/components/pages/app-management/store/archivedAppWorkflowStore.ts
import {createPaginatedEntityStore} from "@agenta/entities/shared"
import {queryWorkflows} from "@agenta/entities/workflow"
import type {Workflow} from "@agenta/entities/workflow"
import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"

import type {AppWorkflowRow} from "./appWorkflowStore"

export const archivedAppWorkflowSearchTermAtom = atom<string>("")

interface ArchivedAppWorkflowQueryMeta {
    projectId: string | null
    searchTerm?: string
}

const archivedAppWorkflowMetaAtom = atom<ArchivedAppWorkflowQueryMeta>((get) => ({
    projectId: get(projectIdAtom),
    searchTerm: get(archivedAppWorkflowSearchTermAtom).trim() || undefined,
}))

export const archivedAppWorkflowPaginatedStore = createPaginatedEntityStore<
    AppWorkflowRow,
    Workflow,
    ArchivedAppWorkflowQueryMeta
>({
    entityName: "archivedAppWorkflow",
    metaAtom: archivedAppWorkflowMetaAtom,
    fetchPage: async ({meta, limit, cursor}) => {
        if (!meta.projectId) {
            return {rows: [], totalCount: null, hasMore: false, nextCursor: null, nextOffset: null, nextWindowing: null}
        }
        const response = await queryWorkflows({
            projectId: meta.projectId,
            name: meta.searchTerm,
            flags: {is_evaluator: false},
            archivedOnly: true,
            windowing: {limit, order: "descending", next: cursor ?? undefined},
        })
        return {
            rows: response.workflows,
            totalCount: response.count ?? null,
            hasMore: !!response.windowing?.next,
            nextCursor: response.windowing?.next ?? null,
            nextOffset: null,
            nextWindowing: null,
        }
    },
    rowConfig: {getRowId: (row) => row.id},
    transformRow: (apiRow): AppWorkflowRow => ({
        key: apiRow.id,
        workflowId: apiRow.id,
        name: apiRow.name ?? apiRow.slug ?? apiRow.id,
        appType: "",
        updatedAt: apiRow.updated_at ?? apiRow.created_at ?? null,
        createdAt: apiRow.created_at ?? null,
        deletedAt: apiRow.deleted_at ?? null,
        deletedById: apiRow.deleted_by_id ?? null,
    }),
    isEnabled: (meta) => Boolean(meta?.projectId),
})
```

Evaluators and testsets have the same shape — the only variation is the query function wrapped (`queryWorkflows` with `is_evaluator: true` for evaluators; testset query for testsets) and the row transform.

### Row type additions

Each row type (`AppWorkflowRow`, `EvaluatorTableRow`, `TestsetTableRow`) gains two optional fields:

```ts
deletedAt?: string | null
deletedById?: string | null
```

The live store's `transformRow` leaves them undefined. The archived store's `transformRow` populates them from the API response. The archived-only columns that read these fields are only rendered in archived mode, so they're invisible on live pages.

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

## Molecule Extensions

Two molecules gain two actions each. Actions are **additive** — existing callers of the standalone functions continue working. Each action wraps the existing API function and invalidates the **package-level** list caches. OSS-layer store invalidation is the calling page's responsibility (two lines after `await`), to keep molecules free of cross-package imports.

### `workflowMolecule` (apps + evaluators share this)

File: `web/packages/agenta-entities/src/workflow/state/molecule.ts`

```ts
archive(workflowId: string): Promise<void>
    // wraps archiveWorkflow(projectId, workflowId)
    // then: invalidateWorkflowsListCache() + invalidateEvaluatorsListCache()
    // invalidateEvaluatorsListCache already fires onEvaluatorMutation listeners

unarchive(workflowId: string): Promise<void>
    // mirrors archive
```

Evaluator pages already ride `onEvaluatorMutation` (existing, unchanged). App pages call `invalidateAppManagementWorkflowQueries()` themselves after awaiting the molecule — same pattern the archive page uses (see Archive Pages). No new listener registry.

### `testsetMolecule`

File: `web/packages/agenta-entities/src/testset/state/testsetMolecule.ts`

```ts
archive(testsetId: string): Promise<void>
    // wraps archiveTestsets({projectId, testsetIds: [testsetId]})
    // then: invalidateTestsetsListCache()

unarchive(testsetId: string): Promise<void>
    // wraps a new unarchiveTestsets API call
    // then: invalidateTestsetsListCache()
```

A new `unarchiveTestsets` function is added to `web/packages/agenta-entities/src/testset/api/mutations.ts` to match the existing `archiveTestsets` shape.

`invalidateTestsetsListCache` alone does **not** refresh `TestsetsTable` — that reads from `testset.paginated.store` (`TestsetsTable.tsx:358`), which lives in OSS. The live testset page and the archived testset page each call `testset.paginated.store.invalidate()` and their archived sibling's `invalidate()` respectively, after awaiting the molecule. Same two-lines-after-`await` pattern as apps.

**Why molecule actions over the standalone functions:**
- Centralizes API wrapping + package-level cache invalidation.
- Future callers (entity row menus, bulk actions) go through a single typed surface.
- Matches the user's direction: "it can come from the molecule."

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

Each archive page is a thin composition: layout + existing table infrastructure + sibling store + column factory (archived mode) + molecule action.

```tsx
// web/oss/src/components/pages/app-management/ArchivedAppsPage.tsx
export default function ArchivedAppsPage() {
    const router = useRouter()
    const {baseAppURL} = useURL()
    const unarchive = useSetAtom(workflowMolecule.actions.unarchive)

    const handleRowClick = useCallback(
        (record: AppWorkflowRow) => router.push(`${baseAppURL}/${record.workflowId}/overview`),
        [router, baseAppURL],
    )

    const actions = useMemo<AppWorkflowColumnActions>(
        () => ({
            onOpen: handleRowClick,
            onOpenPlayground: () => {},
            onDelete: () => {},
            onRestore: async (record) => {
                try {
                    await unarchive(record.workflowId)
                    archivedAppWorkflowPaginatedStore.invalidate()
                    await invalidateAppManagementWorkflowQueries()
                    message.success("App restored")
                } catch (e) {
                    message.error(extractApiErrorMessage(e))
                }
            },
        }),
        [handleRowClick, unarchive],
    )

    const columns = useMemo(
        () => createAppWorkflowColumns(actions, {mode: "archived"}),
        [actions],
    )

    const table = useTableManager<AppWorkflowRow>({
        datasetStore: archivedAppWorkflowPaginatedStore.store as never,
        scopeId: "archived-app-workflows",
        pageSize: 50,
        onRowClick: handleRowClick,
        columnVisibilityStorageKey: "agenta:archived-apps:column-visibility",
        rowClassName: "cursor-pointer",
        search: {atom: archivedAppWorkflowSearchTermAtom, className: "w-full max-w-[400px]"},
        exportFilename: "archived-apps.csv",
    })

    return (
        <ArchivedEntityLayout
            title="Archived apps"
            subtitle="Archived apps are hidden from your workspace but keep all prompts, evaluations, and traces. Restore any time."
            onBack={() => router.push(baseAppURL)}
        >
            <InfiniteVirtualTableFeatureShell<AppWorkflowRow>
                {...table.shellProps}
                columns={columns}
                enableExport
            />
        </ArchivedEntityLayout>
    )
}
```

Evaluators and testsets follow the same shape. Testsets retains its tree expansion for revisions — the shell's `expandable` wiring is unchanged.

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
  - Each sibling store's `fetchPage` sends `archivedOnly: true` and threads `searchTerm` / `projectId` through correctly.
  - Molecule `archive` / `unarchive` actions call the API wrapper and invalidate package-level list caches (`invalidateWorkflowsListCache`, `invalidateEvaluatorsListCache`, `invalidateTestsetsListCache`).

- **Integration (per entity)**
  - Restore via molecule action calls the correct unarchive endpoint.
  - Restore invalidates both sibling store and live-list cache.
  - Row click navigates to the correct details href.

- **Manual QA checklist (per entity)**
  1. Live table shows "Archived" button next to "Create new" → click lands on `/{entity}/archived`.
  2. Archive something from live → disappears from live, appears in archived.
  3. Search in archived list → server-side filter matches.
  4. Export CSV from archived list → downloads currently loaded rows.
  5. Click an archived row → existing details page loads without crash.
  6. Click "Restore" → row disappears from archived, reappears in live.
  7. Back button → returns to live list.
  8. Archive ~50 items, scroll archived list → pagination advances cleanly.

No new test infrastructure. Follow existing frontend test patterns.

## Rollout

Additive feature. No migrations. No feature flag (read + single-row restore only; no new destructive action).

**Implementation order:**
1. Confirm / land backend `archived_only: true` flag on workflow + testset query endpoints.
2. Molecule actions: `workflowMolecule.archive/unarchive`, `testsetMolecule.archive/unarchive`, plus new `unarchiveTestsets` API wrapper.
3. Column factory `mode` extensions + row-type additions (`deletedAt`, `deletedById`).
4. `ArchivedEntityLayout` component.
5. Per-entity slice (each independently shippable):
   - Apps: sibling store → archive page → access button → QA.
   - Evaluators: same sequence.
   - Testsets: column extraction (separate commit) → sibling store → archive page → access button → QA.
6. Pre-ship details-page verification for all three.

## Known Risks

1. **Backend prerequisite.** v4 cannot ship until the backend adds `archived_only: true` to the workflow + testset query endpoints. If the flag isn't shipped at frontend start, the archive page would show live + archived mixed — unacceptable. *Mitigation:* step 1 of the rollout is confirming / landing the flag. Frontend work does not start until it is confirmed.

2. **Testset column extraction.** Moving ≈ 200 lines of inline columns out of `TestsetsTable.tsx` into an exported factory touches a dense file. *Mitigation:* pure move, no logic change; lives in its own commit; regression test is "the live testsets page looks identical after the extraction."

3. **Molecule-action migration debt.** v4 adds `archive`/`unarchive` to molecules but does not migrate existing callers (which continue to use standalone functions). This is intentional scope control but creates two ways to do the same thing temporarily. *Mitigation:* tracked as a follow-up; not a shipping blocker.

## Open Questions

1. **"Archived by" fallback.** The existing `@agenta/entities/shared/user` atom family's fallback is reused. Verify its fallback label ("Former member" or similar) during implementation.
2. **Restore confirmation.** v4 treats restore as non-destructive (no confirm popover). Revisit if product feedback indicates otherwise.

## Follow-ups (out of scope)

- Bulk restore from the archived list.
- Permanent delete (needs new backend endpoint + confirmation UX).
- "Export all archived rows" (fetch-all or server-side export).
- Archived revisions / variants inline in version history.
- Environments and Queries archived views.
- Migrate existing standalone `archiveWorkflow` / `unarchiveWorkflow` / `archiveTestsets` callers onto the new molecule actions (consolidation).
