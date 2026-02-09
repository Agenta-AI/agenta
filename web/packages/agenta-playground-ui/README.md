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
import { PlaygroundContent, PlaygroundUIProvider } from '@agenta/playground-ui'
import { PlaygroundEntityProvider } from '@agenta/playground'

function PlaygroundPage() {
  return (
    <PlaygroundEntityProvider value={entityProviders}>
      <PlaygroundUIProvider value={uiProviders}>
        <PlaygroundContent />
      </PlaygroundUIProvider>
    </PlaygroundEntityProvider>
  )
}
```

### Component Examples

#### Using PlaygroundContent

Main playground layout with config panel and testcase panel.

```tsx
import { PlaygroundContent } from '@agenta/playground-ui'

<PlaygroundContent />
```

#### Using EntitySelector

Entity selection modal for choosing app revisions or evaluators.

```tsx
import { EntitySelector, EntitySelectorProvider } from '@agenta/playground-ui'

<EntitySelectorProvider>
  <EntitySelector />
</EntitySelectorProvider>
```

#### Using InputMappingModal

Configure input mappings between runnables.

```tsx
import { InputMappingModalWrapper } from '@agenta/playground-ui'

<InputMappingModalWrapper />
```

### Context Providers

#### PlaygroundUIProvider

Injects OSS/EE-specific components:

```typescript
const uiProviders = {
  EntityDrillInView: MyDrillInComponent,
  SharedGenerationResultUtils: MyResultUtils,
  LoadTestsetModal: MyTestsetModal,
  CommitVariantChangesButton: MyCommitButton,
}

<PlaygroundUIProvider value={uiProviders}>
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
  PlaygroundContent,
  ConfigPanel,
  TestcasePanel,
  EntitySelector,
  InputMappingModalWrapper,
  TestsetSelectionModal,
  LoadableEntityPanel,
  ExecutionMetrics,
} from '@agenta/playground-ui'
```

### Subpath Exports

```typescript
import { EntitySelector } from '@agenta/playground-ui/entity-selector'
import { InputMappingModal } from '@agenta/playground-ui/input-mapping'
import { LoadableEntityPanel } from '@agenta/playground-ui/loadable'
```

## Architecture

### Package Dependency Flow

```text
@agenta/shared        ← Base utilities (formatters, path utils)
       ↑
@agenta/ui            ← UI primitives (EnhancedModal, styles)
       ↑
@agenta/entities      ← Entity state (loadable, runnable bridges)
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
├── index.ts                  # Main exports
├── context/                  # UI context for OSS/EE injection
│   └── PlaygroundUIContext.tsx
└── components/
    ├── PlaygroundContent/    # Main orchestrator (784 lines)
    │   └── PlaygroundContent.tsx
    ├── ConfigPanel/          # Left panel - configuration
    │   ├── ConfigPanel.tsx
    │   └── components/
    │       ├── ConfigPanelHeader.tsx
    │       ├── DataSourceSection.tsx
    │       ├── DownstreamMappingsSection.tsx
    │       ├── InputsDataSection.tsx
    │       └── OutputMappingSection.tsx
    ├── ConfigurationSection/ # Schema-driven config drill-in
    ├── TestcasePanel/        # Right panel - execution (815 lines)
    ├── EntitySelector/       # Entity selection modal
    │   └── EntitySelector.tsx
    ├── InputMappingModal/    # Input mapping configuration
    │   ├── InputMappingModal.tsx
    │   ├── components/
    │   │   ├── MappingLegend.tsx
    │   │   ├── ObjectMappingRow.tsx
    │   │   ├── PathSelector.tsx
    │   │   ├── ScalarMappingRow.tsx
    │   │   └── TestRunPreview.tsx
    │   ├── hooks/
    │   │   └── useMappingState.ts
    │   └── utils.tsx
    ├── TestsetSelectionModal/
    │   ├── TestsetSelectionModal.tsx
    │   └── components/
    ├── LoadableEntityPanel/
    ├── RunnableColumnsLayout/
    └── ExecutionMetrics/
```

## Main Components

### PlaygroundContent

Main orchestrator component with two-column layout:

- **Left**: Configuration panel (prompt, model, parameters)
- **Right**: Testcase panel (inputs, run, outputs)
- Coordinates modals (testset selection, input mapping, entity selection)
- Manages loadable/runnable synchronization

### ConfigPanel

Displays configuration for a runnable entity:

- **ConfigPanelHeader**: Entity info, version badge, commit button
- **ConfigurationSection**: Schema-driven drill-in for config
- **InputsDataSection**: Expected vs Provided inputs, extra columns
- **DataSourceSection**: Testset connection (primary nodes)
- **DownstreamMappingsSection**: Input mappings (downstream nodes)

### TestcasePanel

Handles testcase execution:

- Displays testcase data in rows
- Run buttons for individual and batch execution
- Output display with chain results for multi-node DAGs
- Execution metrics (latency, tokens, cost)

### EntitySelector

Modal for selecting playground entities:

- **AppRevisionSelector**: App -> Variant -> Revision hierarchy
- **EvaluatorRevisionSelector**: Evaluator -> Variant -> Revision
- **TestcaseSelector**: Testcase ID input
- **SpanSelector**: Span ID input

Uses `EntityPicker` from `@agenta/entity-ui` for hierarchical selection.

### InputMappingModal

Configure input mappings between runnables in a chain:

- Auto-mapping with manual override support
- Test run capability for path discovery
- Scalar and object mapping modes
- Path selection from upstream outputs and testcase columns

### ConfigurationSection

Schema-driven configuration UI using `SchemaPropertyRenderer` from `@agenta/entity-ui`.

## Component Composition Patterns

### Controller-Based State Access

Components read state via controllers, not internal atoms:

```typescript
import { playgroundController, outputConnectionController } from '@agenta/playground'
import { useAtomValue, useSetAtom } from 'jotai'

// Read state via selectors
const nodes = useAtomValue(playgroundController.selectors.nodes())
const primaryNode = useAtomValue(playgroundController.selectors.primaryNode())
const connections = useAtomValue(outputConnectionController.selectors.allConnections())

// Write via compound actions (multi-step operations)
const addPrimaryNode = useSetAtom(playgroundController.actions.addPrimaryNode)
const disconnectAndReset = useSetAtom(playgroundController.actions.disconnectAndResetToLocal)
```

### Bridge-Based Entity Access

Access entity data via bridges:

```typescript
import { loadableBridge, runnableBridge } from '@agenta/entities'

const rows = useAtomValue(loadableBridge.selectors.rows(loadableId))
const inputPorts = useAtomValue(runnableBridge.selectors.inputPorts(runnableId))
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

Child panel components use `React.memo` to prevent unnecessary re-renders:

```typescript
// ConfigPanel, TestcasePanel, RunnableColumnsLayout are all wrapped with memo
export const ConfigPanel = memo(function ConfigPanel({ ... }) {
    // Component implementation
})
```

**Why memo matters for playground:**

- `PlaygroundContent` subscribes to multiple atoms (nodes, connections, testset state)
- Without memo, child panels re-render whenever ANY parent atom changes
- With memo, child panels only re-render when their specific props change
- This is critical during execution when results update frequently

**Performance-aware state patterns:**

```typescript
// ✅ GOOD: Fine-grained subscriptions
const nodes = useAtomValue(playgroundController.selectors.nodes())
const primaryNode = useAtomValue(playgroundController.selectors.primaryNode())

// ❌ BAD: Consolidated object returns cause cascade re-renders
const { nodes, primaryNode, connections } = usePlaygroundState() // Object ref changes on any update
```

**Rule:** Keep fine-grained atom subscriptions. Never consolidate subscriptions into a single hook that returns an object.

### Injectable UI Context

OSS/EE-specific components are injected via context:

```typescript
const { EntityDrillInView, CommitVariantChangesButton } = usePlaygroundUI()
```

## Dependencies

- `@agenta/playground` - State management (controllers, hooks)
- `@agenta/entities` - Entity state management (runnable, loadable, testset)
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

## Future Improvements

### Completed Extractions

See [Component Code Review](../../../docs/handovers/playground-ui-code-review.md):

- ✅ Extracted `ExecutionMetricsDisplay` to `@agenta/ui`
- ✅ Extracted path utilities to `@agenta/shared`
- ✅ Extracted `PathSelectorDropdown` to `@agenta/ui`
- ✅ Extracted `MappingStatusTag` to `@agenta/ui`
- ✅ Broke down `TestcasePanel` (815 → 222 lines)
- ✅ Broke down `PlaygroundContent` (790 → 503 lines)

### Completed State Separation Work

The following state separation improvements have been implemented:

- ✅ Testset connection logic moved to `connectToTestset` and `importTestcases` compound actions
- ✅ Row management logic (first row init) moved to `addRowWithInit` compound action
- ✅ Extra column management unified via `addExtraColumn` and `removeExtraColumn` compound actions
- ✅ Output mapping column management unified via `addOutputMappingColumn` compound action
- ✅ Child panels wrapped with `React.memo` for performance optimization

UI components now use single compound action calls instead of multi-step dual dispatch patterns.
See `@agenta/playground` README for the full compound actions API.
