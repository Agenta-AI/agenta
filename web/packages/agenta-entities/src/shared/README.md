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
├── utils/            # Common utilities
│   ├── schema.ts                   # Schema navigation & defaults
│   ├── transforms.ts               # Date parsing, normalization
│   ├── helpers.ts                  # ID utils, batch operations
│   └── index.ts
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
