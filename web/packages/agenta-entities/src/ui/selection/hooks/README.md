# Entity Selection Hooks

Primitive hooks for building custom entity selection UIs. These hooks handle data fetching, navigation state, and selection logic.

## Overview

| Hook | Purpose |
|------|---------|
| `useHierarchicalSelection` | Navigate through entity hierarchy, manage breadcrumbs |
| `useEntityList` | Fetch and filter entity lists with search |
| `useMultiSelect` | Handle multiple selections with toggle logic |
| `useLazyChildren` | Lazy-load child options for cascaders |

## useHierarchicalSelection

The primary hook for navigating hierarchical entity structures. Powers `EntityPicker` internally.

### Usage

```typescript
import { useHierarchicalSelection, appRevisionAdapter } from '@agenta/entities/ui'

function CustomHierarchyBrowser() {
  const {
    // Navigation state
    breadcrumb,           // SelectionPathItem[] - current path
    currentLevel,         // number - current depth
    items,                // unknown[] - entities at current level
    isLoading,            // boolean
    isAtRoot,             // boolean - at top level?
    isAtLeaf,             // boolean - at selectable level?

    // Search
    searchTerm,           // string
    setSearchTerm,        // (term: string) => void

    // Navigation actions
    navigateDown,         // (entity) => void - drill into entity
    navigateUp,           // () => void - go back one level
    navigateToLevel,      // (level: number) => void - jump to breadcrumb
    reset,                // () => void - back to root

    // Selection
    select,               // (entity) => void - trigger onSelect
    canNavigateDown,      // (entity) => boolean
    canSelect,            // (entity) => boolean
    isDisabled,           // (entity) => boolean

    // Config
    currentLevelConfig,   // HierarchyLevel | null
    adapter,              // resolved adapter
  } = useHierarchicalSelection({
    adapter: appRevisionAdapter,
    instanceId: 'my-browser',
    onSelect: (selection) => console.log('Selected:', selection),
    autoSelectSingle: true,  // Auto-select when only 1 option
  })

  return (
    <div>
      {/* Breadcrumb */}
      <nav>
        <button onClick={reset}>Home</button>
        {breadcrumb.map((item, i) => (
          <button key={item.id} onClick={() => navigateToLevel(i + 1)}>
            {item.label}
          </button>
        ))}
      </nav>

      {/* Search */}
      <input
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        placeholder="Search..."
      />

      {/* Items */}
      {isLoading ? (
        <Spinner />
      ) : (
        <ul>
          {items.map((item) => {
            const id = currentLevelConfig?.getId(item)
            const label = currentLevelConfig?.getLabel(item)

            return (
              <li key={id}>
                <span>{label}</span>
                {canNavigateDown(item) && (
                  <button onClick={() => navigateDown(item)}>→</button>
                )}
                {canSelect(item) && (
                  <button onClick={() => select(item)}>Select</button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
```

### Options

```typescript
interface UseHierarchicalSelectionOptions<TSelection> {
  adapter: EntitySelectionAdapter<TSelection> | string
  instanceId: string                    // Unique ID for state isolation
  onSelect?: (selection: TSelection) => void
  autoSelectSingle?: boolean            // Default: false
  initialPath?: SelectionPathItem[]     // Restore from saved state
}
```

## useEntityList

Fetches and filters entity lists. Used internally by `useHierarchicalSelection`.

### Usage

```typescript
import { useEntityList } from '@agenta/entities/ui'

function EntityListComponent() {
  const {
    items,        // unknown[] - filtered items
    isLoading,    // boolean
    error,        // Error | null
    searchTerm,   // string
    setSearchTerm // (term: string) => void
  } = useEntityList({
    listAtom: myListAtom,  // Atom<ListQueryState<T>>
    instanceId: 'my-list',
  })

  return (
    <div>
      <input
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
      />
      {items.map((item) => (
        <div key={item.id}>{item.name}</div>
      ))}
    </div>
  )
}
```

## useMultiSelect

Manages multi-selection state with toggle, select all, and limit functionality.

### Usage

```typescript
import { useMultiSelect } from '@agenta/entities/ui'

interface Item {
  id: string
  name: string
}

function MultiSelectList({ items }: { items: Item[] }) {
  const {
    selectedItems,    // Item[] - currently selected
    isSelected,       // (item: Item) => boolean
    toggle,           // (item: Item) => void
    selectAll,        // (items: Item[]) => void
    clearAll,         // () => void
    canSelectMore,    // boolean - under max limit?
  } = useMultiSelect<Item>({
    getId: (item) => item.id,
    maxSelections: 10,
    onChange: (selections) => console.log('Selected:', selections),
  })

  return (
    <div>
      <button onClick={clearAll}>Clear</button>
      <button onClick={() => selectAll(items)} disabled={!canSelectMore}>
        Select All
      </button>

      {items.map((item) => (
        <label key={item.id}>
          <input
            type="checkbox"
            checked={isSelected(item)}
            onChange={() => toggle(item)}
            disabled={!isSelected(item) && !canSelectMore}
          />
          {item.name}
        </label>
      ))}

      <p>{selectedItems.length} selected</p>
    </div>
  )
}
```

### Options

```typescript
interface UseMultiSelectOptions<T> {
  getId: (item: T) => string
  maxSelections?: number        // undefined = unlimited
  initialSelection?: T[]
  onChange?: (items: T[]) => void
}
```

## useLazyChildren

Lazy-loads child options for cascader-style components. Converts adapter hierarchy to Ant Design Cascader format.

### Usage

```typescript
import { useLazyChildren, testsetAdapter } from '@agenta/entities/ui'

function LazyCascader() {
  const {
    options,      // CascaderOption[] - current options tree
    loadChildren, // (selectedOptions: any[]) => Promise<void>
    isLoading,    // boolean
  } = useLazyChildren({
    adapter: testsetAdapter,
    instanceId: 'my-cascader',
  })

  return (
    <Cascader
      options={options}
      loadData={loadChildren}
      loading={isLoading}
      onChange={(value, selectedOptions) => {
        console.log('Selected:', value, selectedOptions)
      }}
    />
  )
}
```

## State Isolation

All hooks use `instanceId` to isolate state between multiple instances. This allows:
- Multiple selectors on the same page
- Independent navigation state per component
- No cross-contamination of search terms or paths

```typescript
// These two instances have completely separate state
const picker1 = useHierarchicalSelection({
  adapter: 'appRevision',
  instanceId: 'picker-1',
})

const picker2 = useHierarchicalSelection({
  adapter: 'appRevision',
  instanceId: 'picker-2',
})
```

## Files

- `index.ts` - Re-exports all hooks
- `useHierarchicalSelection.ts` - Hierarchy navigation hook
- `useEntityList.ts` - List fetching and filtering
- `useMultiSelect.ts` - Multi-selection management
- `useLazyChildren.ts` - Lazy loading for cascaders
