# Loadable Module

Data source management for entities that provide inputs to runnables.

A **loadable** represents a data source (like a testset or trace) that provides input rows for execution. Loadables can operate in local mode (manual data entry) or connected mode (synced with an entity).

## Quick Start

```typescript
import { loadableController } from '@agenta/entities/loadable'
import { useAtomValue, useSetAtom } from 'jotai'

// Read rows (flat, entity-agnostic API)
const rows = useAtomValue(loadableController.selectors.rows(loadableId))
const columns = useAtomValue(loadableController.selectors.columns(loadableId))
const isDirty = useAtomValue(loadableController.selectors.isDirty(loadableId))

// Add a row
const addRow = useSetAtom(loadableController.actions.addRow)
addRow(loadableId, { prompt: 'Hello, world!' })

// Connect to a testset (sets connectedSourceType: 'testcase')
const connect = useSetAtom(loadableController.actions.connectToSource)
connect(loadableId, testsetRevisionId, 'MyTestset v1', testcases)
```

## Architecture

The loadable system uses a **bridge pattern** with clear abstraction layers:

### Abstraction Layers

```text
┌─────────────────────────────────────────────────────────────────┐
│                     UI Components                                │
│         (read selectors, dispatch actions via hooks)            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   loadableBridge / loadableController           │
│    High-level API: rows, columns, addRow, connectToSource...   │
│    (Entity-agnostic interface for UI consumption)               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Entity Molecules                            │
│   testcaseMolecule, appRevisionMolecule, revisionMolecule...   │
│   (Entity-specific data access, mutations, dirty tracking)      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Pure State (store.ts)                       │
│              Jotai atoms with no entity dependencies             │
└─────────────────────────────────────────────────────────────────┘
```

**Key principle:** UI components should use the flat controller API (`loadableController.selectors.*` / `loadableController.actions.*`), not reach down to molecules or entity-specific APIs. This enables:

- **Unified API** across different data sources (testsets, traces, future sources)
- **Decoupled data layer** - UI doesn't know about entity implementation details
- **Easy customization** - behavior differences handled at molecule level
- **Reduced boilerplate** - common patterns implemented once in controller

### Layer Responsibilities

1. **Pure state** (`store.ts`): Jotai atoms with no entity dependencies
2. **Controller** (`controller.ts`): Bridges entity molecules to unified selectors/actions
3. **Bridge** (`bridge.ts`): Minimal wrapper exposing the controller API
4. **Factory** (`shared/createEntityBridge.ts`): Creates bridges with configurable sources

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
// The connectToSource action sets connectedSourceType: 'testcase'
const connect = useSetAtom(loadableController.actions.connectToSource)
connect(loadableId, revisionId, 'TestsetName v1', testcases)
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
    columns: LoadableColumn[]
    activeRowId: string | null
    name: string | null  // For new testset creation
    connectedSourceId: string | null
    connectedSourceName: string | null
    connectedSourceType: LoadableSourceType | null  // 'testcase' | 'trace' (for entity dispatch)
    linkedRunnableType: RunnableType | null
    linkedRunnableId: string | null
    executionResults: Record<string, RowExecutionResult>
    outputMappings: OutputMapping[]  // Maps execution outputs to columns
    hiddenTestcaseIds: Set<string>   // UI-only filter for hidden rows
    disabledOutputMappingRowIds: Set<string>  // Rows with output mapping disabled
}

// Note: Rows are NOT stored in LoadableState - they live in testcaseMolecule.
// The loadable is a view/context layer over testcase entities.
```

## Controller API

The `loadableController` provides a flat, entity-agnostic API that internally dispatches
to the appropriate entity implementation based on `connectedSourceType`.

```typescript
import { loadableController } from '@agenta/entities/loadable'

// Flat API (entity-agnostic) - PREFERRED
const rows = useAtomValue(loadableController.selectors.rows(loadableId))
const isDirty = useAtomValue(loadableController.selectors.isDirty(loadableId))

// Actions
const addRow = useSetAtom(loadableController.actions.addRow)
addRow(loadableId, { input: 'test' })

// For entity-specific features not in the flat API
const testcaseSpecific = useAtomValue(
    loadableController.entities.testset.selectors.newColumnKeys(loadableId)
)
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

### Identity-Only Row Pattern

Loadable tables follow the same identity-only row pattern as `TestcaseTable`:

```typescript
// Rows contain only identifiers - no entity data duplicated
interface LoadableTableRow {
    id: string
    key: string
    __isSkeleton?: boolean
}

// Cell data is accessed via testcase molecule
const cellValue = testcase.get.cell(record.id, columnKey)
```

This ensures consistent data access regardless of whether data is local-only or server-synced.
See `LoadableDataTable` for the reference implementation.

## Best Practices

### Reactive Column Derivation

Columns should be **derived reactively** from the linked runnable's input ports, not synced manually via React effects:

```typescript
// ❌ WRONG - Don't sync columns via React useEffect
useEffect(() => {
    const newColumns = runnable.inputPorts.map(port => ({
        key: port.key,
        name: port.name,
        type: port.type,
    }))
    loadable.setColumns(newColumns)
}, [runnable.inputPorts])

// ✅ CORRECT - Columns derived automatically in atom
// loadableColumnsFromRunnableAtomFamily reads inputPorts reactively
const columns = useAtomValue(loadableController.selectors.columns(loadableId))
```

The derivation flow:

```text
appRevisionMolecule.selectors.inputPorts(revisionId)
    → extracts variables from agConfig template (e.g., {{topic}})
    → loadableColumnsFromRunnableAtomFamily transforms to columns
    → loadable columns include both derived + existing data columns
```

### Avoiding React Effect Syncs

State synchronization should happen **within atoms**, not in React components:

```typescript
// ❌ ANTI-PATTERN - Component responsible for keeping state in sync
function PlaygroundContent() {
    const inputPorts = useAtomValue(runnableBridge.inputPorts(revisionId))
    const setColumns = useSetAtom(loadableController.actions.setColumns)

    // This couples state correctness to component lifecycle!
    useEffect(() => {
        const columns = inputPorts.map(port => ({ key: port.key, name: port.name, type: port.type }))
        setColumns(loadableId, columns)
    }, [inputPorts])

    return <Content />
}

// ✅ CORRECT - State derived reactively in atoms
// Components just read the derived state
function PlaygroundContent() {
    const columns = useAtomValue(loadableController.selectors.columns(loadableId))
    // columns automatically include derived columns from runnable
    return <Content columns={columns} />
}
```

**Why this matters:**

- React effects run after render, causing unnecessary re-renders
- Components become responsible for state correctness
- Testing requires rendering components to trigger syncs
- State can become stale if effects don't run (unmounted, suspended)

### Metadata-Based Context Passing

When opening modals or invoking actions that need context from multiple sources, pass context via metadata rather than creating reverse lookup atoms:

```typescript
// ❌ WRONG - Creating reverse lookup atoms
const loadableIdForRevisionAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        // This scans all loadables to find which one is connected
        // Expensive and error-prone!
    })
)

// ✅ CORRECT - Pass context via metadata
const {commit} = useBoundCommit({
    type: "revision",
    id: revisionId,
    metadata: { loadableId }, // Context flows up from UI
})

// The adapter receives metadata and can query derived state
const derivedChanges = loadableId
    ? get(derivedColumnChangesAtomFamily(loadableId))
    : { added: [], removed: [] }
```

### Compound Actions for Multi-Step Operations

When an action requires multiple state updates, bundle them in a single write atom:

```typescript
// ❌ WRONG - Multiple separate dispatches
const handleConnect = () => {
    setConnectedSourceId(sourceId)
    setConnectedSourceName(sourceName)
    setConnectedSourceType('testcase')
    setLinkedRunnableId(runnableId)
    linkToTestset(sourceId)
}

// ✅ CORRECT - Single compound action
const connectToSource = useSetAtom(loadableController.actions.connectToSource)
connectToSource(loadableId, sourceId, sourceName, 'testcase')
// Internally bundles all state updates atomically
```

### Reactive Effect Atoms for Auto-Initialization

When state needs to be initialized based on async data (like schema loading), use **effect atoms** instead of polling or React effects:

```typescript
// ❌ WRONG - Polling with timeouts
const linkToRunnable = async (loadableId, runnableId) => {
    // Poll for schema to load...
    for (let i = 0; i < 30; i++) {
        const schema = get(schemaQuery)
        if (schema.data) {
            initializeMappings()
            return
        }
        await sleep(100)  // NEVER use timeouts!
    }
}

// ❌ WRONG - React effect sync
useEffect(() => {
    if (schemaLoaded && !hasMappings) {
        initializeDefaultMappings()
    }
}, [schemaLoaded, hasMappings])

// ✅ CORRECT - Reactive effect atom
// 1. Pure selector determines if init should happen
const shouldAutoInitAtomFamily = atomFamily((loadableId) =>
    atom((get) => {
        const state = get(loadableStateAtomFamily(loadableId))
        if (state.outputMappings.length > 0) return false
        const schema = get(schemaQuery(state.linkedRunnableId))
        return !schema.isPending && hasRealOutputPorts(schema)
    })
)

// 2. Effect atom triggers initialization when conditions are met
const autoInitEffectAtomFamily = atomFamily((loadableId) =>
    atom((get) => {
        const shouldInit = get(shouldAutoInitAtomFamily(loadableId))
        if (shouldInit) {
            getDefaultStore().set(initializeDefaultMappingsAtom, loadableId)
        }
        return shouldInit
    })
)

// 3. Wire into selector chain (e.g., rows selector)
const rowsSelector = (loadableId) => atom((get) => {
    get(autoInitEffectAtomFamily(loadableId))  // Trigger effect
    return get(connectedRowsAtomFamily(loadableId))
})
```

**Why this pattern:**
- No timeouts or polling (violates codebase rules)
- No React component lifecycle dependency
- Runs purely at the Jotai atom level
- Automatically triggers when dependencies change
- Self-preventing: conditions include checks that prevent re-triggering

## File Structure

```text
loadable/
├── README.md                 # This file
├── index.ts                  # Public exports
├── types.ts                  # Type definitions
├── store.ts                  # Pure Jotai atoms (no entity deps)
├── controller.ts             # Entity-aware atoms, actions, and bridge logic
├── bridge.ts                 # Minimal bridge wrapper (delegates to controller)
└── utils.ts                  # Path extraction and output mapping utilities
```
