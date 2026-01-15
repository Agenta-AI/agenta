# Entity Selection System

A unified, adapter-based system for hierarchical entity selection across the Agenta application.

## Overview

The Entity Selection System provides reusable components and hooks for navigating and selecting entities through multi-level hierarchies (e.g., App → Variant → Revision). It eliminates code duplication across different selection UIs by providing:

- **Adapters**: Entity-specific configurations that define hierarchies
- **Hooks**: Primitive hooks for custom implementations
- **Components**: Ready-to-use UI components (EntityPicker, EntityCascader, EntitySelectorModal)
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
│  PRIMITIVE HOOKS (Building Blocks)                                       │
│  ┌────────────────┐ ┌────────────────────┐ ┌─────────────────────────┐  │
│  │useEntityList   │ │useHierarchical     │ │useMultiSelect           │  │
│  │- items         │ │Selection           │ │- selections             │  │
│  │- isLoading     │ │- currentLevel      │ │- toggle/selectAll       │  │
│  │- filter        │ │- navigateDown/Up   │ │- canSelectMore          │  │
│  └────────────────┘ └────────────────────┘ └─────────────────────────┘  │
│                                    │                                     │
│                                    ▼                                     │
│  UI COMPONENTS (Ready-to-Use)                                           │
│  ┌────────────────┐ ┌────────────────┐ ┌─────────────────────────────┐  │
│  │EntityCascader  │ │EntityPicker    │ │EntitySelectorModal          │  │
│  │(Ant Cascader)  │ │(Inline List)   │ │(Modal + Tabs)               │  │
│  └────────────────┘ └────────────────┘ └─────────────────────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Using EntityPicker (Recommended)

```tsx
import { EntityPicker, type AppRevisionSelectionResult } from '@agenta/entities/ui'

function MyComponent() {
  const handleSelect = (selection: AppRevisionSelectionResult) => {
    console.log('Selected:', selection.metadata.appName, selection.metadata.variantName)
  }

  return (
    <EntityPicker<AppRevisionSelectionResult>
      adapter="appRevision"
      onSelect={handleSelect}
      showSearch
      showBreadcrumb
      rootLabel="All Apps"
    />
  )
}
```

### Using EntityCascader

```tsx
import { EntityCascader, type TestsetSelectionResult } from '@agenta/entities/ui'

function TestsetSelector() {
  const [value, setValue] = useState<string[]>([])

  return (
    <EntityCascader<TestsetSelectionResult>
      adapter="testset"
      value={value}
      onChange={(path, selection) => {
        setValue(path)
        console.log('Selected revision:', selection?.metadata.revisionId)
      }}
      placeholder="Select testset and revision"
      showSearch
      allowClear
    />
  )
}
```

### Using Primitive Hooks

```tsx
import { useHierarchicalSelection, appRevisionAdapter } from '@agenta/entities/ui'

function CustomSelector() {
  const {
    breadcrumb,
    items,
    isLoading,
    navigateDown,
    navigateUp,
    select,
    canSelect,
  } = useHierarchicalSelection({
    adapter: appRevisionAdapter,
    instanceId: 'my-custom-selector',
    onSelect: (selection) => console.log('Selected:', selection),
    autoSelectSingle: true,
  })

  return (
    <div>
      {/* Custom UI implementation */}
    </div>
  )
}
```

## Initialization

Before using the selection components, adapters must be initialized with actual atoms from the application. This is done in `Providers.tsx`:

```typescript
import { initializeSelectionAdapters } from '@/oss/state/entities/selection'

// Called once during app initialization
initializeSelectionAdapters()
```

## Directory Structure

```
selection/
├── index.ts                  # Public exports
├── types.ts                  # Core TypeScript types
├── README.md                 # This file
│
├── adapters/                 # Entity adapters
│   ├── README.md
│   ├── index.ts
│   ├── createAdapter.ts      # Factory function
│   ├── appRevisionAdapter.ts # App → Variant → Revision
│   ├── evaluatorRevisionAdapter.ts
│   └── testsetAdapter.ts     # Testset → Revision
│
├── state/                    # Jotai state atoms
│   ├── README.md
│   ├── index.ts
│   ├── selectionState.ts     # Navigation state
│   └── modalState.ts         # Modal controller state
│
├── hooks/                    # Primitive hooks
│   ├── README.md
│   ├── index.ts
│   ├── useEntityList.ts
│   ├── useHierarchicalSelection.ts
│   ├── useMultiSelect.ts
│   └── useLazyChildren.ts
│
└── components/               # UI components
    ├── README.md
    ├── index.ts
    ├── EntityPicker.tsx      # Inline hierarchical picker
    ├── EntityCascader.tsx    # Ant Cascader wrapper
    ├── EntitySelectorModal.tsx
    ├── useEntitySelector.ts  # Modal hook
    └── primitives/           # Building block components
        ├── EntityBreadcrumb.tsx
        ├── EntityListItem.tsx
        └── SearchInput.tsx
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
- **AddToTestsetDrawer**: `EntityCascader` for testset/revision selection
- **LoadTestsetModal**: `EntityPicker` for hierarchical testset browsing
- **PlaygroundTest EntitySelector**: `EntityPicker` for app/evaluator revision selection
