# InfiniteVirtualTable

High-performance virtualized table component with infinite scroll, designed for data-intensive interfaces.

## Features

- **Virtual Scrolling** - Efficiently renders only visible rows, supporting thousands of rows
- **Infinite Loading** - Cursor-based pagination with automatic loading
- **Column Management** - Resizable columns, visibility controls, reordering
- **Row Selection** - Single and multi-select with keyboard support
- **Expandable Rows** - Nested content with custom expansion
- **Row Height Control** - Small, medium, large presets
- **Export Support** - CSV/JSON export with custom column resolution
- **Editable Tables** - Inline editing support with validation

## Structure

```
InfiniteVirtualTable/
├── atoms/              # Jotai atoms for column state
├── columns/            # Column creation utilities
│   ├── cells.tsx       # Cell renderer factories
│   ├── createTableColumns.ts
│   └── createStandardColumns.tsx
├── components/         # UI components
│   ├── common/         # Shared components (SkeletonLine, ResizableTitle)
│   ├── columnVisibility/  # Column visibility controls
│   └── filters/        # Filter components
├── context/            # React contexts
├── features/           # Feature shell and pagination
├── helpers/            # Store creation utilities
├── hooks/              # React hooks
├── paginated/          # Paginated entity store factory
├── providers/          # Context providers
└── utils/              # Internal utilities
```

## Quick Start

### Basic Table

```tsx
import {
  InfiniteVirtualTable,
  useTableManager,
  createTableColumns,
} from '@agenta/ui'

function MyTable() {
  const columns = useMemo(() => createTableColumns<MyRow>([
    { key: 'name', title: 'Name', width: 200 },
    { key: 'status', title: 'Status', width: 100 },
  ]), [])

  const tableManager = useTableManager({
    tableKey: 'my-table',
    columns,
    fetchData: async ({ cursor, limit }) => {
      const data = await fetchMyData({ cursor, limit })
      return {
        rows: data.items,
        nextCursor: data.nextCursor,
        hasMore: data.hasMore,
      }
    },
  })

  return <InfiniteVirtualTable manager={tableManager} />
}
```

### Paginated Entity Store

For entity controllers that need paginated data:

```tsx
import { createPaginatedEntityStore } from '@agenta/ui'

export const myEntityPaginatedStore = createPaginatedEntityStore({
  entityName: 'myEntity',
  metaAtom: myEntityMetaAtom,
  fetchPage: async ({ meta, limit, cursor }) => {
    return await fetchMyEntities({
      projectId: meta.projectId,
      limit,
      cursor,
    })
  },
  rowConfig: {
    getRowId: (row) => row.id,
    skeletonDefaults: { id: '', name: '' },
  },
})
```

## Main Exports

### Components

- `InfiniteVirtualTable` - Main table component
- `InfiniteVirtualTableFeatureShell` - Feature-rich table wrapper with tabs, delete, export
- `TableShell` - Table wrapper with toolbar
- `TableDescription` - Table description component
- `ColumnVisibilityTrigger` - Column visibility dropdown
- `ColumnVisibilityPopoverContent` - Column visibility popover content
- `ColumnVisibilityHeader` - Column visibility header
- `ColumnVisibilityProvider` - Column visibility context provider
- `FiltersPopoverTrigger` - Filter controls
- `SkeletonLine` - Skeleton loading line
- `ResizableTitle` - Resizable column header

### Hooks
- `useTableManager` - Complete table state management
- `useTableActions` - Action handlers (delete, export)
- `useRowHeight` - Row height controls
- `useExpandableRows` - Expandable row state
- `useEditableTable` - Inline editing
- `useTableExport` - Table export functionality
- `useEntityTableState` - Entity table state management
- `useColumnVisibilityControls` - Column visibility controls
- `useColumnVisibilityContext` - Column visibility context

### Factories
- `createTableColumns` - Column definition factory
- `createStandardColumns` - Standard column presets (text, date, user, actions)
- `createPaginatedEntityStore` - Entity pagination with controller pattern
- `createSimpleTableStore` - Basic table store
- `createInfiniteTableStore` - Infinite scroll table store
- `createInfiniteDatasetStore` - Infinite dataset store
- `createTableRowHelpers` - Row helper utilities
- `createRowHeightAtom` - Row height atom factory

### Cell Factories
- `createTextCell` - Text cell renderer
- `createComponentCell` - Custom component cell
- `createStatusCell` - Status cell renderer
- `createActionsCell` - Actions cell renderer
- `createViewportAwareCell` - Viewport-aware cell (lazy rendering)
- `createColumnVisibilityAwareCell` - Column visibility-aware cell

### Types

- `InfiniteTableRowBase` - Base row type
- `InfiniteVirtualTableProps` - Table component props
- `PaginatedEntityStore` - Paginated store type
- `TableColumnConfig` - Column configuration type
- `ExpandableRowConfig` - Expandable row configuration
- `ColumnVisibilityState` - Column visibility state type

## Internal Implementation

The following are **internal implementation details** and are NOT exported:
- `atoms/columnVisibility.ts` - Internal column visibility state atoms
- `atoms/columnWidths.ts` - Internal column width state atoms
- `atoms/columnHiddenKeys.ts` - Internal hidden keys state atoms

These atoms are used internally by the table components and should not be accessed directly.
