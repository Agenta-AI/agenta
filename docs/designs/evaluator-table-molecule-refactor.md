# IVT Table Refactor: Lean Cache + Molecule Cells

A reusable pattern for migrating Infinite Virtual Tables from fat row objects to lean ID-only rows with molecule-backed cell renderers. Implemented and validated on the Evaluators table.

---

## Core Principle

**Paginated store → row IDs + bare sort fields only. Molecules → all display data.**

The table's `fetchPage` returns a page of API objects. `transformRow` strips each object down to its stable IDs and the minimum fields needed for grouping/sorting — nothing else. Cell components subscribe to the entity molecule per ID to get display data on demand.

**Why this matters:**

| Concern | Fat rows (old) | Lean rows + molecules (new) |
|---------|---------------|------------------------------|
| TanStack Query cache size | Full API response objects per row | ~6 scalar fields per row |
| Cell re-renders on pagination | Every row re-renders when list refetches | Only cells whose molecule data changed |
| Data freshness after mutation | Stale until full table refetch | Molecule invalidation propagates instantly |
| Deduplication | Same entity data stored in list cache + row object + possibly a module-level map | Single source of truth in entity molecule |

---

## Pattern Overview

### 1. Row type — IDs + bare sort fields only

```typescript
export interface MyTableRow {
    key: string
    __isSkeleton?: boolean
    // Tree/grouping markers (if applicable)
    __isGroupParent?: boolean
    __isGroupChild?: boolean
    __childCount?: number
    // Stable IDs — passed to molecule selectors by cells
    revisionId: string
    workflowId: string
    variantId: string
    // The ONLY non-ID fields allowed on the row:
    // fields that cannot come from a molecule because grouping/sorting
    // logic runs before any cells mount.
    version: number | null           // sort order
    revisionCreatedAt: string | null // date sort + "Date Created" display
    [k: string]: unknown
}
```

**Rule of thumb:** if a field is only ever rendered inside a cell, it belongs in the molecule, not the row.

**Exception:** fields used by grouping logic (building the tree, determining sort order) before any cell mounts must stay on the row. `version` and `revisionCreatedAt` are the canonical examples.

---

### 2. `transformRow` — strip everything except IDs + sort fields

```typescript
transformRow: (apiRow): MyTableRow => ({
    key: apiRow.id,
    revisionId: apiRow.id,
    workflowId: apiRow.workflow_id ?? "",
    variantId: apiRow.workflow_variant_id ?? apiRow.variant_id ?? "",
    version: apiRow.version ?? null,
    revisionCreatedAt: apiRow.created_at ?? null,
}),
```

When `transformRow` is provided to `createPaginatedEntityStore`, the lean row object is what TanStack Query caches — not the full API response. This is the primary cache-size win. In development the store logs the cached size:

```
[evaluator] query cache: 72 rows, 8.2KB stored in TanStack Query cache
// vs. without transformRow:
[evaluator] query cache: 72 rows, 412KB stored in TanStack Query cache
```

---

### 3. Seeding parent/group entities

For grouped tables, the group parent row needs display data (name, slug) for the workflow-level entity — not a revision. Fetch the parent list once, seed each entity into the molecule immediately, then cache only the IDs:

```typescript
async function ensureWorkflowIdCache(projectId, category) {
    const cacheKey = `${projectId}:${category}`
    if (_workflowIdCache?.key === cacheKey) return _workflowIdCache

    const response = await queryWorkflows({projectId, flags})
    const workflows = response.workflows.filter((w) => !w.deleted_at)

    const workflowIds: string[] = []
    for (const w of workflows) {
        workflowIds.push(w.id)
        // Seed so group parent cells resolve immediately without a fetch
        workflowMolecule.set.seedEntity(w.id, w)
    }

    _workflowIdCache = {key: cacheKey, workflowIds}
    return _workflowIdCache
}
```

**`seedEntity` writes to `workflowLocalServerDataAtomFamily(id)`** — the same backing atom that `workflowEntityAtomFamily` checks first. Seeded data resolves synchronously, no query fired.

**Do NOT seed revisions.** Revision cells subscribe to `workflowQueryAtomFamily(revisionId)` which is an `atomWithQuery` — it fetches on demand and populates the molecule automatically.

---

### 4. Cell renderers — subscribe to scalar atom families

The critical insight: **never subscribe to a full entity object or a TanStack Query state object inside a cell.** Both produce new object references on every state transition, causing React's subscription callback to loop → max update depth error.

Instead, derive scalar (`string | null`, `boolean`, `string[]`) atom families from molecule selectors at module level. Primitives with the same value are always `===` equal — subscriptions never fire spuriously.

#### ❌ What causes max update depth

```typescript
// BAD — returns a full Workflow object (new reference every render)
const entity = useAtomValue(workflowMolecule.selectors.data(revisionId))
const name = entity?.name ?? "—"

// BAD — returns TanStack Query state object (new reference on every transition)
const query = useAtomValue(workflowMolecule.atoms.query(revisionId))
const name = query.data?.name ?? "—"
```

#### ✅ Scalar atom families at module level

Define these once, outside any component. `atomFamily` memoizes by key — same ID → same atom instance.

```typescript
import {atom, useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"
import {getDefaultStore} from "jotai/vanilla"
import {workflowMolecule} from "@agenta/entities/workflow"

// One scalar family per piece of data needed
const workflowNameAtomFamily = atomFamily((id: string) =>
    atom<string | null>((get) => get(workflowMolecule.selectors.name(id))),
)
const workflowSlugAtomFamily = atomFamily((id: string) =>
    atom<string | null>((get) => get(workflowMolecule.selectors.slug(id))),
)
const workflowKeyAtomFamily = atomFamily((id: string) =>
    atom<string | null>((get) => get(workflowMolecule.selectors.workflowKey(id))),
)
const workflowUpdatedAtAtomFamily = atomFamily((id: string) =>
    atom<string | null>((get) => {
        const entity = get(workflowMolecule.selectors.data(id))
        return entity?.updated_at ?? entity?.created_at ?? null
    }),
)
const workflowUpdatedByIdAtomFamily = atomFamily((id: string) =>
    atom<string | null>((get) => {
        const entity = get(workflowMolecule.selectors.data(id))
        return entity?.updated_by_id ?? entity?.created_by_id ?? null
    }),
)
const workflowOutputSchemaKeysAtomFamily = atomFamily((id: string) =>
    atom<string[]>((get) => {
        const entity = get(workflowMolecule.selectors.data(id))
        const props = resolveOutputSchemaProperties(entity?.data)
        return props ? Object.keys(props) : []
    }),
)
```

Note: for derived values that are still objects (like `string[]`), the array is a new reference on every evaluation. `atomFamily` + `atom` don't run equality checks on arrays by default. If this causes churn, extract to a JSON-stable primitive (e.g. `JSON.stringify(keys)`) or use `selectAtom` with `deepEqual`. In practice `string[]` of schema keys is stable enough because `resolveOutputSchemaProperties` only changes when the entity data changes.

---

### 5. `useDefaultStoreAtomValue` — cross-provider reads

IVT cell renderers run inside an isolated Jotai `Provider`. Entity atoms live in the **default store**. Reading them with plain `useAtomValue` inside the IVT provider returns `undefined`.

```typescript
const defaultStore = getDefaultStore()

function useDefaultStoreAtomValue<T>(atomArg: Atom<T>): T {
    return useAtomValue(atomArg, {store: defaultStore})
}
```

Use this hook for every atom read inside cell renderers. This is the only IVT-specific concern — outside cell renderers (normal React tree), use plain `useAtomValue`.

---

### 6. Cell renderer pattern

```typescript
import {memo} from "react"

const NameCell = memo(({revisionId, version, isGroupChild}: {
    revisionId: string
    version: number | null
    isGroupChild: boolean
}) => {
    // ✅ scalar primitive — referentially stable
    const name = useDefaultStoreAtomValue(workflowNameAtomFamily(revisionId))
    const slug = useDefaultStoreAtomValue(workflowSlugAtomFamily(revisionId))
    const displayName = name ?? slug ?? "—"

    return (
        <div className={isGroupChild ? "pl-6" : ""}>
            {displayName}
            {version != null && <Tag>v{version}</Tag>}
        </div>
    )
})
```

Key practices:
- Always `memo()` cell components — they receive stable props (IDs, primitives)
- Always guard `if (record.__isSkeleton) return <SkeletonLine />` before any molecule read — skeleton rows have empty IDs that would trigger unwanted fetches
- Pass IDs as props, not full `record` objects — keeps the component interface minimal and avoids prop reference churn

---

### 7. Fields that should stay on the row vs. come from molecules

| Field | Where | Why |
|-------|-------|-----|
| `revisionId` | Row | Molecule key |
| `workflowId` | Row | Molecule key for group parent |
| `variantId` | Row | Molecule key for variant-level lookups |
| `version` | Row | Grouping sort order — needed before cells mount |
| `revisionCreatedAt` | Row | "Date Created" column + sort — revision API always returns this; workflow list may not |
| `name`, `slug` | Molecule | Display only |
| `evaluatorKey` / URI | Molecule | Display only (`workflowMolecule.selectors.workflowKey`) |
| `updated_at`, `updated_by_id` | Molecule | Display only |
| `message` (commit) | Molecule | Display only |
| `outputProperties` (schema) | Molecule | Display only, derived in scalar atomFamily |
| `tags` | Molecule | Display only, comes from template data not entity |

**Special case — "Date Created":** The revision `created_at` is reliably present on revision API responses but may be absent on workflow list responses. Store it as `revisionCreatedAt` on the row and read it directly in the column renderer — no molecule needed.

```typescript
// Column factory — reads directly from row, no molecule
{
    type: "text",
    key: "createdAt",
    title: "Date Created",
    render: (_value, record) => {
        if (record.__isSkeleton) return <SkeletonLine width="50%" />
        return <DateCell date={record.revisionCreatedAt as string | null} />
    },
},
```

---

## Applying to Other Tables

### Checklist

1. **Slim the row type** — remove every field that is only used for display
2. **Update `transformRow`** — keep only IDs + sort/grouping fields
3. **Verify `skeletonDefaults`** matches the new lean row shape
4. **Define scalar `atomFamily` instances** at module level in the columns file
5. **Add `useDefaultStoreAtomValue`** hook (copy from evaluatorColumns or extract to shared)
6. **Update each cell renderer** — replace `record.someField` reads with `useDefaultStoreAtomValue(scalarAtomFamily(record.entityId))`
7. **Guard skeletons** — every cell must early-return a skeleton before reading any atom
8. **Seed group parent entities** in the store's page-fetch preamble if applicable
9. **Run lint-fix** — scalar `atomFamily` definitions are module-level `const`s; the linter will flag them as unused if not wired into cells

### Common mistakes

**Subscribing to `selectors.data(id)` directly in a cell**

Even though `data` is a named selector on the molecule, it returns a full object (`Workflow | null`). Every state change produces a new object reference, causing the subscription to fire every render cycle.

```typescript
// ❌ — will cause max update depth
const entity = useDefaultStoreAtomValue(workflowMolecule.selectors.data(id))
const name = entity?.name
```

**Subscribing to `atoms.query(id)` directly in a cell**

`atoms.query` returns the raw TanStack Query state object `{data, isPending, isError, error}`. This object is recreated on every query state transition (loading → success, stale → fetching, etc.).

```typescript
// ❌ — will cause max update depth
const q = useDefaultStoreAtomValue(workflowMolecule.atoms.query(id))
const name = q.data?.name
```

**Using `useAtomValue` without `{store: defaultStore}` in IVT cells**

IVT wraps each row in an isolated Jotai Provider. Entity atoms registered in the default store are invisible to it.

```typescript
// ❌ — returns undefined inside IVT cells
const name = useAtomValue(workflowNameAtomFamily(id))

// ✅
const name = useDefaultStoreAtomValue(workflowNameAtomFamily(id))
```

**Putting scalar atomFamilies inside the component or column factory function**

Every render creates a new `atom(...)` instance. `atomFamily`'s memoization only works when the factory call is stable.

```typescript
// ❌ — new atom instance every render, no memoization
const NameCell = ({id}) => {
    const nameAtom = atomFamily((id) => atom((get) => get(workflowMolecule.selectors.name(id))))
    const name = useDefaultStoreAtomValue(nameAtom(id))
    ...
}

// ✅ — defined once at module level
const workflowNameAtomFamily = atomFamily((id: string) =>
    atom<string | null>((get) => get(workflowMolecule.selectors.name(id))),
)
const NameCell = ({id}) => {
    const name = useDefaultStoreAtomValue(workflowNameAtomFamily(id))
    ...
}
```

---

## Files Changed in This Refactor

| File | Change |
|------|--------|
| `evaluatorsPaginatedStore.ts` | Slim `EvaluatorTableRow`; replace `WorkflowCacheEntry`/`_workflowCache` with `WorkflowIdCache`; `transformRow` strips to IDs + `version` + `revisionCreatedAt`; `ensureWorkflowIdCache` seeds workflow molecules |
| `evaluatorColumns.tsx` | Added `useDefaultStoreAtomValue`; added 7 scalar `atomFamily` instances; all cell renderers rewritten to use scalar atoms; `type: "date"` → `type: "text"` for "Date Created" column |

### What was removed

- `_workflowCache` module-level map (per-workflow name/slug/timestamps)
- `WorkflowCacheEntry`, `EvaluatorWorkflowCache` types
- `ensureWorkflowCache`, `clearEvaluatorWorkflowNameCache` exports
- All display fields (`name`, `slug`, `evaluatorKey`, `uri`, `outputProperties`, `tags`, `updatedAt`, `commitMessage`, `createdById`, `updatedById`) from `EvaluatorTableRow`
- Direct `workflowMolecule.selectors.data(id)` and `workflowMolecule.atoms.query(id)` reads inside cell components
