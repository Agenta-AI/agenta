# Evaluator Entity Module

Entity state management for **SimpleEvaluator** entities — the new workflow-based evaluator configuration model.

## Overview

This module replaces the legacy `EvaluatorConfig` model with the new `SimpleEvaluator` model that treats evaluators as workflows with git-like versioning (Artifact → Variant → Revision).

The `SimpleEvaluator` API abstracts the underlying workflow structure into a flat entity with embedded revision data, making it simpler for frontend consumption.

### Key Mapping (Legacy → New)

| Legacy | New |
|--------|-----|
| `EvaluatorConfig` | `SimpleEvaluator` (this module's `Evaluator` type) |
| `evaluator_key` | Derived from `data.uri` via `parseEvaluatorKeyFromUri()` |
| `settings_values` | `data.parameters` |
| `GET /evaluators/configs/` | `POST /preview/simple/evaluators/query` |
| `POST /evaluators/configs/` | `POST /preview/simple/evaluators/` |
| `PUT /evaluators/configs/{id}/` | `PUT /preview/simple/evaluators/{id}` |
| `DELETE /evaluators/configs/{id}/` | `POST /preview/simple/evaluators/{id}/archive` |

## Module Structure

```
evaluator/
├── README.md              # This file
├── index.ts               # Module entry point (all exports)
├── core/
│   ├── index.ts           # Core exports
│   ├── schema.ts          # Zod schemas matching backend API shapes
│   └── types.ts           # TypeScript interfaces for API params
├── api/
│   ├── index.ts           # API exports
│   └── api.ts             # HTTP functions (CRUD + query)
└── state/
    ├── index.ts           # State exports
    ├── store.ts           # Jotai atoms (query, draft, entity)
    ├── molecule.ts        # Unified molecule API
    └── runnableSetup.ts   # Runnable extension for playground
```

## Quick Start

### Import

```typescript
// Subpath import (recommended for tree-shaking)
import { evaluatorMolecule } from '@agenta/entities/evaluator'

// Or from main package
import { evaluator } from '@agenta/entities'
```

### Reading Data (Reactive)

```typescript
import { useAtomValue } from 'jotai'
import { evaluatorMolecule } from '@agenta/entities/evaluator'

function MyComponent({ evaluatorId }: { evaluatorId: string }) {
  // Entity data (server + local draft merged)
  const data = useAtomValue(evaluatorMolecule.selectors.data(evaluatorId))

  // Derived selectors
  const uri = useAtomValue(evaluatorMolecule.selectors.uri(evaluatorId))
  const key = useAtomValue(evaluatorMolecule.selectors.evaluatorKey(evaluatorId))
  const params = useAtomValue(evaluatorMolecule.selectors.parameters(evaluatorId))
  const isDirty = useAtomValue(evaluatorMolecule.selectors.isDirty(evaluatorId))
  const isCustom = useAtomValue(evaluatorMolecule.selectors.isCustom(evaluatorId))

  // Query state (loading, error)
  const query = useAtomValue(evaluatorMolecule.selectors.query(evaluatorId))
  if (query.isPending) return <Spinner />
  if (query.isError) return <Error error={query.error} />
}
```

### Writing Data (Draft State)

```typescript
import { useSetAtom } from 'jotai'
import { evaluatorMolecule } from '@agenta/entities/evaluator'

function EditEvaluator({ evaluatorId }: { evaluatorId: string }) {
  const update = useSetAtom(evaluatorMolecule.actions.update)
  const discard = useSetAtom(evaluatorMolecule.actions.discard)

  // Update parameters (local draft)
  const handleParamChange = (key: string, value: unknown) => {
    update(evaluatorId, {
      data: { parameters: { [key]: value } },
    })
  }

  // Discard local changes
  const handleReset = () => discard(evaluatorId)
}
```

### Imperative API (Outside React)

```typescript
import { evaluatorMolecule } from '@agenta/entities/evaluator'

// Read
const data = evaluatorMolecule.get.data(evaluatorId)
const uri = evaluatorMolecule.get.uri(evaluatorId)

// Write
evaluatorMolecule.set.update(evaluatorId, { data: { parameters: newParams } })
evaluatorMolecule.set.discard(evaluatorId)

// Set project context
evaluatorMolecule.set.projectId(projectId)
```

### List Query

```typescript
import { useAtomValue } from 'jotai'
import { evaluatorMolecule } from '@agenta/entities/evaluator'

function EvaluatorsList() {
  // Set project ID first (required for queries)
  evaluatorMolecule.set.projectId(projectId)

  // Read list data
  const evaluators = useAtomValue(evaluatorMolecule.atoms.nonArchived)
  const listQuery = useAtomValue(evaluatorMolecule.atoms.listQuery)
}
```

### CRUD Operations

```typescript
import {
  createEvaluator,
  updateEvaluator,
  archiveEvaluator,
  buildEvaluatorUri,
  generateSlug,
} from '@agenta/entities/evaluator'

// Create
const evaluator = await createEvaluator(projectId, {
  slug: generateSlug('My Exact Match'),
  name: 'My Exact Match',
  flags: { is_evaluator: true },
  data: {
    uri: buildEvaluatorUri('auto_exact_match'),
    parameters: { case_sensitive: true },
    schemas: {
      outputs: {
        type: 'object',
        properties: {
          score: { type: 'number' },
          success: { type: 'boolean' },
        },
      },
    },
  },
})

// Update
const updated = await updateEvaluator(projectId, {
  id: evaluator.id,
  data: { parameters: { case_sensitive: false } },
})

// Archive (soft delete)
await archiveEvaluator(projectId, evaluator.id)
```

## Data Model

### Evaluator (SimpleEvaluator)

```typescript
interface Evaluator {
  // Identifier
  id: string
  slug?: string

  // Header
  name?: string
  description?: string

  // Lifecycle
  created_at?: string
  updated_at?: string
  deleted_at?: string
  created_by_id?: string
  updated_by_id?: string
  deleted_by_id?: string

  // Flags
  flags?: {
    is_custom: boolean    // User-defined evaluator
    is_evaluator: boolean // Always true
    is_human: boolean     // Human evaluation
    is_chat: boolean      // Chat-based evaluation
  }

  // Metadata
  tags?: string[]
  meta?: Record<string, unknown>

  // Revision data (flattened from latest revision)
  data?: EvaluatorData

  // Internal IDs
  variant_id?: string
  revision_id?: string
}
```

### EvaluatorData (SimpleEvaluatorData)

```typescript
interface EvaluatorData {
  // Service Interface
  version?: string   // e.g., "2025.07.14"
  uri?: string       // e.g., "agenta:builtin:auto_exact_match:v0"
  url?: string       // Webhook URL
  headers?: Record<string, unknown>
  schemas?: {
    parameters?: Record<string, unknown>  // JSON Schema for config params
    inputs?: Record<string, unknown>      // JSON Schema for inputs
    outputs?: Record<string, unknown>     // JSON Schema for outputs
  }

  // Configuration
  script?: Record<string, unknown>     // Custom code evaluator
  parameters?: Record<string, unknown> // Settings values (config)

  // Legacy (backward compat)
  service?: Record<string, unknown>
  configuration?: Record<string, unknown>
}
```

## URI System

Evaluators are identified by URIs in the format `provider:kind:key:version`.

```typescript
import { parseEvaluatorKeyFromUri, buildEvaluatorUri } from '@agenta/entities/evaluator'

// Parse key from URI
parseEvaluatorKeyFromUri('agenta:builtin:auto_exact_match:v0')
// → 'auto_exact_match'

// Build URI from key
buildEvaluatorUri('auto_exact_match')
// → 'agenta:builtin:auto_exact_match:v0'

// Custom evaluator URI
buildEvaluatorUri('my_eval', 'user', 'custom', 'latest')
// → 'user:custom:my_eval:latest'
```

## Runnable Interface

The evaluator entity satisfies the runnable interface for playground integration:

```typescript
import { evaluatorRunnableExtension } from '@agenta/entities/evaluator'

// Atoms available for playground bridge
evaluatorRunnableExtension.atoms.executionMode(id)   // Always "completion"
evaluatorRunnableExtension.atoms.invocationUrl(id)    // Webhook URL or null
evaluatorRunnableExtension.atoms.inputSchema(id)      // From data.schemas.inputs
evaluatorRunnableExtension.atoms.outputSchema(id)     // From data.schemas.outputs
evaluatorRunnableExtension.atoms.configuration(id)    // From data.parameters
evaluatorRunnableExtension.atoms.uri(id)              // For native workflow invoke
```

## Backend API Reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/preview/simple/evaluators/query` | POST | Query evaluators with filters |
| `/preview/simple/evaluators/` | POST | Create new evaluator |
| `/preview/simple/evaluators/{id}` | GET | Fetch evaluator by ID |
| `/preview/simple/evaluators/{id}` | PUT | Update evaluator |
| `/preview/simple/evaluators/{id}/archive` | POST | Archive (soft delete) |
| `/preview/simple/evaluators/{id}/unarchive` | POST | Restore archived |

## Related

- **Design doc**: `docs/design/migrate-evaluator-playground/` (PR #3572)
- **Backend PR**: #3527 (Migrate evaluators to workflow model)
- **Existing stub**: `@agenta/entities/evaluatorRevision` (replaced by this module)
- **Runnable bridge**: `@agenta/entities/runnable` (integrates evaluator as runnable)
