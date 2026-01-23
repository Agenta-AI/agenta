# @agenta/entity-ui

Entity-specific UI components for the Agenta platform. This package provides reusable UI components for entity operations like selection, modals, and drill-in views.

## Installation

This package is part of the Agenta monorepo and is installed automatically via pnpm workspaces.

## Exports

The package provides the following subpath exports:

```typescript
// Main export - all components
import { ... } from '@agenta/entity-ui'

// DrillIn components for hierarchical data navigation
import { MoleculeDrillInView, useDrillIn, ... } from '@agenta/entity-ui/drill-in'

// Entity modals (delete, commit, save)
import { EntityDeleteModal, useEntityDelete, ... } from '@agenta/entity-ui/modals'

// Entity selection (EntityPicker with variants)
import { EntityPicker, useEntitySelector, ... } from '@agenta/entity-ui/selection'

// Testcase-specific UI
import { TestcaseTable } from '@agenta/entity-ui/testcase'
```

## Features

### DrillIn View

Hierarchical data navigation for inspecting nested data structures:

- `MoleculeDrillInView` - Main drill-in component with molecule integration
- `MoleculeDrillInBreadcrumb` - Breadcrumb navigation
- Field renderers for different data types (text, number, boolean, JSON, messages)
- Schema controls for configuration editing

### Entity Modals

Reusable modals for entity operations:

- `EntityDeleteModal` - Delete single or multiple entities
- `EntityCommitModal` - Commit changes with message
- `EntitySaveModal` - Save/save-as/create new operations

### Entity Selection

Unified system for selecting entities through multi-level hierarchies:

- `EntityPicker` - Single component with 3 variants:
  - `cascading` - Dropdown cascade (App → Variant → Revision)
  - `breadcrumb` - Breadcrumb navigation with drill-down
  - `list-popover` - List with hover popovers (2-level)
- Pre-built adapters for common entities (appRevision, evaluatorRevision, testset)

## Architecture

This package provides entity-specific UI components that integrate with the entity state management layer:

```
@agenta/shared       ← Base utilities
       ↑
@agenta/ui           ← Presentational components
       ↑
@agenta/entities     ← Entity state management (molecules, schemas)
       ↑
@agenta/entity-ui    ← Entity-specific UI (this package)
       ↑
@agenta/playground   ← Feature-specific code
```

## Adapter Pattern

UI components use adapters to work with any entity type. Adapters are defined in this package and integrate with molecules from `@agenta/entities`:

```typescript
import { createAndRegisterEntityAdapter } from '@agenta/entity-ui'
import { myMolecule } from '@agenta/entities/myEntity'

// Create and register adapter for your entity
export const myAdapter = createAndRegisterEntityAdapter({
  type: 'myEntity',
  getDisplayName: (entity) => entity?.name ?? 'Untitled',
  getDisplayLabel: (count) => count === 1 ? 'Entity' : 'Entities',
  deleteAtom: myMolecule.reducers.delete,
  dataAtom: (id) => myMolecule.atoms.data(id),
  canDelete: () => true,
})
```

### Pre-built Adapters

This package includes adapters for testset entities:

```typescript
import { testsetModalAdapter, revisionModalAdapter } from '@agenta/entity-ui'
```

These adapters are auto-registered when imported and enable the entity modals to work with testsets and revisions.

## Quick Start

### Using Entity Selection

```typescript
import { EntityPicker, type AppRevisionSelectionResult } from '@agenta/entity-ui'

// Cascading dropdowns for compact spaces
<EntityPicker<AppRevisionSelectionResult>
  variant="cascading"
  adapter="appRevision"
  onSelect={(selection) => {
    console.log('Selected revision:', selection.id)
  }}
/>

// Breadcrumb navigation for modals
<EntityPicker<AppRevisionSelectionResult>
  variant="breadcrumb"
  adapter="appRevision"
  onSelect={handleSelect}
  showSearch
  showBreadcrumb
  rootLabel="All Apps"
/>
```

### Using Entity Modals

```typescript
import { useEntityDelete, EntityDeleteModal } from '@agenta/entity-ui'

// Hook for programmatic deletion
const { openDelete } = useEntityDelete()

const handleDelete = () => {
  openDelete([{ type: 'testset', id: testsetId }])
}

// Modal component (render once in your app)
<EntityDeleteModal />
```

### Using DrillIn View

```typescript
import { MoleculeDrillInView } from '@agenta/entity-ui'
import { traceSpanMolecule } from '@agenta/entities/trace'

<MoleculeDrillInView
  molecule={traceSpanMolecule}
  entityId={spanId}
  editable={false}
/>
```

## Dependencies

- `@agenta/shared` - Path utilities, types
- `@agenta/ui` - EnhancedModal, Editor, styling utilities
- `@agenta/entities` - Molecule types, schemas, selection configs
- `jotai` - State management (peer dependency)
- `antd` - UI components (peer dependency)

## Documentation

Each submodule has its own README with detailed documentation:

- [`src/DrillInView/README.md`](./src/DrillInView/README.md) - DrillIn components
- [`src/modals/README.md`](./src/modals/README.md) - Entity modals
- [`src/selection/README.md`](./src/selection/README.md) - Entity selection system
