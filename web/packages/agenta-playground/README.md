# @agenta/playground

State management for the Agenta playground feature.

## Overview

This package provides **state controllers** for managing playground state.
It is decoupled from UI - for React components, use `@agenta/playground-ui`.

## Installation

This is an internal workspace package. Add it to your `package.json`:

```json
{
  "dependencies": {
    "@agenta/playground": "workspace:*"
  }
}
```

## Usage

### Controllers

Controllers provide a clean API for state access:

```typescript
import { playgroundController, outputConnectionController } from '@agenta/playground'
import { useAtomValue, useSetAtom } from 'jotai'

// Read state via selectors
const nodes = useAtomValue(playgroundController.selectors.nodes())
const selectedNode = useAtomValue(playgroundController.selectors.selectedNode())
const connections = useAtomValue(outputConnectionController.selectors.allConnections())

// Write state via dispatch
const dispatch = useSetAtom(playgroundController.dispatch)
dispatch({ type: 'addNode', payload: nodeConfig })

// Compound actions
const addPrimaryNode = useSetAtom(playgroundController.actions.addPrimaryNode)
addPrimaryNode(selection)
```

### Execution

Use `useChainExecution` hook for execution orchestration:

```typescript
import { useChainExecution } from '@agenta/playground'

// Automatic loadableId derivation from primary node
const { runStep, sessions, isCompareMode, isExecuting } = useChainExecution()

// Run a step
await runStep('row-123', { prompt: 'Hello' })
```

For advanced usage, use `executionController` directly:

```typescript
import { executionController } from '@agenta/playground'
import { useAtomValue, useSetAtom } from 'jotai'

// Initialize sessions (required before execution)
const initSessions = useSetAtom(executionController.actions.initSessions)
initSessions({
    loadableId: 'loadable-1',
    sessions: [
        { id: 'sess:rev1', runnableId: 'rev1', runnableType: 'appRevision', mode: 'completion' }
    ]
})

// Run step
const runStep = useSetAtom(executionController.actions.runStep)
await runStep({
    loadableId: 'loadable-1',
    stepId: 'row-123',
    data: { prompt: 'Hello' }
})

// Get result
const result = useAtomValue(
    executionController.selectors.resultForStepSession('loadable-1', 'row-123', 'sess:rev1')
)
```

### Multi-Session Execution (Compare Mode)

For comparing execution across multiple runnables (e.g., different revisions):

```typescript
import { executionController } from '@agenta/playground'
import { useAtomValue, useSetAtom } from 'jotai'

// Initialize multiple sessions
const initSessions = useSetAtom(executionController.actions.initSessions)
initSessions({
    loadableId: 'loadable-1',
    sessions: [
        { id: 'sess:revA', runnableId: 'revA', runnableType: 'appRevision', mode: 'completion' },
        { id: 'sess:revB', runnableId: 'revB', runnableType: 'appRevision', mode: 'completion' },
    ]
})

// Run step across all active sessions
const runStep = useSetAtom(executionController.actions.runStep)
await runStep({
    loadableId: 'loadable-1',
    stepId: 'row-123',
    data: { prompt: 'Hello' }
})

// Get results per session
const resultsForStep = useAtomValue(
    executionController.selectors.resultsForStep('loadable-1', 'row-123')
)
// { 'sess:revA': RunResult, 'sess:revB': RunResult }

// Check if in compare mode
const isCompareMode = useAtomValue(
    executionController.selectors.isCompareMode('loadable-1')
)
```

**Using the hook:**

```typescript
import { useChainExecution } from '@agenta/playground'

const {
    runStep,
    getResultsForStep,
    sessions,
    isCompareMode,
    isExecuting,
} = useChainExecution()

// Run step across sessions
await runStep('row-123', { prompt: 'Hello' })
```

### React Hooks (Recommended for React Components)

For React components, use the convenience hooks from `@agenta/playground/react`:

```typescript
import { usePlaygroundState, useChainExecution, useDerivedState } from '@agenta/playground/react'

function MyComponent() {
    // Full playground state access
    const {
        primaryNode,
        nodes,
        connectedTestset,
        extraColumns,
        allConnections,
        editingConnectionId,
        addPrimaryNode,
        connectToTestset,
        addRowWithInit,
    } = usePlaygroundState()

    // Execution
    const { runStep, isExecuting, sessions } = useChainExecution()

    // Transform controller state to view model types for UI
    const {
        primaryNodeEntity,
        runnableNodes,
        outputReceivers,
        executionResults,
    } = useDerivedState({
        primaryNode,
        nodes,
        allConnections,
        editingConnectionId,
        loadable,
        extraColumns,
    })

    return (
        <button onClick={() => addPrimaryNode(selection)}>Add Node</button>
    )
}
```

**Hooks are also available from the main export:**

```typescript
import { usePlaygroundState, useChainExecution } from '@agenta/playground'
```

### URL Snapshot Sharing

Share playground state (including draft changes) via URL:

```typescript
import { playgroundSnapshotController } from '@agenta/playground'
import { parseSnapshot, encodeSnapshot } from '@agenta/playground/snapshot'
import { useSetAtom } from 'jotai'

// Create a snapshot from current selection
const createSnapshot = useSetAtom(playgroundSnapshotController.actions.createSnapshot)
const result = createSnapshot(['rev-123', 'local-draft-456'])

if (result.ok) {
    // Build share URL
    const url = new URL(window.location.href)
    url.hash = `pgSnapshot=${result.encoded}`
    await navigator.clipboard.writeText(url.toString())
}

// Hydrate a snapshot (restore state from URL)
const hydrateSnapshot = useSetAtom(playgroundSnapshotController.actions.hydrateSnapshot)
const encoded = extractSnapshotFromHash(url) // Your URL parsing logic
const parseResult = parseSnapshot(encoded)

if (parseResult.ok) {
    const hydrateResult = hydrateSnapshot(parseResult.value)
    // hydrateResult.selection contains the new revision IDs to select
}
```

**Snapshot subpath exports:**

```typescript
import {
    encodeSnapshot,
    parseSnapshot,
    validateSnapshot,
    type PlaygroundSnapshotV1,
    SNAPSHOT_VERSION,
    MAX_ENCODED_LENGTH,
} from '@agenta/playground/snapshot'
```

### Entity Context (Dependency Injection)

```typescript
import { PlaygroundEntityProvider, usePlaygroundEntities } from '@agenta/playground'

// In app root
<PlaygroundEntityProvider value={providers}>
  <App />
</PlaygroundEntityProvider>

// In components
const { appRevisionSelectors, evaluatorRevisionSelectors } = usePlaygroundEntities()
```

## API

### Controllers

| Controller | Purpose |
|------------|---------|
| `playgroundController` | Nodes, selection, testset connection |
| `outputConnectionController` | Inter-node connections, mappings |
| `entitySelectorController` | Entity selection modal state |
| `executionController` | Execution orchestration (single & multi-session) |
| `playgroundSnapshotController` | URL snapshot sharing (create/hydrate) |

### React Hooks (`@agenta/playground/react`)

| Hook | Purpose |
|------|---------|
| `usePlaygroundState` | Full playground state and compound actions |
| `useChainExecution` | Execution orchestration (optional loadableId, defaults to primary node) |
| `useDerivedState` | Transform controller state to view model types |

### View Model Types

These types transform controller state for UI consumption:

| Type | Purpose |
|------|---------|
| `ChainExecutionResult` | Execution result for UI display (subset of `RowExecutionResult`) |
| `ChainNodeInfo` | Node info for chain display |
| `RunnableNode` | Node in the playground graph with entity and ports |
| `OutputReceiverInfo` | Downstream receiver for ConfigPanel display |
| `EntityInfo` | Entity reference with required label |

## Architecture

```
@agenta/playground (this package)
├── Controllers (public API)
│   ├── playgroundController
│   ├── outputConnectionController
│   ├── entitySelectorController
│   └── executionController (async)
├── React Hooks (@agenta/playground/react)
│   ├── usePlaygroundState (controller state bindings)
│   ├── useChainExecution (execution orchestration)
│   └── useDerivedState (view model transformations)
├── View Model Types
│   ├── ChainExecutionResult
│   ├── RunnableNode
│   ├── OutputReceiverInfo
│   └── EntityInfo
└── Context
    └── PlaygroundEntityProvider

        ↑
@agenta/playground-ui (UI package)
├── Components
│   ├── PlaygroundContent
│   ├── ConfigPanel
│   └── ...
└── Context
    └── PlaygroundUIProvider
```

### Directory Structure

```text
src/
├── index.ts              # Public exports (controllers, hooks, types)
├── react/                # React bindings (@agenta/playground/react)
│   ├── index.ts          # Hook exports
│   ├── usePlaygroundState.ts   # Controller state bindings
│   ├── useChainExecution.ts    # Execution orchestration
│   └── useDerivedState.ts      # View model transformations
├── hooks/                # Deprecated - re-exports from react/
└── state/                # Jotai atoms and controllers
    ├── atoms/            # Internal atoms (NOT exported from package)
    ├── controllers/      # Public controller APIs
    │   ├── playgroundController.ts
    │   ├── outputConnectionController.ts
    │   ├── entitySelectorController.ts
    │   └── executionController.ts  # Async compound actions
    ├── context/          # Entity provider injection
    └── types.ts          # Type definitions + view model types
```

### State Management

The playground uses a **controller pattern** for state management:

```typescript
import { playgroundController, outputConnectionController } from "@agenta/playground"

// Selectors (read state)
const nodes = useAtomValue(playgroundController.selectors.nodes())
const primaryNode = useAtomValue(playgroundController.selectors.primaryNode())

// Dispatch (simple actions)
const dispatch = useSetAtom(playgroundController.dispatch)
dispatch({ type: 'selectNode', nodeId: 'node-123' })

// Compound actions (multi-step operations)
const addPrimaryNode = useSetAtom(playgroundController.actions.addPrimaryNode)
addPrimaryNode(selection)
```

### Compound Actions

Compound actions encapsulate multi-step operations that should be atomic:

**playgroundController.actions:**

| Action | What it does |
|--------|--------------|
| `addPrimaryNode` | Creates node, links loadable, sets up local testset, creates initial row |
| `changePrimaryNode` | Updates primary node, re-links loadable, updates testset name if local |
| `addDownstreamNode` | Creates downstream node with correct depth |
| `removeNode` | Removes node, cleans up selection, returns removed connection IDs |
| `disconnectAndResetToLocal` | Disconnects testset, resets to local mode, creates initial row |
| `connectToTestset` | Connects to testset revision, updates playground state, syncs testcases atomically |
| `importTestcases` | Imports testcases in local mode without connecting to a source |
| `addRowWithInit` | Adds row with automatic local testset name initialization if needed |
| `addExtraColumn` | Adds extra column to both playground and loadable state atomically |
| `removeExtraColumn` | Removes extra column from both playground and loadable state atomically |
| `addOutputMappingColumn` | Adds output mapping column to loadable only (not extraColumns), with key normalization |

**executionController.actions:**

| Action | What it does |
|--------|--------------|
| `initSessions` | Initialize execution sessions (required before execution) |
| `addSession` | Add a single session |
| `removeSession` | Remove a session and its results |
| `setActiveSessions` | Set active sessions for compare mode |
| `addStep` | Add a step (for chat mode) |
| `updateStepInput` | Update step input before execution |
| `removeStep` | Remove a step and its results |
| `runStep` | Execute step across sessions (main execution action) |
| `cancelStep` | Cancel step execution |
| `reset` | Reset all execution state |

**executionController.selectors:**

| Selector | Returns |
|----------|---------|
| `mode(loadableId)` | Execution mode ("completion" \| "chat") |
| `sessions(loadableId)` | All sessions as array |
| `activeSessions(loadableId)` | Active sessions for compare |
| `isCompareMode(loadableId)` | Whether comparing multiple sessions |
| `steps(loadableId)` | All steps in order |
| `resultsForStep(loadableId, stepId)` | Step results by sessionId |
| `resultForStepSession(loadableId, stepId, sessionId)` | Single result |
| `isStepRunning(loadableId, stepId)` | Whether step is running |
| `isAnyExecuting(loadableId)` | Whether any execution is running |
| `progress(loadableId)` | Execution progress info |
| `stateSummary(loadableId)` | Complete state summary |

**Why compound actions?**

UI components should not contain business logic. Instead of:

```typescript
// ❌ BAD: UI handler with business logic
const handleAdd = () => {
    set(playgroundNodesAtom, [...nodes, newNode])
    set(selectedNodeIdAtom, newNode.id)
    set(connectedTestsetAtom, { id: null, name: generateName() })
    set(loadableController.actions.linkToRunnable, loadableId, type, id)
    set(loadableController.actions.addRow, loadableId, {})
}
```

Use compound actions:

```typescript
// ✅ GOOD: Single action call
const handleAdd = () => addPrimaryNode(selection)
```

### Key Concepts

1. **Loadable Entities**: Data sources (testsets, traces) that provide input rows for execution
2. **Runnable Entities**: App revisions and evaluators that can be executed
3. **Chain Execution**: Multi-node DAG execution with topological ordering
4. **Output Mapping**: Maps execution outputs to testcase columns
5. **Compound Actions**: Atomic multi-step operations for complex workflows

## Package Exports

```typescript
// Main exports (controllers + hooks)
import {
  playgroundController,
  outputConnectionController,
  entitySelectorController,
  executionController,
  usePlaygroundState,
  useChainExecution,
  useDerivedState,
  PlaygroundEntityProvider,
} from '@agenta/playground'

// React subpath (recommended for React components)
import {
  usePlaygroundState,
  useChainExecution,
  useDerivedState,
} from '@agenta/playground/react'

// State-only subpath (for advanced usage)
import { playgroundController } from '@agenta/playground/state'

// Type exports
import type {
  // Entity types
  PlaygroundNode,
  OutputConnection,
  EntitySelection,
  RunnableType,
  // View model types
  ChainExecutionResult,
  ChainNodeInfo,
  RunnableNode,
  OutputReceiverInfo,
  EntityInfo,
  // Compound action payloads
  ConnectToTestsetPayload,
  ImportTestcasesPayload,
  AddRowWithInitPayload,
  ExtraColumnPayload,
  OutputMappingColumnPayload,
  InitSessionsPayload,
  RunStepPayload,
  // Hook param types
  DerivedStateParams,
} from '@agenta/playground'
```

## Internal Notes

**Atoms are NOT exported from this package.**

Internal atoms are implementation details used by controllers. External consumers should use the controller API:

```typescript
// GOOD - Use controllers
const nodes = useAtomValue(playgroundController.selectors.nodes())

// BAD - Don't import internal atoms
// import { playgroundNodesAtom } from '@agenta/playground' // NOT exported
```

## Dependencies

- `@agenta/entities` - Entity state management (runnable, loadable, testset)
- `@agenta/shared` - Shared utilities (formatters, API)
- `jotai` - State management

## Related Packages

- `@agenta/playground-ui` - React UI components
- `@agenta/entities` - Entity state management

## Development

```bash
# Type check
pnpm build

# Lint
pnpm lint
```

## Completed Improvements

The following work packages from the [Playground UI Code Review](../../../docs/handovers/playground-ui-code-review.md) have been implemented:

- **WP1:** Testset connection logic consolidated into `connectToTestset` and `importTestcases` compound actions
- **WP2:** Row management logic moved to `addRowWithInit` compound action
- **WP3:** Extra column management unified via `addExtraColumn` and `removeExtraColumn` compound actions
- **WP4:** Output mapping column management unified via `addOutputMappingColumn` compound action
- **WP8:** Chain execution moved from `useChainExecution` hook to `executionController` with async compound actions
- **WP9:** React hooks consolidated in `@agenta/playground/react` subpath (`usePlaygroundState`, `useChainExecution`)
- **WP10:** View model types (`ChainExecutionResult`, `RunnableNode`, `OutputReceiverInfo`, `EntityInfo`) and `useDerivedState` hook moved to `@agenta/playground`

### Design Principles

1. **State machine completeness**: All multi-step workflows should have compound actions
2. **No UI business logic**: UI components call single actions only
3. **Atomic operations**: Related state changes happen together
4. **Reactive derivation**: Derive state in atoms, not in useEffect
