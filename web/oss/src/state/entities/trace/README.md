# Trace Entity Module

Manages trace span entities with features for viewing and editing trace data from LLM observability.

## Features

- **Batch fetching** - Combines concurrent requests into single API call
- **Cache redirect** - Checks various query caches before fetching
- **Draft state** - Local edits to span attributes
- **Entity controllers** - Unified API with selectors and actions
- **Drill-in navigation** - Path-based navigation for nested attribute data

## Architecture

### Two-Layer Structure

1. **Query layer** (`spanQueryAtomFamily`) - Server state with batch fetching and cache redirect
2. **Draft layer** (`traceSpanDraftAtomFamily`) - Local edits to attributes
3. **Combined layer** (`traceSpanEntityAtomFamily`) - Merges draft + server data

## Entity Controller

The `traceSpan` controller provides a unified API for working with trace span entities.

### Basic Usage

```typescript
import {traceSpan} from "@/oss/state/entities/trace"

// Option 1: Full controller (state + dispatch)
function SpanEditor({spanId}: {spanId: string}) {
  const [state, dispatch] = useAtom(traceSpan.controller(spanId))

  if (state.isPending) return <Skeleton />
  if (state.isError) return <Error error={state.error} />
  if (!state.data) return <NotFound />

  return (
    <div>
      <Editor
        value={state.data.attributes}
        onChange={(attrs) => dispatch({type: "update", changes: attrs})}
      />
      {state.isDirty && (
        <Button onClick={() => dispatch({type: "discard"})}>
          Discard Changes
        </Button>
      )}
    </div>
  )
}

// Option 2: Efficient selectors
function DirtyIndicator({spanId}: {spanId: string}) {
  const isDirty = useAtomValue(traceSpan.selectors.isDirty(spanId))
  return isDirty ? <Badge>Modified</Badge> : null
}

// Option 3: In-atom usage
const myDerivedAtom = atom(null, (get, set) => {
  set(traceSpan.actions.update, spanId, {"ag.data.inputs": newInputs})
  set(traceSpan.actions.discard, spanId)
})
```

### Controller State

```typescript
interface TraceSpanControllerState {
  data: TraceSpan | null  // Entity with draft merged
  serverData: TraceSpan | null  // Raw server data (from query)
  isPending: boolean  // True while fetching
  isError: boolean  // True if fetch failed
  error: Error | null  // Error if fetch failed
  isDirty: boolean  // True if has unsaved changes
  isNew: boolean  // Always false for traces (they come from server)
}
```

## API Reference

### Entity Controller

**Selectors (fine-grained subscriptions):**

- `traceSpan.selectors.data(id)` - Entity data (server + draft merged)
- `traceSpan.selectors.query(id)` - Query state with loading/error
- `traceSpan.selectors.isDirty(id)` - Has unsaved changes

**Actions (for use in other atoms):**

- `traceSpan.actions.update` - Update: `set(traceSpan.actions.update, spanId, newAttributes)`
- `traceSpan.actions.discard` - Discard: `set(traceSpan.actions.discard, spanId)`

**Drill-in (for nested attribute editing):**

- `traceSpan.drillIn.getValueAtPath(span, path)` - Get nested value
- `traceSpan.drillIn.setValueAtPathAtom` - Set nested value
- `traceSpan.drillIn.getRootItems(span)` - Get attribute keys as navigation items

### Entity Atoms

- `traceSpanEntityAtomFamily(spanId)` - Combined entity (draft + server)
- `spanQueryAtomFamily(spanId)` - TanStack Query atom (server state)

### Draft Atoms

- `traceSpanDraftAtomFamily(spanId)` - Get/set draft attributes
- `traceSpanHasDraftAtomFamily(spanId)` - Boolean check
- `traceSpanIsDirtyAtomFamily(spanId)` - Has unsaved changes

### Mutation Atoms

- `updateTraceSpanAtom` - Update span attributes (creates draft)
- `discardTraceSpanDraftAtom` - Clear draft for span

### Derived Atoms (Data Extraction)

- `spanInputsAtomFamily(spanId)` - Extract inputs from span
- `spanOutputsAtomFamily(spanId)` - Extract outputs from span
- `spanAgDataAtomFamily(spanId)` - Extract ag.data from attributes

## Usage Examples

### Example 1: Viewing Span Data

```typescript
import {traceSpan} from "@/oss/state/entities/trace"

const SpanViewer = ({spanId}: {spanId: string}) => {
  const queryState = useAtomValue(traceSpan.selectors.query(spanId))

  if (queryState.isPending) return <Skeleton />
  if (queryState.isError) return <Error error={queryState.error} />
  if (!queryState.data) return <NotFound />

  const span = queryState.data
  return (
    <div>
      <h2>{span.name}</h2>
      <pre>{JSON.stringify(span.attributes, null, 2)}</pre>
    </div>
  )
}
```

### Example 2: Editing Span Attributes

```typescript
import {traceSpan} from "@/oss/state/entities/trace"

const SpanAttributeEditor = ({spanId}: {spanId: string}) => {
  const [state, dispatch] = useAtom(traceSpan.controller(spanId))

  if (!state.data) return null

  const handleUpdate = (key: string, value: unknown) => {
    dispatch({
      type: "update",
      changes: {[key]: value}
    })
  }

  return (
    <div>
      {Object.entries(state.data.attributes).map(([key, value]) => (
        <Field
          key={key}
          label={key}
          value={value}
          onChange={(v) => handleUpdate(key, v)}
        />
      ))}
      {state.isDirty && (
        <Button onClick={() => dispatch({type: "discard"})}>
          Reset
        </Button>
      )}
    </div>
  )
}
```

### Example 3: Drill-in Navigation

```typescript
import {traceSpan} from "@/oss/state/entities/trace"

const NestedAttributeViewer = ({spanId, path}: {spanId: string; path: string[]}) => {
  const data = useAtomValue(traceSpan.selectors.data(spanId))
  const setValueAtPath = useSetAtom(traceSpan.drillIn!.setValueAtPathAtom)

  // Get nested value
  const value = traceSpan.drillIn!.getValueAtPath(data, path)

  return (
    <Editor
      value={JSON.stringify(value, null, 2)}
      onChange={(newValue) => {
        setValueAtPath({
          id: spanId,
          path,
          value: JSON.parse(newValue)
        })
      }}
    />
  )
}
```

### Example 4: Derived Atoms Using Controller

```typescript
import {traceSpan} from "@/oss/state/entities/trace"

// Derive data from span entities using controller selectors
const spanSummariesAtom = atom((get) => {
  const spanIds = get(selectedSpanIdsAtom)

  return spanIds.map((spanId) => {
    const data = get(traceSpan.selectors.data(spanId))
    const isDirty = get(traceSpan.selectors.isDirty(spanId))

    return {
      id: spanId,
      name: data?.name ?? "Loading...",
      hasChanges: isDirty,
    }
  })
})

// Batch discard using controller actions
const discardAllChangesAtom = atom(null, (get, set) => {
  const spanIds = get(selectedSpanIdsAtom)

  for (const spanId of spanIds) {
    if (get(traceSpan.selectors.isDirty(spanId))) {
      set(traceSpan.actions.discard, spanId)
    }
  }
})
```

## Selectors and Helpers

The module also exports utility functions for working with trace data:

### Path Utilities

- `getValueAtPath(obj, path)` - Navigate nested data by path
- `collectKeyPaths(obj)` - Collect all paths in object
- `filterDataPaths(paths)` - Filter to data-relevant paths

### Data Extraction

- `extractInputs(span)` - Extract inputs from span attributes
- `extractOutputs(span)` - Extract outputs from span attributes
- `extractAgData(span)` - Extract ag.data from attributes
- `spanToTraceData(span)` - Convert span to simplified trace data format

### Auto-mapping Helpers

- `COLUMN_NAME_MAPPINGS` - Common column name mappings
- `getSuggestedColumnName(path)` - Suggest column name for path
- `generateMappingSuggestions(paths, columns)` - Generate mapping suggestions
- `matchColumnsWithSuggestions(paths, columns)` - Auto-match paths to columns

## Notes

- Trace spans are **read-only** from the server - edits are local drafts only
- Draft attributes are stored separately and merged at render time
- The `isNew` property is always `false` for traces (they originate from server tracing)
- Use `traceSpan.drillIn` for path-based navigation through nested attribute data
