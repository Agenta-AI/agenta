# Runnable Module

Execution management for entities that can be invoked (app revisions, evaluators).

A **runnable** represents an executable entity that can process inputs and produce outputs. Runnables include:

- **App Revisions**: Application variants with specific configurations
- **Evaluator Revisions**: Evaluation logic for scoring outputs

## Quick Start (New API)

```typescript
import { runnableBridge } from '@agenta/entities/runnable'
import { useAtomValue } from 'jotai'

// Get runnable data
const data = useAtomValue(runnableBridge.selectors.data(revisionId))

// Get input/output ports
const inputPorts = useAtomValue(runnableBridge.selectors.inputPorts(revisionId))
const outputPorts = useAtomValue(runnableBridge.selectors.outputPorts(revisionId))

// Access evaluator-specific features
const evalController = runnableBridge.runnable('evaluatorRevision')
const presets = useAtomValue(evalController.selectors.presets(evaluatorId))
```

## Architecture

The runnable system uses a **bridge pattern** that separates:

1. **Types** (`types.ts`): Shared type definitions
2. **Bridge** (`bridge.ts`): Connects molecule APIs to unified selectors
3. **Factory** (`shared/createPlaygroundBridge.ts`): Creates bridges with configurable runnable types

```text
┌─────────────────────────────────────────────────────────────────┐
│                    runnableBridge                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │ appRevision │    │ evaluator   │    │   future    │         │
│  │   runnable  │    │  Revision   │    │  runnables  │         │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘         │
│         │                  │                  │                 │
│         ▼                  ▼                  ▼                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              Unified Selectors                              ││
│  │  data, query, isDirty, inputPorts, outputPorts, schemas    ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## API Reference

### Selectors

| Selector | Returns | Description |
| -------- | ------- | ----------- |
| `data(runnableId)` | `RunnableData \| null` | Runnable data |
| `query(runnableId)` | `BridgeQueryState` | Query state with loading/error |
| `isDirty(runnableId)` | `boolean` | Has unsaved changes |
| `inputPorts(runnableId)` | `RunnablePort[]` | Input port definitions |
| `outputPorts(runnableId)` | `RunnablePort[]` | Output port definitions |
| `configuration(runnableId)` | `Record<string, unknown> \| null` | Configuration object |
| `invocationUrl(runnableId)` | `string \| null` | URL for execution |
| `schemas(runnableId)` | `{inputSchema, outputSchema} \| null` | JSON schemas |

### Runnable-Specific Selectors

Access runnable-type-specific features:

```typescript
// Evaluator-specific
const evalController = runnableBridge.runnable('evaluatorRevision')
const presets = useAtomValue(evalController.selectors.presets(evaluatorId))
const applyPreset = useSetAtom(evalController.actions.applyPreset)
applyPreset(evaluatorId, presetId)
```

## Runnable Types

### appRevision

App revisions use `appRevisionMolecule` for:
- Schema extraction (input/output ports)
- Configuration management
- Invocation URL resolution

### evaluatorRevision

Evaluator revisions use `evaluatorRevisionMolecule` for:
- Preset management
- Evaluation configuration
- Custom schemas

Note: `evaluatorRevisionMolecule` is a stub by default in OSS. Configure it via dependency injection for full functionality.

## Custom Runnables

Use `createRunnableBridge` to add custom runnable types:

```typescript
import { createRunnableBridge } from '@agenta/entities/runnable'
import { myCustomMolecule } from './myModule'

const customBridge = createRunnableBridge({
    runnables: {
        appRevision: { /* existing config */ },
        evaluatorRevision: { /* existing config */ },
        myCustomRunnable: {
            molecule: myCustomMolecule,
            toRunnable: (entity) => ({
                id: entity.id,
                name: entity.name,
                configuration: entity.config,
                schemas: entity.schemas,
            }),
            getInputPorts: (entity) => extractPorts(entity.schemas?.inputSchema),
            getOutputPorts: (entity) => extractPorts(entity.schemas?.outputSchema),
        },
    },
})
```

## Types

### Core Types

```typescript
interface RunnableData {
    id: string
    name?: string
    version?: number
    slug?: string
    configuration?: Record<string, unknown>
    invocationUrl?: string
    schemas?: {
        inputSchema?: unknown
        outputSchema?: unknown
    }
}

interface RunnablePort {
    key: string
    name: string
    type: string
    required?: boolean
    schema?: unknown
}
```

### Execution Types

```typescript
type ExecutionStatus = "idle" | "pending" | "running" | "success" | "error" | "cancelled"

interface ExecutionResult {
    executionId: string
    status: ExecutionStatus
    startedAt: string
    completedAt?: string
    output?: unknown
    error?: { message: string; code?: string }
    trace?: TraceInfo
    metrics?: ExecutionMetrics
}
```

## Utilities

### Chain Execution

For DAG-based execution of multiple runnables:

```typescript
import { computeTopologicalOrder, resolveChainInputs } from '@agenta/entities/runnable'

// Get execution order
const order = computeTopologicalOrder(nodes, connections)

// Resolve inputs from upstream outputs
const inputs = resolveChainInputs(mappings, upstreamOutputs, testcaseData)
```

### Auto-Mapping

Automatically map inputs based on name matching:

```typescript
import { autoMapInputs } from '@agenta/entities/runnable'

const mappings = autoMapInputs(
    ["input", "context"],  // target keys
    [{ path: "testcase.input", key: "input" }]  // available sources
)
// Returns: [{ targetKey: "input", sourcePath: "testcase.input", status: "valid" }, ...]
```

## Legacy API (Backwards Compatible)

The following exports are maintained for backwards compatibility:

```typescript
// Deprecated - use runnableBridge instead
import { useRunnable, useRunnableSelectors, PlaygroundEntityProvider } from '@agenta/entities/runnable'

// Hook usage (still supported)
const runnable = useRunnable('appRevision', revisionId)
runnable.data
runnable.inputPorts
runnable.execute(inputs)

// Context provider (still supported)
<PlaygroundEntityProvider value={customProviders}>
    <App />
</PlaygroundEntityProvider>
```

## File Structure

```text
runnable/
├── README.md                         # This file
├── index.ts                          # Public exports
├── types.ts                          # Shared type definitions
├── bridge.ts                         # Configured runnable bridge
├── useRunnable.ts                    # React hook for runnables (legacy)
├── utils.ts                          # Execution utilities
└── context/
    └── PlaygroundEntityContext.tsx   # DI provider (legacy)
```
