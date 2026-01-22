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

The runnable system uses a **bridge pattern** with clear abstraction layers:

### Abstraction Layers

```text
┌─────────────────────────────────────────────────────────────────┐
│                     UI Components                                │
│         (read selectors, dispatch actions via hooks)            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      runnableBridge                              │
│    High-level API: data, inputPorts, outputPorts, schemas...   │
│    (Entity-agnostic interface for UI consumption)               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Entity Molecules                            │
│       appRevisionMolecule, evaluatorRevisionMolecule...         │
│   (Entity-specific data access, schema parsing, dirty tracking) │
└─────────────────────────────────────────────────────────────────┘
```

**Key principle:** UI components should use the highest-level API available (`runnableBridge`), not reach down to molecules directly. This enables:

- **Unified API** across different runnable types (app revisions, evaluators, future types)
- **Decoupled data layer** - UI doesn't know about entity implementation details
- **Easy customization** - behavior differences handled at molecule level (e.g., evaluator presets)
- **Reduced boilerplate** - common patterns like port extraction implemented once

### Layer Responsibilities

1. **Types** (`types.ts`): Shared type definitions for execution, ports, mappings
2. **Bridge** (`bridge.ts`): Connects molecule APIs to unified selectors with transformations
3. **Factory** (`shared/createEntityBridge.ts`): Creates bridges with configurable runnable types

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

## Best Practices

### Invocation URL Resolution

The invocation URL is **computed from the schema query**, not stored directly on entity data. This is because:

- The URL depends on runtime prefix and route path from OpenAPI spec
- The schema query fetches the OpenAPI spec and extracts URL components

```typescript
// ❌ WRONG - Don't read invocationUrl directly from entity data
const data = useAtomValue(appRevisionMolecule.selectors.data(revisionId))
const url = data?.invocationUrl // This doesn't exist on AppRevisionData!

// ✅ CORRECT - Use the computed atom from molecule
const url = useAtomValue(appRevisionMolecule.atoms.invocationUrl(revisionId))
```

The computation flow:

```text
schemaQuery (fetches OpenAPI spec)
    → extracts runtimePrefix + routePath
    → invocationUrlAtomFamily computes full URL
    → molecule.atoms.invocationUrl exposes it
```

### API Payload Format

When invoking runnables, the API expects a specific payload structure:

```typescript
// ❌ WRONG - Don't send inputs directly
fetch(url, {
    body: JSON.stringify(inputs) // { prompt: "hello" }
})

// ✅ CORRECT - Wrap inputs in object
fetch(url, {
    body: JSON.stringify({ inputs }) // { inputs: { prompt: "hello" } }
})
```

For the `/test` endpoint (draft testing), include the ag_config:

```typescript
const requestBody: Record<string, unknown> = { inputs }

if (url.endsWith("/test")) {
    // Include draft config for testing uncommitted changes
    requestBody.ag_config = configuration
}

fetch(url, {
    body: JSON.stringify(requestBody)
})
```

### Response Data Extraction

API responses have a structured format:

```typescript
// API returns:
{
    version: "1.0",
    data: "The actual output",
    content_type: "text/plain",
    tree: { ... }
}

// Extract the main output
const responseData = await response.json()
const output = responseData?.data !== undefined
    ? responseData.data
    : responseData
```

### Input Ports Derivation

Input ports are derived reactively from the revision's `agConfig`:

```typescript
// The molecule computes inputPorts from agConfig template variables
const inputPorts = useAtomValue(appRevisionMolecule.selectors.inputPorts(revisionId))

// This extracts variables like {{topic}} from prompt templates
// Returns: [{ key: "topic", name: "topic", type: "string", required: true }]
```

This is the single source of truth for "what inputs does this revision expect".

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
import { useRunnable, useRunnableSelectors } from '@agenta/entities/runnable'

// Hook usage (still supported)
const runnable = useRunnable('appRevision', revisionId)
runnable.data
runnable.inputPorts
runnable.execute(inputs)
```

## Entity Provider (Dependency Injection)

For runtime dependency injection of entity implementations, use the context from `@agenta/playground`:

```typescript
import { PlaygroundEntityProvider, usePlaygroundEntities } from '@agenta/playground'

// Wrap your app with the provider
<PlaygroundEntityProvider providers={{
    appRevision: { selectors: appRevisionMolecule.selectors },
    evaluatorRevision: { selectors: evalMolecule.selectors, actions: evalMolecule.actions },
}}>
    <App />
</PlaygroundEntityProvider>

// Access injected providers in components
const { appRevision, evaluatorRevision } = usePlaygroundEntities()
```

The type definitions for providers are exported from this module:

```typescript
import type { PlaygroundEntityProviders, EntityRevisionSelectors } from '@agenta/entities/runnable'
```

## File Structure

```text
runnable/
├── README.md                         # This file
├── index.ts                          # Public exports
├── types.ts                          # Shared type definitions
├── providerTypes.ts                  # Provider interface types (for DI context)
├── bridge.ts                         # Configured runnable bridge
├── useRunnable.ts                    # React hook for runnables (legacy)
└── utils.ts                          # Execution utilities
```
