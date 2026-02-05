# Testset Entity

This module provides state management for **testset** and **revision** entities using the molecule architecture.

## Overview

```text
testset/
├── index.ts              # Public exports
├── README.md             # This file
├── relations.ts          # Entity relations (testset→revision→testcase)
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
| `.atoms.effectiveTestcaseIds(id)` | Effective testcase IDs (server + pending local rows) |
| `.atoms.effectiveTestcases(id)` | Effective testcases resolved from IDs |
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

### Latest Revision Fetching

For getting the latest revision of a testset:

```typescript
import { latestRevisionForTestsetAtomFamily } from '@agenta/entities/testset'

// Read latest revision with loading state
const { data, isPending } = useAtomValue(latestRevisionForTestsetAtomFamily(testsetId))
```

**Features:**

1. **Batch optimization**: Concurrent requests are batched into a single API call
2. **Per-testset limits**: The batch API fetches exactly 1 revision per testset
3. **Efficient caching**: Results are cached per testset with 30s stale time

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
Testset (metadata: name, description)
└── Revisions (immutable snapshots)
    └── Testcases (data rows)
```

- **Testset**: Parent entity with metadata (name, description)
- **Revision**: Immutable snapshot of testcase data
- **Testcases**: Row data within a revision

> **Note:** The frontend uses a 2-level hierarchy (Testset → Revision → Testcase). There is no separate "Variant" entity — name and description are stored directly on the Testset.

### Immutability

Revisions are **immutable** - editing creates a new revision. This is why:

- `revisionMolecule` doesn't have complex merge logic
- Draft state is simple partial updates
- Query caching uses `staleTime: Infinity`

### Relations

Entity relations define parent-child hierarchies and are declared in `relations.ts`:

```text
testset → revision → testcase
```

| Relation                      | File           | Mode      |
|-------------------------------|----------------|-----------|
| `testsetToRevisionRelation`   | `relations.ts` | reference |
| `revisionToTestcaseRelation`  | `relations.ts` | reference |

Relations are auto-registered on import and enable:

- **EntityPicker** adapters for selection UI
- **Hierarchy discovery** via `entityRelationRegistry`

#### Import constraint

The dependency between `relations.ts` and molecule files is **one-way**:

```text
relations.ts  ──imports──▶  state/revisionMolecule.ts   ✓
state/revisionMolecule.ts  ──imports──▶  relations.ts   ✗ FORBIDDEN
```

`relations.ts` imports molecules to populate `childMolecule` in relation definitions.
Molecule files must **never** import from `relations.ts` — doing so creates a circular
ES module dependency that causes `ReferenceError: Cannot access 'X' before initialization`.

If a molecule needs child IDs that a relation also extracts, **inline the logic**:

```typescript
// In state/revisionMolecule.ts — GOOD: inline extraction
const testcaseIds = revision.data?.testcase_ids ?? []

// In state/revisionMolecule.ts — BAD: imports from relations.ts
import { revisionToTestcaseRelation } from "../relations"
const testcaseIds = getChildIds(revision, revisionToTestcaseRelation)
```

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

## Saving Changes

For saving testset changes:

```typescript
import { saveTestsetAtom } from '@agenta/entities/testset'

// Save changes to create a new revision
const save = useSetAtom(saveTestsetAtom)
const result = await save({
  projectId,
  testsetId,
  revisionId,
  commitMessage: 'Updated data'
})

if (result.success) {
  // Navigate to new revision
  router.push(`/testsets/${result.newRevisionId}`)
}
```
