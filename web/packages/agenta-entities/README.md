# @agenta/entities

Entity state management package for the Agenta web application. Provides molecules, schemas, and API functions for managing domain entities.

> **Note:** UI components (modals, pickers, drill-in views) have been moved to [`@agenta/entity-ui`](../agenta-entity-ui/README.md) for better data/UI separation.

## Installation

This is a workspace package. It's automatically available within the monorepo:

```typescript
// PREFERRED: Clean named exports from main package
import {testcase, revision, testset, appRevision, loadable, runnable} from '@agenta/entities'
import type {Testcase, Revision, Testset} from '@agenta/entities'

// Specialized utilities require subpath imports
import {testcasePaginatedStore, testcaseDataController} from '@agenta/entities/testcase'
import {latestRevisionForTestsetAtomFamily, saveTestsetAtom} from '@agenta/entities/testset'
import {loadableController} from '@agenta/entities/loadable'

// UI components are now in @agenta/entity-ui
import {EntityPicker, MoleculeDrillInView} from '@agenta/entity-ui'
```

## Package Structure

```text
src/
├── index.ts              # Main exports (shared utilities)
├── shared/               # Core molecule pattern & utilities
│   ├── molecule/         # createMolecule, extendMolecule, controllers
│   ├── relations/        # Entity parent-child relationships & registry
│   ├── utils/            # Schema, transforms, helpers
│   └── user/             # User resolution atoms
├── appRevision/          # App revision entity
│   ├── relations.ts      # App → Variant → Revision hierarchy definitions
│   └── state/            # Molecule & store
├── trace/                # Trace/span entity
│   ├── core/             # Schemas & types
│   ├── api/              # HTTP functions
│   ├── state/            # Molecule & store
│   └── utils/            # Selectors
├── testset/              # Testset/revision entity
│   ├── core/             # Schemas & types
│   ├── api/              # HTTP functions & mutations
│   ├── relations.ts      # Testset → Revision → Testcase hierarchy definitions
│   └── state/            # Molecules & table state
└── testcase/             # Testcase entity
    ├── core/             # Schemas & types
    ├── api/              # HTTP functions
    └── state/            # Molecule & paginated store

# UI components moved to @agenta/entity-ui
```

## Quick Start

### Using Entity Controllers (Clean Named Exports)

Entity controllers provide a unified API for state management. Use clean named exports from the main package:

```typescript
import {testcase, revision, appRevision} from '@agenta/entities'

// React hook - returns [state, dispatch]
const [state, dispatch] = testcase.useController(id)

// Fine-grained subscriptions
const data = useAtomValue(testcase.atoms.data(id))
const isDirty = useAtomValue(testcase.atoms.isDirty(id))

// Imperative API (for callbacks)
const data = testcase.get.data(id)
testcase.set.update(id, {name: 'Updated'})

// Capability APIs (runnable/loadable)
const inputPorts = useAtomValue(appRevision.runnable.inputPorts(id))
const rows = useAtomValue(testcase.loadable.rows(revisionId))
```

### Using UI Components

UI components have been moved to `@agenta/entity-ui` for better data/UI separation:

```typescript
import {
  EntityDeleteModal,
  EntityPicker,
  MoleculeDrillInView,
} from '@agenta/entity-ui'

// Delete modal (register adapters first)
<EntityDeleteModal />

// Entity picker with hierarchical navigation
<EntityPicker
  adapter={appRevisionAdapter}
  onSelect={(selection) => console.log(selection)}
/>

// Drill-in view for nested data
<MoleculeDrillInView
  molecule={traceSpanMolecule}
  entityId={spanId}
  editable
/>
```

## Subpath Exports

| Subpath                     | Description                                      |
| --------------------------- | ------------------------------------------------ |
| `@agenta/entities` | Core utilities (createEntityController, schema utils) |
| `@agenta/entities/shared` | Molecule factories, transforms, relations, user atoms |
| `@agenta/entities/appRevision` | App revision molecule, relations (app→variant→revision) |
| `@agenta/entities/trace` | Trace/span molecule, schemas, API |
| `@agenta/entities/testset` | Testset/revision molecules, relations, schemas, API |
| `@agenta/entities/testcase` | Testcase molecule, schemas, API |
| `@agenta/entities/loadable` | Loadable bridge (data sources) |
| `@agenta/entities/runnable` | Runnable bridge (executable entities) |

> **UI components** are now in `@agenta/entity-ui` (modals, pickers, drill-in views)

## Architecture

### Entity Controller Pattern

Every entity follows a consistent controller pattern:

```typescript
entity.atoms.*          // Atom families for reactive subscriptions
entity.actions.*        // Write atoms for use with set() in atom compositions
entity.get.*            // Imperative reads (for callbacks)
entity.set.*            // Imperative writes (for callbacks)
entity.useController    // React hook combining atoms + dispatch
entity.cleanup.*        // Memory management

// Capability namespaces (if applicable)
entity.runnable.*       // For runnable entities (appRevision, evaluator)
entity.loadable.*       // For loadable entities (testcase)
```

### Data Flow

```
Server → TanStack Query → atoms.serverData
                              ↓
                         atoms.draft (local changes)
                              ↓
                         atoms.data (merged)
                              ↓
                         useController → Component
```

### Entity Relations

Entities define parent-child relationships declaratively via `EntityRelation` objects. Relations are auto-registered when their modules are imported, enabling:

- **Selection adapter generation** - EntityPicker adapters derive from relations
- **Hierarchy discovery** - `entityRelationRegistry.getPath("app", "appRevision")` → `["app", "variant", "appRevision"]`
- **Molecule extension** - `extendWithRelations()` adds child ID/data atoms
- **Binding utilities** - Type-safe loadable ID generation/parsing

```typescript
import { entityRelationRegistry } from '@agenta/entities/shared'
import { appToVariantRelation } from '@agenta/entities/appRevision'
import { testsetToRevisionRelation } from '@agenta/entities/testset'

// Relations are auto-registered on import
const path = entityRelationRegistry.getPath("app", "appRevision")
// → ["app", "variant", "appRevision"]

const children = entityRelationRegistry.getChildren("testset")
// → ["revision"]
```

**Defined hierarchies:**

| Hierarchy | Relations Module |
|-----------|------------------|
| App → Variant → AppRevision | `@agenta/entities/appRevision` |
| Testset → Revision → Testcase | `@agenta/entities/testset` |

**Import safety:** Within each entity module, the dependency between `relations.ts`
and molecule files is one-way. `relations.ts` imports molecules (to populate `childMolecule`),
but molecules must **never** import from `relations.ts` — doing so creates a circular
ES module dependency. If a molecule needs child IDs, inline the extraction logic
(e.g., `data?.child_ids ?? []`) instead of importing the relation object.

See [`src/shared/README.md`](./src/shared/README.md#entity-relations) for the full relations API.

## Import Best Practices

### Use Static Imports for API Functions

Always use static imports for API functions and core logic. Never use inline lazy imports (`await import(...)`) in this package:

```typescript
// GOOD: Static imports
import {fetchLatestRevision} from "../api"
import {createTestset} from "../api/mutations"

export const latestRevision = {
    fetch: async (testsetId: string, projectId: string) => {
        return fetchLatestRevision({testsetId, projectId})
    },
}

// BAD: Inline lazy imports - avoid!
const {fetchLatestRevision} = await import("../api")  // Don't do this
```

### Lazy Loading for Heavy UI Components

For heavy UI dependencies (like Lexical editor), use `React.lazy` or `next/dynamic` instead of inline lazy imports:

```typescript
// GOOD: React.lazy for heavy components
import {lazy, Suspense} from "react"

const DiffView = lazy(() =>
    import("@agenta/ui/editor").then((mod) => ({default: mod.DiffView})),
)
```

See the [import-lazy rule](../../.claude/skills/agenta-package-practices/rules/import-lazy.md) for detailed guidelines.

## Dependencies

### Peer Dependencies

- `jotai` - State management
- `jotai-tanstack-query` - Query integration
- `@tanstack/react-query` - Data fetching
- `antd` - UI components
- `zod` - Schema validation

### Workspace Dependencies

- `@agenta/shared` - Path utilities, common types

## Documentation

Each submodule has its own README with detailed documentation:

- [`src/shared/README.md`](./src/shared/README.md) - Molecule pattern
- [`src/trace/README.md`](./src/trace/README.md) - Trace entity
- [`src/testset/README.md`](./src/testset/README.md) - Testset entity
- [`src/testcase/README.md`](./src/testcase/README.md) - Testcase entity
- [`docs/onboarding-reference.md`](./docs/onboarding-reference.md) - Onboarding quick reference
- [`docs/entity-implementation-analysis.md`](./docs/entity-implementation-analysis.md) - Detailed implementation analysis

For UI components documentation, see [`@agenta/entity-ui`](../agenta-entity-ui/README.md).
