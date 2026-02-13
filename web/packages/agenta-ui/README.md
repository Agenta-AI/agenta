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

## Subpath Exports

**Always use subpath imports for better tree-shaking.** Importing from the root barrel (`@agenta/ui`) pulls the entire dependency graph, which increases bundle size (especially Lexical Editor ~500KB+).

| Subpath | Description | Key Exports |
|---------|-------------|-------------|
| `@agenta/ui` | Main exports | Presentational components, utilities, `cn`, `textColors` |
| `@agenta/ui/table` | Virtual table | `InfiniteVirtualTable`, paginated store utilities |
| `@agenta/ui/editor` | Lexical editor | `Editor`, `DiffView`, JSON parsing utilities |
| `@agenta/ui/shared-editor` | Shared editor | `SharedEditor`, `useDebounceInput` |
| `@agenta/ui/chat-message` | Chat messages | `ChatMessageEditor`, `ChatMessageList`, message types/schemas |
| `@agenta/ui/llm-icons` | LLM icons | `LLMIconMap`, provider icons |
| `@agenta/ui/select-llm-provider` | Provider selector | `SelectLLMProvider` |
| `@agenta/ui/app-message` | App messages | `AppMessageContext`, `useAppMessage` |
| `@agenta/ui/cell-renderers` | Cell renderers | `CellRendererRegistry`, table cell components |

### Usage Examples

```typescript
// Main exports (presentational components, utilities)
import {cn, textColors, SectionCard, EnhancedModal} from "@agenta/ui"

// Table components (avoids pulling Lexical)
import {InfiniteVirtualTable, createPaginatedEntityStore} from "@agenta/ui/table"

// Editor components (only when needed)
import {Editor, DiffView, tryParsePartialJson} from "@agenta/ui/editor"

// Chat message components
import {ChatMessageEditor, ChatMessageList} from "@agenta/ui/chat-message"
import type {SimpleChatMessage} from "@agenta/ui/chat-message"

// App message context (toast notifications)
import {AppMessageContext, useAppMessage} from "@agenta/ui/app-message"

// Cell renderers for tables
import {CellRendererRegistry, registerCellRenderer} from "@agenta/ui/cell-renderers"
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
