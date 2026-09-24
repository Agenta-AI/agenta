# @agenta/playground-ui

React UI components for the Agenta playground feature.

## Overview

This package provides **React components** for building playground UIs.
For state management, see `@agenta/playground`.

## Installation

This is an internal workspace package. Add it to your `package.json`:

```json
{
  "dependencies": {
    "@agenta/playground-ui": "workspace:*",
    "@agenta/playground": "workspace:*"
  }
}
```

## Usage

### Basic Setup

```typescript
import { PlaygroundUIProvider } from '@agenta/playground-ui'

function PlaygroundPage() {
  return (
    <PlaygroundUIProvider providers={uiProviders}>
      {children}
    </PlaygroundUIProvider>
  )
}
```

### Component Examples

#### Using EntitySelector

Entity selection modal for choosing app revisions or evaluators.

```tsx
import { EntitySelector, EntitySelectorProvider } from '@agenta/playground-ui'

<EntitySelectorProvider>
  <EntitySelector />
</EntitySelectorProvider>
```

### Context Providers

#### PlaygroundUIProvider

Injects app-layer components:

```typescript
const uiProviders = {
  EntityDrillInView: MyDrillInComponent,
  SharedGenerationResultUtils: MyResultUtils,
  CommitVariantChangesButton: MyCommitButton,
}

<PlaygroundUIProvider providers={uiProviders}>
  {children}
</PlaygroundUIProvider>
```

## Exports

### Main Export

```typescript
import {
  // Context
  PlaygroundUIProvider,
  usePlaygroundUI,

  // Components
  EntitySelector,
  EntitySelectorProvider,
  ControlsBar,
  PlaygroundOutputs,
  ToolCallView,
} from '@agenta/playground-ui'
```

### Subpath Exports

See `package.json` `exports` for the full list (e.g. `@agenta/playground-ui/execution-items`,
`@agenta/playground-ui/commit`, `@agenta/playground-ui/agent-page-header`).

## Architecture

### Package Dependency Flow

```text
@agenta/shared        ← Base utilities (formatters, path utils)
       ↑
@agenta/ui            ← UI primitives (EnhancedModal, styles)
       ↑
@agenta/entities      ← Entity state (loadable bridge, workflow molecule)
       ↑
@agenta/entity-ui     ← Entity UI (EntityPicker, SchemaPropertyRenderer)
       ↑
@agenta/playground    ← Playground state (controllers)
       ↑
@agenta/playground-ui ← This package (React components)
```

### State vs UI Separation

- **State** lives in `@agenta/playground` (controllers, atoms)
- **UI** lives here (React components that consume state)

```typescript
// In components, import state from @agenta/playground
import { playgroundController } from '@agenta/playground'
import { useAtomValue } from 'jotai'

const nodes = useAtomValue(playgroundController.selectors.nodes())
```

### Directory Structure

```text
src/
├── index.ts          # Main exports
├── context/          # UI context for app-layer injection (PlaygroundUIContext.tsx)
├── components/       # Execution items, outputs, entity selector, agent headers, ...
├── hooks/            # Execution cell, layout, loading hooks
├── state/            # UI-only atoms (feature flags, focus drawer)
└── utils/
```

## Main Components

### EntitySelector

Modal for selecting playground entities (workflow revisions, evaluator revisions, testcases,
spans). Uses `EntityPicker` from `@agenta/entity-ui` for hierarchical selection.

## Component Composition Patterns

### Controller-Based State Access

Components read state via controllers, not internal atoms:

```typescript
import { playgroundController, outputConnectionController } from '@agenta/playground'
import { useAtomValue, useSetAtom } from 'jotai'

// Read state via selectors
const nodes = useAtomValue(playgroundController.selectors.nodes())
const connections = useAtomValue(outputConnectionController.selectors.allConnections())

// Write via compound actions (multi-step operations)
const addPrimaryNode = useSetAtom(playgroundController.actions.addPrimaryNode)
const disconnectAndReset = useSetAtom(playgroundController.actions.disconnectAndResetToLocal)
```

### Entity Data Access

Access entity data via bridges and molecules:

```typescript
import { loadableBridge } from '@agenta/entities'
import { workflowMolecule } from '@agenta/entities/workflow'

const rows = useAtomValue(loadableBridge.selectors.rows(loadableId))
const inputPorts = useAtomValue(workflowMolecule.selectors.inputPorts(revisionId))
```

### UI-Only Principle

UI components should be **visual layers only** - no business logic:

```typescript
// ✅ GOOD: Thin callback wrapper
const handleAdd = useCallback(() => {
    addPrimaryNode(selection)
}, [addPrimaryNode, selection])

// ❌ BAD: Business logic in handler
const handleAdd = useCallback(() => {
    if (someCondition) {
        dispatch({type: "a"})
    }
    dispatch({type: "b"})
    loadable.doSomething()
}, [...])
```

**Rule:** If a handler needs conditional logic or multiple dispatches, create a compound action in `@agenta/playground`.

### Performance Optimization

**Performance-aware state patterns:**

```typescript
// ✅ GOOD: Fine-grained subscriptions
const nodes = useAtomValue(playgroundController.selectors.nodes())

// ❌ BAD: Consolidated object returns cause cascade re-renders
const { nodes, connections } = usePlaygroundState() // Object ref changes on any update
```

**Rule:** Keep fine-grained atom subscriptions. Never consolidate subscriptions into a single hook that returns an object.

### Injectable UI Context

App-layer components are injected via context:

```typescript
const { EntityDrillInView, CommitVariantChangesButton } = usePlaygroundUI()
```

## Dependencies

- `@agenta/playground` - State management (controllers, hooks)
- `@agenta/entities` - Entity state management (workflow molecule, loadable bridge, testset)
- `@agenta/entity-ui` - Entity-specific UI components
- `@agenta/ui` - Shared UI components and styling tokens
- `@agenta/shared` - Shared utilities (formatters, API)
- `antd` - UI component library
- `jotai` - State management

## Related Packages

- `@agenta/playground` - State management
- `@agenta/ui` - Base UI components
- `@agenta/entity-ui` - Entity-specific UI

## Development

```bash
# Type check
pnpm build

# Lint
pnpm lint
```
