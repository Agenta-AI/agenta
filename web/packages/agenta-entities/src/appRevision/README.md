# AppRevision Entity

State management for **app revision** entities - versioned configurations of application variants.

## Overview

```text
appRevision/
├── index.ts                # Public exports
├── README.md               # This file
├── core.ts                 # Zod schemas, types, service type utilities
├── api/                    # HTTP functions
│   ├── api.ts              # Fetch functions and transformers
│   ├── schema.ts           # OpenAPI schema extraction + service prefetch
│   └── index.ts            # Re-exports
└── state/                  # State management
    ├── store.ts            # Query and draft atom families
    ├── schemaAtoms.ts      # Schema router atom + selectors
    ├── serviceSchemaAtoms.ts # Service schema prefetch (Layer 1)
    ├── runnableSetup.ts    # Runnable extension (execution mode, invocation)
    ├── molecule.ts         # Unified molecule API
    └── index.ts            # Re-exports
```

## Quick Start

### Using the Molecule API

```typescript
import { appRevisionMolecule } from '@agenta/entities/appRevision'
import { useAtomValue, useSetAtom } from 'jotai'

// Read entity data
const data = useAtomValue(appRevisionMolecule.atoms.data(revisionId))
const isDirty = useAtomValue(appRevisionMolecule.atoms.isDirty(revisionId))

// Read input ports (derived from agConfig template variables)
const inputPorts = useAtomValue(appRevisionMolecule.selectors.inputPorts(revisionId))

// Read schema
const agConfigSchema = useAtomValue(appRevisionMolecule.atoms.agConfigSchema(revisionId))

// Update draft
const update = useSetAtom(appRevisionMolecule.reducers.update)
update(revisionId, { agConfig: newConfig })
```

### Imperative API (in callbacks)

```typescript
import { appRevisionMolecule } from '@agenta/entities/appRevision'

// Read state
const data = appRevisionMolecule.get.data(revisionId)
const isDirty = appRevisionMolecule.get.isDirty(revisionId)

// Write state
appRevisionMolecule.set.update(revisionId, { agConfig: newConfig })
appRevisionMolecule.set.discard(revisionId)
```

## Molecule API

### Atoms

| Atom | Description |
|------|-------------|
| `.atoms.data(id)` | Merged data (server + draft) |
| `.atoms.query(id)` | Query state (isPending, isError, error) |
| `.atoms.draft(id)` | Local draft changes |
| `.atoms.isDirty(id)` | Has unsaved changes |
| `.atoms.inputPorts(id)` | Input ports derived from agConfig template |
| `.atoms.agConfigSchema(id)` | ag_config schema from OpenAPI |
| `.atoms.executionMode(id)` | Execution mode (direct/deployed) |
| `.atoms.endpoint(id)` | Endpoint based on mode (/test or /run) |
| `.atoms.invocationUrl(id)` | Full invocation URL |
| `.atoms.schemaLoading(id)` | Schema loading state |

### Selectors

| Selector | Description |
|----------|-------------|
| `.selectors.data(id)` | Merged entity data |
| `.selectors.serverData(id)` | Server data only |
| `.selectors.inputPorts(id)` | Input ports from agConfig |
| `.selectors.outputPorts(id)` | Output ports from schema |
| `.selectors.agConfigSchema(id)` | ag_config schema |
| `.selectors.promptSchema(id)` | Prompt-specific schema |
| `.selectors.customPropertiesSchema(id)` | Non-prompt properties |
| `.selectors.apps` | Apps list for selection |
| `.selectors.variantsByApp(appId)` | Variants for an app |
| `.selectors.revisions(variantId)` | Revisions for a variant |
| `.selectors.appsQuery` | Apps query state (isPending, isError, data) |
| `.selectors.variantsQuery(appId)` | Variants query state for an app |
| `.selectors.revisionsQuery(variantId)` | Revisions query state for a variant |

### Reducers

| Reducer | Description |
|---------|-------------|
| `.reducers.update` | `(id, changes) => void` - Update draft |
| `.reducers.discard` | `(id) => void` - Discard draft |
| `.reducers.setExecutionMode` | `(id, mode) => void` - Set execution mode |
| `.reducers.updatePrompt` | `(id, promptIndex, changes) => void` |
| `.reducers.updateMessage` | `(id, promptIndex, messageIndex, changes) => void` |
| `.reducers.addMessage` | `(id, promptIndex, message) => void` |
| `.reducers.deleteMessage` | `(id, promptIndex, messageIndex) => void` |

### Imperative API

```typescript
// Getters
appRevisionMolecule.get.data(id)           // => AppRevisionData | null
appRevisionMolecule.get.serverData(id)     // => AppRevisionData | null
appRevisionMolecule.get.isDirty(id)        // => boolean
appRevisionMolecule.get.inputPorts(id)     // => AppRevisionInputPort[]
appRevisionMolecule.get.executionMode(id)  // => ExecutionMode
appRevisionMolecule.get.invocationUrl(id)  // => string | null

// Setters
appRevisionMolecule.set.update(id, { agConfig: {...} })
appRevisionMolecule.set.discard(id)
appRevisionMolecule.set.executionMode(id, 'deployed')
```

## Architecture

### Entity Model

```text
App
├── Variant (named configuration)
└── Revisions (immutable snapshots)
    ├── agConfig (configuration object)
    ├── prompts (legacy format)
    └── parameters (additional settings)
```

### Data Flow

```text
┌─────────────────────────────────────────────────────────────────┐
│                    appRevisionMolecule                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │   Query     │    │   Draft     │    │   Schema    │         │
│  │   Atoms     │    │   Atoms     │    │   Atoms     │         │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘         │
│         │                  │                  │                 │
│         ▼                  ▼                  ▼                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              Unified Selectors                              ││
│  │  data, isDirty, inputPorts, outputPorts, invocationUrl     ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### Service Schema Prefetch

For **completion** and **chat** apps (the majority of user apps), the OpenAPI schema
is identical across all revisions of the same service type. This enables a two-layer
optimization that makes schema data available at app-selection time:

```text
┌──────────────────────────────────────────────────────────────────┐
│  Layer 1: Service Schema (prefetched)                            │
│  ┌───────────────────────────┐ ┌──────────────────────────────┐  │
│  │ completionServiceSchema   │ │ chatServiceSchema             │  │
│  │ /services/completion/     │ │ /services/chat/               │  │
│  │ openapi.json              │ │ openapi.json                  │  │
│  └───────────────────────────┘ └──────────────────────────────┘  │
│                                                                  │
│  Layer 2: Per-Revision Schema (fallback for custom apps)         │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ directSchemaQueryAtomFamily(revisionId)                   │    │
│  │ Fetches from {revision.uri}/openapi.json                  │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  Router: appRevisionSchemaQueryAtomFamily(revisionId)            │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ IF app_type is "completion" or "chat":                    │    │
│  │   → Use prefetched service schema + revision runtime ctx  │    │
│  │ ELSE (custom):                                            │    │
│  │   → Use per-revision schema fetch (existing behavior)     │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

**Timing comparison:**

| Flow | Without prefetch | With prefetch |
|------|------------------|---------------|
| Schema availability | After revision URI + OpenAPI fetch | At app selection |
| `isChatVariant` | After schema fetch | At app selection |
| `messagesSchema` | After schema fetch | At app selection |
| Custom apps | After revision URI + OpenAPI fetch | Same (no change) |

**Key files:**

| File | Purpose |
|------|---------|
| `state/serviceSchemaAtoms.ts` | Prefetch atoms, app type lookup, composition |
| `state/schemaAtoms.ts` | Router atom, per-revision fallback, selectors |
| `api/schema.ts` | `fetchServiceSchema()` — service endpoint fetch |
| `core.ts` | `resolveServiceType()`, `APP_SERVICE_TYPES`, `SERVICE_ROUTE_PATHS` |

**Usage (downstream consumers unchanged):**

```typescript
// These all work exactly the same — routing is transparent
const schema = useAtomValue(appRevisionMolecule.atoms.agConfigSchema(revisionId))
const isChatVariant = useAtomValue(appRevisionMolecule.atoms.isChatVariant(revisionId))
const messagesSchema = useAtomValue(appRevisionMolecule.atoms.messagesSchema(revisionId))
```

### Input Ports Derivation

Input ports are **derived reactively** from the revision's `agConfig` prompt template:

```typescript
// The molecule computes inputPorts from agConfig template variables
const inputPorts = useAtomValue(appRevisionMolecule.selectors.inputPorts(revisionId))

// This extracts variables like {{topic}} from prompt messages
// Returns: [{ key: "topic", name: "topic", type: "string", required: true }]
```

This is the **single source of truth** for "what inputs does this revision expect".

### Invocation URL Resolution

The invocation URL is **computed from the schema query**, not stored on entity data:

```typescript
// ❌ WRONG - Don't read invocationUrl from entity data
const data = useAtomValue(appRevisionMolecule.selectors.data(revisionId))
const url = data?.invocationUrl // This doesn't exist!

// ✅ CORRECT - Use the computed atom
const url = useAtomValue(appRevisionMolecule.atoms.invocationUrl(revisionId))
```

The computation flow:

```text
schemaQuery (fetches OpenAPI spec from revision URI)
    → extracts runtimePrefix + routePath
    → invocationUrlAtomFamily computes full URL
    → molecule.atoms.invocationUrl exposes it
```

## Runnable Extension

AppRevision implements the **runnable** interface for execution:

```typescript
import { runnableBridge } from '@agenta/entities/runnable'

// Use unified runnable API
const data = useAtomValue(runnableBridge.selectors.data(revisionId))
const inputPorts = useAtomValue(runnableBridge.selectors.inputPorts(revisionId))
```

### Execution Modes

| Mode | Endpoint | Description |
|------|----------|-------------|
| `direct` | `/test` | Test with draft config (uncommitted changes) |
| `deployed` | `/run` | Run with committed config |

```typescript
// Set execution mode
const setMode = useSetAtom(appRevisionMolecule.reducers.setExecutionMode)
setMode(revisionId, 'deployed')

// Read current mode
const mode = useAtomValue(appRevisionMolecule.atoms.executionMode(revisionId))
```

## API Functions

For direct API access:

```typescript
import {
  fetchRevisionConfig,
  fetchRevisionSchema,
  fetchAppsList,
  fetchVariantsList,
  fetchRevisionsList,
} from '@agenta/entities/appRevision'

// Fetch single revision config
const revision = await fetchRevisionConfig(revisionId, projectId)

// Fetch OpenAPI schema
const schema = await fetchRevisionSchema(uri)

// Fetch lists for selection
const apps = await fetchAppsList(projectId)
const variants = await fetchVariantsList(appId, projectId)
const revisions = await fetchRevisionsList(variantId, projectId)
```

## Types

### Core Types

```typescript
interface AppRevisionData {
  id: string
  variantId?: string
  appId?: string
  revision: number
  prompts?: PromptConfig[]
  agConfig?: Record<string, unknown>
  parameters?: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
  uri?: string
  runtimePrefix?: string
  routePath?: string
}

interface AppRevisionInputPort {
  key: string
  name: string
  type: "string"
  required: boolean
}

type ExecutionMode = "direct" | "deployed"
```

### Schema Types

```typescript
interface RevisionSchemaState {
  openApiSchema?: unknown
  agConfigSchema?: EntitySchema
  promptSchema?: EntitySchema
  customPropertiesSchema?: EntitySchema
  outputsSchema?: EntitySchema
  endpoints?: {
    test?: EndpointSchema
    run?: EndpointSchema
    generate?: EndpointSchema
    generateDeployed?: EndpointSchema
  }
  availableEndpoints?: string[]
  isChatVariant?: boolean
  runtimePrefix?: string
  routePath?: string
}
```

## Best Practices

### Reactive State Derivation

State should be derived reactively in atoms, not synced via React effects:

```typescript
// ❌ WRONG - React effect sync
useEffect(() => {
  const ports = extractPorts(agConfig)
  setInputPorts(ports)
}, [agConfig])

// ✅ CORRECT - Reactive atom derivation
const inputPorts = useAtomValue(appRevisionMolecule.selectors.inputPorts(revisionId))
// Automatically updates when agConfig changes
```

### Using the Controller API

Components should use the highest-level API available:

```typescript
// ❌ WRONG - Reaching into implementation details
const query = useAtomValue(appRevisionQueryAtomFamily(revisionId))
const draft = useAtomValue(appRevisionDraftAtomFamily(revisionId))
const merged = draft ?? query.data

// ✅ CORRECT - Use molecule API
const data = useAtomValue(appRevisionMolecule.atoms.data(revisionId))
```

### Schema-Driven Approach

Prefer `agConfig` over legacy `prompts` array:

```typescript
// ❌ Legacy approach
const prompts = data.prompts

// ✅ Schema-driven approach
const agConfig = data.agConfig
const schema = useAtomValue(appRevisionMolecule.atoms.agConfigSchema(revisionId))
```

## Selection Config

For entity selection UI:

```typescript
import { appRevisionSelectionConfig } from '@agenta/entities/appRevision'

// Use with selection system
initializeSelectionSystem({
  appRevision: appRevisionSelectionConfig,
})
```
