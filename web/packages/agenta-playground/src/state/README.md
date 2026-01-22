# Playground State Module

State management for the playground feature using Jotai atoms.

## Overview

This module provides:
- **Playground Atoms**: Core state for playground nodes, selection, and modals
- **Connection Atoms**: Output connections between playground nodes
- **Entity Selector Atoms**: Modal state for entity selection
- **Cascading Selection**: Derived state for cascading app revision selection

## Directory Structure

```
state/
├── index.ts              # Public exports (types, atoms, controllers, context)
├── types.ts              # Type definitions
├── README.md             # This file
├── atoms/
│   ├── index.ts          # Re-exports all atoms
│   ├── playground.ts     # Core playground state
│   ├── connections.ts    # Output connections
│   ├── entitySelector.ts # Entity selector modal state
│   └── cascadingSelection.ts # Cascading selection atoms
├── controllers/
│   └── playgroundController.ts # High-level state management
└── context/
    └── PlaygroundEntityProvider.tsx # Entity provider injection
```

## Cascading Selection

The `cascadingSelection` module provides derived state for hierarchical entity selection with auto-selection logic. Unlike the `useHierarchicalSelection` hook which manages navigation state, cascading selection uses pure Jotai atoms for automatic derivation.

### Architecture

```
User Actions                    Derived State
┌─────────────────────┐         ┌──────────────────────────────────┐
│ userSelectedAppId   │ ──────► │ effectiveVariantId               │
│ userSelectedVariantId│         │ (user selection OR auto-select) │
└─────────────────────┘         ├──────────────────────────────────┤
                                │ autoSelectedRevisionId           │
                                │ (auto-select if single revision) │
                                ├──────────────────────────────────┤
                                │ autoCompletedSelection           │
                                │ (full EntitySelection if         │
                                │  all levels auto-complete)       │
                                └──────────────────────────────────┘
```

### Auto-Selection Logic

The cascading selection system automatically derives effective selections:

1. **Variant Auto-Selection**: When user selects an app with exactly one variant, `effectiveVariantId` automatically returns that variant's ID
2. **Revision Auto-Selection**: When the effective variant has exactly one revision, `autoSelectedRevisionId` returns that revision's ID
3. **Auto-Completion**: When all levels are determined (through user selection or auto-selection), `autoCompletedSelection` returns a complete `EntitySelection` object

### Usage

```typescript
import { cascadingSelection } from '@agenta/playground/state'
import { useAtomValue, useSetAtom } from 'jotai'

function AppRevisionSelector({ onSelect }: { onSelect: (selection: EntitySelection) => void }) {
  // Read derived state
  const effectiveVariantId = useAtomValue(cascadingSelection.selectors.effectiveVariantId)
  const autoCompletedSelection = useAtomValue(cascadingSelection.selectors.autoCompletedSelection)

  // Actions
  const setAppId = useSetAtom(cascadingSelection.actions.setAppId)
  const setVariantId = useSetAtom(cascadingSelection.atoms.userSelectedVariantId)
  const reset = useSetAtom(cascadingSelection.actions.reset)

  // Auto-completion effect
  useEffect(() => {
    if (autoCompletedSelection) {
      onSelect(autoCompletedSelection)
    }
  }, [autoCompletedSelection, onSelect])

  // Reset on unmount
  useEffect(() => {
    return () => reset()
  }, [reset])

  return (
    // Render cascading selects...
  )
}
```

### API Reference

#### Atoms (Read/Write)

| Atom | Type | Description |
|------|------|-------------|
| `atoms.userSelectedAppId` | `string \| null` | User's explicit app selection |
| `atoms.userSelectedVariantId` | `string \| null` | User's explicit variant selection |

#### Selectors (Read-Only)

| Selector | Type | Description |
|----------|------|-------------|
| `selectors.apps` | `AppListItem[]` | All available apps |
| `selectors.variantsForSelectedApp` | `VariantListItem[]` | Variants for selected app |
| `selectors.revisionsForEffectiveVariant` | `RevisionListItem[]` | Revisions for effective variant |
| `selectors.effectiveVariantId` | `string \| null` | User selection OR auto-select |
| `selectors.autoSelectedRevisionId` | `string \| null` | Auto-selected revision ID |
| `selectors.isVariantAutoSelected` | `boolean` | Whether variant was auto-selected |
| `selectors.canAutoComplete` | `boolean` | Whether selection can auto-complete |
| `selectors.selectedApp` | `AppListItem \| null` | Selected app data |
| `selectors.selectedVariant` | `VariantListItem \| null` | Selected variant data |
| `selectors.autoSelectedRevision` | `RevisionListItem \| null` | Auto-selected revision data |
| `selectors.autoCompletedSelection` | `EntitySelection \| null` | Complete selection if auto-completed |
| `selectors.selectionState` | `SelectionState` | Summary of current selection state |

#### Actions (Write-Only)

| Action | Parameters | Description |
|--------|------------|-------------|
| `actions.setAppId` | `string \| null` | Set app ID and reset variant |
| `actions.reset` | none | Reset all selections |

#### Query State Selectors (Loading/Error)

The `queryState` namespace provides loading and error state for each selection level:

| Selector | Type | Description |
|----------|------|-------------|
| `queryState.apps` | `SelectionLevelLoadingState` | Apps list loading/error state |
| `queryState.variants` | `SelectionLevelLoadingState` | Variants loading/error (for selected app) |
| `queryState.revisions` | `SelectionLevelLoadingState` | Revisions loading/error (for effective variant) |
| `queryState.variantsByAppId(appId)` | `SelectionLevelLoadingState` | Variants loading/error for specific app |
| `queryState.revisionsByVariantId(variantId)` | `SelectionLevelLoadingState` | Revisions loading/error for specific variant |
| `queryState.isAnyLoading` | `boolean` | True if any level is loading |
| `queryState.combinedError` | `Error \| null` | First error found across levels |

**SelectionLevelLoadingState type:**

```typescript
interface SelectionLevelLoadingState {
  isPending: boolean
  isError: boolean
  error: Error | null
}
```

**Usage with loading indicators:**

```typescript
const appsQueryState = useAtomValue(cascadingSelection.queryState.apps)
const variantsQueryState = useAtomValue(cascadingSelection.queryState.variants)

return (
  <Select
    loading={appsQueryState.isPending}
    disabled={appsQueryState.isPending}
    status={appsQueryState.isError ? "error" : undefined}
    placeholder={appsQueryState.isPending ? "Loading..." : "Select an app..."}
    notFoundContent={
      appsQueryState.isPending ? "Loading applications..." :
      appsQueryState.isError ? "Failed to load applications" :
      "No applications found"
    }
    // ...
  />
)
```

### Why Data Layer Instead of React?

Moving auto-selection logic to atoms provides several benefits:

1. **Separation of Concerns**: UI components focus on rendering, atoms handle derivation
2. **Testability**: Logic can be tested without React components
3. **Reusability**: Same atoms can be used by multiple components
4. **Consistency**: Derived state is always in sync with source atoms
5. **Performance**: Atom derivation is memoized by Jotai

### Comparison with Entity Selection System

| Aspect | Cascading Selection | useHierarchicalSelection |
|--------|---------------------|--------------------------|
| Pattern | Pure atoms with derivation | Hook with navigation state |
| Auto-selection | Built into derived atoms | Via `autoSelectSingle` prop |
| UI Pattern | Cascading dropdowns | List-based drill-down |
| State Location | Playground package | Entities package |
| Use Case | EntitySelector dropdowns | EntityPicker, EntityCascader |

## Other State Modules

### Playground Atoms (`atoms/playground.ts`)

Core state for playground nodes and UI:

```typescript
import {
  playgroundNodesAtom,    // All playground nodes
  selectedNodeIdAtom,     // Currently selected node
  connectedTestsetAtom,   // Connected testset info
  extraColumnsAtom,       // Additional columns
  testsetModalOpenAtom,   // Testset modal state
  mappingModalOpenAtom,   // Mapping modal state
} from '@agenta/playground/state'
```

### Connection Atoms (`atoms/connections.ts`)

Output connections between nodes:

```typescript
import {
  outputConnectionsAtom,           // All connections
  connectionsBySourceAtomFamily,   // Connections from a source
  connectionsByTargetAtomFamily,   // Connections to a target
} from '@agenta/playground/state'
```

### Entity Selector Atoms (`atoms/entitySelector.ts`)

Modal state for entity selection:

```typescript
import {
  entitySelectorOpenAtom,      // Modal open state
  entitySelectorConfigAtom,    // Modal configuration
  entitySelectorResolverAtom,  // Promise resolver
} from '@agenta/playground/state'
```

## Controllers

### playgroundController

High-level API for playground state management:

```typescript
import { playgroundController } from '@agenta/playground/state'

// Selectors
const nodes = useAtomValue(playgroundController.selectors.nodes())
const primaryNode = useAtomValue(playgroundController.selectors.primaryNode())

// Actions
const addNode = useSetAtom(playgroundController.actions.addPrimaryNode)
const removeNode = useSetAtom(playgroundController.actions.removeNode)
```

### outputConnectionController

Manages connections between nodes:

```typescript
import { outputConnectionController } from '@agenta/playground/state'

// Create connection
const connect = useSetAtom(outputConnectionController.actions.connect)
connect({ sourceId, targetId, portMapping })

// Remove connection
const disconnect = useSetAtom(outputConnectionController.actions.disconnect)
disconnect(connectionId)
```

### entitySelectorController

Promise-based modal API:

```typescript
import { entitySelectorController } from '@agenta/playground/state'

// Open selector and await result
const open = useSetAtom(entitySelectorController.actions.open)
const selection = await open({
  title: 'Select App Revision',
  allowedTypes: ['appRevision'],
})
```
