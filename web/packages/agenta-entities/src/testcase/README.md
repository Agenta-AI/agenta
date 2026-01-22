# Testcase Entity Module

Complete testcase entity management with schemas, API functions, and state management.

## Architecture

```text
testcase/
├── core/                    # Pure definitions (no runtime deps)
│   ├── schema.ts           # Zod schemas and transformations
│   ├── types.ts            # TypeScript interfaces
│   ├── columnExtraction.ts # Column extraction from data
│   └── index.ts            # Re-exports
├── api/                     # HTTP layer
│   ├── api.ts              # Fetch functions (axios)
│   └── index.ts            # Re-exports
├── state/                   # Jotai state management
│   ├── store.ts            # Query atoms, draft state, mutations
│   ├── molecule.ts         # Unified controller API
│   ├── dataController.ts   # Unified data source abstraction
│   ├── paginatedStore.ts   # Paginated data for InfiniteVirtualTable
│   └── index.ts            # Re-exports
└── index.ts                 # Main entry point

# Note: Column grouping utility (groupColumns) is in @agenta/ui, not here.
# Use: import { groupColumns } from '@agenta/ui'
```

## Usage

### Quick Start

```typescript
import {
    // Molecule (primary API for entity operations)
    testcaseMolecule,
    // Data controller (for table components)
    testcaseDataController,
    // API functions
    fetchTestcase,
    fetchTestcasesBatch,
    // Types
    type Testcase,
    type FlattenedTestcase,
} from '@agenta/entities/testcase'

// For table components - use data controller
const config = useMemo(() => ({ scopeId: 'my-table', revisionId }), [revisionId])
const rows = useAtomValue(testcaseDataController.selectors.rows(config))
const columns = useAtomValue(testcaseDataController.selectors.columns(config))
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

## Selection Draft (for Modal Selection)

The testcase molecule provides selection draft APIs for modal-based testcase selection.
This allows users to select/deselect testcases in a modal without affecting the main state
until they confirm their selection.

```typescript
import { testcaseMolecule } from '@agenta/entities/testcase'
import { useSetAtom, useAtomValue } from 'jotai'

// Initialize draft when opening selection modal
// Optionally pass initial IDs (e.g., from loadable controller's filtered view)
const initSelectionDraft = useSetAtom(testcaseMolecule.actions.initSelectionDraft)
initSelectionDraft(revisionId)
// Or with initial IDs:
initSelectionDraft(revisionId, ['tc-1', 'tc-2'])

// Read current selection (draft if exists, else all displayRowIds)
const currentSelection = useAtomValue(
    testcaseMolecule.atoms.currentSelection(revisionId)
)

// Update selection during editing
const setSelectionDraft = useSetAtom(testcaseMolecule.actions.setSelectionDraft)
setSelectionDraft(revisionId, ['tc-1', 'tc-3', 'tc-5'])

// Commit selection on confirm (updates testcaseIdsAtom)
const commitSelectionDraft = useSetAtom(testcaseMolecule.actions.commitSelectionDraft)
commitSelectionDraft(revisionId)

// Discard selection on cancel (removes draft, no state change)
const discardSelectionDraft = useSetAtom(testcaseMolecule.actions.discardSelectionDraft)
discardSelectionDraft(revisionId)
```

### Selection Draft API

| API | Description |
| --- | ----------- |
| `testcaseMolecule.actions.initSelectionDraft` | Initialize draft from displayRowIds or provided IDs |
| `testcaseMolecule.actions.setSelectionDraft` | Update draft selection |
| `testcaseMolecule.actions.commitSelectionDraft` | Commit draft to actual selection |
| `testcaseMolecule.actions.discardSelectionDraft` | Discard draft without changes |
| `testcaseMolecule.atoms.selectionDraft(revisionId)` | Raw draft atom (null if no draft) |
| `testcaseMolecule.atoms.currentSelection(revisionId)` | Draft if exists, else displayRowIds |

## Data Controller

The `testcaseDataController` provides a unified API for testcase data access that abstracts the data source (local vs server). This enables shared components to work with testcase data without knowing the source.

```typescript
import { testcaseDataController } from '@agenta/entities/testcase'
import { useAtomValue, useSetAtom } from 'jotai'

// Configure data source
const config = { revisionId: 'rev-123', scopeId: 'my-table' }

// Use unified selectors
const rows = useAtomValue(testcaseDataController.selectors.rows(config))
const isLoading = useAtomValue(testcaseDataController.selectors.isLoading(config))
const columns = useAtomValue(testcaseDataController.selectors.columns(config))

// Selection management
const selectedIds = useAtomValue(testcaseDataController.selectors.selectedIds(config.scopeId))
const setSelection = useSetAtom(testcaseDataController.actions.setSelection)
setSelection(config.scopeId, ['id1', 'id2'])

// Cleanup on unmount (prevents memory leaks)
const resetSelection = useSetAtom(testcaseDataController.actions.resetSelection)
useEffect(() => () => resetSelection(config.scopeId), [config.scopeId])
```

### Data Controller API

| API | Description |
| --- | ----------- |
| `selectors.rows(config)` | Get rows from configured data source |
| `selectors.isLoading(config)` | Check if data is loading |
| `selectors.columns(config)` | Get extracted columns from data |
| `selectors.selectedIds(scopeId)` | Get selected IDs as Set |
| `selectors.isAllSelected(config)` | Check if all rows are selected |
| `actions.setSelection` | Set selection for a scope |
| `actions.toggleSelection` | Toggle a single testcase selection |
| `actions.selectAll` | Select all testcases |
| `actions.clearSelection` | Clear selection |
| `actions.resetSelection` | Reset selection (removes from cache) |

## UI Components

### TestcaseTable

A reusable table component for displaying testcases with optional selection support:

```typescript
import { TestcaseTable } from '@agenta/entities/ui'

// View-only mode
<TestcaseTable
  config={{ scopeId: 'my-table', revisionId: 'rev-123' }}
/>

// With selection
<TestcaseTable
  config={{ scopeId: 'my-table', revisionId: 'rev-123' }}
  selectable
  onSelectionChange={(ids) => console.log('Selected:', ids)}
/>
```

### TestsetPicker

A component for browsing and selecting testsets and their revisions:

```typescript
import { TestsetPicker } from '@agenta/entities/ui'

<TestsetPicker
  selectedRevisionId={selectedRevisionId}
  selectedTestsetId={selectedTestsetId}
  onSelect={(revisionId, testsetId) => handleSelect(revisionId, testsetId)}
/>
```

## When to Use Which API

| Use Case | API | Description |
|----------|-----|-------------|
| Standalone testcase table | `testcaseDataController` | Unified data access for table components |
| Playground with execution | `loadableBridge` | Higher-level abstraction with execution context |
| Entity-level operations | `testcaseMolecule` | Direct entity CRUD, dirty tracking, drafts |
| Custom data fetching | `fetchTestcase*` functions | Direct HTTP API calls |

## Integration with Loadable

For playground and execution contexts, use `loadableBridge` instead of `testcaseDataController` directly. The loadable module provides a higher-level abstraction for data sources:

```typescript
import { loadableBridge } from '@agenta/entities/loadable'

// Connect loadable to testset revision
const connect = useSetAtom(loadableBridge.actions.connectToSource)
connect(loadableId, revisionId, 'MyTestset v1', 'testcase')

// Rows are now derived from testcaseMolecule
const rows = useAtomValue(loadableBridge.selectors.rows(loadableId))

// Columns are derived reactively from the linked runnable's input ports
const columns = useAtomValue(loadableBridge.selectors.columns(loadableId))
```

See [Loadable README](../loadable/README.md) for the full controller pattern and best practices.

## Commit Flow

Testcases don't have individual commit actions - they are committed as part of a revision commit. The commit flow works as follows:

1. **Edit testcases** using `testcaseMolecule.actions.update` or `testcaseMolecule.actions.add`
2. **Track changes** via `testcaseMolecule.atoms.hasUnsavedChanges`
3. **Commit via revision** using `revisionMolecule` from `@agenta/entities/testset`

```typescript
import { revisionMolecule } from '@agenta/entities/testset'
import { testcaseMolecule } from '@agenta/entities/testcase'

// Check for unsaved testcase changes
const hasChanges = useAtomValue(testcaseMolecule.atoms.hasUnsavedChanges)

// Commit is handled at revision level
// The revision commit will include all testcase changes
const commit = useSetAtom(revisionMolecule.actions.commit)
await commit({ revisionId, message: 'Updated testcases' })
```

For the unified save/commit modal pattern, use `useSaveOrCommit` from `@agenta/entities/ui`:

```typescript
import { useSaveOrCommit } from '@agenta/entities/ui'

const { save, commit, canSave, canCommit } = useSaveOrCommit({
    entityType: 'revision',
    entityId: revisionId,
})
```

## System Fields

These fields are excluded from dirty comparison and data operations:

- `id`, `key`, `testset_id`, `set_id`
- `created_at`, `updated_at`, `deleted_at`
- `created_by_id`, `updated_by_id`, `deleted_by_id`
- `flags`, `tags`, `meta`
- `__isSkeleton`, `testcase_dedup_id`
