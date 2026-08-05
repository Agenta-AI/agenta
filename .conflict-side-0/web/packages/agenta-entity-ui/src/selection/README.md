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
│  DATA LAYER (Entity Controllers - Source of Truth)                       │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │ appRevision.selectors.apps / variantsByApp(id) / revisions(id)      ││
│  │ evaluatorRevision.selectors.evaluators / variantsByEvaluator / ...  ││
│  │ testset / revision (from @agenta/entities)                          ││
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

Before using the selection components, adapters must be initialized. This is done in `Providers.tsx`.

### Recommended Setup

The testset and appRevision adapters are **auto-configured** from `EntityRelation` definitions in `@agenta/entities`. They no longer require runtime configuration. Only the evaluator adapter still needs runtime config:

```typescript
import { initializeSelectionSystem } from '@agenta/entity-ui'

// Testset and appRevision adapters are auto-configured from entity relations.
// Only evaluator needs runtime config (no evaluator relations defined yet).
initializeSelectionSystem({
  user: {
    membersAtom: workspaceMembersAtom,
    currentUserAtom: userAtom,
  },
  evaluatorRevision: {
    evaluatorsAtom: evaluatorRevision.selectors.evaluators,
    variantsByEvaluatorFamily: evaluatorRevision.selectors.variantsByEvaluator,
    revisionsByVariantFamily: evaluatorRevision.selectors.revisions,
  },
})
```

> **Migration Note:** The old `testset` and `appRevision` config keys are no longer needed. The adapters use atoms and relations defined directly in `@agenta/entities/testset` and `@agenta/entities/appRevision`.

## Directory Structure

```
selection/
├── index.ts                  # Public exports
├── types.ts                  # Core TypeScript types
├── README.md                 # This file
├── initializeSelection.ts    # Initialization function
│
├── adapters/                 # Entity adapters
│   ├── index.ts
│   ├── createAdapter.ts              # Base factory & registry
│   ├── createAdapterFromRelations.ts # Relation-based factory (preferred)
│   ├── createLevelFromRelation.ts    # Level config from EntityRelation
│   ├── revisionLevelFactory.ts       # Git-based revision levels
│   ├── appRevisionRelationAdapter.ts # App → Variant → Revision (relation-based)
│   ├── testsetRelationAdapter.ts     # Testset → Revision (relation-based)
│   └── evaluatorRevisionAdapter.ts   # Evaluator → Variant → Revision (legacy)
│
├── state/                    # Jotai state atoms
│   ├── README.md
│   ├── index.ts
│   ├── selectionState.ts     # Navigation state (controller pattern)
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

| Adapter | Hierarchy | Selection Result | Source |
|---------|-----------|------------------|--------|
| `appRevisionAdapter` | App → Variant → Revision | `AppRevisionSelectionResult` | Relation-based |
| `testsetAdapter` | Testset → Revision | `TestsetSelectionResult` | Relation-based |
| `evaluatorRevisionAdapter` | Evaluator → Variant → Revision | `EvaluatorRevisionSelectionResult` | Legacy (runtime config) |

The `appRevisionAdapter` and `testsetAdapter` are built using relation-based factories (`createThreeLevelAdapter` / `createTwoLevelAdapter`). They derive their hierarchy configuration from `EntityRelation` definitions in `@agenta/entities`, eliminating ~200 lines of boilerplate per adapter.

### Creating Custom Adapters (Relation-Based)

For new entities with defined relations, use the factory functions:

```typescript
import { createTwoLevelAdapter, createThreeLevelAdapter } from '@agenta/entity-ui'

// 2-level: Parent → Child
export const myAdapter = createTwoLevelAdapter({
  name: 'myEntity',
  parentType: 'parent',
  parentListAtom: parentListAtom,
  childType: 'child',
  childRelation: parentToChildRelation, // EntityRelation from @agenta/entities
  selectionType: 'child',
  toSelection: (path, leaf) => ({ ... }),
})

// 3-level: Grandparent → Parent → Child
export const myAdapter = createThreeLevelAdapter({
  name: 'myEntity',
  grandparentType: 'grandparent',
  grandparentListAtom: grandparentListAtom,
  parentType: 'parent',
  parentRelation: grandparentToParentRelation,
  childType: 'child',
  childRelation: parentToChildRelation,
  selectionType: 'child',
  toSelection: (path, leaf) => ({ ... }),
})
```

For full customization, use `createAdapterFromRelations` directly - see `createAdapterFromRelations.ts`.

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

### EntityRelation (from @agenta/entities)

Relations declaratively define parent-child hierarchies. The selection adapter factories use:

- `relation.listAtomFamily` - To populate dropdown data
- `relation.selection.label` - For UI labels
- `relation.selection.autoSelectSingle` - Auto-selection behavior
- `relation.selection.displayName` - Custom display names

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
