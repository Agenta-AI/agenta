# Testset Entity

This module provides state management for **testset** and **revision** entities using the molecule architecture.

## Overview

```
testset/
├── index.ts              # Public exports
├── README.md             # This file
├── core/                 # Schemas and types
│   ├── schema.ts         # Zod schemas
│   ├── types.ts          # TypeScript interfaces
│   └── index.ts          # Re-exports
├── api/                  # HTTP functions
│   ├── api.ts            # Fetch functions
│   ├── helpers.ts        # Cache utilities
│   └── index.ts          # Re-exports
└── state/                # State management
    ├── store.ts          # Query atom families
    ├── revisionMolecule.ts
    ├── testsetMolecule.ts
    └── index.ts          # Re-exports
```

## Quick Start

### Using the Molecule API

```typescript
import { revisionMolecule, testsetMolecule } from '@agenta/entities/testset'

// In components - use the React hook
function RevisionEditor({ revisionId }: { revisionId: string }) {
  const [state, dispatch] = revisionMolecule.useController(revisionId)

  if (state.isPending) return <Skeleton />
  if (!state.data) return <NotFound />

  return (
    <div>
      <h1>Revision v{state.data.version}</h1>
      <input
        value={state.data.message ?? ''}
        onChange={(e) => dispatch.update({ message: e.target.value })}
      />
      {state.isDirty && <span>Unsaved changes</span>}
      <button onClick={() => dispatch.discard()}>Discard</button>
    </div>
  )
}
```

### Using Atoms in Jotai

```typescript
import { revisionMolecule, testsetMolecule } from '@agenta/entities/testset'

// Subscribe to specific state
const data = useAtomValue(revisionMolecule.atoms.data(revisionId))
const isDirty = useAtomValue(revisionMolecule.atoms.isDirty(revisionId))

// List queries
const testsetsList = useAtomValue(testsetMolecule.atoms.list(null))
const searchResults = useAtomValue(testsetMolecule.atoms.list('my-search'))

// Testcase-derived columns
const columns = useAtomValue(revisionMolecule.atoms.testcaseColumns(revisionId))
```

### Imperative API (in callbacks)

```typescript
import { revisionMolecule } from '@agenta/entities/testset'

// Read state
const data = revisionMolecule.get.data(revisionId)
const isDirty = revisionMolecule.get.isDirty(revisionId)

// Write state
revisionMolecule.set.update(revisionId, { message: 'New message' })
revisionMolecule.set.discard(revisionId)
```

## Molecule API

### `revisionMolecule`

Manages revision entity state.

#### Atoms

| Atom | Description |
|------|-------------|
| `.atoms.data(id)` | Merged data (server + draft) |
| `.atoms.serverData(id)` | Server data only |
| `.atoms.draft(id)` | Local draft changes |
| `.atoms.query(id)` | Query state (isPending, isError, error) |
| `.atoms.isDirty(id)` | Has unsaved changes |
| `.atoms.isNew(id)` | Is new entity |
| `.atoms.withTestcases(id)` | Revision with testcases included |
| `.atoms.testcaseColumns(id)` | Column names from testcases |
| `.atoms.testcaseColumnsNormalized(id)` | Lowercase columns for matching |
| `.atoms.list(testsetId)` | Revisions list for a testset |
| `.atoms.latestForTestset(testsetId)` | Latest revision for a testset |

#### Reducers

| Reducer | Description |
|---------|-------------|
| `.reducers.update` | `(id, changes) => void` - Update draft |
| `.reducers.discard` | `(id) => void` - Discard draft |
| `.reducers.enableList` | `(testsetId) => void` - Enable lazy list query |

#### Imperative API

```typescript
// Getters
revisionMolecule.get.data(id)        // => Revision | null
revisionMolecule.get.serverData(id)  // => Revision | null
revisionMolecule.get.isDirty(id)     // => boolean

// Setters
revisionMolecule.set.update(id, { message: 'Updated' })
revisionMolecule.set.discard(id)
```

#### React Hook

```typescript
const [state, dispatch] = revisionMolecule.useController(revisionId)

// State shape
state.data         // Revision | null
state.serverData   // Revision | null
state.isPending    // boolean
state.isError      // boolean
state.error        // Error | null
state.isDirty      // boolean
state.isNew        // boolean

// Dispatch actions
dispatch.update({ message: 'New message' })
dispatch.discard()
```

### `testsetMolecule`

Manages testset entity state.

#### Atoms

| Atom | Description |
|------|-------------|
| `.atoms.data(id)` | Merged data (server + draft) |
| `.atoms.serverData(id)` | Server data only |
| `.atoms.draft(id)` | Local draft changes |
| `.atoms.query(id)` | Query state |
| `.atoms.isDirty(id)` | Has unsaved changes |
| `.atoms.isNew(id)` | Is new entity (`id === "new"`) |
| `.atoms.list(searchQuery)` | Testsets list (null for all) |
| `.atoms.variant(variantId)` | Variant query |

#### Imperative API

```typescript
testsetMolecule.get.data(id)
testsetMolecule.set.update(id, { name: 'New Name' })
testsetMolecule.set.discard(id)
```

## Cache Invalidation

After mutations, invalidate caches to refresh data:

```typescript
import {
  invalidateRevisionsListCache,
  invalidateTestsetsListCache,
  invalidateTestsetCache,
} from '@agenta/entities/testset'

// After creating/deleting a revision
invalidateRevisionsListCache(testsetId)

// After creating/deleting a testset
invalidateTestsetsListCache()

// After updating testset metadata
invalidateTestsetCache(testsetId)
```

## Schemas

### Revision Schema

```typescript
import { revisionSchema, type Revision } from '@agenta/entities/testset'

const revision = revisionSchema.parse(apiResponse)

// Type
interface Revision {
  id: string
  testset_id: string
  testset_variant_id?: string
  name?: string | null
  description?: string | null
  version: number
  message?: string | null
  created_at?: string | null
  // ... more fields
}
```

### Testset Schema

```typescript
import { testsetSchema, type Testset } from '@agenta/entities/testset'

// Type
interface Testset {
  id: string
  name: string
  description?: string | null
  created_at?: string | null
  updated_at?: string | null
}
```

## API Functions

For direct API access without caching:

```typescript
import {
  fetchRevision,
  fetchRevisionsList,
  fetchLatestRevision,
  fetchLatestRevisionsBatch,
  fetchTestsetDetail,
  fetchTestsetsList,
} from '@agenta/entities/testset'

// Fetch single revision
const revision = await fetchRevision({ id: revisionId, projectId })

// Fetch revisions list
const { testset_revisions } = await fetchRevisionsList({ projectId, testsetId })

// Fetch latest revision for a single testset (optimized - limit: 1)
const latest = await fetchLatestRevision({ projectId, testsetId })

// Batch fetch latest revisions for multiple testsets
// Uses per-ref limits to get exactly 1 revision per testset
const revisionMap = await fetchLatestRevisionsBatch(projectId, testsetIds)
// Returns: Map<testsetId, Revision>

// Fetch testset
const testset = await fetchTestsetDetail({ id: testsetId, projectId })
```

### Optimized Latest Revision Fetching

For tables displaying testsets with their latest revision info, use the optimized query atoms:

```typescript
import {
  latestRevisionQueryAtomFamily,
  latestRevisionStatefulAtomFamily,
  requestLatestRevisionAtom,
} from '@agenta/entities/testset'

// Step 1: Request the latest revision (enables the query)
const request = useSetAtom(requestLatestRevisionAtom)
useEffect(() => {
  if (testsetId && projectId) {
    request({ testsetId, projectId })
  }
}, [testsetId, projectId, request])

// Step 2: Read the latest revision with loading state
const { data, isPending } = useAtomValue(latestRevisionStatefulAtomFamily(testsetId))
```

**Why use this pattern?**

1. **Explicit enabling**: Queries are disabled until `requestLatestRevisionAtom` is called
2. **Batch optimization**: When multiple components request latest revisions concurrently, requests are batched within a 10ms window into a single API call
3. **Per-testset limits**: The batch API uses `ReferenceWithLimit` to fetch exactly 1 revision per testset using SQL window functions
4. **Efficient caching**: Results are cached per testset with 30s stale time

## Utilities

```typescript
import {
  normalizeRevision,
  isV0Revision,
  getVersionDisplay,
  NEW_TESTSET_ID,
  isNewTestsetId,
} from '@agenta/entities/testset'

// Normalize API response
const normalized = normalizeRevision(rawApiData)

// Check revision version
isV0Revision(revision)       // true if version === 0
getVersionDisplay(revision)  // "v1", "v2", etc.

// New testset handling
isNewTestsetId("new")  // true
isNewTestsetId("abc")  // false
```

## Architecture Notes

### Entity Model

```
Testset (metadata)
├── Variant (name, description)
└── Revisions (immutable snapshots)
    └── Testcases (data rows)
```

- **Testset**: Parent entity with metadata
- **Variant**: Contains mutable name/description
- **Revision**: Immutable snapshot of testcase data
- **Testcases**: Row data within a revision

### Immutability

Revisions are **immutable** - editing creates a new revision. This is why:

- `revisionMolecule` doesn't have complex merge logic
- Draft state is simple partial updates
- Query caching uses `staleTime: Infinity`

### Batch Fetching Architecture

For tables with many testsets, latest revision queries use a batching pattern:

```text
Component A requests latest for testset-1  ─┐
Component B requests latest for testset-2  ─┼─→ Batch Fetcher ─→ Single API call
Component C requests latest for testset-3  ─┘     (10ms window)
```

**How it works:**

1. **Request Collection**: `createBatchFetcher` collects requests within a 10ms window
2. **Per-Ref Limits**: API accepts `ReferenceWithLimit` with `limit: 1` per testset
3. **SQL Window Functions**: Backend uses `ROW_NUMBER() OVER (PARTITION BY artifact_id)` to get exactly N revisions per testset
4. **Result Distribution**: Batch fetcher maps results back to individual requesters

**Benefits:**

- Reduces N API calls to 1 for N concurrent testset components
- Guarantees exactly 1 result per testset (not affected by global ordering)
- Works with TanStack Query caching

## Table State Management

For revision table operations (column add/remove/rename, row operations):

```typescript
import {
  // Column operations
  addColumnReducer,
  removeColumnReducer,
  renameColumnReducer,
  // Row operations
  addRowReducer,
  removeRowReducer,
  removeRowsReducer,
  // Pending state
  pendingColumnOpsAtomFamily,
  pendingRowOpsAtomFamily,
  hasPendingChangesAtomFamily,
  // Clear
  clearPendingOpsReducer,
} from '@agenta/entities/testset'
```

## Mutation Atoms

For saving changes:

```typescript
import {
  saveTestsetAtom,
  saveNewTestsetAtom,
  clearChangesAtom,
  changesSummaryAtom,
  hasUnsavedChangesAtom,
} from '@agenta/entities/testset'

// Check for changes
const hasChanges = useAtomValue(hasUnsavedChangesAtom)
const summary = useAtomValue(changesSummaryAtom)

// Save
const save = useSetAtom(saveTestsetAtom)
await save({ revisionId, message: 'Updated data' })
```
