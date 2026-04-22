# Archived Entities View — Design (v2, alternative)

**Status:** Alternative draft
**Date:** 2026-04-21
**Scope:** Frontend (web/oss + web/packages/agenta-entity-ui)
**Relationship to v1:** Same feature, same constraints, same backend contract. Different internal shape.

## Why a v2 exists

While writing v1 I hung the archived-list feature off `EntityModalAdapter` — the adapter registry that powers `EntityCommitModal`, `EntityDeleteModal`, `EntitySaveModal`. That works, but it couples an archive *route* to a modal registry. Three pushbacks convinced me to draft an alternative:

1. **"Archived entities view" is not a modal.** It's a full page. Stacking archive capability fields onto `EntityModalAdapter` makes that type a grab-bag for anything remotely entity-related. The name stops matching the shape.
2. **The real per-entity config is tiny** — four closures (fetch archived, restore, row href, one identity column). A global adapter registry is heavyweight for four closures.
3. **Ownership drifts.** Today, apps own `appWorkflowPaginatedStore.ts` next to `ApplicationManagementSection.tsx`. In v1, apps have to register archive-capability into a cross-package registry in `@agenta/entity-ui`, hiding the config from the people who maintain apps.

## What v2 changes

**Drop the adapter registry extension.** Replace it with a small **factory** that returns a ready-to-render page component. Each entity calls the factory with its four closures, colocated with its other paginated-store code.

```
           v1 (registry)                              v2 (factory)
  ─────────────────────────────              ─────────────────────────────
  EntityModalAdapter grows 4 fields          createArchivedEntityPage(config)
           │                                         │
           ▼                                         ▼
  registerEntityAdapter('application',       ArchivedAppsPage = factory({...})
    { commit, save, delete,                         │
      archivedStore, restore,                       ▼
      extraColumn, getDetailsHref })        exported from apps page dir
           │
           ▼
  EntityArchivedView reads from registry
```

## Architecture

```
web/packages/agenta-entity-ui/src/archived/        ← NEW (no registry, pure factory)
├── createArchivedEntityPage.tsx   (factory: takes a config, returns a React page)
├── ArchivedListShell.tsx          (internal: back-btn header + InfiniteVirtualTableFeatureShell)
├── columns.tsx                    (common column renderers)
└── index.ts

web/oss/src/components/pages/app-management/
├── store/archivedAppWorkflowStore.ts   ← NEW (colocated with live store)
└── ArchivedAppsPage.tsx                ← NEW (calls factory with apps config)

web/oss/src/components/Evaluators/
├── store/archivedEvaluatorsStore.ts    ← NEW
└── ArchivedEvaluatorsPage.tsx          ← NEW

web/oss/src/components/pages/testset/
├── store/archivedTestsetsStore.ts      ← NEW
└── ArchivedTestsetsPage.tsx            ← NEW

web/oss/src/pages/w/[workspace_id]/p/[project_id]/apps/archived/index.tsx        ← thin re-export
web/oss/src/pages/w/[workspace_id]/p/[project_id]/evaluators/archived/index.tsx  ← thin re-export
web/oss/src/pages/w/[workspace_id]/p/[project_id]/testsets/archived/index.tsx    ← thin re-export

+ one "Archived" button added to each entity's existing page primaryActions
```

## The factory

```ts
// @agenta/entity-ui/archived
export interface ArchivedEntityPageConfig<Row> {
  title: string                                    // "Archived apps"
  subtitle?: string                                // empty-state / header description
  backHref?: string                                // optional; default is router.back()
  paginatedStore: PaginatedEntityStore<Row>        // colocated archived-only store
  searchAtom: WritableAtom<string, [string], void>
  restore(row: Row): Promise<void>                 // calls POST /{id}/unarchive + invalidates caches
  getDetailsHref(row: Row): string | null          // row click target; null disables click
  extraColumn?: ColumnType<Row>                    // optional identity column (e.g. "Type" for apps)
  exportCsv?(rows: Row[]): void                    // optional; hidden if undefined
  storageKeys: {columnVisibility: string}          // mirrors useTableManager conventions
}

export function createArchivedEntityPage<Row>(
  config: ArchivedEntityPageConfig<Row>,
): NextPage
```

### Consumer shape (example: apps)

```tsx
// web/oss/src/components/pages/app-management/ArchivedAppsPage.tsx
import {createArchivedEntityPage} from '@agenta/entity-ui/archived'
import {unarchiveWorkflow, invalidateWorkflowsListCache} from '@agenta/entities/workflow'
import {archivedAppWorkflowPaginatedStore, archivedAppWorkflowSearchAtom} from './store/archivedAppWorkflowStore'
import {invalidateAppManagementWorkflowQueries} from './store'
import {appTypeColumn} from './components/appWorkflowColumns'

export default createArchivedEntityPage<AppWorkflowRow>({
  title: 'Archived apps',
  subtitle: 'Archived apps are hidden from your workspace but keep all prompts, evaluations, and traces. Restore any time.',
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
  exportCsv: (rows) => exportToCsv('archived-apps.csv', rows),
  storageKeys: {columnVisibility: 'agenta:archived-apps:column-visibility'},
})
```

That's the entire per-entity config — roughly 30 lines, colocated with the app's other store code, no package-crossing registration.

### Page route re-export

```tsx
// web/oss/src/pages/w/[workspace_id]/p/[project_id]/apps/archived/index.tsx
export {default} from '@/oss/components/pages/app-management/ArchivedAppsPage'
```

## Column spine (unchanged from v1)

```
Name | [config.extraColumn?] | Archived (deleted_at) | Archived by (deleted_by_id → user atom) | Last activity (updated_at) | Restore
```

Same renderers as v1 — `columns.tsx` in the factory package. `Archived by` uses `@agenta/entities/shared/user` atoms. Restore cell is a plain button with `loading` state.

## State Management

No new state library. Three places state lives, all atoms:

1. **Archived paginated store** — colocated with the live store per entity (`archivedAppWorkflowPaginatedStore` etc.), built from `createPaginatedEntityStore`.
2. **Search atom** — one per entity, colocated.
3. **Factory-internal ephemeral state** — `useState` for row-level restore loading (no need to persist).

The factory itself holds no module-level state — it's pure.

## Backend Contract

Identical to v1: `POST /{id}/unarchive` + `query` endpoints with `include_archived: true`. The same "`archived_only` vs client-side filter" open question applies; same recommendation (client-side filter first, API extension as follow-up if pagination gets weird).

## Error handling / Testing / Rollout

Same as v1 — only the internal shape changes.

## v2 vs v1 — honest comparison

| Dimension | v1 (adapter registry) | v2 (factory) |
|---|---|---|
| **New patterns introduced** | Zero (extends existing `EntityModalAdapter`) | Zero (factory is a pattern used throughout the codebase: `createPaginatedEntityStore`, `createEntityAdapter`, `createEntityActionHook`) |
| **Semantic fit** | Archive fields live on `EntityModalAdapter` — a type named for modals | Archive fields live on `ArchivedEntityPageConfig` — a type named for the archived page |
| **Ownership colocation** | Apps' archive config lives in `@agenta/entity-ui`'s adapter registration; apps team has to jump packages to change it | Apps' archive config lives in `web/oss/src/components/pages/app-management/` next to the live store and section component |
| **Coupling** | Archive view depends on the modal adapter registry being initialized | Archive view is a standalone factory; no implicit registration order |
| **Code footprint day-1** | ~Same (one shell + 3 pages + 3 adapter extensions + backend client code) | ~Same (one factory + 3 pages + 3 colocated stores + backend client code), slightly less because no adapter-registry entries |
| **Cost to diverge** (e.g. testsets needs a custom column layout) | Have to widen the adapter interface or fork the shell | Testsets' factory call can pass different options; no cross-entity pressure |
| **Cost to unify** (e.g. add bulk restore to all three) | Change one shell | Change one factory |
| **Discoverability** ("where is apps' archived config?") | Grep for `registerEntityAdapter.*application` in `@agenta/entity-ui` | Open `ArchivedAppsPage.tsx` in app-management — the page file IS the config |
| **Risk of registry drift** (capability registered for some entities, not others, silently) | Possible — relies on runtime registration | Impossible — the factory enforces config at type-check time |

### Why v2 is better (summary)

1. **Naming matches behavior.** `ArchivedEntityPageConfig` vs `EntityModalAdapter` grown a fifth leg.
2. **Colocation over registration.** No cross-package wiring for per-entity behavior that's genuinely owned by each entity.
3. **Type-checked at configuration.** The factory takes all required closures as typed parameters — a missing `restore` is a compile error, not a silent runtime gap.
4. **Lighter mental model.** To understand apps' archived page, open one file. In v1, you open the shell, trace the registry, find the adapter registration, read the capability fields. Same information, fewer hops.
5. **Matches house style.** Factories (`createPaginatedEntityStore`, `createEntityAdapter`, `createEntityActionHook`, `createUseStyles`) are already the dominant composition pattern in this codebase.

### Where v1 wins

1. **One-stop entity configuration.** If you believe the codebase is trending toward every git-based entity having a single "adapter file" that describes commit + save + delete + archive + anything future, v1's registry is a natural home for that. v2 spreads per-capability config across files.
2. **Modal + archive coherence.** If, later, we want the archived row's restore action to dispatch through the existing `EntityActionProvider` (e.g. to show a global restore toast), v1's adapter is already wired to it.

Both of those are speculative. YAGNI says: don't architect for them today.

## Recommendation

Build v2. It's the same feature, slightly less code, zero new patterns, better naming, better colocation, and it leaves the v1 door open (a future PR can register a "catalog of all entity adapters" anytime — it just doesn't need to exist on day one).

## Follow-ups (same as v1)

- Bulk restore (column-0 checkboxes exist in mockup but inert in v1/v2).
- Permanent delete (needs backend endpoint).
- Archived revisions/variants in version history.
- Environments and queries archived views.
