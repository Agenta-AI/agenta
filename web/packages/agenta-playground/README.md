# @agenta/playground

Playground UI components package for testing app revisions, evaluators, and managing testcases.

## Installation

This is an internal workspace package. Add it to your `package.json`:

```json
{
  "dependencies": {
    "@agenta/playground": "workspace:*"
  }
}
```

## Usage

The package requires a provider to inject OSS/EE-specific components:

```tsx
import { PlaygroundUIProvider, PlaygroundContent } from "@agenta/playground"
import { SharedGenerationResultUtils } from "@/oss/components/SharedGenerationResultUtils"
// ... other imports

export function PlaygroundTest() {
  return (
    <PlaygroundUIProvider providers={{
      SharedGenerationResultUtils,
      // ... other injectable components
    }}>
      <PlaygroundContent />
    </PlaygroundUIProvider>
  )
}
```

## Architecture

### Directory Structure

```text
src/
├── index.ts              # Public exports
├── components/           # UI components
│   ├── PlaygroundContent/    # Main orchestrator component
│   ├── ConfigPanel/          # Configuration panel (left side)
│   ├── TestcasePanel/        # Testcase execution panel (right side)
│   ├── ConfigurationSection/ # Schema-driven configuration UI
│   ├── EntitySelector/       # Entity selection modal
│   ├── InputMappingModal/    # Input mapping for chains
│   ├── LoadableEntityPanel/  # Loadable data display
│   ├── RunnableColumnsLayout/# Multi-node chain layout
│   └── TestsetSelectionModal/# Testset selection and save
├── context/              # React context for OSS/EE injection
├── hooks/                # Custom hooks (chain execution)
└── state/                # Jotai atoms and controllers
    ├── atoms/            # Core playground state
    ├── controllers/      # High-level state management APIs
    └── context/          # Entity provider injection
```

### State Management

The playground uses a **controller pattern** for state management:

```typescript
import { playgroundController, outputConnectionController } from "@agenta/playground"

// Selectors (read state)
const nodes = useAtomValue(playgroundController.selectors.nodes())
const primaryNode = useAtomValue(playgroundController.selectors.primaryNode())

// Actions (write state)
const addNode = useSetAtom(playgroundController.actions.addPrimaryNode)
const removeNode = useSetAtom(playgroundController.actions.removeNode)
```

### Key Concepts

1. **Loadable Entities**: Data sources (testsets, traces) that provide input rows for execution
2. **Runnable Entities**: App revisions and evaluators that can be executed
3. **Chain Execution**: Multi-node DAG execution with topological ordering
4. **Output Mapping**: Maps execution outputs to testcase columns

## Main Components

### PlaygroundContent

Main orchestrator component with two-column layout:

- **Left**: Configuration panel (prompt, model, parameters)
- **Right**: Testcase panel (inputs, run, outputs)

### ConfigPanel

Displays configuration for a runnable entity:

- Data source connection (testset linking)
- Input/output variable display
- Configuration sections (prompt, model, etc.)

### TestcasePanel

Handles testcase execution:

- Displays testcase data
- Run buttons for individual and batch execution
- Output display with chain results

### ConfigurationSection

Schema-driven configuration UI using `SchemaPropertyRenderer` from `@agenta/entity-ui`.

## Dependencies

- `@agenta/entities` - Entity state management (runnable, loadable, testset)
- `@agenta/ui` - Shared UI components and styling tokens
- `@agenta/shared` - Shared utilities (formatters, API)
- `antd` - UI component library
- `jotai` - State management

## Documentation

See [src/state/README.md](./src/state/README.md) for detailed state management documentation.

## Development

```bash
# Type check
pnpm build

# Lint
pnpm lint
```
