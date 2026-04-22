# Archived Entities View — Design (v3, final)

**Status:** Final draft — supersedes v1 and v2
**Date:** 2026-04-22
**Scope:** Frontend only (web/oss + web/packages/agenta-entity-ui). No backend changes.

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

Out of scope for v1: archived variants/revisions/environments/queries, bulk restore, permanent delete, any changes to the archive action itself.

## Non-Goals

- No new state-management pattern. Atom-based state (`jotai`) is the house style.
- No new table primitive. Reuse `InfiniteVirtualTableFeatureShell` + `useTableManager`.
- No breadcrumb navigation — a back button in the page header is enough.
- No new modal/drawer UX — this is a full route.
- **No extension of `EntityModalAdapter`.** Archive is not a modal concept; keeping it separate prevents that type from becoming a grab-bag.

## Approach

A dedicated `@agenta/entity-ui/archived` module exports one reusable page component, `ArchivedEntityPage`. Each entity has its own small Next page that builds the config inside a React component (so it can use hooks like `useRouter`, `useURL`, `useAtomValue`) and passes it to `ArchivedEntityPage`. The archived paginated store for each entity lives colocated with that entity's existing live store.

This matches the house style in two ways:

1. **Factories/builders are already the house pattern** (`createPaginatedEntityStore`, `createEntityAdapter`, `createEntityActionHook`). A reusable page component that takes a typed config object is the same shape.
2. **Colocation is already the house pattern.** `appWorkflowPaginatedStore.ts` lives next to `ApplicationManagementSection.tsx`. The archived store belongs in the same folder as the live store.

## Architecture

```
web/packages/agenta-entity-ui/src/archived/        ← NEW dedicated module
├── ArchivedEntityPage.tsx       (public: the reusable page component)
├── ArchivedListShell.tsx        (internal: back-btn header + virtual table shell)
├── columns.tsx                  (common column renderers)
├── types.ts                     (ArchivedEntityPageConfig interface)
└── index.ts

web/oss/src/components/pages/app-management/
├── store/archivedAppWorkflowStore.ts   ← NEW (colocated with live store)
└── ArchivedAppsPage.tsx                ← NEW (builds config with hooks, renders ArchivedEntityPage)

web/oss/src/components/Evaluators/
├── store/archivedEvaluatorsStore.ts    ← NEW
└── ArchivedEvaluatorsPage.tsx          ← NEW

web/oss/src/components/pages/testset/
├── store/archivedTestsetsStore.ts      ← NEW
└── ArchivedTestsetsPage.tsx            ← NEW

web/oss/src/pages/w/[workspace_id]/p/[project_id]/apps/archived/index.tsx        ← thin re-export
web/oss/src/pages/w/[workspace_id]/p/[project_id]/evaluators/archived/index.tsx  ← thin re-export
web/oss/src/pages/w/[workspace_id]/p/[project_id]/testsets/archived/index.tsx    ← thin re-export

+ "Archived" button added to each entity's live-table primaryActions
```

## Component API (hooks-safe)

Critical correction from v2: the API is a **React component**, not a module-level factory. Entity pages build `config` inside a component with `useMemo` so hooks are allowed.

```ts
// @agenta/entity-ui/archived/types.ts
export interface ArchivedEntityPageConfig<Row> {
  /** Header */
  title: string                                    // "Archived apps"
  subtitle?: string                                // secondary description
  onBack?: () => void                              // defaults to router.back()

  /** Data */
  paginatedStore: PaginatedEntityStore<Row>        // archived-only store
  searchAtom: WritableAtom<string, [string], void>

  /** Actions */
  restore(row: Row): Promise<void>                 // calls /unarchive + invalidates caches
  getDetailsHref(row: Row): string | null          // row-click target; null disables click

  /** Optional */
  extraColumn?: ColumnType<Row>                    // single entity-specific column (e.g. "Type" for apps)
  exportFilename?: string                          // default "archived-{entity}.csv"

  /** Storage keys (mirrors useTableManager conventions) */
  storageKeys: {columnVisibility: string}
}
```

```tsx
// @agenta/entity-ui/archived/ArchivedEntityPage.tsx
export function ArchivedEntityPage<Row extends InfiniteTableRowBase>({
  config,
}: {config: ArchivedEntityPageConfig<Row>}) {
  // Renders back button, title, subtitle, search, Export CSV, virtual table,
  // restore cell, empty state. Wires config.paginatedStore into useTableManager.
  // Calls config.restore/getDetailsHref as appropriate.
}
```

### Consumer shape — apps example (all hooks allowed)

```tsx
// web/oss/src/components/pages/app-management/ArchivedAppsPage.tsx
import {useMemo} from "react"
import {useRouter} from "next/router"

import {ArchivedEntityPage} from "@agenta/entity-ui/archived"
import {unarchiveWorkflow, invalidateWorkflowsListCache} from "@agenta/entities/workflow"

import useURL from "@/oss/hooks/useURL"
import {getProjectValues} from "@/oss/state/project"

import {invalidateAppManagementWorkflowQueries} from "./store"
import {
  archivedAppWorkflowPaginatedStore,
  archivedAppWorkflowSearchAtom,
} from "./store/archivedAppWorkflowStore"
import {appTypeColumn} from "./components/appWorkflowColumns"

export default function ArchivedAppsPage() {
  const router = useRouter()
  const {baseAppURL} = useURL()

  const config = useMemo(
    () => ({
      title: "Archived apps",
      subtitle:
        "Archived apps are hidden from your workspace but keep all prompts, evaluations, and traces. Restore any time.",
      onBack: () => router.push(baseAppURL),
      paginatedStore: archivedAppWorkflowPaginatedStore,
      searchAtom: archivedAppWorkflowSearchAtom,
      restore: async (row) => {
        const {projectId} = getProjectValues()
        await unarchiveWorkflow(projectId, row.workflowId)
        invalidateWorkflowsListCache()
        await invalidateAppManagementWorkflowQueries()
        archivedAppWorkflowPaginatedStore.invalidate()
      },
      getDetailsHref: (row) => `${baseAppURL}/${row.workflowId}/overview`,
      extraColumn: appTypeColumn,
      exportFilename: "archived-apps.csv",
      storageKeys: {columnVisibility: "agenta:archived-apps:column-visibility"},
    }),
    [router, baseAppURL],
  )

  return <ArchivedEntityPage config={config} />
}
```

### Page route re-export

```tsx
// web/oss/src/pages/w/[workspace_id]/p/[project_id]/apps/archived/index.tsx
export {default} from "@/oss/components/pages/app-management/ArchivedAppsPage"
```

## Column Spine

```
Name | [config.extraColumn?] | Archived (deleted_at) | Archived by (deleted_by_id → user atom) | Last activity (updated_at) | Restore
```

- All renderers live in `@agenta/entity-ui/archived/columns.tsx`.
- `Archived by` resolves `deleted_by_id` via the existing `@agenta/entities/shared/user` atom family (same path used for "created by" elsewhere).
- `extraColumn` is optional and singular. Apps pass `appTypeColumn` (renders "chat" / "completion" / "retrieval" etc.). Evaluators/testsets pass their own or omit.
- The Restore cell is a plain `<Button>` with per-row `loading` state (non-destructive; no confirm popover).

## State Management

Atoms only. No new provider, no new context.

- **Archived paginated store** — one per entity, colocated with the live store, built from `createPaginatedEntityStore`.
- **Search atom** — one per entity, colocated.
- **Restore loading state** — per-row `useState` inside the shell (no persistence needed).

## Backend Contract

**No backend changes.** We use what exists today.

The backend offers one flag, `include_archived`, on every `POST /query` endpoint:

- `include_archived: false` (default) — live rows only (`deleted_at IS NULL`).
- `include_archived: true` — live **and** archived rows mixed. There is no "archived only" semantic.

**Frontend strategy:** each archived store's `fetchPage` calls the existing query endpoint with `include_archived: true`, then filters client-side to rows where `deleted_at != null` before handing them to the table:

```ts
const response = await queryWorkflows({
  projectId,
  name: searchTerm,
  flags: {is_evaluator: false},
  includeArchived: true,
  windowing: {limit, next: cursor},
})

const archivedOnly = response.workflows.filter((w) => w.deleted_at != null)
const archivedCount = archivedOnly.length  // local — server `count` reflects live+archived combined
```

**Known limitation (see Known Risks):** a page returned by the server can contain mostly live rows, so the archived table may show a partial page even when more archived rows exist further back. We accept this for v1; if it bites at scale we revisit with a backend addition in a follow-up.

## CSV Export

Semantics are **inherited from `InfiniteVirtualTableFeatureShell`** — the same mechanism every other table in the app uses:

- `enableExport={true}` + `exportFilename="archived-apps.csv"`
- Scope: **currently loaded + currently filtered rows** (what the user sees in the table, post-search).
- No custom CSV logic. No "fetch-all archived rows then export" flow.

If product later wants "export the entire archived set regardless of load state," that's a follow-up requiring either an accumulator or a server-side export endpoint. Not v1.

## Row Click → Existing Details Page

Row click calls `router.push(config.getDetailsHref(row))`.

- **Apps:** `${baseAppURL}/${row.workflowId}/overview`
- **Evaluators:** existing evaluator details route
- **Testsets:** existing testset viewer route

### Pre-ship verification (required, not a follow-up)

Each of the three details pages must be verified to **load cleanly for an archived artifact** (fetches, renders headings, does not crash on a missing active-list entry). If any route throws or renders a "not found" because it filters `deleted_at IS NULL`, that route needs a tiny fix before shipping (add `include_archived: true` to its detail fetcher). The implementation plan has an explicit verification task covering all three entities.

## Access Point ("Archived" button)

On each entity's live table header, add a secondary button in the existing `primaryActions` node:

```tsx
<Button icon={<InboxOutlined />} onClick={() => router.push(archivedRoute)}>
  Archived
</Button>
```

Route map:

| Entity | Live page | Archived route |
|---|---|---|
| Apps | `ApplicationManagementSection` | `/w/{ws}/p/{p}/apps/archived` |
| Evaluators | `Evaluators/index.tsx` | `/w/{ws}/p/{p}/evaluators/archived` |
| Testsets | `TestsetsTable` page | `/w/{ws}/p/{p}/testsets/archived` |

## Error Handling

- **Restore failure:** `message.error(extractApiErrorMessage(e))` using the existing helper. Row stays put; user can retry.
- **Empty list (no archived entities):** dedicated empty state rendered by `ArchivedEntityPage` ("Nothing archived yet"). Not an error.
- **Query failure:** `InfiniteVirtualTableFeatureShell` already has its error UI.
- **Restore succeeded but invalidation failed:** log a warning; the user will see updated data on their next navigation. Don't surface a separate toast — success is success.

## Testing Strategy

- **Unit:**
  - `buildArchivedColumns(extraColumn?)` produces correct column order for with/without `extraColumn`.
  - Archived paginated store's `fetchPage` sends `include_archived: true` + `archived_only: true`.

- **Integration (per entity):**
  - Restore calls the correct unarchive endpoint.
  - Restore invalidates both the archived store and the live-list cache.
  - Row click navigates to the correct details href.

- **Manual QA checklist:**
  1. On each entity's live table, click "Archived" → lands on `/{entity}/archived`.
  2. Archive something from the live table → see it disappear from live, appear in archived list.
  3. Search archived by name → matches filter correctly.
  4. Export CSV → file downloads with currently visible columns and rows.
  5. Click an archived row → existing details page loads without crash.
  6. Click "Restore" on a row → row disappears from archived list, reappears in live list.
  7. Back button → returns to the live list.
  8. Archive ~50 items (bulk via API), scroll through the archived list — pagination loads more rows without breaking. A partially filled final page is acceptable (see Known Risks).

Follow existing frontend test patterns; no new test infrastructure.

## Rollout

No migrations. Additive feature. No feature flag — low risk (read + restore only, no new destructive action).

Implementation order:

1. Frontend package: build `ArchivedEntityPage` + columns + shell.
2. Pre-ship verification: confirm all three detail routes handle archived artifacts. Fix any that don't.
3. Per-entity pages + stores + access-point buttons: apps first, then evaluators, then testsets (so each is independently shippable).
4. Manual QA on each entity's live + archived + detail path before merging that entity's slice.

## Known Risks

1. **Sparse pagination from client-side archived filter.** The server returns `include_archived: true` pages mixing live and archived rows. After client-side filtering to archived-only, a given page may be under-full. Mitigation for v1:
   - Use a larger page size (e.g. `limit: 100` instead of 50) to raise the odds of a full page.
   - Accept that archived counts shown in the UI are derived from what's been paginated so far, not the absolute server count.
   - If scale bites, escalate with a minimal backend addition (a second boolean like `archived_only`) as a follow-up. v3 explicitly does not require this.

## Open Questions

1. **`extraColumn` for evaluators/testsets.** Apps clearly has "Type." Do evaluators want "Category"? Do testsets want "Rows" or "Revisions"? Default to omitting and add based on product feedback after shipping apps.
2. **"Archived by" fallback.** If the user who archived has been removed from the workspace, what do we show? Default plan: "Former member" (same fallback the existing `@agenta/entities/shared/user` atom uses — verify during implementation).
3. **Row click on a truly broken details page.** If verification finds that one of the three detail routes can't be made archive-safe in this scope, we fall back to disabling row click for that entity (`getDetailsHref: () => null`). This is a known escape hatch, not a soft commitment.

## Follow-ups (out of scope for v1)

- Bulk restore (column-0 checkboxes inert today).
- Permanent delete from the archived view (needs backend endpoint + confirmation UX).
- "Export all archived rows" (fetch-all or server-side export).
- Archived revisions/variants inline in version history.
- Environments and Queries archived views.

## Summary of changes from v2

- **Component, not module-level factory.** `<ArchivedEntityPage config={config} />`. Per-entity page builds `config` inside a React component with `useMemo`, unblocking `useRouter`/`useURL`/any atom read.
- **No backend changes.** Use the existing `include_archived: true` flag and filter client-side. Sparse pagination documented as a known risk with mitigations; escalation path (minimal backend addition) is a follow-up if needed.
- **CSV semantics pinned.** Uses the shell's built-in export — same as every other table — scoped to loaded+filtered rows.
- **Details-page archive compatibility promoted from follow-up to pre-ship verification.** Row click is part of the shipped UX; it must work.
- **Added v1's UX sections** — access button, route map, error handling, empty state, manual QA, open questions — that were thin in v2.
- **Bulk restore explicitly out of v1** (single-row is enough; reduces risk).
