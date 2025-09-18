# New Variants State Management

A pure atom-based approach to variant state management with deep link priority loading, windowing/pagination support, and smart cache redirection.

## Architecture Overview

This system implements a **pure atom-based architecture** where all business logic resides in testable atoms, with React hooks serving as thin wrappers. This design enables:

- **Independent testing** without React dependencies
- **Pure functions** with predictable inputs/outputs
- **Composable atoms** that can be combined in different ways
- **Smart cache coordination** to avoid duplicate queries
- **Deep link priority** for immediate access to URL-referenced content

## Key Features

### 🔗 Deep Link Priority Loading

- Automatically detects deep-linked variants/revisions from URL
- Fetches priority items first for immediate availability
- Shorter cache times for deep-linked content
- Smart fallback to individual fetches when needed

### 📄 Windowing & Pagination

- Configurable window sizes for large datasets
- Progressive loading with infinite scroll support
- Maintains window state across navigation
- Background prefetching for smooth UX

### 🧠 Smart Cache Redirection

- Checks bulk queries before individual requests
- Avoids duplicate API calls for cached data
- Cache statistics and invalidation strategies
- Background preloading for anticipated needs

### 🧪 Pure Atom Testing

- All logic testable without React components
- Mock-friendly API layer
- Comprehensive test coverage
- Integration test scenarios

## Folder Structure

```
src/state/newVariants/
├── atoms/
│   ├── deepLink.ts      # Deep link detection and priority config
│   ├── window.ts        # Windowing/pagination state management
│   ├── cache.ts         # Cache intelligence and invalidation
│   ├── strategy.ts      # Query orchestration logic
│   ├── queries.ts       # Main query atoms using strategies
│   ├── derived.ts       # Computed state for components
│   └── actions.ts       # State mutation and side effect atoms
├── api/
│   └── variants.ts      # Enhanced API layer with bulk/priority support
├── hooks/
│   └── index.ts         # Thin React hooks wrapping atoms
├── __tests__/
│   ├── setup.ts         # Test utilities and mocks
│   ├── deepLink.test.ts # Deep link atom tests
│   ├── window.test.ts   # Window management tests
│   ├── cache.test.ts    # Cache intelligence tests
│   ├── strategy.test.ts # Query strategy tests
│   └── integration.test.ts # End-to-end scenarios
└── index.ts             # Main exports
```

## Usage Examples

### Table with Windowing

```typescript
import { useVariantTable } from '@/state/newVariants/hooks'

export const VariantTable = ({ appId }: { appId: string }) => {
    const {
        variants,
        isLoading,
        hasMore,
        loadMore,
        hasPriorityItems,
        priorityCount,
        currentPage,
        totalPages
    } = useVariantTable(appId, 'main-table')

    return (
        <div>
            {hasPriorityItems && (
                <div className="priority-banner">
                    Showing {priorityCount} deep-linked items first
                </div>
            )}

            {variants.map(variant => (
                <VariantRow key={variant.id} variant={variant} />
            ))}

            {hasMore && (
                <button onClick={loadMore} disabled={isLoading}>
                    Load More ({currentPage}/{totalPages})
                </button>
            )}
        </div>
    )
}
```

### Selection Dropdown

```typescript
import { useVariantSelection } from '@/state/newVariants/hooks'

export const VariantSelector = ({ appId, onSelect }: Props) => {
    const {
        selectableItems,
        isLoading,
        stats,
        selectVariant
    } = useVariantSelection(appId)

    return (
        <Select
            loading={isLoading}
            options={selectableItems}
            onChange={(value) => {
                selectVariant(value)
                onSelect(value)
            }}
            placeholder={`Select from ${stats.total} variants`}
        />
    )
}
```

### Deep-Linked Playground

```typescript
import { useVariantById, useDeepLinkedVariant } from '@/state/newVariants/hooks'

export const PlaygroundComponent = () => {
    const { variantId, isDeepLinked } = useDeepLinkedVariant()
    const { variant, isLoading, fromCache } = useVariantById(variantId!)

    if (isLoading) {
        return <div>Loading {isDeepLinked ? 'deep-linked' : ''} variant...</div>
    }

    return (
        <div>
            {fromCache && <div className="cache-indicator">Loaded from cache</div>}
            <PlaygroundInterface variant={variant} />
        </div>
    )
}
```

## Testing

### Running Tests

```bash
# From the newVariants directory
cd src/state/newVariants/__tests__
npm test

# With coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

### Test Categories

1. **Unit Tests**: Individual atom behavior
2. **Integration Tests**: Cross-atom coordination
3. **Cache Tests**: Smart redirection scenarios
4. **Deep Link Tests**: Priority loading flows
5. **Window Tests**: Pagination state management

### Test Environment Setup

The test environment includes:

- Mock axios configuration with realistic responses
- Mock router state for deep link testing
- Query client setup with pre-populated cache
- Test data generators for various scenarios

## API Integration

### Backend Requirements

The system expects these backend endpoints:

```python
# Priority fetching for deep links
POST /apps/{app_id}/variants/priority
{
    "priority_ids": ["var1", "rev1"],
    "mode": "enhanced"
}

# Windowed fetching with exclusions
GET /apps/{app_id}/variants/?offset=50&limit=50&exclude_ids=var1,var2&mode=windowed

# Bulk query endpoint
POST /workflows/variants/query
{
    "variant_ids": ["var1", "var2"],
    "include": ["revisions", "schema", "deployments"]
}
```

### Authentication

The system uses the existing axios configuration which handles:

- JWT token injection
- Project ID parameters
- Permission checks
- Error handling

## Migration Strategy

This implementation is designed to **coexist** with the current variant system:

1. **Phase 1**: Implement new atoms alongside existing ones
2. **Phase 2**: Migrate specific components to use new hooks
3. **Phase 3**: Gradually replace old atoms with new ones
4. **Phase 4**: Remove deprecated code

## Performance Considerations

- **Cache-first strategy** reduces API calls
- **Priority loading** ensures immediate deep link access
- **Windowing** prevents memory issues with large datasets
- **Background prefetching** improves perceived performance
- **Memoized computations** in derived atoms

## Future Enhancements

- **Real-time updates** via WebSocket integration
- **Optimistic updates** for mutations
- **Offline support** with cache persistence
- **Advanced filtering** and search capabilities
- **Performance monitoring** and analytics
