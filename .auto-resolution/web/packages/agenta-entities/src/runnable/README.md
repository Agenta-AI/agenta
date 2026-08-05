# Runnable Module

Execution management for entities that can be invoked (app revisions, evaluators).

A **runnable** represents an executable entity that can process inputs and produce outputs. Runnables include:

- **App Revisions**: Application variants with specific configurations
- **Evaluator Revisions**: Evaluation logic for scoring outputs

## Quick Start

```typescript
import { workflowMolecule } from '@agenta/entities/workflow'
import { useAtomValue } from 'jotai'

// Get revision data directly from the molecule
const data = useAtomValue(workflowMolecule.selectors.data(revisionId))
const inputPorts = useAtomValue(workflowMolecule.selectors.inputPorts(revisionId))
const outputPorts = useAtomValue(workflowMolecule.selectors.outputPorts(revisionId))
const config = useAtomValue(workflowMolecule.selectors.configuration(revisionId))
```

## Architecture

UI components access entity data directly via `workflowMolecule`:

```text
┌─────────────────────────────────────────────────────────────────┐
│                     UI Components                                │
│         (read selectors, dispatch actions via hooks)            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      workflowMolecule                            │
│   Data access, schema parsing, dirty tracking, input ports      │
│   (Entity-specific state management via Jotai atoms)            │
└─────────────────────────────────────────────────────────────────┘
```

### Layer Responsibilities

1. **Types** (`types.ts`): Shared type definitions for execution, ports, mappings
2. **Molecule** (`@agenta/entities/workflow`): Entity state management with selectors, actions, and cache
3. **Integration utilities** (`bridge.ts`): Standalone helpers for loadable-runnable column derivation and drill-in navigation

## API Reference

### Molecule Selectors

Access revision data via `workflowMolecule.selectors.*`:

| Selector | Returns | Description |
| -------- | ------- | ----------- |
| `data(revisionId)` | `WorkflowData \| null` | Revision data |
| `query(revisionId)` | `QueryState` | Query state with loading/error |
| `isDirty(revisionId)` | `boolean` | Has unsaved changes |
| `inputPorts(revisionId)` | `RunnablePort[]` | Input port definitions |
| `outputPorts(revisionId)` | `RunnablePort[]` | Output port definitions |
| `configuration(revisionId)` | `Record<string, unknown> \| null` | Configuration object |

## Types

### Core Types

```typescript
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

The invocation URL is **computed from the schema query**, not stored directly on entity data:

```typescript
// ✅ CORRECT - Use the computed atom from molecule
const url = useAtomValue(workflowMolecule.atoms.invocationUrl(revisionId))
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
const inputPorts = useAtomValue(workflowMolecule.selectors.inputPorts(revisionId))

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

## Entity Provider (Dependency Injection)

For runtime dependency injection of entity implementations, use the context from `@agenta/playground`:

```typescript
import { PlaygroundEntityProvider, usePlaygroundEntities } from '@agenta/playground'

// Wrap your app with the provider
<PlaygroundEntityProvider providers={{
    appRevision: { selectors: workflowMolecule.selectors },
}}>
    <App />
</PlaygroundEntityProvider>

// Access injected providers in components
const { appRevision } = usePlaygroundEntities()
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
├── bridge.ts                         # Standalone integration utilities
└── utils.ts                          # Execution utilities
```
