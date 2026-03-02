# Testcase Entity Module

Manages testcase entities with advanced features for handling large datasets, complex editing workflows, and fine-grained reactivity.

## Features

- **Batch fetching** - Combines concurrent requests into single API call
- **Cache redirect** - Checks paginated query cache before fetching
- **Draft state** - Local edits with column change tracking
- **Cell subscriptions** - Fine-grained reactivity (only re-render changed cells)
- **Entity controllers** - Unified API with selectors and actions
- **Infinite scrolling** - Pagination support for large datasets

## Architecture

### Three-Layer Structure

1. **Query layer** (`testcaseQueryAtomFamily`) - Server state with batch fetching and cache redirect
2. **Draft layer** (`testcaseDraftAtomFamily`) - Local edits with column change tracking
3. **Combined layer** (`testcaseEntityAtomFamily`) - Merges draft + server + pending column changes

## Which Atom Should I Use?

### Use `testcase.controller(id)` (Recommended)

**Best for:** Components that need both data and actions

```typescript
import {testcase} from "@/oss/state/entities/testcase"

const TestcaseEditor = ({testcaseId}: {testcaseId: string}) => {
  const [state, dispatch] = useAtom(testcase.controller(testcaseId))

  if (!state.data) return null

  return (
    <div>
      <Input
        value={state.data.input}
        onChange={(e) => dispatch({
          type: "update",
          changes: {input: e.target.value}
        })}
      />
      {state.isDirty && (
        <Button onClick={() => dispatch({type: "discard"})}>
          Discard Changes
        </Button>
      )}
    </div>
  )
}
```

**When to use:**
- Forms and editors
- Components that need to update entity state
- When you want unified access to data + isDirty + actions

**Returns:** `[EntityControllerState, Dispatch<EntityAction>]`

### Use `testcase.selectors.query(id)`

**Best for:** Components displaying testcase details with loading states

```typescript
import {testcase} from "@/oss/state/entities/testcase"

const TestcaseDetailModal = ({testcaseId}: {testcaseId: string}) => {
  const queryState = useAtomValue(testcase.selectors.query(testcaseId))

  if (queryState.isPending) return <Skeleton />
  if (queryState.isError) return <ErrorDisplay error={queryState.error} />
  if (!queryState.data) return <NotFound />

  return <TestcaseView testcase={queryState.data} />
}
```

**When to use:**
- Modals/drawers showing single testcase
- Components that need to show "Loading..." while fetching
- Components that need explicit loading/error states

**Returns:** `QueryResult<FlattenedTestcase>`

### Use `testcaseEntityAtomFamily`

**Best for:** Direct entity access without loading states

```typescript
const TestcaseField = ({testcaseId}: {testcaseId: string}) => {
  const testcase = useAtomValue(testcaseEntityAtomFamily(testcaseId))

  if (!testcase) return null
  return <div>{testcase.someField}</div>
}
```

**When to use:**
- Table cells (no loading UI needed)
- Derived atoms that combine multiple entities
- Mutations that need current entity value
- Performance-critical paths

**Returns:** `FlattenedTestcase | null`

### Use `testcaseCellAtomFamily`

**Best for:** Table cells with fine-grained reactivity

```typescript
const TestcaseCell = ({testcaseId, column}: {testcaseId: string; column: string}) => {
  const value = useAtomValue(testcaseCellAtomFamily({testcaseId, column}))

  return <TableCell>{value}</TableCell>
}
```

**When to use:**
- Table cell components
- Only need to re-render when specific cell value changes
- Want to avoid re-rendering when other fields in the testcase change

**Returns:** `unknown` (the value of the specific column)

**Performance benefit:** Component only re-renders when the specific cell value changes, not when any field in the testcase changes.

## Usage Examples

### Example 1: Modal with Loading States (Query Selector)

```typescript
import {testcase} from "@/oss/state/entities/testcase"

const TestcaseViewerModal = ({testcaseId}: {testcaseId: string}) => {
  const queryState = useAtomValue(testcase.selectors.query(testcaseId))

  if (queryState.isPending) {
    return (
      <Modal>
        <Skeleton height={400} />
      </Modal>
    )
  }

  if (queryState.isError) {
    return (
      <Modal>
        <Alert type="error">
          Failed to load testcase: {queryState.error?.message}
        </Alert>
      </Modal>
    )
  }

  if (!queryState.data) {
    return (
      <Modal>
        <Empty description="Testcase not found" />
      </Modal>
    )
  }

  return (
    <Modal>
      <h2>Test case Details</h2>
      <pre>{JSON.stringify(queryState.data, null, 2)}</pre>
    </Modal>
  )
}
```

### Example 2: Table Cell (Cell Atom)

```typescript
import {testcaseCellAtomFamily} from "@/oss/state/entities/testcase"

const EditableCell = ({
  testcaseId,
  column
}: {
  testcaseId: string
  column: string
}) => {
  // Only re-renders when THIS cell's value changes
  const value = useAtomValue(testcaseCellAtomFamily({testcaseId, column}))
  const updateTestcase = useSetAtom(updateTestcaseAtom)

  return (
    <Input
      value={value as string}
      onChange={(e) => updateTestcase({
        id: testcaseId,
        updates: {[column]: e.target.value}
      })}
    />
  )
}
```

### Example 3: Derived Atom (Entity Atom)

```typescript
import {testcaseEntityAtomFamily} from "@/oss/state/entities/testcase"

// Derived atom that computes score from multiple testcases
const averageScoreAtom = atom((get) => {
  const testcaseIds = get(testcaseIdsAtom)

  const scores = testcaseIds
    .map(id => get(testcaseEntityAtomFamily(id)))
    .filter(Boolean)
    .map(testcase => testcase.score)
    .filter(score => typeof score === "number")

  if (scores.length === 0) return 0
  return scores.reduce((a, b) => a + b, 0) / scores.length
})
```

### Example 4: Editing Testcase (Controller)

```typescript
import {testcase} from "@/oss/state/entities/testcase"

const TestcaseEditor = ({testcaseId}: {testcaseId: string}) => {
  const [state, dispatch] = useAtom(testcase.controller(testcaseId))

  if (!state.data) return null

  return (
    <div>
      <Input
        value={state.data.input}
        onChange={(e) => dispatch({
          type: "update",
          changes: {input: e.target.value}
        })}
      />
      {state.isDirty && (
        <Button onClick={() => dispatch({type: "discard"})}>
          Discard Changes
        </Button>
      )}
    </div>
  )
}
```

## API Reference

### Entity Controller

The `testcase` controller provides a unified API for working with testcase entities.

**Controller state (`testcase.controller(id)`):**

```typescript
interface TestcaseControllerState {
  data: FlattenedTestcase | null  // Entity with draft merged
  serverData: FlattenedTestcase | null  // Raw server data (from query)
  isPending: boolean  // True while fetching
  isError: boolean  // True if fetch failed
  error: Error | null  // Error if fetch failed
  isDirty: boolean  // True if has unsaved changes
  isNew: boolean  // True if not yet on server (id starts with "new-" or "local-")
}
```

**Selectors (fine-grained subscriptions):**

- `testcase.selectors.data(id)` - Entity data only
- `testcase.selectors.query(id)` - Query state with loading/error
- `testcase.selectors.isDirty(id)` - Dirty state only
- `testcase.selectors.cell({id, column})` - Cell-level subscription (for table performance)

**Actions (base):**

- `testcase.actions.update` - Update: `set(testcase.actions.update, id, {field: value})`
- `testcase.actions.discard` - Discard: `set(testcase.actions.discard, id)`

**Actions (testcase-specific):**

- `testcase.actions.add` - Create single new testcase with empty columns
- `testcase.actions.create` - Batch create with options (prefix, skip dedup)
- `testcase.actions.append` - Batch append from data rows (deprecated, use create)
- `testcase.actions.delete` - Delete testcases: `set(testcase.actions.delete, [id1, id2])`

**Drill-in (for nested data editing):**

- `testcase.drillIn.getValueAtPath(entity, path)` - Get nested value
- `testcase.drillIn.setValueAtPathAtom` - Set nested value
- `testcase.drillIn.getRootItems(entity, columns)` - Get root navigation items

### Entity Atoms

- `testcaseEntityAtomFamily(testcaseId: string)` - Combined entity (draft + server + columns)
- `testcaseCellAtomFamily({id, column})` - Cell-level subscription

### Query Atoms

- `testcaseQueryAtomFamily(testcaseId: string)` - TanStack Query atom (server state)

### Draft Atoms

- `testcaseDraftAtomFamily(testcaseId: string)` - Get/set draft
- `testcaseHasDraftAtomFamily(testcaseId: string)` - Boolean check
- `testcaseIsDirtyAtomFamily(testcaseId: string)` - Dirty check (accounts for column changes)

### Mutation Atoms

- `updateTestcaseAtom` - Update testcase field (creates draft)
- `discardDraftAtom` - Clear draft for single testcase
- `discardAllDraftsAtom` - Clear all drafts
- `batchUpdateTestcasesSyncAtom` - Batch update (single re-render)

### Column Operations

- `addColumnAtom` - Add column to schema
- `deleteColumnAtom` - Delete column from schema
- `renameColumnAtom` - Rename column across all testcases
- `addColumnToTestcasesAtom` - Batch add column to all entities
- `deleteColumnFromTestcasesAtom` - Batch delete column from all entities
- `renameColumnInTestcasesAtom` - Batch rename column in all entities

### ID Tracking

- `testcaseIdsAtom` - Server IDs (from pagination)
- `newEntityIdsAtom` - Client IDs (not yet saved)
- `deletedEntityIdsAtom` - Soft-deleted IDs

## Performance Characteristics

### Batch Fetching

Concurrent requests within 16ms window are combined:

```typescript
// Multiple components read different testcases
const Component1 = () => useAtomValue(testcaseEntityAtomFamily("id-1"))
const Component2 = () => useAtomValue(testcaseEntityAtomFamily("id-2"))
const Component3 = () => useAtomValue(testcaseEntityAtomFamily("id-3"))

// Result: Single API call with testcase_ids: ["id-1", "id-2", "id-3"]
```

### Cache Redirect

Checks paginated query cache before fetching:

1. Component requests testcase by ID
2. Checks if ID exists in any `["testcases-table"]` query cache page
3. If found, uses cached data (no fetch)
4. If not found, uses batch fetcher

### Cell-Level Subscriptions

Only re-renders affected cells:

```typescript
// Table with 1000 rows × 10 columns = 10,000 cells
// User edits one cell
// Result: Only 1 cell re-renders, not all 10,000
```

## Advanced Topics

### Custom Dirty Detection

Testcases track "dirty" state across multiple dimensions:

1. **Field edits** - Draft vs server comparison (via query atom)
2. **Column renames** - Entity has old column name that needs renaming
3. **Column deletions** - Entity has column with data that needs deleting
4. **Column additions** - Entity missing newly added column

This ensures entities are marked dirty even without local edits if schema changes are pending.

### Nested Column Support

Columns can be nested paths:

```typescript
// Column: "inputs.code"
// Actual data: { inputs: { code: "console.log('hello')" } }

// Delete nested column
deleteColumnFromTestcasesAtom("inputs.code")

// Handles JSON strings
// Before: { inputs: '{"code": "console.log()"}' }
// After:  { inputs: '{}' }
```

### Pending Column Changes

Column operations are tracked separately and applied to newly loaded data:

```typescript
// User renames "input" → "prompt"
// New page loads from server with old schema
// Rename is automatically applied to new data
// Result: UI stays consistent across all pages
```

## Troubleshooting

### Testcase not loading

Check:
1. Is `projectId` set in `projectIdAtom`?
2. Is `revisionId` set in `currentRevisionIdAtom`?
3. Is testcase ID a valid UUID? (new rows use temp IDs like "new-row-xxx")

### Cell not updating

Check:
1. Are you using `testcaseCellAtomFamily` with correct `{id, column}`?
2. Did you call `updateTestcaseAtom` to create draft?
3. Is column in the current columns list (`currentColumnsAtom`)?

### Performance issues

Check:
1. Are you using `testcaseCellAtomFamily` for table cells?
2. Are batch operations using `batchUpdateTestcasesSyncAtom`?
3. Is pagination enabled for large datasets?
