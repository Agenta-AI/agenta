# @agenta/ui

Shared UI components package for the Agenta monorepo.

## Installation

This is an internal workspace package. Add it to your `package.json`:

```json
{
  "dependencies": {
    "@agenta/ui": "workspace:*"
  }
}
```

## Usage

```typescript
// Import components
import {
  InfiniteVirtualTable,
  useTableManager,
  SearchInput,
  VirtualList,
  VersionBadge,
  RevisionLabel,
  EnhancedModal,
  // Section layout primitives
  SectionCard,
  SectionLabel,
  SectionHeaderRow,
  ConfigBlock,
  // Copy button
  CopyButton,
} from '@agenta/ui'

// Import utilities
import { copyToClipboard, cn, sizeClasses, textColors, bgColors } from '@agenta/ui'
```

## Documentation

See [src/README.md](./src/README.md) for detailed documentation on:

- **InfiniteVirtualTable** - High-performance virtualized table with infinite scroll
- **Components** - Selection, presentational, and modal components
- **Utilities** - Clipboard, styling, and helper functions

## Development

```bash
# Type check
pnpm build

# Lint
pnpm lint
```

## Peer Dependencies

- `antd` >= 5.0.0
- `jotai` >= 2.0.0
- `react` >= 18.0.0
- `react-dom` >= 18.0.0
