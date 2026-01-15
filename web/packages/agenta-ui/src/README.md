# @agenta/ui Source Structure

This package provides shared UI components, hooks, and utilities for building data-intensive interfaces.

## Folder Structure

```
src/
├── components/              # Reusable UI components
│   ├── selection/           # Selection UI components
│   │   ├── SearchInput.tsx       # Search input with clear button
│   │   ├── ListItem.tsx          # Generic list item (click/navigate)
│   │   ├── VirtualList.tsx       # Virtualized list with @tanstack/react-virtual
│   │   ├── LoadMoreButton.tsx    # Pagination "Load more" button
│   │   ├── LoadAllButton.tsx     # "Load all" button with progress
│   │   ├── Breadcrumb.tsx        # Navigation breadcrumb
│   │   └── index.ts
│   ├── presentational/      # Pure display components
│   │   ├── version/         # Version badge components
│   │   ├── revision/        # Revision label components
│   │   ├── entity/          # Entity name/path components
│   │   └── index.ts
│   ├── EnhancedModal.tsx    # Modal wrapper with lazy rendering
│   └── index.ts
├── InfiniteVirtualTable/   # High-performance virtualized table
│   ├── atoms/              # Jotai atoms for column state
│   ├── columns/            # Column creation utilities
│   ├── components/         # UI components
│   │   ├── common/         # Shared components (ResizableTitle, SkeletonCell)
│   │   ├── columnVisibility/  # Column visibility controls
│   │   └── filters/        # Filter components
│   ├── context/            # React contexts
│   ├── features/           # Feature shell and pagination
│   ├── helpers/            # Store creation utilities
│   ├── hooks/              # React hooks
│   ├── paginated/          # Paginated entity store factory
│   ├── providers/          # Context providers
│   └── utils/              # Internal utilities
├── utils/                  # Generic utilities
│   ├── copyToClipboard.ts  # Clipboard utility
│   ├── styles.ts           # Styling utilities (cn, sizeClasses, etc.)
│   └── README.md
└── index.ts                # Main exports
```

## Design Principles

1. **Single Responsibility** - Each folder has a clear purpose
2. **Colocation** - Related code lives together (e.g., paginated is inside InfiniteVirtualTable)
3. **Minimal Root** - Only generic utilities at the root level
4. **Documentation** - Each major folder has its own README

## Main Modules

### Components

Reusable UI components organized by domain:

#### Selection Components (`components/selection/`)

Building blocks for list selection UIs:
- **SearchInput**: Search input with clear button and keyboard support
- **ListItem**: Generic list item with click/navigate variants
- **VirtualList**: Virtualized list using @tanstack/react-virtual
- **LoadMoreButton**: Pagination button with count display
- **LoadAllButton**: Load all pages with progress indicator
- **Breadcrumb**: Navigation breadcrumb with back button

```tsx
import { SearchInput, ListItem, VirtualList, LoadMoreButton, Breadcrumb } from '@agenta/ui'
```

#### Presentational Components (`components/presentational/`)

Pure display components for entity information:
- **VersionBadge**: Version number in "vX" format
- **RevisionLabel**: Revision details (version, date, message, author)
- **EntityPathLabel**: Hierarchical paths ("App / Variant / v1")
- **EntityNameWithVersion**: Entity name with version badge

```tsx
import { VersionBadge, RevisionLabel, EntityPathLabel, EntityNameWithVersion } from '@agenta/ui'
```

#### Modal Components

- **EnhancedModal**: Modal wrapper with lazy rendering, auto-height, and smart style merging

```tsx
import { EnhancedModal } from '@agenta/ui'
```

### InfiniteVirtualTable

The core table component with:
- Virtual scrolling for large datasets
- Infinite loading with cursor pagination
- Column management (resize, visibility, reorder)
- Row selection and expansion
- Paginated entity store factory

See [InfiniteVirtualTable/README.md](./InfiniteVirtualTable/README.md) for details.

### Utilities

Generic utilities:
- **copyToClipboard**: Clipboard operations
- **cn**: Class name concatenation utility
- **sizeClasses, flexLayouts, textColors**: Styling constants

```tsx
import { copyToClipboard, cn, sizeClasses, flexLayouts, textColors } from '@agenta/ui'
```

See [utils/README.md](./utils/README.md) for details.

## Importing

```typescript
// Import everything from main entry
import {
  // Table
  InfiniteVirtualTable,
  useTableManager,

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

  // Modal
  EnhancedModal,

  // Utilities
  copyToClipboard,
  cn,
  sizeClasses,
  flexLayouts,
  textColors,
} from '@agenta/ui'
```

## Adding New Features

### Table-related features
Add to `InfiniteVirtualTable/` in the appropriate subfolder:
- New hooks → `hooks/`
- New components → `components/`
- New atoms → `atoms/`

### Generic utilities
Add to `utils/` and export from `index.ts`.

### New major components
Create a new folder at the `src/` level with its own README and export from `index.ts`.
