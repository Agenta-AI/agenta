## EnhancedTable

A powerful table component extending Ant Design's Table with enhanced features like resizable columns, collapsible groups, and virtualization.

## Props

- `columns`: Array of `EnhancedColumnType` (required)
- `skeletonRowCount`: Number of skeleton rows to show when loading (default: 5)
- `addNotAvailableCell`: Show not available cell for empty values (default: true)
- `virtualized`: Enable virtualized rendering (default: false)
- `uniqueKey`: Unique identifier for persisting table state (required)
- All other Ant Design Table props are supported

## Features

- **Resizable Columns**: Drag to resize column widths
- **Collapsible Groups**: Collapse/expand column groups
- **Aggregated Data on Collapse**: Optionally render aggregated content when columns are collapsed
- **Skeleton Loading**: Built-in loading states
- **Virtualization**: Optimized rendering for large datasets
- **Persistent State**: Saves column widths and collapse on local-storage
- **Responsive**: Adapts to container size

## Usage

```tsx
import {EnhancedTable} from "./EnhancedUIs/Table"

const columns = [
    {
        title: "Name",
        dataIndex: "name",
        width: 200,
        isSkeleton: false,
        // Disable not-available cell just for this column (overrides table default)
        addNotAvailableCell: false,
    },
    {
        title: "Details",
        collapsible: true,
        // Enable not-available cell for the group when collapsed (inherits table default otherwise)
        addNotAvailableCell: true,
        // Render a summary when collapsed
        renderAggregatedData: ({record}) => `Age: ${record.age}, Address: ${record.address}`,
        children: [
            {title: "Age", dataIndex: "age"},
            {title: "Address", dataIndex: "address"},
        ],
    },
]

return (
    <EnhancedTable
        columns={columns}
        dataSource={data}
        loading={isLoading}
        uniqueKey="user-table"
        virtualized={true}
    />
)
```
