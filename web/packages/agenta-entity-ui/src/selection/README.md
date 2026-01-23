# Entity Selection System

A unified, adapter-based system for hierarchical entity selection across the Agenta application.

## Overview

The Entity Selection System provides a **single `EntityPicker` component** with multiple display variants for navigating and selecting entities through multi-level hierarchies (e.g., App → Variant → Revision). It eliminates code duplication by providing:

- **Adapters**: Entity-specific configurations that define hierarchies
- **Unified Hooks**: Mode-specific hooks (`useCascadingMode`, `useBreadcrumbMode`, `useListPopoverMode`)
- **Single Component**: `EntityPicker` with `variant` prop for different UIs
- **State Management**: Jotai-based navigation and selection state

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Entity Selection Architecture                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  DATA LAYER (Existing Molecules - Source of Truth)                       │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │ appRevision.selectors.apps / variantsByApp(id) / revisions(id)      ││
│  │ evaluatorRevision.selectors.evaluators / variantsByEvaluator / ...  ││
│  │ testsetMolecule / revisionMolecule (from @agenta/entities/testset)  ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                    │                                     │
│                                    ▼                                     │
│  ADAPTER LAYER (Entity-Specific Configuration)                          │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │ EntitySelectionAdapter<TEntity>                                      ││
│  │ - levels: HierarchyLevel[] (parent → child navigation)              ││
│  │ - listAtom / listAtomFamily: Data source atoms                      ││
│  │ - getLabel/getId: Display functions                                 ││
│  │ - toSelection: Transform to selection result                        ││
│  └─────────────────────────────────────────────────────────────────────┘│
│  Pre-built: testsetAdapter, appRevisionAdapter, evaluatorRevisionAdapter│
│                                    │                                     │
│                                    ▼                                     │
│  UNIFIED HOOKS (Mode-Specific)                                          │
│  ┌────────────────┐ ┌────────────────────┐ ┌─────────────────────────┐  │
│  │useCascadingMode│ │useBreadcrumbMode   │ │useListPopoverMode       │  │
│  │- levels[]      │ │- breadcrumb        │ │- parents                │  │
│  │- autoSelect    │ │- items             │ │- children               │  │
│  │- onSelect      │ │- navigateDown/Up   │ │- popoverState           │  │
│  └────────────────┘ └────────────────────┘ └─────────────────────────┘  │
│                                    │                                     │
│                                    ▼                                     │
│  UI COMPONENT (Single Component, Multiple Variants)                     │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │ EntityPicker<TSelection>                                            ││
│  │ - variant="cascading"    → Cascading dropdowns                      ││
│  │ - variant="breadcrumb"   → Breadcrumb navigation + list             ││
│  │ - variant="list-popover" → List with hover popovers                 ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Using EntityPicker (Unified Component)

```tsx
import { EntityPicker, type AppRevisionSelectionResult } from '@agenta/entity-ui'

// Cascading dropdowns (App → Variant → Revision)
<EntityPicker<AppRevisionSelectionResult>
  variant="cascading"
  adapter="appRevision"
  onSelect={handleSelect}
/>

// Breadcrumb navigation with drill-down list
<EntityPicker<AppRevisionSelectionResult>
  variant="breadcrumb"
  adapter="appRevision"
  onSelect={handleSelect}
  showSearch
  showBreadcrumb
  rootLabel="All Apps"
/>

// List with hover popovers (for 2-level hierarchies)
<EntityPicker<TestsetSelectionResult>
  variant="list-popover"
  adapter="testset"
  onSelect={handleSelect}
  autoSelectLatest
  selectLatestOnParentClick
/>
```

### Variant Selection Guide

| Variant | Use Case | Hierarchy Depth |
|---------|----------|-----------------|
| `cascading` | Inline dropdowns, compact space | Any (typically 2-3) |
| `breadcrumb` | Modal/drawer, full-page selection | Any (typically 3+) |
| `list-popover` | Sidebar lists with hover details | Exactly 2 levels |

### Using Unified Hooks

For custom UIs, use the mode-specific hooks directly:

```tsx
import { useCascadingMode, useBreadcrumbMode, useListPopoverMode } from '@agenta/entity-ui'

// Cascading mode
const { levels, isComplete } = useCascadingMode({
  adapter: 'appRevision',
  instanceId: 'my-cascading',
  onSelect: handleSelect,
})

// Breadcrumb mode
const { breadcrumb, items, navigateDown, navigateUp, select } = useBreadcrumbMode({
  adapter: 'appRevision',
  instanceId: 'my-breadcrumb',
  onSelect: handleSelect,
})

// List-popover mode
const { parents, handleParentHover, handleChildSelect } = useListPopoverMode({
  adapter: 'testset',
  instanceId: 'my-list',
  onSelect: handleSelect,
})
```

## Initialization

Before using the selection components, adapters must be initialized with actual atoms from the application. This is done in `Providers.tsx`:

```typescript
import { initializeSelectionSystem } from '@agenta/entity-ui'

// Called once during app initialization
initializeSelectionSystem({
  appRevision: {
    appsAtom: appRevisionMolecule.selectors.apps,
    variantsByAppFamily: (appId) => appRevisionMolecule.selectors.variantsByApp(appId),
    revisionsByVariantFamily: (variantId) => appRevisionMolecule.selectors.revisions(variantId),
  },
  evaluatorRevision: {
    evaluatorsAtom: evaluatorRevisionMolecule.selectors.evaluators,
    variantsAtomFamily: (evaluatorId) => evaluatorRevisionMolecule.selectors.variantsByEvaluator(evaluatorId),
    revisionsAtomFamily: (variantId) => evaluatorRevisionMolecule.selectors.revisions(variantId),
  },
  testset: {
    testsetsListAtom: testsetMolecule.atoms.list(null),
    revisionsListFamily: (testsetId) => revisionMolecule.atoms.list(testsetId),
  },
})
```

## Directory Structure

```
selection/
├── index.ts                  # Public exports
├── types.ts                  # Core TypeScript types
├── README.md                 # This file
├── initializeSelection.ts    # Initialization function
│
├── adapters/                 # Entity adapters
│   ├── README.md
│   ├── index.ts
│   ├── createAdapter.ts      # Factory function & registry
│   ├── appRevisionAdapter.ts # App → Variant → Revision
│   ├── evaluatorRevisionAdapter.ts
│   └── testsetAdapter.ts     # Testset → Revision
│
├── state/                    # Jotai state atoms
│   ├── README.md
│   ├── index.ts
│   ├── selectionState.ts     # Navigation state (molecule pattern)
│   └── modalState.ts         # Modal controller state
│
├── hooks/                    # Unified hooks
│   ├── README.md
│   ├── index.ts
│   ├── useEntitySelection.ts # Unified hook entry point
│   ├── useEntitySelectionCore.ts # Core hook logic
│   ├── modes/                # Mode-specific hooks
│   │   ├── useCascadingMode.ts
│   │   ├── useBreadcrumbMode.ts
│   │   └── useListPopoverMode.ts
│   └── utilities/            # Helper hooks
│       ├── useChildrenData.ts
│       └── useAutoSelectLatestChild.ts
│
└── components/               # UI components
    ├── README.md
    ├── index.ts
    ├── UnifiedEntityPicker/  # Main component with variants
    │   ├── index.ts
    │   ├── UnifiedEntityPicker.tsx
    │   ├── types.ts
    │   ├── variants/
    │   │   ├── CascadingVariant.tsx
    │   │   ├── BreadcrumbVariant.tsx
    │   │   └── ListPopoverVariant.tsx
    │   └── shared/
    │       ├── LevelSelect.tsx
    │       ├── ChildPopoverContent.tsx
    │       └── AutoSelectHandler.tsx
    ├── EntitySelectorModal.tsx
    └── hooks/
        └── useEntitySelector.ts
```

## Pre-built Adapters

| Adapter | Hierarchy | Selection Result |
|---------|-----------|------------------|
| `appRevisionAdapter` | App → Variant → Revision | `AppRevisionSelectionResult` |
| `evaluatorRevisionAdapter` | Evaluator → Variant → Revision | `EvaluatorRevisionSelectionResult` |
| `testsetAdapter` | Testset → Revision | `TestsetSelectionResult` |

## Key Concepts

### Adapter

An adapter defines how to navigate and select entities within a specific hierarchy. It provides:
- `levels`: Array of `HierarchyLevel` configurations
- `toSelection`: Function to transform path + entity into selection result
- `emptyMessage` / `loadingMessage`: UI strings

### HierarchyLevel

Defines a single level in the hierarchy:
- `type`: Entity type (e.g., "app", "variant", "revision")
- `listAtom` or `listAtomFamily`: Data source
- `getId` / `getLabel`: Entity display functions
- `hasChildren` / `isSelectable`: Navigation control

### Selection Result

The result returned when a user makes a selection:
```typescript
interface EntitySelectionResult<TMeta> {
  type: SelectableEntityType
  id: string
  label: string
  path: SelectionPathItem[]
  metadata: TMeta
}
```

## Usage in the Codebase

The system is used in:
- **TestsetSelectionModal**: `EntityPicker variant="list-popover"` for testset/revision selection
- **EntitySelectorModal**: `EntityPicker variant="breadcrumb"` for modal-based selection
- **Playground EntitySelector**: `EntityPicker variant="cascading"` for app revision selection

## Variant Details

### Cascading Variant

Renders cascading `Select` dropdowns for each hierarchy level:

```tsx
<EntityPicker<AppRevisionSelectionResult>
  variant="cascading"
  adapter="appRevision"
  onSelect={handleSelect}
  showLabels            // Show label above each select
  layout="horizontal"   // or "vertical"
  gap={12}              // Gap between selects
  size="middle"         // Ant Design size
/>
```

### Breadcrumb Variant

Shows one level at a time with breadcrumb navigation:

```tsx
<EntityPicker<AppRevisionSelectionResult>
  variant="breadcrumb"
  adapter="appRevision"
  onSelect={handleSelect}
  showSearch            // Search input
  showBreadcrumb        // Breadcrumb trail
  showBackButton        // Back arrow button
  rootLabel="All Apps"  // Root breadcrumb label
  maxHeight={400}       // List max height
  autoSelectSingle      // Auto-select when only 1 option
  infiniteScroll        // Enable virtual scrolling
  pageSize={50}         // Page size for pagination
/>
```

### List-Popover Variant

Displays parent list with hover popovers for children (2-level hierarchies only):

```tsx
<EntityPicker<TestsetSelectionResult>
  variant="list-popover"
  adapter="testset"
  onSelect={handleSelect}
  selectedParentId={currentTestsetId}
  selectedChildId={currentRevisionId}
  autoSelectLatest      // Auto-select latest child on mount
  selectLatestOnParentClick // Select latest when clicking parent
  popoverPlacement="rightTop"
  popoverTrigger="hover"
  disabledParentIds={disabledSet}
  disabledChildIds={disabledChildSet}
/>
```

## EntitySelectorModal

A modal for entity selection with tab support for multiple entity types:

```tsx
import { useEntitySelector } from '@agenta/entity-ui'

function MyComponent() {
  const { open } = useEntitySelector()

  const handleAdd = async () => {
    const selection = await open({
      title: 'Select Entity',
      allowedTypes: ['appRevision', 'evaluatorRevision'],
    })

    if (selection) {
      console.log('Selected:', selection.type, selection.id)
    }
  }

  return <button onClick={handleAdd}>Add Entity</button>
}
```

## State Isolation

Components support `instanceId` for state isolation:

```tsx
// Two pickers with independent state
<EntityPicker adapter="appRevision" instanceId="picker-1" variant="cascading" />
<EntityPicker adapter="appRevision" instanceId="picker-2" variant="cascading" />
```
