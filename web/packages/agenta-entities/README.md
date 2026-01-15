# @agenta/entities

Entity state management package for the Agenta web application. Provides molecules, schemas, API functions, and UI components for managing domain entities.

## Installation

This is a workspace package. It's automatically available within the monorepo:

```typescript
import { ... } from '@agenta/entities'
import { ... } from '@agenta/entities/shared'
import { ... } from '@agenta/entities/trace'
import { ... } from '@agenta/entities/testset'
import { ... } from '@agenta/entities/testcase'
import { ... } from '@agenta/entities/ui'
```

## Package Structure

```text
src/
├── index.ts              # Main exports (shared utilities)
├── shared/               # Core molecule pattern & utilities
│   ├── molecule/         # createMolecule, extendMolecule, controllers
│   ├── utils/            # Schema, transforms, helpers
│   └── user/             # User resolution atoms
├── trace/                # Trace/span entity
│   ├── core/             # Schemas & types
│   ├── api/              # HTTP functions
│   ├── state/            # Molecule & store
│   └── utils/            # Selectors
├── testset/              # Testset/revision entity
│   ├── core/             # Schemas & types
│   ├── api/              # HTTP functions & mutations
│   └── state/            # Molecules & table state
├── testcase/             # Testcase entity
│   ├── core/             # Schemas & types
│   ├── api/              # HTTP functions
│   └── state/            # Molecule & paginated store
└── ui/                   # Entity-agnostic UI components
    ├── DrillInView/      # Hierarchical data navigation
    ├── modals/           # Delete, commit, save modals
    └── selection/        # Entity picker components
```

## Quick Start

### Using Molecules

Molecules provide a unified API for entity state management:

```typescript
import { testcaseMolecule } from '@agenta/entities/testcase'

// React hook - returns [state, dispatch]
const [state, dispatch] = testcaseMolecule.useController(id)

// Fine-grained subscriptions
const data = useAtomValue(testcaseMolecule.atoms.data(id))
const isDirty = useAtomValue(testcaseMolecule.atoms.isDirty(id))

// Imperative API (for callbacks)
const data = testcaseMolecule.get.data(id)
testcaseMolecule.set.update(id, { name: 'Updated' })
```

### Using UI Components

```typescript
import {
  EntityDeleteModal,
  EntityPicker,
  MoleculeDrillInView,
} from '@agenta/entities/ui'

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
| `@agenta/entities/shared` | Molecule factories, transforms, user atoms |
| `@agenta/entities/trace` | Trace/span molecule, schemas, API |
| `@agenta/entities/testset` | Testset/revision molecules, schemas, API |
| `@agenta/entities/testcase` | Testcase molecule, schemas, API |
| `@agenta/entities/ui` | UI components (modals, pickers, drill-in) |

## Architecture

### Molecule Pattern

Every entity follows the molecule pattern:

```typescript
molecule.atoms.*        // Atom families for reactive subscriptions
molecule.reducers.*     // Write operations
molecule.get.*          // Imperative reads
molecule.set.*          // Imperative writes
molecule.useController  // React hook combining atoms + dispatch
molecule.cleanup.*      // Memory management
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

### Adapter Pattern

UI components use adapters to work with any entity type:

```typescript
// Create adapter for your entity
const myAdapter = createEntityAdapter({
  type: 'myEntity',
  getDisplayName: (entity) => entity?.name ?? 'Untitled',
  deleteAtom: myMolecule.reducers.delete,
  dataAtom: (id) => myMolecule.atoms.data(id),
})

// Register for use in modals
registerEntityAdapter(myAdapter)
```

## Dependencies

### Peer Dependencies

- `jotai` - State management
- `jotai-tanstack-query` - Query integration
- `@tanstack/react-query` - Data fetching
- `antd` - UI components
- `zod` - Schema validation

### Workspace Dependencies

- `@agenta/shared` - Path utilities, common types
- `@agenta/ui` - Presentational components

## Documentation

Each submodule has its own README with detailed documentation:

- [`src/shared/README.md`](./src/shared/README.md) - Molecule pattern
- [`src/trace/README.md`](./src/trace/README.md) - Trace entity
- [`src/testset/README.md`](./src/testset/README.md) - Testset entity
- [`src/testcase/README.md`](./src/testcase/README.md) - Testcase entity
- [`src/ui/README.md`](./src/ui/README.md) - UI components
