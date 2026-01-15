# Testcase Entity Module

Complete testcase entity management with schemas, API functions, and state management.

## Architecture

```text
testcase/
├── core/                    # Pure definitions (no runtime deps)
│   ├── schema.ts           # Zod schemas and transformations
│   ├── types.ts            # TypeScript interfaces
│   └── index.ts            # Re-exports
├── api/                     # HTTP layer
│   ├── api.ts              # Fetch functions (axios)
│   └── index.ts            # Re-exports
├── state/                   # Jotai state management
│   ├── store.ts            # Query atoms, draft state, mutations
│   ├── molecule.ts         # Unified controller API
│   └── index.ts            # Re-exports
└── index.ts                 # Main entry point
```

## Usage

### Quick Start

```typescript
import {
    // Molecule (primary API)
    testcaseMolecule,
    // API functions
    fetchTestcase,
    fetchTestcasesBatch,
    // Types
    type Testcase,
    type FlattenedTestcase,
} from '@agenta/entities/testcase'
```

### Controller Pattern

The `testcaseMolecule` provides a unified API for entity state management:

```typescript
// In React components - full state + dispatch
const [state, dispatch] = useAtom(testcaseMolecule.controller(testcaseId))

if (state.isPending) return <Skeleton />
if (!state.data) return <NotFound />

// Update entity
dispatch({ type: 'update', changes: { name: 'New name' } })

// Discard local changes
dispatch({ type: 'discard' })
```

### Fine-Grained Subscriptions

For optimal performance, use atoms directly:

```typescript
// Only re-renders on data change
const data = useAtomValue(testcaseMolecule.selectors.data(testcaseId))

// Cell accessor for tables - minimal re-renders
const cellValue = useAtomValue(testcaseMolecule.atoms.cell({ id: testcaseId, column: 'name' }))

// Dirty state
const isDirty = useAtomValue(testcaseMolecule.selectors.isDirty(testcaseId))
```

### Imperative API

For callbacks, effects, or plain atoms:

```typescript
// Read
const data = testcaseMolecule.get.data(testcaseId)
const cellValue = testcaseMolecule.get.cell(testcaseId, 'name')

// Write
testcaseMolecule.set.update(testcaseId, { name: 'Updated' })
testcaseMolecule.set.discard(testcaseId)
testcaseMolecule.set.batchUpdate([
    { id: 'tc-1', updates: { name: 'First' } },
    { id: 'tc-2', updates: { name: 'Second' } },
])
```

### API Functions

Direct HTTP functions for custom fetching:

```typescript
// Single testcase
const testcase = await fetchTestcase({
    projectId: 'proj-123',
    testcaseId: 'tc-456'
})

// Batch fetch
const testcases = await fetchTestcasesBatch({
    projectId: 'proj-123',
    testcaseIds: ['tc-1', 'tc-2', 'tc-3']
})

// Paginated fetch
const page = await fetchTestcasesPage({
    projectId: 'proj-123',
    revisionId: 'rev-456',
    cursor: null,
    limit: 50
})
```

## Schemas

### Testcase Schema

```typescript
import { testcaseSchema, flattenTestcase, unflattenTestcase } from '@agenta/entities/testcase'

// Parse API response
const testcase = testcaseSchema.parse(apiResponse)

// Flatten for table display (spreads data into columns)
const flattened = flattenTestcase(testcase)
// { id: '1', name: 'Test', value: 123 }

// Unflatten for API submission
const unflattened = unflattenTestcase(flattened)
// { id: '1', data: { name: 'Test', value: 123 } }
```

### Type Structure

```typescript
// API format (nested data)
type Testcase = {
    id: string
    data: Record<string, unknown>
    testset_id?: string
    created_at?: string
    // ... other system fields
}

// Table format (flattened)
type FlattenedTestcase = {
    id: string
    // Data fields spread to top level
    name: string
    value: number
    // ... dynamic columns
}
```

## State Management

### Molecule API

| API | Description |
| ----- | ------------- |
| `testcaseMolecule.controller(id)` | State + dispatch atom |
| `testcaseMolecule.selectors.data(id)` | Merged entity data |
| `testcaseMolecule.selectors.isDirty(id)` | Has unsaved changes |
| `testcaseMolecule.selectors.query(id)` | Query state (isPending, isError) |
| `testcaseMolecule.atoms.cell({id, column})` | Cell accessor |
| `testcaseMolecule.get.*` | Imperative reads |
| `testcaseMolecule.set.*` | Imperative writes |

### Store Atoms (Advanced)

For direct atom access in the OSS layer:

```typescript
// Context
currentRevisionIdAtom

// ID tracking
testcaseIdsAtom           // Server testcase IDs
newEntityIdsAtom          // Locally created IDs
deletedEntityIdsAtom      // Pending deletions

// Query atoms
testcaseQueryAtomFamily(id)   // { data, isPending, isError, error }

// Draft state
testcaseDraftAtomFamily(id)   // Local changes
testcaseIsDirtyAtomFamily(id) // Has unsaved changes

// Entity atoms
testcaseEntityAtomFamily(id)  // Merged server + draft
testcaseCellAtomFamily({id, column}) // Cell accessor
```

### Paginated Store

For table views with pagination:

```typescript
import { testcasePaginatedStore } from '@agenta/entities/testcase'

// Access paginated data
const rows = useAtomValue(testcasePaginatedStore.rowsAtom)
const meta = useAtomValue(testcasesPaginatedMetaAtom)

// Search
const [searchTerm, setSearchTerm] = useAtom(testcasesSearchTermAtom)

// Filters
const [filters, setFilters] = useAtom(testcaseFilters.all)
```

## Data Flow

```text
API Response
    │
    ▼
testcaseQueryAtomFamily ─────────────────────────┐
    │                                             │
    ▼                                             │
flattenTestcase()                                 │
    │                                             │
    ▼                                             │
testcaseDraftAtomFamily (local changes) ─────────┤
    │                                             │
    ▼                                             │
testcaseEntityAtomFamily (merged) ───────────────┤
    │                                             │
    ├─► testcaseCellAtomFamily (per-cell) ◄──────┘
    │
    ▼
testcaseIsDirtyAtomFamily
```

## Cache Strategy

- **Batch fetching**: Concurrent requests for individual testcases are batched
- **Cache redirect**: Single fetches check paginated cache first
- **Debounced batching**: 10ms window to combine concurrent requests

## System Fields

These fields are excluded from dirty comparison and data operations:

- `id`, `key`, `testset_id`, `set_id`
- `created_at`, `updated_at`, `deleted_at`
- `created_by_id`, `updated_by_id`, `deleted_by_id`
- `flags`, `tags`, `meta`
- `__isSkeleton`, `testcase_dedup_id`
