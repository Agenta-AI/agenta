# Entity Selection Components

UI components for entity selection built on top of the unified hooks and adapters.

## Overview

The entity selection system provides a **single unified component** with multiple display variants:

| Component | Description |
|-----------|-------------|
| `EntityPicker` | Unified component with `variant` prop for different UIs |
| `EntitySelectorModal` | Modal wrapper with tabs for multiple entity types |

## EntityPicker

The unified picker component that renders differently based on the `variant` prop.

### Variants

| Variant | Description | Use Case |
|---------|-------------|----------|
| `cascading` | Cascading `Select` dropdowns | Inline forms, compact space |
| `breadcrumb` | Breadcrumb navigation with list | Modal/drawer, full selection |
| `list-popover` | Parent list with hover popovers | Sidebars, 2-level hierarchies |

### Basic Usage

```tsx
import { EntityPicker, type AppRevisionSelectionResult } from '@agenta/entities/ui'

// Cascading dropdowns
<EntityPicker<AppRevisionSelectionResult>
  variant="cascading"
  adapter="appRevision"
  onSelect={handleSelect}
/>

// Breadcrumb navigation
<EntityPicker<AppRevisionSelectionResult>
  variant="breadcrumb"
  adapter="appRevision"
  onSelect={handleSelect}
  showSearch
  showBreadcrumb
  rootLabel="All Apps"
/>

// List with popovers
<EntityPicker<TestsetSelectionResult>
  variant="list-popover"
  adapter="testset"
  onSelect={handleSelect}
  autoSelectLatest
/>
```

### Base Props (All Variants)

```typescript
interface EntityPickerBaseProps<TSelection> {
  /** The adapter defining the entity hierarchy */
  adapter: EntitySelectionAdapter<TSelection> | string

  /** Callback when an entity is selected */
  onSelect?: (selection: TSelection) => void

  /** Instance ID for state isolation */
  instanceId?: string

  /** Show search input */
  showSearch?: boolean

  /** Empty message when no items */
  emptyMessage?: string

  /** Loading message */
  loadingMessage?: string

  /** Additional CSS class */
  className?: string

  /** Disabled state */
  disabled?: boolean
}
```

### Cascading Variant Props

```typescript
interface CascadingVariantProps<TSelection> extends EntityPickerBaseProps<TSelection> {
  variant: "cascading"

  /** Override auto-select per level */
  autoSelectByLevel?: (boolean | undefined)[]

  /** Show labels above each select */
  showLabels?: boolean

  /** Layout direction */
  layout?: "horizontal" | "vertical"

  /** Gap between selects */
  gap?: number

  /** Select size */
  size?: "small" | "middle" | "large"

  /** Show auto-selected indicator */
  showAutoIndicator?: boolean
}
```

### Breadcrumb Variant Props

```typescript
interface BreadcrumbVariantProps<TSelection> extends EntityPickerBaseProps<TSelection> {
  variant: "breadcrumb"

  /** Override auto-select per level */
  autoSelectByLevel?: (boolean | undefined)[]

  /** Show breadcrumb navigation */
  showBreadcrumb?: boolean

  /** Show back button */
  showBackButton?: boolean

  /** Root label for breadcrumb */
  rootLabel?: string

  /** Max height for list */
  maxHeight?: number | string

  /** Auto-select single option */
  autoSelectSingle?: boolean

  /** Enable infinite scroll */
  infiniteScroll?: boolean

  /** Page size for infinite scroll */
  pageSize?: number

  /** Show load more button (instead of auto-load) */
  loadMoreButton?: boolean

  /** Show load all button */
  showLoadAll?: boolean

  /** Estimated item height for virtual list */
  estimatedItemHeight?: number
}
```

### List-Popover Variant Props

```typescript
interface ListPopoverVariantProps<TSelection> extends EntityPickerBaseProps<TSelection> {
  variant: "list-popover"

  /** Currently selected parent ID */
  selectedParentId?: string | null

  /** Currently selected child ID */
  selectedChildId?: string | null

  /** Auto-select first parent's first/latest child on mount */
  autoSelectFirst?: boolean
  autoSelectLatest?: boolean

  /** Select latest child when clicking a parent */
  selectLatestOnParentClick?: boolean

  /** Set of disabled parent IDs */
  disabledParentIds?: Set<string>

  /** Set of disabled child IDs */
  disabledChildIds?: Set<string>

  /** Tooltip for disabled items */
  disabledTooltip?: string
  disabledChildTooltip?: string

  /** Popover placement */
  popoverPlacement?: "right" | "rightTop" | "rightBottom"

  /** Popover trigger */
  popoverTrigger?: "hover" | "click"

  /** Max height for list */
  maxHeight?: number | string

  /** Callback when parent is hovered */
  onParentHover?: (parentId: string) => void
}
```

## EntitySelectorModal

A modal component for selecting entities, with optional tab navigation for multiple entity types.

### Usage with Hook

```tsx
import { useEntitySelector } from '@agenta/entities/ui'

function MyComponent() {
  const { open } = useEntitySelector()

  const handleAdd = async () => {
    const selection = await open({
      title: 'Select Entity',
      allowedTypes: ['appRevision', 'evaluatorRevision'],
    })

    if (selection) {
      console.log('Selected:', selection.type, selection.id)
    }
  }

  return <button onClick={handleAdd}>Add Entity</button>
}
```

### Direct Usage

```tsx
import { EntitySelectorModal } from '@agenta/entities/ui'

function MyModal({ open, onClose }) {
  return (
    <EntitySelectorModal
      open={open}
      title="Select an App Revision"
      allowedTypes={['appRevision']}
      onSelect={(selection) => {
        console.log('Selected:', selection)
        onClose()
      }}
      onCancel={onClose}
    />
  )
}
```

### Props

```typescript
interface EntitySelectorModalProps {
  /** Modal visibility */
  open?: boolean

  /** Cancel callback */
  onCancel?: () => void

  /** Selection callback */
  onSelect?: (selection: EntitySelectionResult) => void

  /** Allowed entity types (creates tabs) */
  allowedTypes?: SelectableEntityType[]

  /** Modal title */
  title?: string

  /** Additional modal width */
  width?: number
}
```

## Primitive Components

> **Note:** Primitive components are available from `@agenta/ui` for direct import,
> or from `@agenta/entities/ui` as a convenience re-export.
>
> ```typescript
> // Direct import from @agenta/ui
> import { SearchInput, EntityListItem, VirtualEntityList, EntityBreadcrumb } from '@agenta/ui'
>
> // Or via @agenta/entities/ui (re-export)
> import { SearchInput, EntityListItem, VirtualEntityList, EntityBreadcrumb } from '@agenta/entities/ui'
> ```

Building blocks for custom implementations:

### EntityBreadcrumb

Displays the current navigation path with clickable items.

```tsx
import { EntityBreadcrumb } from '@agenta/entities/ui'

<EntityBreadcrumb
  path={[
    { id: '1', label: 'My App' },
    { id: '2', label: 'default' },
  ]}
  onNavigate={(level) => console.log('Navigate to level:', level)}
  rootLabel="Home"
/>
```

### EntityListItem

A single selectable item with optional children indicator.

```tsx
import { EntityListItem } from '@agenta/entities/ui'

<EntityListItem
  label="My App"
  labelNode={<CustomLabel />}  // Optional rich label
  hasChildren={true}
  isSelectable={true}
  isSelected={false}
  isHovered={false}
  onClick={() => navigateDown(item)}
  onSelect={() => select(item)}
/>
```

### SearchInput

Debounced search input.

```tsx
import { SearchInput } from '@agenta/entities/ui'

<SearchInput
  value={searchTerm}
  onChange={setSearchTerm}
  placeholder="Search apps..."
  disabled={false}
/>
```

### VirtualEntityList

Virtual scrolling list for large datasets.

```tsx
import { VirtualEntityList } from '@agenta/entities/ui'

<VirtualEntityList
  items={items}
  renderItem={(item, index) => <EntityListItem key={item.id} ... />}
  maxHeight={400}
  estimateSize={48}
  onEndReached={fetchNextPage}
  endReachedThreshold={200}
  hasMore={hasNextPage}
  isFetchingMore={isFetchingNextPage}
/>
```

### LoadMoreButton / LoadAllButton

Pagination buttons for large lists.

```tsx
import { LoadMoreButton, LoadAllButton } from '@agenta/entities/ui'

<LoadMoreButton
  onClick={fetchNextPage}
  isLoading={isFetchingNextPage}
  hasMore={hasNextPage}
/>

<LoadAllButton
  onLoadAll={loadAllPages}
  isLoading={isLoadingAll}
  hasMore={hasNextPage}
  totalCount={totalCount}
/>
```

## Shared Components (UnifiedEntityPicker)

Internal shared components used by the variant implementations:

### LevelSelect

Renders a single level as an Ant Design `Select`:

```tsx
import { LevelSelect } from '@agenta/entities/ui'

<LevelSelect
  level={levelState}
  onChange={handleChange}
  showLabel
  size="middle"
/>
```

### ChildPopoverContent

Renders children in a popover:

```tsx
import { ChildPopoverContent } from '@agenta/entities/ui'

<ChildPopoverContent
  parentId={parent.id}
  parentLabel={parent.label}
  childLevelConfig={childLevelConfig}
  selectedChildId={selectedChildId}
  disabledChildIds={disabledChildIds}
  disabledChildTooltip="Already connected"
  onSelect={handleChildSelect}
/>
```

### AutoSelectHandler

Invisible component that triggers auto-selection:

```tsx
import { AutoSelectHandler } from '@agenta/entities/ui'

{autoSelectingParent && (
  <AutoSelectHandler
    parentId={autoSelectingParent.id}
    parentLabel={autoSelectingParent.label}
    parentLevelConfig={parentLevelConfig}
    childLevelConfig={childLevelConfig}
    createSelection={adapter.toSelection}
    onSelect={onSelect}
    onComplete={() => setAutoSelectingParent(null)}
  />
)}
```

## Styling

All components use Tailwind CSS classes and are designed to work with Ant Design's theme system.

To customize, use the `className` prop or override via CSS.

## State Isolation

Components support `instanceId` for state isolation:

```tsx
// Two pickers with independent state
<EntityPicker adapter="appRevision" variant="cascading" instanceId="picker-1" />
<EntityPicker adapter="appRevision" variant="cascading" instanceId="picker-2" />
```

## Files

```
components/
├── index.ts                    # Re-exports all components
├── README.md                   # This file
├── EntitySelectorModal.tsx     # Modal component
├── hooks/
│   └── useEntitySelector.ts    # Modal hook
└── UnifiedEntityPicker/
    ├── index.ts                # Re-exports
    ├── UnifiedEntityPicker.tsx # Main component with variant switch
    ├── types.ts                # Props types
    ├── variants/
    │   ├── CascadingVariant.tsx
    │   ├── BreadcrumbVariant.tsx
    │   └── ListPopoverVariant.tsx
    └── shared/
        ├── LevelSelect.tsx
        ├── ChildPopoverContent.tsx
        └── AutoSelectHandler.tsx
```
