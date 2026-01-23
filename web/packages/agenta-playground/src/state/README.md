# Playground State Module

State management for the playground feature using Jotai atoms.

## Overview

This module provides:
- **Playground Atoms**: Core state for playground nodes, selection, and modals
- **Connection Atoms**: Output connections between playground nodes
- **Entity Selector Atoms**: Modal state for entity selection

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
│   └── entitySelector.ts # Entity selector modal state
├── controllers/
│   └── playgroundController.ts # High-level state management
└── context/
    └── PlaygroundEntityProvider.tsx # Entity provider injection
```

## Entity Selection

For cascading entity selection (App → Variant → Revision), use the unified selection system from `@agenta/entity-ui`:

```typescript
import { AppRevisionSelectGroup } from '@agenta/entity-ui'

function AppRevisionSelector({ onSelect }) {
    return (
        <AppRevisionSelectGroup
            onSelect={(selection) => {
                onSelect({
                    type: "appRevision",
                    id: selection.id,
                    label: selection.label,
                    metadata: selection.metadata,
                })
            }}
        />
    )
}
```

For more details, see the [Entity Selection documentation](../../../agenta-entities/src/ui/selection/README.md).

## State Modules

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
