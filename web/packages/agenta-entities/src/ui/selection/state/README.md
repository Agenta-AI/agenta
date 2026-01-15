# Entity Selection State

Jotai atoms for managing selection navigation state and modal controller state.

## Overview

The state module provides:
- **Selection State**: Navigation path, current level, search term per instance
- **Modal State**: Open/close state, configuration, and promise-based resolution

## Selection State Atoms

All selection state is scoped by `instanceId` using atom families. This allows multiple selection UIs to operate independently.

### Core State

```typescript
import { selectionStateFamily } from '@agenta/entities/ui'

// Read current state for an instance
const stateAtom = selectionStateFamily('my-picker')
// Returns: { currentPath: [], currentLevel: 0, searchTerm: '' }
```

### Navigation Actions

```typescript
import {
  navigateDownFamily,
  navigateUpFamily,
  navigateToLevelFamily,
  resetSelectionFamily,
  setPathFamily,
  setSearchTermFamily,
} from '@agenta/entities/ui'

// Navigate into a child entity
const navigateDown = useSetAtom(navigateDownFamily('my-picker'))
navigateDown({ type: 'app', id: 'app-1', label: 'My App' })

// Navigate up one level
const navigateUp = useSetAtom(navigateUpFamily('my-picker'))
navigateUp()

// Navigate to specific breadcrumb level
const navigateToLevel = useSetAtom(navigateToLevelFamily('my-picker'))
navigateToLevel(1)  // Go to second item in breadcrumb

// Reset to root
const reset = useSetAtom(resetSelectionFamily('my-picker'))
reset()

// Set search term
const setSearchTerm = useSetAtom(setSearchTermFamily('my-picker'))
setSearchTerm('search query')
```

### Derived Atoms

```typescript
import {
  currentPathFamily,
  currentLevelFamily,
  searchTermFamily,
  isAtRootFamily,
  currentParentIdFamily,
} from '@agenta/entities/ui'

// Current breadcrumb path
const path = useAtomValue(currentPathFamily('my-picker'))

// Current level index
const level = useAtomValue(currentLevelFamily('my-picker'))

// Search term
const searchTerm = useAtomValue(searchTermFamily('my-picker'))

// Is at root level?
const isRoot = useAtomValue(isAtRootFamily('my-picker'))

// Parent entity ID (for loading children)
const parentId = useAtomValue(currentParentIdFamily('my-picker'))
```

## Selection Molecule

For convenience, all selection state is also exposed via a molecule pattern:

```typescript
import { selectionMolecule } from '@agenta/entities/ui'

// In components (usually prefer useHierarchicalSelection hook instead)
const path = useAtomValue(selectionMolecule.path('my-picker'))
const level = useAtomValue(selectionMolecule.level('my-picker'))
```

## Modal State (entitySelectorController)

The modal state provides a promise-based API for opening selection modals.

### Controller API

```typescript
import { entitySelectorController } from '@agenta/entities/ui'

// Check if modal is open
const isOpen = useAtomValue(entitySelectorController.selectors.isOpen())

// Get current config
const config = useAtomValue(entitySelectorController.selectors.config())

// Open modal (returns Promise)
const openSelector = useSetAtom(entitySelectorController.actions.open)
const selection = await openSelector({
  title: 'Select Entity',
  allowedTypes: ['appRevision', 'evaluatorRevision'],
})

// Close with selection
const closeSelector = useSetAtom(entitySelectorController.actions.close)
closeSelector(selection)  // or null to cancel

// Force close without triggering resolver
const forceClose = useSetAtom(entitySelectorController.actions.forceClose)
forceClose()
```

### Modal State Atoms

```typescript
import {
  entitySelectorOpenAtom,      // boolean - is modal open
  entitySelectorConfigAtom,    // EntitySelectorConfig
  entitySelectorResolverAtom,  // Promise resolver function
  entitySelectorActiveTypeAtom, // Currently active tab
  entitySelectorAllowedTypesAtom, // Allowed entity types
  entitySelectorTitleAtom,     // Modal title
  entitySelectorAdaptersAtom,  // Configured adapters
} from '@agenta/entities/ui'
```

### Modal Actions

```typescript
import {
  openEntitySelectorAtom,      // Open with config
  closeEntitySelectorAtom,     // Close and resolve promise
  closeEntitySelectorWithSelectionAtom, // Close with selection
  forceCloseEntitySelectorAtom, // Close without resolving
  setEntitySelectorActiveTypeAtom, // Change active tab
  resetEntitySelectorAtom,     // Reset all state
} from '@agenta/entities/ui'
```

## State Shape

### Selection State

```typescript
interface HierarchicalSelectionState {
  currentPath: SelectionPathItem[]  // Breadcrumb
  currentLevel: number              // 0-indexed depth
  searchTerm: string                // Filter text
}

interface SelectionPathItem {
  type: SelectableEntityType
  id: string
  label: string
}
```

### Modal Config

```typescript
interface EntitySelectorConfig {
  allowedTypes?: SelectableEntityType[]
  title?: string
  adapters?: EntitySelectionAdapter[]
}
```

## Usage Patterns

### In Components (Prefer Hooks)

```tsx
// PREFERRED: Use the hook
import { useHierarchicalSelection } from '@agenta/entities/ui'

const { breadcrumb, items, navigateDown } = useHierarchicalSelection({
  adapter: 'appRevision',
  instanceId: 'my-picker',
})
```

### In Other Atoms (Direct Access)

```typescript
import { currentPathFamily } from '@agenta/entities/ui'

// Derive state from selection
const myDerivedAtom = atom((get) => {
  const path = get(currentPathFamily('my-picker'))
  return path.length > 0 ? path[path.length - 1].id : null
})
```

### Instance Isolation

Each `instanceId` creates completely isolated state:

```typescript
// These have separate state
const state1 = get(selectionStateFamily('picker-1'))
const state2 = get(selectionStateFamily('picker-2'))
// state1 and state2 are independent
```

## Files

- `index.ts` - Re-exports all state atoms
- `selectionState.ts` - Navigation state atoms and families
- `modalState.ts` - Modal controller atoms and actions
