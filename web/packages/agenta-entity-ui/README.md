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

### Entity Table

Generic table component for displaying entity lists with selection, grouping, and pagination:

- `EntityTable` - Generic component backed by `EntityDataController` from `@agenta/entities/shared`
- `TestcaseTable` - Testcase-specific thin wrapper over `EntityTable`
- Uses `buildEntityColumns` from `@agenta/ui` for column construction
- Built-in selection management with external/internal control modes

```typescript
import { EntityTable } from '@agenta/entity-ui'
import { testcaseDataController, type TestcaseDataConfig } from '@agenta/entities/testcase'

// Generic usage with any data controller
<EntityTable
  controller={testcaseDataController}
  config={config}
  getRowData={(record) => record as Record<string, unknown>}
  selectable
  grouping
/>

// Or use the testcase-specific wrapper
import { TestcaseTable } from '@agenta/entity-ui'

<TestcaseTable
  config={{ scopeId: 'my-table', revisionId: 'rev-123' }}
  selectable
  onSelectionChange={(ids) => console.log('Selected:', ids)}
/>
```

## Architecture

This package provides entity-specific UI components that integrate with the entity state management layer:

```
@agenta/shared       ← Base utilities
       ↑
@agenta/ui           ← Presentational components
       ↑
@agenta/entities     ← Entity state management (controllers, schemas)
       ↑
@agenta/entity-ui    ← Entity-specific UI (this package)
       ↑
@agenta/playground   ← Feature-specific code
```

## Adapter Pattern

UI components use adapters to work with any entity type.

### Modal Adapters

For entity action modals (delete, save, commit):

```typescript
import { createAndRegisterEntityAdapter } from '@agenta/entity-ui'
import { testset } from '@agenta/entities'

export const testsetAdapter = createAndRegisterEntityAdapter({
  type: 'testset',
  getDisplayName: (entity) => entity?.name ?? 'Untitled',
  getDisplayLabel: (count) => count === 1 ? 'Testset' : 'Testsets',
  deleteAtom: testset.actions.delete,
  dataAtom: (id) => testset.atoms.data(id),
  canDelete: () => true,
})
```

### Selection Adapters (Relation-Based)

For hierarchical entity selection (EntityPicker), adapters are derived from `EntityRelation` definitions. The testset and appRevision adapters are pre-built and auto-configured from `@agenta/entities` - no runtime configuration required:

```typescript
// Pre-built adapters (auto-configured from entity relations)
import { testsetAdapter, appRevisionAdapter } from '@agenta/entity-ui'

// These are registered during initializeSelectionSystem()
```

To create custom selection adapters, use the relation-based factories:

```typescript
import { createAdapterFromRelations, createTwoLevelAdapter } from '@agenta/entity-ui'

// Simple 2-level hierarchy (testset -> revision)
export const testsetAdapter = createTwoLevelAdapter({
  name: 'testset',
  parentType: 'testset',
  parentListAtom: testsetsListAtom,
  childType: 'revision',
  childRelationKey: 'testset->revision',
  selectionType: 'revision',
})

// Complex 3-level hierarchy with overrides (app -> variant -> revision)
export const appRevisionAdapter = createAdapterFromRelations({
  name: 'appRevision',
  rootLevel: {
    type: 'app',
    label: 'Application',
    listAtom: appsListAtom,
  },
  childLevels: [
    {
      type: 'variant',
      relationKey: 'app->variant',
      overrides: { autoSelectSingle: true },
    },
    {
      type: 'appRevision',
      relationKey: 'variant->appRevision',
      overrides: { autoSelectSingle: true },
    },
  ],
  selectionType: 'appRevision',
  extractMetadata: (path, leaf) => ({
    appId: path[0]?.id,
    appName: path[0]?.label,
    variantId: path[1]?.id,
    variantName: path[1]?.label,
    revision: (leaf as any).revision ?? 0,
  }),
})
```

The factories reduce adapter code from ~200+ lines to ~20 lines by:

1. Deriving level config from `EntityRelation` definitions
2. Using `relation.selection` for UI configuration
3. Providing default accessors for common entity field patterns

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
// Use clean named exports from main package
import { traceSpan } from '@agenta/entities'

<MoleculeDrillInView
  molecule={traceSpan}
  entityId={spanId}
  editable={false}
/>
```

## Import Best Practices

### Lazy Loading Modals

The `EntityModalsProvider` uses `React.lazy` to code-split entity modals (commit, delete, save). This reduces the initial bundle size since modals are only loaded when needed:

```typescript
// Inside EntityModalsProvider - modals are lazy loaded
const EntityCommitModal = lazy(() =>
    import("./commit").then((mod) => ({default: mod.EntityCommitModal})),
)
```

When creating new heavy components or modals, follow the same pattern:

```typescript
// GOOD: React.lazy for modals and heavy components
import {lazy, Suspense} from "react"

const HeavyModal = lazy(() => import("./HeavyModal"))

function MyProvider({children}) {
    return (
        <>
            {children}
            <Suspense fallback={null}>
                <HeavyModal />
            </Suspense>
        </>
    )
}
```

See the [import-lazy rule](../../.claude/skills/agenta-package-practices/rules/import-lazy.md) for detailed guidelines.

## Dependencies

- `@agenta/shared` - Path utilities, types
- `@agenta/ui` - EnhancedModal, Editor, styling utilities
- `@agenta/entities` - Entity controllers, schemas, selection configs
- `jotai` - State management (peer dependency)
- `antd` - UI components (peer dependency)

## Documentation

Each submodule has its own README with detailed documentation:

- [`src/DrillInView/README.md`](./src/DrillInView/README.md) - DrillIn components
- [`src/modals/README.md`](./src/modals/README.md) - Entity modals
- [`src/selection/README.md`](./src/selection/README.md) - Entity selection system
