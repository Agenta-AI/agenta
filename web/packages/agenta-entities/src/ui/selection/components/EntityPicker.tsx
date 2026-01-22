/**
 * EntityPicker Component
 *
 * An inline hierarchical picker for selecting entities.
 * Displays a list of entities at the current level with breadcrumb navigation.
 * Supports optional infinite scroll with virtual list rendering.
 */

import {useCallback, useId, useMemo} from "react"

import {
    EntityBreadcrumb,
    EntityListItem,
    LoadAllButton,
    LoadMoreButton,
    SearchInput,
    VirtualEntityList,
} from "@agenta/ui"
import {Skeleton, Empty, Button, Spin} from "antd"
import {ArrowLeft} from "lucide-react"

import {useHierarchicalSelection} from "../hooks/useHierarchicalSelection"
import type {EntitySelectionAdapter, EntitySelectionResult} from "../types"

// ============================================================================
// SKELETON LOADER
// ============================================================================

interface ListItemSkeletonProps {
    count?: number
}

/**
 * Skeleton loader for list items during loading state
 */
function ListItemSkeleton({count = 4}: ListItemSkeletonProps) {
    return (
        <div className="space-y-2">
            {Array.from({length: count}).map((_, index) => (
                <div key={index} className="flex items-center p-3 rounded-md bg-zinc-1">
                    <Skeleton.Avatar active size="small" shape="square" className="mr-3" />
                    <div className="flex-1">
                        <Skeleton.Input active size="small" block className="!w-3/4 mb-1" />
                    </div>
                </div>
            ))}
        </div>
    )
}

// ============================================================================
// TYPES
// ============================================================================

export interface EntityPickerProps<TSelection = EntitySelectionResult> {
    /**
     * The adapter defining the entity hierarchy
     */
    adapter: EntitySelectionAdapter<TSelection> | string

    /**
     * Callback when an entity is selected
     */
    onSelect?: (selection: TSelection) => void

    /**
     * Auto-select when only one option is available
     * @default false
     */
    autoSelectSingle?: boolean

    /**
     * Show search input
     * @default true
     */
    showSearch?: boolean

    /**
     * Show breadcrumb navigation
     * @default true
     */
    showBreadcrumb?: boolean

    /**
     * Show back button when not at root
     * @default true
     */
    showBackButton?: boolean

    /**
     * Root label for breadcrumb
     */
    rootLabel?: string

    /**
     * Empty message when no items
     */
    emptyMessage?: string

    /**
     * Loading message
     */
    loadingMessage?: string

    /**
     * Maximum height for the list
     */
    maxHeight?: number | string

    /**
     * Additional CSS class
     */
    className?: string

    /**
     * Instance ID for state isolation (auto-generated if not provided)
     */
    instanceId?: string

    // ========================================================================
    // INFINITE SCROLL PROPS
    // ========================================================================

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
     * Show "Load More" button instead of auto-loading on scroll
     * Only applies when infiniteScroll is true
     * @default false
     */
    loadMoreButton?: boolean

    /**
     * Show "Load All" button to fetch all remaining pages
     * Only applies when infiniteScroll is true
     * @default false
     */
    showLoadAll?: boolean

    /**
     * Estimated item height for virtual list (pixels)
     * @default 48
     */
    estimatedItemHeight?: number
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Inline hierarchical entity picker
 *
 * @example
 * ```tsx
 * // Basic usage
 * <EntityPicker
 *   adapter={appRevisionAdapter}
 *   onSelect={(selection) => console.log('Selected:', selection)}
 *   showSearch
 *   rootLabel="All Apps"
 * />
 *
 * // With infinite scroll
 * <EntityPicker
 *   adapter={testsetAdapter}
 *   onSelect={handleSelect}
 *   infiniteScroll
 *   pageSize={25}
 * />
 *
 * // With load more button
 * <EntityPicker
 *   adapter={testsetAdapter}
 *   onSelect={handleSelect}
 *   infiniteScroll
 *   loadMoreButton
 *   showLoadAll
 * />
 * ```
 */
export function EntityPicker<TSelection = EntitySelectionResult>({
    adapter,
    onSelect,
    autoSelectSingle = false,
    showSearch = true,
    showBreadcrumb = true,
    showBackButton = true,
    rootLabel,
    emptyMessage,
    loadingMessage,
    maxHeight = 400,
    className = "",
    instanceId: providedInstanceId,
    // Infinite scroll props
    infiniteScroll = false,
    pageSize = 50,
    loadMoreButton = false,
    showLoadAll = false,
    estimatedItemHeight = 48,
}: EntityPickerProps<TSelection>) {
    const generatedId = useId()
    const instanceId = providedInstanceId ?? generatedId

    // Single hook handles both paginated and non-paginated modes
    const {
        breadcrumb,
        items,
        isLoading,
        isAtRoot,
        currentLevelConfig,
        searchTerm,
        setSearchTerm,
        navigateDown,
        navigateUp,
        navigateToLevel,
        select,
        canNavigateDown,
        canSelect,
        isDisabled,
        adapter: resolvedAdapter,
        // Pagination props
        supportsPagination,
        hasNextPage,
        isFetchingNextPage,
        isLoadingAll,
        fetchNextPage,
        loadAllPages,
        cancelLoadAll: _cancelLoadAll,
        totalCount,
    } = useHierarchicalSelection({
        adapter,
        instanceId,
        onSelect,
        autoSelectSingle,
        paginated: infiniteScroll,
        pageSize,
    })

    // Get display messages with contextual level type
    const levelTypeLabel = currentLevelConfig?.type ?? "items"
    const displayEmptyMessage =
        emptyMessage ?? resolvedAdapter.emptyMessage ?? `No ${levelTypeLabel} found`
    const displayLoadingMessage =
        loadingMessage ?? resolvedAdapter.loadingMessage ?? `Loading ${levelTypeLabel}...`
    const displayRootLabel = rootLabel ?? "Select"

    // Handle item click
    const handleItemClick = useCallback(
        (item: unknown) => {
            if (canNavigateDown(item)) {
                navigateDown(item)
            }
        },
        [canNavigateDown, navigateDown],
    )

    // Handle item select
    const handleItemSelect = useCallback(
        (item: unknown) => {
            if (canSelect(item)) {
                select(item)
            }
        },
        [canSelect, select],
    )

    // Render list item
    const renderItem = useCallback(
        (item: unknown, _index: number) => {
            if (!currentLevelConfig) return null

            const id = currentLevelConfig.getId(item)
            const label = currentLevelConfig.getLabel(item)
            const labelNode = currentLevelConfig.getLabelNode?.(item)
            const icon = currentLevelConfig.getIcon?.(item)
            const description = currentLevelConfig.getDescription?.(item)
            const hasChildren = canNavigateDown(item)
            const isSelectable = canSelect(item)
            const disabled = isDisabled(item)

            return (
                <EntityListItem
                    key={id}
                    label={label}
                    labelNode={labelNode}
                    description={description}
                    icon={icon}
                    hasChildren={hasChildren}
                    isSelectable={isSelectable}
                    isDisabled={disabled}
                    onClick={() => handleItemClick(item)}
                    onSelect={() => handleItemSelect(item)}
                />
            )
        },
        [
            currentLevelConfig,
            canNavigateDown,
            canSelect,
            isDisabled,
            handleItemClick,
            handleItemSelect,
        ],
    )

    // Get item key for virtual list
    const getItemKey = useCallback(
        (item: unknown, index: number) => {
            if (!currentLevelConfig) return index
            return currentLevelConfig.getId(item)
        },
        [currentLevelConfig],
    )

    // Should use virtual list?
    const useVirtualList = infiniteScroll && supportsPagination

    // Calculate max height number for virtual list
    const maxHeightNumber = useMemo(() => {
        if (typeof maxHeight === "number") return maxHeight
        // Try to parse string maxHeight
        const parsed = parseInt(maxHeight, 10)
        return isNaN(parsed) ? 400 : parsed
    }, [maxHeight])

    return (
        <div className={`flex flex-col ${className}`}>
            {/* Header with breadcrumb and back button */}
            {(showBreadcrumb || (showBackButton && !isAtRoot)) && (
                <div className="flex items-center gap-2 mb-3">
                    {showBackButton && !isAtRoot && (
                        <Button
                            type="text"
                            icon={<ArrowLeft className="w-4 h-4" />}
                            onClick={navigateUp}
                            size="small"
                        />
                    )}
                    {showBreadcrumb && (
                        <EntityBreadcrumb
                            path={breadcrumb}
                            onNavigate={navigateToLevel}
                            rootLabel={displayRootLabel}
                            className="flex-1"
                        />
                    )}
                    {/* Load All button in header */}
                    {showLoadAll && supportsPagination && hasNextPage && (
                        <LoadAllButton
                            onLoadAll={loadAllPages}
                            isLoading={isLoadingAll}
                            hasMore={hasNextPage}
                            loadedCount={items.length}
                            totalCount={totalCount}
                        />
                    )}
                </div>
            )}

            {/* Search input */}
            {showSearch && (
                <div className="mb-3">
                    <SearchInput
                        value={searchTerm}
                        onChange={setSearchTerm}
                        placeholder={`Search ${currentLevelConfig?.type ?? "items"}...`}
                        autoFocus={false}
                    />
                </div>
            )}

            {/* Items list */}
            {isLoading ? (
                <div className="py-2">
                    <div className="text-xs text-zinc-4 mb-2">{displayLoadingMessage}</div>
                    <ListItemSkeleton count={4} />
                </div>
            ) : items.length === 0 ? (
                <Empty description={displayEmptyMessage} image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : useVirtualList ? (
                // Virtual list for infinite scroll
                <>
                    <VirtualEntityList
                        items={items}
                        renderItem={renderItem}
                        estimateSize={estimatedItemHeight}
                        maxHeight={maxHeightNumber}
                        onEndReached={loadMoreButton ? undefined : fetchNextPage}
                        hasMore={hasNextPage}
                        isFetchingMore={isFetchingNextPage}
                        getItemKey={getItemKey}
                    />
                    {/* Load More button (if enabled) */}
                    {loadMoreButton && (
                        <LoadMoreButton
                            onClick={fetchNextPage}
                            isLoading={isFetchingNextPage}
                            hasMore={hasNextPage}
                            loadedCount={items.length}
                            totalCount={totalCount}
                            showCount
                        />
                    )}
                </>
            ) : (
                // Standard list
                <div
                    className="overflow-y-auto"
                    style={{
                        maxHeight: typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight,
                    }}
                >
                    <div className="space-y-1">{items.map(renderItem)}</div>
                    {/* Show pagination controls even without virtual list */}
                    {infiniteScroll && hasNextPage && (
                        <>
                            {loadMoreButton ? (
                                <LoadMoreButton
                                    onClick={fetchNextPage}
                                    isLoading={isFetchingNextPage}
                                    hasMore={hasNextPage}
                                    loadedCount={items.length}
                                    totalCount={totalCount}
                                    showCount
                                />
                            ) : (
                                isFetchingNextPage && (
                                    <div className="flex items-center justify-center py-4">
                                        <Spin size="small" />
                                        <span className="ml-2 text-zinc-6">Loading more...</span>
                                    </div>
                                )
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    )
}
