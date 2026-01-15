# Infinite Scroll Implementation Plan for Entity Selection

## Overview

This plan outlines adding infinite scroll support to the entity selection UI components while maintaining backward compatibility through prop-based configuration.

## Current State

### Architecture
- **EntityPicker** renders items via `items.map(renderItem)` with `overflow-y-auto`
- **useEntityList** fetches all data at once via `listAtom`
- **Adapters** return `ListQueryState<T>` with complete data arrays
- **No virtualization** - all items rendered to DOM

### Pain Points
- Large lists (100+ items) cause DOM bloat and slow rendering
- Client-side search degrades with large datasets
- Memory usage grows linearly with list size

---

## Proposed Solution

### 1. Create Shared Infinite Scroll Utilities

Create a new `@agenta/entities/ui/selection/hooks/useInfiniteList.ts` that:
- Wraps TanStack Query's `useInfiniteQuery` pattern via Jotai atoms
- Provides load-more triggers (scroll-based or button-based)
- Integrates with existing search term state
- Supports both cursor and offset pagination

```typescript
// New file: hooks/useInfiniteList.ts

interface UseInfiniteListOptions<T> {
  /**
   * Atom family returning paginated query state
   */
  listAtomFamily: (params: PaginationParams) => Atom<PaginatedListQueryState<T>>

  /**
   * Instance ID for state isolation
   */
  instanceId: string

  /**
   * Page size
   * @default 50
   */
  pageSize?: number

  /**
   * Search field for server-side filtering (if supported)
   */
  searchField?: keyof T
}

interface UseInfiniteListResult<T> {
  items: T[]
  isLoading: boolean
  isFetchingNextPage: boolean
  hasNextPage: boolean
  fetchNextPage: () => void
  error: Error | null
  searchTerm: string
  setSearchTerm: (term: string) => void
  totalCount: number | null
}
```

### 2. Extend ListQueryState for Pagination

Update the `ListQueryState` type to optionally include pagination info:

```typescript
// Updated types.ts

interface ListQueryState<T> {
  data: T[] | null
  isPending: boolean
  isError: boolean
  error: Error | null
}

// New: Paginated variant
interface PaginatedListQueryState<T> extends ListQueryState<T> {
  pagination?: {
    hasNextPage: boolean
    nextCursor: string | null
    nextOffset: number | null
    totalCount: number | null
    isFetchingNextPage: boolean
  }
  // For loading more data
  fetchNextPage?: () => void
}
```

### 3. Update Adapter Interface

Add optional pagination support to hierarchy levels:

```typescript
// Updated adapter types

interface HierarchyLevel<T> {
  // Existing
  type: SelectableEntityType
  listAtom?: Atom<ListQueryState<T>>
  listAtomFamily?: (parentId: string) => Atom<ListQueryState<T>>

  // NEW: Paginated variants
  paginatedListAtom?: (params: PaginationParams) => Atom<PaginatedListQueryState<T>>
  paginatedListAtomFamily?: (parentId: string, params: PaginationParams) => Atom<PaginatedListQueryState<T>>

  // NEW: Server-side search support
  supportsServerSearch?: boolean
  searchField?: string

  // Existing...
  getId: (entity) => string
  getLabel: (entity) => string
  // ...
}

interface PaginationParams {
  pageSize: number
  cursor: string | null
  offset: number
  searchTerm?: string
}
```

### 4. Create Virtual List Component

Create a lightweight virtual scroll wrapper using `@tanstack/react-virtual`:

```typescript
// New file: components/primitives/VirtualEntityList.tsx

interface VirtualEntityListProps<T> {
  items: T[]
  renderItem: (item: T, index: number) => React.ReactNode
  estimateSize?: number  // Default: 48px
  overscan?: number      // Default: 5
  maxHeight: number | string
  onEndReached?: () => void
  endReachedThreshold?: number  // Default: 200px
  isLoading?: boolean
  isFetchingMore?: boolean
}
```

This component:
- Uses `@tanstack/react-virtual` for virtualization
- Triggers `onEndReached` when scrolling near bottom
- Shows loading indicator when fetching more
- Only renders visible items + overscan

### 5. Update EntityPicker with Infinite Scroll Option

Add prop to enable infinite scroll:

```typescript
// Updated EntityPickerProps

interface EntityPickerProps<TSelection> {
  // Existing props...

  /**
   * Enable infinite scroll with virtual list
   * When true, uses pagination from adapter if available
   * @default false
   */
  infiniteScroll?: boolean

  /**
   * Page size for infinite scroll
   * @default 50
   */
  pageSize?: number

  /**
   * Show "Load More" button instead of auto-loading
   * Only applies when infiniteScroll is true
   * @default false
   */
  loadMoreButton?: boolean
}
```

### 6. Create useHierarchicalSelectionPaginated Hook

A new hook variant that supports pagination:

```typescript
// New file: hooks/useHierarchicalSelectionPaginated.ts

interface UseHierarchicalSelectionPaginatedOptions {
  adapter: EntitySelectionAdapter | string
  instanceId: string
  onSelect?: (selection) => void
  autoSelectSingle?: boolean
  pageSize?: number
}

interface UseHierarchicalSelectionPaginatedResult {
  // All existing returns from useHierarchicalSelection
  // Plus:
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => void
  totalCount: number | null
}
```

---

## Implementation Phases

### Phase 1: Core Infrastructure (Foundation)

1. **Create pagination types**
   - Add `PaginatedListQueryState<T>` type
   - Add `PaginationParams` type
   - Update `HierarchyLevel` interface

2. **Create `useInfiniteList` hook**
   - Pagination state management
   - Cursor/offset tracking
   - Integration with search term atoms
   - Load-more action

3. **Create `VirtualEntityList` component**
   - TanStack Virtual integration
   - Scroll-based loading trigger
   - Loading states

Files to create/modify:
- `types.ts` - Add pagination types
- `hooks/useInfiniteList.ts` - New hook
- `components/primitives/VirtualEntityList.tsx` - New component

### Phase 2: Hook Integration

1. **Create `useHierarchicalSelectionPaginated`**
   - Extends `useHierarchicalSelection`
   - Adds pagination state and actions
   - Falls back to non-paginated when adapter doesn't support it

2. **Update `useEntityList` for backward compatibility**
   - Check if adapter provides paginated atoms
   - Use appropriate fetching strategy

Files to create/modify:
- `hooks/useHierarchicalSelectionPaginated.ts` - New hook
- `hooks/useEntityList.ts` - Minor updates

### Phase 3: Component Updates

1. **Update `EntityPicker`**
   - Add `infiniteScroll` prop
   - Conditionally use `VirtualEntityList`
   - Use paginated hook when enabled

2. **Create `LoadMoreButton` component**
   - Optional alternative to scroll-based loading

Files to modify:
- `components/EntityPicker.tsx`
- `components/primitives/index.ts`

### Phase 4: Adapter Updates

1. **Update adapter factory**
   - Support `paginatedListAtom` configuration
   - Document pagination requirements

2. **Update existing adapters (as needed)**
   - `testsetAdapter.ts` - Add pagination support
   - `appRevisionAdapter.ts` - Add pagination support
   - `evaluatorRevisionAdapter.ts` - Add pagination support

Files to modify:
- `adapters/createAdapter.ts`
- Individual adapter files

---

## API Design

### Usage: Basic (Backward Compatible)

```tsx
// No changes needed - works exactly as before
<EntityPicker
  adapter={testsetAdapter}
  onSelect={handleSelect}
/>
```

### Usage: With Infinite Scroll

```tsx
<EntityPicker
  adapter={testsetAdapter}
  onSelect={handleSelect}
  infiniteScroll           // Enable virtual list + pagination
  pageSize={25}            // Optional: override page size
/>
```

### Usage: With Load More Button

```tsx
<EntityPicker
  adapter={testsetAdapter}
  onSelect={handleSelect}
  infiniteScroll
  loadMoreButton           // Show button instead of auto-load
/>
```

### Adapter Configuration: Paginated

```typescript
const testsetAdapter = createAdapter({
  name: "testset",
  entityType: "testset",
  hierarchy: {
    levels: [
      {
        type: "testset",
        // Existing: all-at-once loading
        listAtom: testsetsListAtom,

        // NEW: Paginated loading
        paginatedListAtom: (params) => testsetsPaginatedAtom(params),
        supportsServerSearch: true,
        searchField: "name",

        getId: (t) => t.id,
        getLabel: (t) => t.name,
        // ...
      },
      // ...
    ],
    selectableLevel: 1,
  },
  // ...
})
```

---

## File Structure

```
selection/
├── hooks/
│   ├── useEntityList.ts           # Minor updates
│   ├── useInfiniteList.ts         # NEW
│   ├── useHierarchicalSelection.ts
│   └── useHierarchicalSelectionPaginated.ts  # NEW
├── components/
│   ├── EntityPicker.tsx           # Updated
│   └── primitives/
│       ├── VirtualEntityList.tsx  # NEW
│       ├── LoadMoreButton.tsx     # NEW
│       └── index.ts               # Updated exports
├── types.ts                       # Updated with pagination types
└── adapters/
    ├── createAdapter.ts           # Updated interface
    └── *.ts                       # Individual adapters (optional updates)
```

---

## Dependencies

### Required (if not already present)

```json
{
  "@tanstack/react-virtual": "^3.x"
}
```

This is already commonly used and lightweight (~3KB gzipped).

---

## Migration Path

### For Consumers (Gradual)

1. **No action required** - Existing code works unchanged
2. **Opt-in** - Add `infiniteScroll` prop to enable
3. **Update adapters** - Add paginated atoms when ready

### For Large Lists

Priority order for adding pagination support:
1. **Testsets** - Often have many revisions
2. **App Revisions** - Can grow large over time
3. **Evaluators** - Less critical, typically smaller lists

---

## Performance Considerations

### Virtual List Benefits
- Only renders visible items (~10-15) instead of all (could be 1000+)
- Smooth scrolling via overscan
- Memory-efficient for large lists

### Pagination Benefits
- Reduced initial load time
- Lower memory footprint
- Server-side filtering possible

### Trade-offs
- Slightly more complex state management
- Need server-side pagination support
- Search behavior changes (server vs client)

---

## Success Metrics

- **Initial render**: < 100ms for any list size
- **Scroll performance**: 60fps during scrolling
- **Memory**: Linear with visible items, not total items
- **User experience**: Seamless loading with no jank

---

## Open Questions

1. **Search behavior**: Should search be server-side when paginated?
   - Recommendation: Yes, for consistency
   - Client-side search doesn't work well with partial data

2. **Minimum list size for virtual scroll**: Always use, or threshold?
   - Recommendation: Always use when `infiniteScroll=true`
   - Virtual scroll overhead is minimal

3. **Error handling**: How to handle pagination errors?
   - Show error state with retry option
   - Keep existing items visible

---

## Timeline Estimate

- **Phase 1**: Foundation infrastructure
- **Phase 2**: Hook integration
- **Phase 3**: Component updates
- **Phase 4**: Adapter updates (incremental)

*Note: Phases 1-3 can be done without touching existing adapters. Phase 4 can be done incrementally as needed per entity type.*
