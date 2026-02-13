# Shared Entity Utilities

This directory contains the core infrastructure for entity state management using the **Molecule** pattern - a unified, framework-agnostic approach for managing related Jotai atoms.

## Module Structure

```
shared/
├── molecule/         # Single entity molecule pattern
│   ├── createMolecule.ts           # Base molecule factory
│   ├── extendMolecule.ts           # Extension helper
│   ├── createControllerAtomFamily.ts
│   ├── createEntityController.ts   # Controller pattern factory
│   ├── createEntityDraftState.ts   # Draft state utilities
│   ├── createLocalMolecule.ts      # Client-only entities
│   ├── types.ts                    # Type definitions
│   └── index.ts
├── relations/        # Entity parent-child relationships
│   ├── registry.ts                 # Central relation registry
│   ├── extendWithRelations.ts      # Molecule extension helper
│   ├── bindings.ts                 # Cross-domain binding utilities
│   └── index.ts
├── utils/            # Common utilities
│   ├── schema.ts                   # Schema navigation & defaults
│   ├── transforms.ts               # Date parsing, normalization
│   ├── helpers.ts                  # ID utils, batch operations
│   └── index.ts
├── createEntityDataController.ts   # Data controller factory for entity tables
└── index.ts          # Public exports
```

> **Note:** Pagination for entity tables is handled by `InfiniteVirtualTableFeatureShell`
> via paginated stores (e.g., `testcasePaginatedStore`, `testsetMolecule.paginated`).
> The deprecated `list/` molecule patterns have been removed.

---

## Quick Reference

### API Structure

Every molecule provides these APIs:

```typescript
molecule.atoms.*        // Atom families for reactive subscriptions
molecule.reducers.*     // Write operations
molecule.get.*          // Imperative reads (snapshot from store)
molecule.set.*          // Imperative writes
molecule.useController  // React hook combining atoms + dispatch
molecule.cleanup.*      // Memory management
```

### Usage Decision Tree

```
Where are you using it?
         │
    ┌────┼────┐
    │    │    │
 React  Atom  Callback
    │    │    │
    ▼    ▼    ▼
useAtom  get(mol.   mol.get.*
         atoms.*)   mol.set.*
```

---

## Core Types

### MoleculeAtoms

| Atom | Type | Description |
|------|------|-------------|
| `data` | `T \| null` | Entity with draft merged |
| `serverData` | `T \| null` | Raw server data |
| `draft` | `TDraft \| null` | Local changes only |
| `query` | `QueryState<T>` | Query state (isPending, isError) |
| `isDirty` | `boolean` | Has unsaved local changes |
| `isNew` | `boolean` | Entity not yet on server |

### MoleculeReducers

| Reducer | Signature | Description |
|---------|-----------|-------------|
| `update` | `(id, changes)` | Merge changes into draft |
| `discard` | `(id)` | Clear draft, revert to server |

---

## Usage Examples

### 1. React Components - Full Controller

```typescript
import { testcaseMolecule } from '@agenta/entities/testcase'

function TestcaseEditor({ id }: { id: string }) {
  const [state, dispatch] = testcaseMolecule.useController(id)

  if (state.isPending) return <Skeleton />
  if (!state.data) return <NotFound />

  return (
    <Input
      value={state.data.input}
      onChange={(e) => dispatch.update({ input: e.target.value })}
    />
  )
}
```

### 2. Fine-Grained Subscriptions

```typescript
// Only re-renders when isDirty changes
function DirtyIndicator({ id }: { id: string }) {
  const isDirty = useAtomValue(testcaseMolecule.atoms.isDirty(id))
  return isDirty ? <Badge>Modified</Badge> : null
}
```

### 3. Plain Atoms (Derived State)

```typescript
const summaryAtom = atom((get) => {
  const data = get(testcaseMolecule.atoms.data(testcaseId))
  const isDirty = get(testcaseMolecule.atoms.isDirty(testcaseId))
  return { data, isDirty }
})
```

### 4. Imperative API (Callbacks)

```typescript
async function handleSave(id: string) {
  const data = testcaseMolecule.get.data(id)
  if (!data || !testcaseMolecule.get.isDirty(id)) return

  await api.save(data)
  testcaseMolecule.set.discard(id)
}
```

---

## Factory: createMolecule

Creates a base molecule with all core functionality.

```typescript
interface CreateMoleculeConfig<T, TDraft = Partial<T>> {
  name: string
  queryAtomFamily: AtomFamily<QueryState<T>>
  draftAtomFamily: AtomFamily<TDraft | null>
  transform?: (serverData: T) => T
  merge?: (serverData: T | null, draft: TDraft | null) => T | null
  isDirty?: (serverData: T | null, draft: TDraft | null) => boolean
  isNewEntity?: (id: string) => boolean
}
```

---

## Extension Pattern

For entity-specific features, use `extendMolecule`:

```typescript
import { createMolecule, extendMolecule } from '@agenta/entities/shared'

const baseMolecule = createMolecule<Entity>({
  name: 'entity',
  queryAtomFamily,
  draftAtomFamily,
})

export const entityMolecule = extendMolecule(baseMolecule, {
  atoms: {
    cell: cellAtomFamily,
    columns: columnsAtom,
  },
  reducers: {
    addColumn: addColumnReducer,
  },
})
```

---

## Local Molecule Pattern

For client-only entities that never sync to a server:

```typescript
import { createLocalMolecule } from '@agenta/entities/shared'

const localMolecule = createLocalMolecule<Entity>({
  name: 'localEntity',
  createDefault: () => ({ data: {} }),
  validate: (entity) => entitySchema.parse(entity),
})

// Create
const id = localMolecule.set.create({ data: { name: 'Test' } })

// Read
const entity = localMolecule.get.data(id)

// Update
localMolecule.set.update(id, { data: { name: 'Updated' } })

// Delete
localMolecule.set.delete(id)
```

---

## Controller Pattern

The controller pattern provides a unified API for entities used with DrillInView components:

```typescript
import { createEntityController } from '@agenta/entities/shared'

const { controller, selectors, actions } = createEntityController({
  name: 'entity',
  queryAtomFamily,
  draftAtomFamily,
  drillIn: {
    getValueAtPath: (data, path) => getValueAtPathUtil(data, path),
    getRootItems: (data) => Object.entries(data).map(([key, value]) => ({
      key,
      value,
      type: typeof value,
    })),
  },
})

// Usage
const [state, dispatch] = useAtom(controller(entityId))
dispatch({ type: 'setAtPath', path: ['name'], value: 'New Name' })
```

---

## Factory: createEntityDataController

Creates a unified data controller for entity table components. Provides selection state,
derived selectors (allRowIds, totalCount, selectedCount, isAllSelected, isSomeSelected),
and action atoms (set, toggle, selectAll, clear, reset) automatically.

Entity modules only need to provide how to get rows, loading state, and columns.

```typescript
import { createEntityDataController, type EntityDataConfigBase } from '@agenta/entities/shared'

interface MyConfig extends EntityDataConfigBase {
  revisionId?: string | null
  pageSize?: number
}

const myDataController = createEntityDataController<MyRow, MyConfig>({
  rows: (config) => atom((get) => {
    if (config.useLocal) return get(localRowsAtom)
    return get(paginatedStore.selectors.state(config)).rows
  }),
  isLoading: (config) => atom((get) => {
    return get(paginatedStore.selectors.state(config)).isFetching
  }),
  columns: (config) => atom((get) => {
    const rows = get(myDataController.selectors.rows(config))
    return extractColumnsFromData(rows)
  }),
  configEquals: (a, b) => a.scopeId === b.scopeId && a.revisionId === b.revisionId,
})

// Usage
const rows = useAtomValue(myDataController.selectors.rows(config))
const selectedIds = useAtomValue(myDataController.selectors.selectedIds(config.scopeId))
const setSelection = useSetAtom(myDataController.actions.setSelection)
```

### Controller API

| Category | API | Description |
|----------|-----|-------------|
| **Selectors** | `rows(config)` | Rows from configured data source |
| | `isLoading(config)` | Loading state |
| | `columns(config)` | Column definitions |
| | `allRowIds(config)` | All row IDs |
| | `totalCount(config)` | Total row count |
| | `selectedIds(scopeId)` | Selected IDs as Set |
| | `selectedIdsArray(scopeId)` | Selected IDs as array |
| | `selectedCount(scopeId)` | Number of selected items |
| | `isAllSelected(config)` | Are all rows selected? |
| | `isSomeSelected(config)` | Some (but not all) selected? |
| **Actions** | `setSelection` | Set selection: `(scopeId, ids)` |
| | `toggleSelection` | Toggle item: `(scopeId, id, multiSelect?)` |
| | `selectAll` | Select all: `(scopeId, allIds)` |
| | `clearSelection` | Clear: `(scopeId)` |
| | `resetSelection` | Reset + cleanup: `(scopeId)` |

### Pairing with EntityTable

Entity-specific table components become thin wrappers:

```typescript
import { EntityTable } from '@agenta/entity-ui'

<EntityTable
  controller={myDataController}
  config={config}
  getRowData={(record) => record as Record<string, unknown>}
  selectable
  grouping
/>
```

---

## Utilities

### Schema Utilities

```typescript
import {
  getSchemaAtPath,
  getDefaultValue,
  createDefaultArrayItem,
} from '@agenta/entities/shared'

const schema = { type: 'object', properties: { name: { type: 'string' } } }
const nameSchema = getSchemaAtPath(schema, ['name'])
const defaultName = getDefaultValue(nameSchema)
```

### Transform Utilities

```typescript
import {
  createTimestampNormalizer,
  composeTransforms,
  parseISODate,
} from '@agenta/entities/shared'

// Normalize dates for WebKit compatibility
const normalizeTimestamps = createTimestampNormalizer(['created_at', 'updated_at'])
const transform = composeTransforms(normalizeTimestamps, customTransform)
```

### ID Utilities

```typescript
import {
  isLocalId,
  isServerId,
  generateLocalId,
} from '@agenta/entities/shared'

const localId = generateLocalId() // 'local-1704067200000-abc123'
isLocalId(localId)  // true
isServerId(uuid)    // true
```

### Batch Operations

```typescript
import { batchUpdate, batchCreate, batchDelete } from '@agenta/entities/shared'

batchUpdate(molecule, [
  { id: 'tc-1', changes: { name: 'First' } },
  { id: 'tc-2', changes: { name: 'Second' } },
])

const newIds = batchCreate(localMolecule, [
  { name: 'Item 1' },
  { name: 'Item 2' },
])
```

---

## Latest Entity Query Factory

For fetching the "latest" version of an entity (e.g., latest revision per testset), use `createLatestEntityQueryFactory`:

```typescript
import { createLatestEntityQueryFactory } from '@agenta/entities/shared'

const latestRevisionQuery = createLatestEntityQueryFactory<Revision>({
  queryKeyPrefix: 'latest-revision',
  fetchFn: (parentId, projectId) => fetchLatestRevision({ parentId, projectId }),
  staleTime: 30_000,
})

// Exported atoms
export const latestRevisionQueryAtomFamily = latestRevisionQuery.queryAtomFamily
export const latestRevisionStatefulAtomFamily = latestRevisionQuery.statefulAtomFamily
export const requestLatestRevisionAtom = latestRevisionQuery.requestAtom
```

### Usage in Components

```typescript
// Request latest revision (enables the query)
const request = useSetAtom(requestLatestRevisionAtom)
request({ parentId: testsetId, projectId })

// Read latest revision with loading state
const { data, isPending } = useAtomValue(latestRevisionStatefulAtomFamily(testsetId))
```

### Why This Pattern?

1. **Explicit enabling**: Queries are disabled until `requestAtom` is called
2. **Project context**: Stores projectId per parent entity (avoids global state timing issues)
3. **Optimized fetching**: Use with batch fetchers to minimize API calls
4. **Reusable**: Same pattern for any entity with a "latest" concept

---

## Entity Relations

Define and query parent-child relationships between entities.

### Overview

The relations system provides:

- **Relation Registry** - Central store for all entity relationships
- **extendWithRelations** - Extend molecules with relation-derived atoms
- **Path Discovery** - Query hierarchies (e.g., `app → variant → revision`)

### Quick Start

```typescript
import {
  EntityRelation,
  entityRelationRegistry,
  extendWithRelations,
} from '@agenta/entities/shared'

// 1. Define a relation
const testcaseRelation: EntityRelation<Revision, Testcase> = {
  name: "testcases",
  parentType: "revision",
  childType: "testcase",
  childIdsPath: (rev) => rev.data?.testcase_ids ?? [],
  childDataPath: (rev) => rev.data?.testcases,
  childMolecule: testcaseMolecule,
  mode: "populate", // Use embedded data if available
}

// 2. Register for global discovery
entityRelationRegistry.register(testcaseRelation)

// 3. Extend molecule with relation atoms
const revisionWithTestcases = extendWithRelations(revisionMolecule, {
  testcases: testcaseRelation,
})

// 4. Use in components
const testcaseIds = useAtomValue(revisionWithTestcases.atoms.testcasesIds(revisionId))
const testcases = useAtomValue(revisionWithTestcases.atoms.testcases(revisionId))
```

### EntityRelation Interface

```typescript
interface EntityRelation<TParent, TChild> extends MoleculeRelation<TParent, TChild> {
  // From MoleculeRelation:
  name: string                                          // Relation name (e.g., "variants")
  childIdsPath: string | ((parent: TParent) => string[]) // How to extract child IDs
  childDataPath?: string | ((parent: TParent) => TChild[] | undefined) // Embedded data
  childMolecule: Molecule<TChild, unknown>              // Child entity molecule
  mode: "populate" | "reference"                        // Embedded vs fetched

  // Extended properties:
  parentType: string              // e.g., "app", "testset"
  childType: string               // e.g., "variant", "revision"

  /** Atom family for list queries (selection UIs) */
  listAtomFamily?: (parentId: string) => Atom<ListQueryState<TChild>>

  /** Selection UI metadata */
  selection?: RelationSelectionConfig

  /** Binding configuration (for loadable/runnable connections) */
  binding?: RelationBindingConfig
}

interface RelationSelectionConfig {
  label: string                                   // Display label (e.g., "Variant")
  autoSelectSingle?: boolean                      // Auto-select if only one option
  autoSelectLatest?: boolean                      // Auto-select most recent
  displayName?: (entity: unknown) => string       // Custom display name
}

interface RelationBindingConfig {
  getId: (type: string, id: string) => string                      // Generate binding ID
  parseId: (bindingId: string) => { type: string; id: string } | null // Parse binding ID
}
```

### Relation Registry

```typescript
import { entityRelationRegistry } from '@agenta/entities/shared'

// Register relations
entityRelationRegistry.register(appToVariantRelation)
entityRelationRegistry.register(variantToRevisionRelation)

// Query hierarchy
const children = entityRelationRegistry.getChildren("app") // ["variant"]
const parents = entityRelationRegistry.getParents("variant") // ["app"]

// Get full path
const path = entityRelationRegistry.getPath("app", "appRevision")
// Returns: ["app", "variant", "appRevision"]

// Validate path
entityRelationRegistry.isValidPath(["app", "variant", "appRevision"]) // true
```

### Modes: Populate vs Reference

```typescript
// POPULATE: Child data is embedded in parent
// → Use embedded data directly, no extra fetches
const relation = {
  mode: "populate",
  childDataPath: (rev) => rev.data?.testcases, // Embedded array
}

// REFERENCE: Only child IDs in parent
// → Fetch children via child molecule
const relation = {
  mode: "reference",
  childIdsPath: (app) => app.variantIds, // Array of IDs
  // No childDataPath - must fetch from childMolecule
}
```

### One-Off Relation Atoms

When you don't need to extend the molecule:

```typescript
import { createRelationIdsAtom, createRelationDataAtom } from '@agenta/entities/shared'

// Create atoms for specific parent ID
const testcaseIdsAtom = createRelationIdsAtom(revisionMolecule, revisionId, testcaseRelation)
const testcasesAtom = createRelationDataAtom(revisionMolecule, revisionId, testcaseRelation)
```

### Binding Utilities

For cross-domain connections (e.g., linking loadable data sources to runnable executors), use the binding utilities:

```typescript
import {
  getLoadableId,
  parseLoadableId,
  isLoadableBindingId,
  getLoadableEntityType,
  getLoadableEntityId,
} from '@agenta/entities/shared'

// Generate a loadable binding ID
const loadableId = getLoadableId('revision', 'rev-123')
// → "testset:revision:rev-123"

// Parse a loadable binding ID
const parsed = parseLoadableId(loadableId)
// → { type: 'revision', id: 'rev-123', format: 'testset' }

// Validation and extraction
isLoadableBindingId('testset:revision:abc-123') // true
getLoadableEntityType('testset:revision:abc-123') // 'revision'
getLoadableEntityId('testset:revision:abc-123')   // 'abc-123'
```

### Pre-Defined Relation Modules

Entity modules define and auto-register their relations on import:

| Module | Relations | Hierarchy |
|--------|-----------|-----------|
| `@agenta/entities/appRevision` | `appToVariantRelation`, `variantToRevisionRelation` | App → Variant → AppRevision |
| `@agenta/entities/testset` | `testsetToRevisionRelation`, `revisionToTestcaseRelation` | Testset → Revision → Testcase |

```typescript
// Relations are auto-registered when the module is imported
import { appToVariantRelation, variantToRevisionRelation } from '@agenta/entities/appRevision'
import { testsetToRevisionRelation } from '@agenta/entities/testset'

// The registry now knows about the full hierarchy
entityRelationRegistry.getPath("app", "appRevision")
// → ["app", "variant", "appRevision"]
```

### Circular Dependency Prevention

Within each entity module, `relations.ts` imports the molecule to populate `childMolecule`.
This dependency is **one-way** — molecules must never import from `relations.ts`:

```text
relations.ts  ──imports──▶  state/molecule.ts    ✓  (provides childMolecule)
state/molecule.ts  ──imports──▶  relations.ts    ✗  FORBIDDEN (circular)
```

**Why this matters:** ES modules execute top-down. If module A is mid-execution and
module B tries to access a `const` export from A that hasn't been assigned yet,
JavaScript throws `ReferenceError: Cannot access 'X' before initialization`.

**If a molecule needs child IDs that a relation also extracts, inline the logic:**

```typescript
// In state/molecule.ts — GOOD: inline extraction
const childIds = atom((get) => {
  const data = get(parentMolecule.atoms.data(id))
  return data?.child_ids ?? []
})

// In state/molecule.ts — BAD: imports from relations.ts
import { parentToChildRelation } from "../relations"
const childIds = atom((get) => {
  const data = get(parentMolecule.atoms.data(id))
  return getChildIds(data, parentToChildRelation)
})
```

**Reference pattern:** `appRevision/state/molecule.ts` follows this rule correctly —
it does not import from `appRevision/relations.ts`.

---

## Memory Management

Molecules use `jotai-family` for explicit memory management:

```typescript
// Remove from cache
molecule.cleanup.remove(id)

// Auto-cleanup stale atoms
molecule.cleanup.setAutoCleanup((createdAt, id) => {
  return Date.now() - createdAt > 5 * 60 * 1000 // 5 minutes
})

// Get all cached IDs
const cachedIds = molecule.cleanup.getIds()
```

---

## Data Flow Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                    MOLECULE DATA FLOW                          │
└───────────────────────────────────────────────────────────────┘

┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   SERVER     │────▶│  TanStack    │────▶│   Query      │
│   (API)      │     │  Query Cache │     │   Atom       │
└──────────────┘     └──────────────┘     └──────────────┘
                                                 │
                                    atoms.serverData
                                                 │
                                                 ▼
                                        ┌──────────────────┐
┌──────────────┐                        │   atoms.data     │
│ atoms.draft  │───────────────────────▶│   (Merged)       │
│              │      Local Changes     │                  │
└──────────────┘                        └──────────────────┘
       ▲                                         │
       │ reducers.update                         │
       │                                         ▼
┌──────────────┐                        ┌──────────────────┐
│  Component   │◀───────────────────────│  useController   │
│  (UI)        │     [state, dispatch]  │                  │
└──────────────┘                        └──────────────────┘
```

**Single Source of Truth:**
- `atoms.serverData` extracts `query.data`
- `atoms.draft` stores local changes only
- `atoms.data` merges: `serverData + draft → merged entity`
- `atoms.isDirty` compares: `draft !== null`

---

## List Counts API

The list counts API provides a unified way to display count summaries for paginated and regular lists.
It handles the complexity of cursor-based pagination, local additions/deletions, and display formatting.

### Overview

```typescript
import {
  EntityListCounts,
  TotalCountMode,
  createPaginatedListCountsAtom,
  createListCountsAtom,
} from '@agenta/entities/shared'
```

### EntityListCounts Interface

```typescript
interface EntityListCounts {
  loadedCount: number        // Rows currently loaded (excludes skeletons)
  totalCount: number | null  // Server total (null if unknown)
  hasMore: boolean           // More pages available (cursor-based)
  isTotalKnown: boolean      // Is totalCount reliable?
  displayLabel: string       // e.g., "12 of 40", "12+", "12 of 40+"
  displayLabelShort: string  // e.g., "12", "12+"
  displaySuffix: "+" | ""    // "+" if hasMore, "" otherwise
}
```

### Display Rules

The API uses cursor presence as the canonical signal for "has more":

- If `hasMore` is true → display suffix `"+"`
- If `totalCount` is unknown → show `"loadedCount+"`
- If `totalCount` is known and `hasMore` is true → show `"loadedCount of totalCount+"`
- If `hasMore` is false → show `"loadedCount"` or `"loadedCount of totalCount"`

### TotalCountMode

Controls how the server's `totalCount` is interpreted:

| Mode | Behavior |
|------|----------|
| `"total"` | `totalCount` is a real server total (display exact count) |
| `"page"` | Treat as page count (display `+` if `hasMore` is true) |
| `"unknown"` | Ignore `totalCount`, display `+` when cursor is present |

### Using with Paginated Stores

Paginated stores have a built-in `listCounts` selector:

```typescript
import { testcasePaginatedStore } from '@agenta/entities/testcase'

// In component
const params = useMemo(() => ({ scopeId, pageSize: 50 }), [scopeId])
const countsAtom = useMemo(
  () => testcasePaginatedStore.selectors.listCounts(params),
  [params]
)
const counts = useAtomValue(countsAtom)

// Use the display label
<span>{counts.displayLabel}</span> // "35+" or "35 of 100+"
```

### Using with Data Controllers

Data controllers also expose list counts:

```typescript
import { testcaseDataController } from '@agenta/entities/testcase'

const config = useMemo(() => ({ scopeId, revisionId, pageSize: 50 }), [scopeId, revisionId])

// Full counts object
const counts = useAtomValue(testcaseDataController.selectors.listCounts(config))

// Or use convenience selectors
const displayLabel = useAtomValue(testcaseDataController.selectors.displayLabel(config))
const hasMore = useAtomValue(testcaseDataController.selectors.hasMore(config))
const loadedCount = useAtomValue(testcaseDataController.selectors.loadedCount(config))
```

### Using with LoadMoreButton

The `LoadMoreButton` component accepts an optional `counts` prop:

```typescript
import { LoadMoreButton } from '@agenta/ui'

// With counts object (recommended)
<LoadMoreButton
  counts={counts}
  onClick={loadMore}
  isLoading={isFetching}
  showCount
/>

// Or with individual props (backward compatible)
<LoadMoreButton
  onClick={loadMore}
  isLoading={isFetching}
  hasMore={hasMore}
  loadedCount={loadedCount}
  totalCount={totalCount}
  showCount
/>
```

### Creating Custom List Counts

For non-paginated lists:

```typescript
import { createListCountsAtom } from '@agenta/entities/shared'

const countsAtom = createListCountsAtom(myListAtom)
// Returns: { loadedCount: N, totalCount: N, hasMore: false, ... }
```

For custom pagination state:

```typescript
import { createListCountsFromPaginationAtom } from '@agenta/entities/shared'

const countsAtom = createListCountsFromPaginationAtom(
  myRowsAtom,
  myPaginationAtom,
  { totalCountMode: 'unknown' }
)
```

### Configuring Paginated Stores

When creating a paginated store, configure list counts behavior:

```typescript
const myPaginatedStore = createPaginatedEntityStore({
  entityName: 'myEntity',
  metaAtom: myMetaAtom,
  fetchPage: myFetchFn,
  rowConfig: { getRowId: (row) => row.id, skeletonDefaults },
  // Configure list counts
  listCountsConfig: {
    totalCountMode: 'unknown', // or 'total' for known totals
    isRowCountable: (row) => !row.__isSkeleton, // custom filter
  },
})
```

---

## Anti-Patterns

### Using atoms in callbacks without imperative API

```typescript
// BAD - atoms require React context
async function handleSave(id: string) {
  const data = useAtomValue(molecule.atoms.data(id)) // Won't work!
}

// GOOD - use imperative API
async function handleSave(id: string) {
  const data = molecule.get.data(id)
}
```

### Creating atoms in render without memoization

```typescript
// BAD - new atom every render
const derived = atom((get) => get(molecule.atoms.data(id)))

// GOOD - memoize the atom
const derived = useMemo(
  () => atom((get) => get(molecule.atoms.data(id))),
  [id]
)
```

### Forgetting cleanup

```typescript
// BAD - memory leak
useEffect(() => {
  // Entity atoms accumulate forever
}, [])

// GOOD - cleanup on unmount
useEffect(() => {
  return () => molecule.cleanup.remove(id)
}, [id])
```
