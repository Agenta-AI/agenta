# @agenta/ui Source Structure

This package provides shared UI components, hooks, and utilities for building data-intensive interfaces.

## Folder Structure

```
src/
├── components/              # Reusable UI components
│   ├── selection/           # Selection UI (search, lists, pagination)
│   ├── presentational/      # Pure display components (badges, labels, etc.)
│   ├── modal/               # Modal layout components
│   ├── CopyButtonDropdown.tsx  # Copy button with dropdown options
│   ├── EnhancedModal.tsx    # Modal wrapper with lazy rendering
│   └── README.md
├── ChatMessage/             # Chat message editing components
│   ├── components/          # Editor, list, attachments
│   └── README.md
├── Editor/                  # Rich text/code editor (Lexical-based)
│   ├── plugins/             # Editor plugins (code, markdown, tokens)
│   ├── form/                # Form view for structured data
│   └── README.md
├── SharedEditor/            # Editor wrapper with debounce
├── InfiniteVirtualTable/    # High-performance virtualized table
│   ├── columns/             # Column creation utilities
│   ├── components/          # Table UI components
│   ├── hooks/               # Table hooks
│   ├── paginated/           # Paginated entity store
│   └── README.md
├── LLMIcons/                # LLM provider SVG icons
│   └── README.md
├── SelectLLMProvider/       # LLM provider selection component
│   └── README.md
├── utils/                   # Generic utilities
│   ├── copyToClipboard.ts   # Clipboard utility
│   ├── styles.ts            # Styling utilities (cn, colors, layouts)
│   ├── appMessageContext.tsx # Ant Design message/modal/notification
│   └── README.md
└── index.ts                 # Main exports
```

## Design Principles

1. **Single Responsibility** - Each folder has a clear purpose
2. **Colocation** - Related code lives together (e.g., paginated is inside InfiniteVirtualTable)
3. **Minimal Root** - Only generic utilities at the root level
4. **Documentation** - Each major folder has its own README

## Main Modules

### Components (`components/`)

Reusable UI components organized by domain. See [components/README.md](./components/README.md) for details.

#### Selection Components (`components/selection/`)

Building blocks for list selection UIs:
- **SearchInput**: Search input with clear button
- **ListItem**: Generic list item with click/navigate variants
- **VirtualList**: Virtualized list using @tanstack/react-virtual
- **LoadMoreButton**: Pagination button with count display
- **LoadAllButton**: Load all pages with progress indicator
- **Breadcrumb**: Navigation breadcrumb with back button

#### Presentational Components (`components/presentational/`)

Pure display components for entity information:
- **VersionBadge**: Version number in "vX" format
- **RevisionLabel**: Revision details (version, date, message, author)
- **EntityPathLabel**: Hierarchical paths ("App / Variant / v1")
- **EntityNameWithVersion**: Entity name with version badge
- **CopyButton**: Copy to clipboard with visual feedback
- **SectionCard/ConfigBlock**: Section layout primitives
- **MetadataHeader**: Label/value metadata display
- **EditableText**: Inline editable text

#### Modal Components (`components/modal/`)

- **EnhancedModal**: Modal wrapper with lazy rendering, auto-height
- **ModalContent**: Standardized modal content layout
- **ModalFooter**: Standardized modal footer with cancel/confirm

#### Action Components

- **CopyButtonDropdown**: Copy button with dropdown options

### ChatMessage

Chat message editing components for OpenAI/Anthropic message format.
See [ChatMessage/README.md](./ChatMessage/README.md) for details.

### Editor

Rich text and code editor built on Lexical with JSON/YAML highlighting, markdown, and form view.
See [Editor/README.md](./Editor/README.md) for details.

### SharedEditor

Editor wrapper with debounce support and styling.
See [SharedEditor/README.md](./SharedEditor/README.md) for details.

### InfiniteVirtualTable

High-performance virtualized table with infinite scroll, column management, and row selection.
See [InfiniteVirtualTable/README.md](./InfiniteVirtualTable/README.md) for details.

### LLMIcons

SVG icons for LLM providers (OpenAI, Anthropic, etc.).
See [LLMIcons/README.md](./LLMIcons/README.md) for details.

### SelectLLMProvider

LLM provider selection component with cascading menu and icons.
See [SelectLLMProvider/README.md](./SelectLLMProvider/README.md) for details.

### Utilities (`utils/`)

Generic utilities:
- **copyToClipboard**: Clipboard operations
- **cn**: Class name concatenation utility
- **sizeClasses, flexLayouts, textColors, bgColors**: Styling constants
- **AppMessageContext**: Ant Design message/modal/notification static exports

See [utils/README.md](./utils/README.md) for details.

## Importing

```typescript
// Import from main entry
import {
  // Table
  InfiniteVirtualTable,
  useTableManager,
  createPaginatedEntityStore,

  // Selection components
  SearchInput,
  ListItem,
  VirtualList,
  LoadMoreButton,
  Breadcrumb,

  // Presentational components
  VersionBadge,
  RevisionLabel,
  EntityPathLabel,
  EntityNameWithVersion,
  CopyButton,
  SectionCard,
  MetadataHeader,
  EditableText,

  // Modal
  EnhancedModal,
  ModalContent,
  ModalFooter,

  // Editor
  Editor,
  SharedEditor,
  DiffView,

  // Chat
  ChatMessageEditor,
  ChatMessageList,

  // LLM
  LLMIconMap,
  SelectLLMProviderBase,

  // Utilities
  copyToClipboard,
  cn,
  sizeClasses,
  flexLayouts,
  textColors,
  message,
  modal,
  notification,
} from '@agenta/ui'
```

## Adding New Features

### Table-related features
Add to `InfiniteVirtualTable/` in the appropriate subfolder:
- New hooks → `hooks/`
- New components → `components/`
- New store factories → `helpers/` or `paginated/`

### Presentational components

Add to `components/presentational/` with its own subfolder if needed.

### Generic utilities
Add to `utils/` and export from `index.ts`.

### New major modules
Create a new folder at the `src/` level with its own README and export from `index.ts`.
