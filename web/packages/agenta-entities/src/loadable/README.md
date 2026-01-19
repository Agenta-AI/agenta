# Loadable Module

Data source management for entities that provide inputs to runnables.

A **loadable** represents a data source (like a testset or trace) that provides input rows for execution. Loadables can operate in local mode (manual data entry) or connected mode (synced with an entity).

## Quick Start (New API)

```typescript
import { loadableBridge } from '@agenta/entities/loadable'
import { useAtomValue, useSetAtom } from 'jotai'

// Read rows
const rows = useAtomValue(loadableBridge.selectors.rows(loadableId))

// Add a row
const addRow = useSetAtom(loadableBridge.actions.addRow)
addRow(loadableId, { prompt: 'Hello, world!' })

// Connect to a testset
const connect = useSetAtom(loadableBridge.actions.connectToSource)
connect(loadableId, testsetRevisionId, 'MyTestset v1', 'testcase')
```

## Architecture

The loadable system uses a **bridge pattern** that separates:

1. **Pure state** (`store.ts`): Jotai atoms with no entity dependencies
2. **Bridge** (`bridge.ts`): Connects molecule APIs to unified selectors/actions
3. **Factory** (`shared/createEntityBridge.ts`): Creates bridges with configurable sources

```
┌─────────────────────────────────────────────────────────────────┐
│                    loadableBridge                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │   testcase  │    │    trace    │    │   future    │         │
│  │   source    │    │   source    │    │   sources   │         │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘         │
│         │                  │                  │                 │
│         ▼                  ▼                  ▼                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              Unified Selectors & Actions                    ││
│  │  rows, columns, activeRow, isDirty, addRow, updateRow...   ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## API Reference

### Selectors

| Selector | Returns | Description |
|----------|---------|-------------|
| `rows(loadableId)` | `LoadableRow[]` | All rows in the loadable |
| `columns(loadableId)` | `LoadableColumn[]` | Column definitions |
| `allColumns(loadableId)` | `LoadableColumn[]` | All columns derived from data |
| `activeRow(loadableId)` | `LoadableRow \| null` | Currently selected row |
| `rowCount(loadableId)` | `number` | Number of rows |
| `mode(loadableId)` | `'local' \| 'connected'` | Current mode |
| `isDirty(loadableId)` | `boolean` | Has unsaved changes |
| `connectedSource(loadableId)` | `{id, name}` | Connected source info |
| `executionResults(loadableId)` | `Record<string, unknown>` | Execution results per row |
| `supportsDynamicInputs(loadableId)` | `boolean` | Can add/remove columns |

### Actions

| Action | Parameters | Description |
|--------|------------|-------------|
| `addRow` | `(loadableId, data?)` | Add a new row |
| `updateRow` | `(loadableId, rowId, data)` | Update row data |
| `removeRow` | `(loadableId, rowId)` | Remove a row |
| `setActiveRow` | `(loadableId, rowId)` | Select a row |
| `setRows` | `(loadableId, rows)` | Replace all rows |
| `setColumns` | `(loadableId, columns)` | Set column definitions |
| `connectToSource` | `(loadableId, sourceId, sourceName, sourceType)` | Connect to entity |
| `disconnect` | `(loadableId)` | Switch to local mode |
| `linkToRunnable` | `(loadableId, runnableType, runnableId)` | Link for column derivation |
| `setExecutionResult` | `(loadableId, rowId, result)` | Store execution result |
| `clearExecutionResults` | `(loadableId)` | Clear all results |

## Source Types

### testcase

Connects to testset testcases via `testcaseMolecule`.

```typescript
// When connected, rows are derived from testcaseMolecule
const connect = useSetAtom(loadableBridge.actions.connectToSource)
connect(loadableId, revisionId, 'TestsetName v1', 'testcase')
```

### trace (Future)

Will connect to trace spans as loadable data.

```typescript
// Coming soon
connect(loadableId, traceId, 'TraceSpan', 'trace')
```

## Custom Sources

Use `createLoadableBridge` to add custom source types:

```typescript
import { createLoadableBridge } from '@agenta/entities/loadable'
import { myCustomMolecule } from './myModule'

const customBridge = createLoadableBridge({
    sources: {
        testcase: { /* existing config */ },
        myCustomSource: {
            molecule: myCustomMolecule,
            toRow: (entity) => ({
                id: entity.id,
                data: { field1: entity.field1 },
            }),
            displayRowIdsAtom: myCustomMolecule.atoms.displayIds,
        },
    },
})
```

## Types

### Core Types

```typescript
interface LoadableRow {
    id: string
    data: Record<string, unknown>
}

interface LoadableColumn {
    key: string
    name: string
    type: "string" | "number" | "boolean" | "object" | "array"
}

type LoadableMode = "local" | "connected"
```

### State Shape

```typescript
interface LoadableState {
    rows: LoadableRow[]
    columns: LoadableColumn[]
    activeRowId: string | null
    connectedSourceId: string | null
    connectedSourceName: string | null
    connectedSourceType: string | null
    linkedRunnableType: string | null
    linkedRunnableId: string | null
    executionResults: Record<string, unknown>
}
```

## Legacy API (Backwards Compatible)

The following exports are maintained for backwards compatibility:

```typescript
// Deprecated - use loadableBridge instead
import { loadableController, testsetLoadable, useLoadable } from '@agenta/entities/loadable'

// Controller usage (deprecated)
const rows = useAtomValue(loadableController.testset.selectors.rows(loadableId))

// Hook usage (still supported)
const loadable = useLoadable(loadableId)
loadable.rows
loadable.addRow({ input: 'test' })
```

## Integration with Testcase Molecule

When connected to a source, the loadable bridges to `testcaseMolecule`:

```typescript
// Connected mode flow:
loadable.rows → connectedRowsAtomFamily → testcaseMolecule.atoms.displayRowIds
                                        → testcaseMolecule.selectors.data(id)

// Local mode flow:
loadable.rows → loadableStateAtomFamily.rows (direct)
```

This allows the loadable to:
- Show testcase data when connected
- Track dirty state via testcaseMolecule
- Fall back to local state when disconnected
