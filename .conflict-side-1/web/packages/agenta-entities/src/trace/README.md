# Trace Entity

Self-contained entity module for trace and span state management in the Agenta platform.

## Overview

This module provides everything needed for trace and span entities:

- **Molecule** - Unified API for span state management with draft support
- **Schemas** - Zod schemas for validation and type safety
- **Selectors** - Pure utilities for data extraction
- **Store** - Query atoms, batch fetchers, and cache management

## Folder Structure

```
trace/
├── README.md              # This documentation
├── index.ts               # Main exports (public API)
├── core/                  # Core types and schemas (no dependencies)
│   ├── index.ts           # Re-exports core modules
│   ├── schema.ts          # Zod schemas for TraceSpan, enums, etc.
│   └── types.ts           # TypeScript interfaces for API params
├── api/                   # API layer (depends on core)
│   ├── index.ts           # Re-exports API modules
│   ├── api.ts             # HTTP API functions (fetch, delete, etc.)
│   └── helpers.ts         # Type guards, tree transformations
├── state/                 # State management (depends on core, api, utils)
│   ├── index.ts           # Re-exports state modules
│   ├── store.ts           # Query atoms, batch fetchers, cache
│   └── molecule.ts        # Unified molecule API
└── utils/                 # Pure utilities (depends on core)
    ├── index.ts           # Re-exports utility modules
    └── selectors.ts       # Data extraction utilities
```

## Quick Start

### Molecule API

```typescript
import { traceSpanMolecule } from '@agenta/entities/trace'

// React hook - returns [state, dispatch]
const [state, dispatch] = traceSpanMolecule.useController(spanId)

// Fine-grained atom subscriptions
const data = useAtomValue(traceSpanMolecule.atoms.data(spanId))
const isDirty = useAtomValue(traceSpanMolecule.atoms.isDirty(spanId))
const inputs = useAtomValue(traceSpanMolecule.atoms.inputs(spanId))
const outputs = useAtomValue(traceSpanMolecule.atoms.outputs(spanId))

// Imperative API (for callbacks, effects)
const spanData = traceSpanMolecule.get.data(spanId)
traceSpanMolecule.set.update(spanId, { 'ag.data.inputs': newInputs })
traceSpanMolecule.set.discard(spanId)

// Cleanup (call when entity no longer needed)
traceSpanMolecule.cleanup.entity(spanId)
```

## Molecule Atoms

| Atom                | Type                       | Description                      |
|---------------------|----------------------------|----------------------------------|
| `atoms.data(id)`    | `TraceSpan \| null`        | Merged entity (server + draft)   |
| `atoms.serverData(id)` | `TraceSpan \| null`     | Server data only                 |
| `atoms.draft(id)`   | `SpanAttributes \| null`   | Local draft changes              |
| `atoms.isDirty(id)` | `boolean`                  | Has unsaved changes              |
| `atoms.inputs(id)`  | `Record<string, unknown>`  | Extracted inputs                 |
| `atoms.outputs(id)` | `Record<string, unknown>`  | Extracted outputs                |
| `atoms.agData(id)`  | `Record<string, unknown>`  | All ag.data.* fields             |

## Molecule Reducers

| Reducer             | Signature         | Description              |
|---------------------|-------------------|--------------------------|
| `reducers.update`   | `(id, changes)`   | Update draft attributes  |
| `reducers.discard`  | `(id)`            | Discard draft changes    |

## Lifecycle API

The molecule includes lifecycle tracking for entity mount/unmount events:

```typescript
// Subscribe to mount events (when entity is first accessed)
const unsubMount = traceSpanMolecule.lifecycle.onMount((id) => {
  console.log(`Span ${id} mounted`)
})

// Subscribe to unmount events (when entity is removed from cache)
const unsubUnmount = traceSpanMolecule.lifecycle.onUnmount((id) => {
  console.log(`Span ${id} unmounted`)
})

// Check if an entity is currently active in cache
const isActive = traceSpanMolecule.lifecycle.isActive(spanId)

// Get count of active entities
const activeCount = traceSpanMolecule.lifecycle.getActiveCount()
```

## Imperative API

For use outside React components:

```typescript
// Read state (snapshot - not reactive)
const spanData = traceSpanMolecule.get.data(spanId)
const serverData = traceSpanMolecule.get.serverData(spanId)
const draft = traceSpanMolecule.get.draft(spanId)
const isDirty = traceSpanMolecule.get.isDirty(spanId)
const query = traceSpanMolecule.get.query(spanId)

// Mutate state
traceSpanMolecule.set.update(spanId, { 'ag.data.inputs': newInputs })
traceSpanMolecule.set.discard(spanId)

// With custom store (for testing)
import { createStore } from 'jotai'
const myStore = createStore()
traceSpanMolecule.get.data(spanId, { store: myStore })
```

## Trace-Level Utilities

For fetching entire traces (read-only):

```typescript
import { traceEntityAtomFamily, invalidateTraceEntityCache } from '@agenta/entities/trace'

// Fetch entire trace tree for display
const traceQuery = useAtomValue(traceEntityAtomFamily(traceId))
const { data: traceData, isPending, isError } = traceQuery

// Invalidate cache after mutations
invalidateTraceEntityCache(traceId)
```

## Selectors (Pure Utilities)

```typescript
import {
  extractInputs,
  extractOutputs,
  extractAgData,
  collectKeyPaths,
  getValueAtPath,
  matchColumnsWithSuggestions,
} from '@agenta/entities/trace'

// Extract data from span
const inputs = extractInputs(span)
const outputs = extractOutputs(span)
const agData = extractAgData(span)

// Path utilities
const paths = collectKeyPaths(span.attributes)
const value = getValueAtPath(span.attributes, 'ag.data.inputs.messages')

// Auto-mapping for testset creation
const mappings = matchColumnsWithSuggestions(spanPaths, testsetColumns)
```

## Data Flow

### Span-Level Operations (Molecule)

```
Component renders
       │
       ▼
traceSpanMolecule.atoms.data(spanId)
       │
       ├── Server Data (from query)
       │         +
       └── Draft Data (local changes)
                 │
                 ▼
           Merged Entity → UI renders

User edits → dispatch({ type: 'update', changes: {...} })
                 │
                 ▼
Draft state updated → isDirty becomes true → UI shows indicator

User saves → commit draft to server → discard draft
User cancels → dispatch({ type: 'discard' }) → draft cleared
```

### Trace-Level Operations (Read-Only)

```
traceEntityAtomFamily(traceId) → Fetches entire trace
       │
       ▼
Batch Fetcher (combines concurrent requests)
       │
       ▼
Response: { traces: { [traceId]: { spans: {...} } } }
       │
       ▼
Cache Population → Extracts all spans → Populates spanQueryAtomFamily
```

## Cache Strategy

### Cache Redirect

Spans are often loaded as part of traces. The cache redirect finds spans in:

- `traces-list` query cache
- `trace-drawer` query cache
- `trace-entity` query cache

This prevents duplicate API calls when navigating from trace view to span details.

### Batch Fetching

Both spans and traces use batch fetchers to combine concurrent requests:

```typescript
// 10 concurrent span requests → 1 API call
spanBatchFetcher({ projectId, spanId })

// 5 concurrent trace requests → 1 API call
traceBatchFetcher({ projectId, traceId })
```

### Retry for Not-Yet-Ingested Data

Spans/traces may not be immediately available after creation:

```typescript
// Span: 3 retries with exponential backoff (1s, 2s, 4s)
if (error instanceof SpanNotFoundError && failureCount < 3) retry

// Trace: 5 retries with exponential backoff (1s, 2s, 4s, 8s, 10s)
if (error instanceof TraceNotFoundError && failureCount < 5) retry
```

## Schemas & Types

```typescript
import {
  // Enums
  TraceTypeEnum,
  SpanCategoryEnum,
  SpanKindEnum,
  StatusCodeEnum,
  // Schemas
  traceSpanSchema,
  spanAttributesSchema,
  // Types
  type TraceSpan,
  type SpanAttributes,
  type TraceListParams,
} from '@agenta/entities/trace'
```

## API Functions

```typescript
import {
  fetchAllPreviewTraces,
  fetchPreviewTrace,
  deletePreviewTrace,
  fetchSessions,
} from '@agenta/entities/trace'
```

## Architecture: Trace vs Span Level

This entity has **two levels of abstraction**:

1. **Span Level** (molecule) - For editing individual spans
   - Has draft state support
   - Supports dirty tracking
   - Used by drill-in editor, trace details panel

2. **Trace Level** (traceEntityAtomFamily) - For fetching entire traces
   - Read-only (no draft state)
   - Populates span cache automatically
   - Used by trace tree visualization
