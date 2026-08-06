# Entity Selection Hooks

Unified hooks for building entity selection UIs. These hooks handle data fetching, navigation state, and selection logic for different display modes.

## Overview

The hooks are organized into three **mode-specific** hooks that power the `EntityPicker` variants:

| Hook | Mode | Use Case |
|------|------|----------|
| `useCascadingMode` | Cascading | Multiple dropdowns side-by-side |
| `useBreadcrumbMode` | Breadcrumb | Drill-down with back navigation |
| `useListPopoverMode` | List-Popover | Parent list with child popovers |

Additionally, there's a unified entry point:

| Hook | Purpose |
|------|---------|
| `useEntitySelection` | Auto-selects mode based on options |
| `useEntitySelectionCore` | Low-level core hook (internal) |

## useCascadingMode

Powers the cascading dropdown variant. Manages multiple levels with auto-selection.

### Usage

```typescript
import { useCascadingMode, type AppRevisionSelectionResult } from '@agenta/entity-ui'

function CascadingSelector() {
  const {
    // Level state
    levels,              // CascadingLevelState[] - state for each level
    isComplete,          // boolean - all levels have selections

    // Selection
    selection,           // TSelection | null - current complete selection

    // Config
    adapter,             // Resolved adapter
  } = useCascadingMode<AppRevisionSelectionResult>({
    adapter: 'appRevision',
    instanceId: 'my-cascading',
    onSelect: (selection) => console.log('Selected:', selection),
    autoSelectByLevel: [true, true, false],  // Auto-select first 2 levels
  })

  return (
    <div className="flex gap-2">
      {levels.map((level) => (
        <Select
          key={level.config.type}
          value={level.selectedId}
          onChange={(id) => level.setSelectedId(id)}
          loading={level.isLoading}
          options={level.items.map(item => ({
            value: level.config.getId(item),
            label: level.config.getLabel(item),
          }))}
        />
      ))}
    </div>
  )
}
```

### Options

```typescript
interface UseCascadingModeOptions<TSelection> {
  /** Adapter name or instance */
  adapter: EntitySelectionAdapter<TSelection> | string

  /** Unique ID for state isolation */
  instanceId: string

  /** Callback when selection is complete */
  onSelect?: (selection: TSelection) => void

  /** Override auto-select per level */
  autoSelectByLevel?: (boolean | undefined)[]
}
```

### Return Value: CascadingLevelState

Each level in the `levels` array contains:

```typescript
interface CascadingLevelState {
  config: HierarchyLevel         // Level configuration
  items: unknown[]               // Available items
  isLoading: boolean             // Loading state
  error: Error | null            // Error state
  selectedId: string | null      // Currently selected ID
  selectedItem: unknown | null   // Currently selected item
  setSelectedId: (id: string | null) => void
  isAutoSelected: boolean        // Was auto-selected
  isDisabled: boolean            // Level disabled (no parent selection)
}
```

## useBreadcrumbMode

Powers the breadcrumb navigation variant. Shows one level at a time with path navigation.

### Usage

```typescript
import { useBreadcrumbMode, type AppRevisionSelectionResult } from '@agenta/entity-ui'

function BreadcrumbSelector() {
  const {
    // Navigation state
    breadcrumb,          // SelectionPathItem[] - current path
    items,               // unknown[] - items at current level
    isLoading,           // boolean
    error,               // Error | null
    isAtRoot,            // boolean - at top level?
    currentLevelConfig,  // HierarchyLevel | null
    currentLevelLabel,   // string - level name for display

    // Search
    searchTerm,          // string
    setSearchTerm,       // (term: string) => void

    // Navigation actions
    navigateDown,        // (entity) => void - drill into entity
    navigateUp,          // () => void - go back one level
    navigateToLevel,     // (level: number) => void - jump to breadcrumb
    reset,               // () => void - back to root

    // Selection
    select,              // (entity) => void - trigger onSelect
    canNavigateDown,     // (entity) => boolean
    canSelect,           // (entity) => boolean
    isDisabled,          // (entity) => boolean

    // Pagination (when paginated: true)
    hasNextPage,         // boolean
    isFetchingNextPage,  // boolean
    isLoadingAll,        // boolean
    fetchNextPage,       // () => void
    loadAllPages,        // () => void
    totalCount,          // number | null

    // Config
    adapter,             // Resolved adapter
  } = useBreadcrumbMode<AppRevisionSelectionResult>({
    adapter: 'appRevision',
    instanceId: 'my-breadcrumb',
    onSelect: (selection) => console.log('Selected:', selection),
    autoSelectSingle: true,
    paginated: true,
    pageSize: 50,
  })

  return (
    <div>
      {/* Breadcrumb */}
      <nav>
        <button onClick={reset}>Home</button>
        {breadcrumb.map((item, i) => (
          <button key={item.id} onClick={() => navigateToLevel(i)}>
            {item.label}
          </button>
        ))}
      </nav>

      {/* Search */}
      <input
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        placeholder={`Search ${currentLevelLabel}...`}
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

      {/* Load More */}
      {hasNextPage && (
        <button onClick={fetchNextPage} disabled={isFetchingNextPage}>
          Load More
        </button>
      )}
    </div>
  )
}
```

### Options

```typescript
interface UseBreadcrumbModeOptions<TSelection> {
  /** Adapter name or instance */
  adapter: EntitySelectionAdapter<TSelection> | string

  /** Unique ID for state isolation */
  instanceId: string

  /** Callback when selection is made */
  onSelect?: (selection: TSelection) => void

  /** Override auto-select per level */
  autoSelectByLevel?: (boolean | undefined)[]

  /** Auto-select when only one option */
  autoSelectSingle?: boolean

  /** Enable pagination */
  paginated?: boolean

  /** Page size for pagination */
  pageSize?: number
}
```

## useListPopoverMode

Powers the list-popover variant. Shows parent list with hover/click popovers for children.

### Usage

```typescript
import { useListPopoverMode, type TestsetSelectionResult } from '@agenta/entity-ui'

function ListPopoverSelector() {
  const {
    // Parent state
    parents,             // ListPopoverParentState[] - parent items with state
    parentLabel,         // string - parent level label
    parentLevelConfig,   // HierarchyLevel
    childLevelConfig,    // HierarchyLevel

    // Search
    searchTerm,          // string
    setSearchTerm,       // (term: string) => void

    // Popover control
    setOpenPopoverId,    // (id: string | null) => void

    // Handlers
    handleParentHover,   // (parentId: string) => void
    handleParentClick,   // (parent: unknown) => void
    handleChildSelect,   // (parentId, parentLabel, child) => void

    // Auto-selection
    autoSelectingParent, // { id, label } | null - parent being auto-selected

    // Loading
    isLoadingParents,    // boolean
    parentsError,        // Error | null

    // Config
    adapter,             // Resolved adapter
  } = useListPopoverMode<TestsetSelectionResult>({
    adapter: 'testset',
    instanceId: 'my-list',
    onSelect: (selection) => console.log('Selected:', selection),
    selectedParentId: currentTestsetId,
    selectedChildId: currentRevisionId,
    autoSelectLatest: true,
    selectLatestOnParentClick: true,
    disabledParentIds: new Set(['disabled-1']),
    disabledChildIds: new Set(['disabled-rev-1']),
  })

  return (
    <div>
      <input
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        placeholder={`Search ${parentLabel}...`}
      />

      {parents.map((parent) => (
        <Popover
          key={parent.id}
          open={parent.isPopoverOpen}
          onOpenChange={(open) => setOpenPopoverId(open ? parent.id : null)}
          content={
            <ChildList
              parentId={parent.id}
              onSelect={(child) => handleChildSelect(parent.id, parent.label, child)}
            />
          }
        >
          <div
            onMouseEnter={() => handleParentHover(parent.id)}
            onClick={() => handleParentClick(parent.entity)}
          >
            {parent.label}
            {parent.isSelected && '✓'}
          </div>
        </Popover>
      ))}
    </div>
  )
}
```

### Options

```typescript
interface UseListPopoverModeOptions<TSelection> {
  /** Adapter name or instance */
  adapter: EntitySelectionAdapter<TSelection> | string

  /** Unique ID for state isolation */
  instanceId: string

  /** Callback when selection is made */
  onSelect?: (selection: TSelection) => void

  /** Currently selected parent ID */
  selectedParentId?: string | null

  /** Currently selected child ID */
  selectedChildId?: string | null

  /** Auto-select first item on mount */
  autoSelectFirst?: boolean

  /** Auto-select latest item on mount */
  autoSelectLatest?: boolean

  /** Select latest child when clicking parent */
  selectLatestOnParentClick?: boolean

  /** Disabled parent IDs */
  disabledParentIds?: Set<string>

  /** Disabled child IDs */
  disabledChildIds?: Set<string>
}
```

### Return Value: ListPopoverParentState

Each parent in the `parents` array contains:

```typescript
interface ListPopoverParentState {
  id: string                     // Parent ID
  label: string                  // Display label
  labelNode?: ReactNode          // Optional rich label
  entity: unknown                // Original entity
  isSelected: boolean            // Is this parent selected
  isDisabled: boolean            // Is this parent disabled
  isPopoverOpen: boolean         // Is popover currently open
}
```

## useEntitySelection

Unified entry point that auto-selects the appropriate mode based on options.

### Usage

```typescript
import { useEntitySelection } from '@agenta/entity-ui'

// Auto-detects mode based on options
const result = useEntitySelection({
  adapter: 'appRevision',
  instanceId: 'my-selector',
  onSelect: handleSelect,

  // Mode is inferred from options:
  // - If autoSelectByLevel provided → cascading mode
  // - If selectedParentId/selectedChildId provided → list-popover mode
  // - Otherwise → breadcrumb mode
})
```

## Utility Hooks

### useChildrenData

Fetches children data for a parent entity.

```typescript
import { useChildrenData } from '@agenta/entity-ui'

const { children, isLoading, error } = useChildrenData({
  parentId: 'parent-123',
  childLevelConfig: childLevel,
})
```

### useAutoSelectLatestChild

Handles auto-selection of the latest child when a parent is clicked.

```typescript
import { useAutoSelectLatestChild } from '@agenta/entity-ui'

const { isAutoSelecting, autoSelectLatest } = useAutoSelectLatestChild({
  parentId: 'parent-123',
  childLevelConfig: childLevel,
  onSelect: handleChildSelect,
  selectLatest: true,
})
```

## Helper Functions

### getLevelLabel / getLevelPlaceholder

Get display strings for a hierarchy level.

```typescript
import { getLevelLabel, getLevelPlaceholder } from '@agenta/entity-ui'

const label = getLevelLabel(levelConfig)           // e.g., "Apps"
const placeholder = getLevelPlaceholder(levelConfig)  // e.g., "Select app..."
```

## State Isolation

All hooks use `instanceId` to isolate state between multiple instances:

```typescript
// These two instances have completely separate state
const picker1 = useBreadcrumbMode({
  adapter: 'appRevision',
  instanceId: 'picker-1',
})

const picker2 = useBreadcrumbMode({
  adapter: 'appRevision',
  instanceId: 'picker-2',
})
```

## Files

```text
hooks/
├── index.ts                    # Re-exports all hooks
├── README.md                   # This file
├── useEntitySelection.ts       # Unified hook entry point
├── useEntitySelectionCore.ts   # Core hook logic
├── modes/
│   ├── index.ts
│   ├── useCascadingMode.ts     # Cascading dropdown mode
│   ├── useBreadcrumbMode.ts    # Breadcrumb navigation mode
│   └── useListPopoverMode.ts   # List-popover mode
└── utilities/
    ├── index.ts
    ├── useChildrenData.ts      # Fetch children for parent
    └── useAutoSelectLatestChild.ts  # Auto-select latest child
```
