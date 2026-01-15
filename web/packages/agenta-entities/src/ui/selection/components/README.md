# Entity Selection Components

Ready-to-use UI components for entity selection. Built on top of the primitive hooks and adapters.

## Overview

| Component | Description | Use Case |
|-----------|-------------|----------|
| `EntityPicker` | Inline hierarchical list | Sidebars, drawers, embedded selection |
| `EntityCascader` | Ant Design Cascader wrapper | Form fields, compact selectors |
| `EntitySelectorModal` | Modal with tabs | Full-screen selection, multiple entity types |

## EntityPicker

An inline hierarchical picker with breadcrumb navigation, search, and back button.

### Usage

```tsx
import { EntityPicker, type AppRevisionSelectionResult } from '@agenta/entities/ui'

function AppSelector() {
  return (
    <EntityPicker<AppRevisionSelectionResult>
      adapter="appRevision"
      onSelect={(selection) => {
        console.log('Selected:', selection.metadata.appName)
      }}
      showSearch
      showBreadcrumb
      showBackButton
      rootLabel="All Apps"
      emptyMessage="No apps available"
      maxHeight={400}
      autoSelectSingle  // Auto-select when only 1 option
    />
  )
}
```

### Props

```typescript
interface EntityPickerProps<TSelection> {
  // Required
  adapter: EntitySelectionAdapter<TSelection> | string
  onSelect?: (selection: TSelection) => void

  // Navigation UI
  showSearch?: boolean        // Default: true
  showBreadcrumb?: boolean    // Default: true
  showBackButton?: boolean    // Default: true
  rootLabel?: string          // Label for root in breadcrumb

  // Display
  emptyMessage?: string
  loadingMessage?: string
  maxHeight?: number | string
  className?: string

  // Behavior
  autoSelectSingle?: boolean  // Auto-select when 1 option
  instanceId?: string         // For state isolation
}
```

## EntityCascader

Wraps Ant Design's Cascader component with adapter-based data loading.

### Usage

```tsx
import { EntityCascader, type TestsetSelectionResult } from '@agenta/entities/ui'

function TestsetField() {
  const [value, setValue] = useState<string[]>([])

  return (
    <EntityCascader<TestsetSelectionResult>
      adapter="testset"
      value={value}
      onChange={(path, selection) => {
        setValue(path)
        if (selection) {
          console.log('Selected revision:', selection.metadata.revisionId)
        }
      }}
      placeholder="Select testset and revision"
      showSearch
      allowClear
      expandTrigger="hover"
      style={{ width: 300 }}
    />
  )
}
```

### Props

```typescript
interface EntityCascaderProps<TSelection> {
  // Required
  adapter: EntitySelectionAdapter<TSelection> | string

  // Controlled value
  value?: string[]
  onChange?: (path: string[], selection: TSelection | null) => void

  // Cascader options
  placeholder?: string
  showSearch?: boolean
  allowClear?: boolean
  expandTrigger?: 'click' | 'hover'
  disabled?: boolean

  // Styling
  style?: React.CSSProperties
  className?: string
  size?: 'small' | 'middle' | 'large'

  // State isolation
  instanceId?: string
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
interface EntitySelectorModalProps<TSelection> {
  // Modal state
  open: boolean
  onCancel?: () => void

  // Selection
  allowedTypes?: SelectableEntityType[]
  onSelect?: (selection: TSelection) => void

  // Modal options
  title?: string
  width?: number
  destroyOnClose?: boolean
}
```

## Primitive Components

> **Note:** Primitive components are available from `@agenta/ui` for direct import,
> or from `@agenta/entities/ui` as a convenience re-export.
>
> ```typescript
> // Direct import from @agenta/ui
> import { SearchInput, ListItem, VirtualList, Breadcrumb, LoadMoreButton, LoadAllButton } from '@agenta/ui'
>
> // Or via @agenta/entities/ui (re-export)
> import { SearchInput, EntityListItem, VirtualEntityList, EntityBreadcrumb } from '@agenta/entities/ui'
> ```

Building blocks for custom implementations, located in `primitives/`.

### EntityBreadcrumb

Displays the current navigation path with clickable items.

```tsx
import { EntityBreadcrumb } from '@agenta/entities/ui'

<EntityBreadcrumb
  path={[
    { type: 'app', id: '1', label: 'My App' },
    { type: 'variant', id: '2', label: 'default' },
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
  description="Production variant"
  icon={<AppIcon />}
  hasChildren={true}
  isSelectable={false}
  onClick={() => navigateDown(item)}
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
  autoFocus
/>
```

## Styling

All components use Tailwind CSS classes and are designed to work with Ant Design's theme system. Key classes:

- Container: `flex flex-col`
- Items: `space-y-1`
- Hover states: Standard Ant Design hover colors

To customize, use the `className` prop or override via CSS.

## State Isolation

Components support `instanceId` for state isolation:

```tsx
// Two pickers with independent state
<EntityPicker adapter="appRevision" instanceId="picker-1" />
<EntityPicker adapter="appRevision" instanceId="picker-2" />
```

## Files

- `index.ts` - Re-exports all components
- `EntityPicker.tsx` - Inline hierarchical picker
- `EntityCascader.tsx` - Ant Cascader wrapper
- `EntitySelectorModal.tsx` - Modal component
- `useEntitySelector.ts` - Modal hook
- `primitives/` - Building block components
  - `EntityBreadcrumb.tsx`
  - `EntityListItem.tsx`
  - `SearchInput.tsx`
