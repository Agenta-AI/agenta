/**
 * BreadcrumbVariant Component
 *
 * Breadcrumb navigation variant for EntityPicker.
 * Shows one hierarchy level at a time with breadcrumb navigation.
 *
 * Pattern: Show Apps → Click App → Show Variants → Click Variant → Show Revisions
 */

import React, {useCallback, useId, useMemo} from "react"

import {
    EntityBreadcrumb,
    EntityListItem,
    SearchInput,
    VirtualEntityList,
} from "@agenta/ui/components/selection"
import {LoadAllButton, LoadMoreButton} from "@agenta/ui/components/selection"
import {cn} from "@agenta/ui/styles"
import {Button, Empty, Spin} from "antd"
import {ArrowLeft} from "lucide-react"

import {useBreadcrumbMode} from "../../../hooks"
import type {EntitySelectionResult} from "../../../types"
import type {BreadcrumbVariantProps} from "../types"

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Breadcrumb navigation variant.
 *
 * Shows one level at a time with breadcrumb trail for navigation.
 * Supports infinite scroll and pagination for large lists.
 *
 * @example
 * ```tsx
 * <BreadcrumbVariant
 *     adapter="appRevision"
 *     onSelect={handleSelect}
 *     showBreadcrumb
 *     infiniteScroll
 * />
 * ```
 */
export function BreadcrumbVariant<TSelection = EntitySelectionResult>({
    adapter,
    onSelect,
    instanceId: providedInstanceId,
    autoSelectByLevel,
    showSearch = true,
    showBreadcrumb = true,
    showBackButton = true,
    rootLabel,
    emptyMessage,
    loadingMessage,
    maxHeight = 400,
    className,
    disabled = false,
    autoSelectSingle = false,
    // Infinite scroll props
    infiniteScroll = false,
    pageSize = 50,
    loadMoreButton = false,
    showLoadAll = false,
    estimatedItemHeight = 48,
}: BreadcrumbVariantProps<TSelection>) {
    const generatedId = useId()
    const instanceId = providedInstanceId ?? generatedId

    // Use the breadcrumb mode hook
    const {
        breadcrumb,
        items,
        isLoading,
        error,
        isAtRoot,
        currentLevelConfig,
        currentLevelLabel,
        searchTerm,
        setSearchTerm,
        navigateDown,
        navigateUp,
        navigateToLevel,
        select,
        canNavigateDown,
        canSelect,
        isDisabled,
        // Pagination
        hasNextPage,
        isFetchingNextPage,
        isLoadingAll,
        fetchNextPage,
        loadAllPages,
        counts,
        adapter: resolvedAdapter,
    } = useBreadcrumbMode({
        adapter,
        instanceId,
        onSelect,
        autoSelectByLevel,
        paginated: infiniteScroll,
        pageSize,
        autoSelectSingle,
    })

    // Get display messages
    const displayEmptyMessage = emptyMessage ?? resolvedAdapter.emptyMessage ?? "No items found"
    const displayLoadingMessage = loadingMessage ?? resolvedAdapter.loadingMessage ?? "Loading..."

    // Handle item click
    const handleItemClick = useCallback(
        (entity: unknown) => {
            if (disabled) return
            if (isDisabled(entity)) return

            if (canSelect(entity)) {
                select(entity)
            } else if (canNavigateDown(entity)) {
                navigateDown(entity)
            }
        },
        [disabled, isDisabled, canSelect, canNavigateDown, select, navigateDown],
    )

    // Render item for virtual list
    const renderItem = useCallback(
        (item: unknown, index: number) => {
            if (!currentLevelConfig) return null

            const id = currentLevelConfig.getId(item)
            const label = currentLevelConfig.getLabel(item)
            const labelNode = currentLevelConfig.getLabelNode?.(item)
            const itemDisabled = disabled || isDisabled(item)
            const navigable = canNavigateDown(item)
            const selectable = canSelect(item)

            return (
                <EntityListItem
                    key={id}
                    label={label}
                    labelNode={labelNode}
                    isSelectable={!itemDisabled && (navigable || selectable)}
                    isSelected={false}
                    onClick={() => handleItemClick(item)}
                    onSelect={() => handleItemClick(item)}
                    hasChildren={navigable}
                />
            )
        },
        [currentLevelConfig, disabled, isDisabled, canNavigateDown, canSelect, handleItemClick],
    )

    // Memoize breadcrumb path for EntityBreadcrumb
    const breadcrumbPath = useMemo(() => {
        return breadcrumb.map((item) => ({
            id: item.id,
            label: item.label,
        }))
    }, [breadcrumb])

    // Handle breadcrumb navigation (level 0 = root click, level 1+ = path item click)
    const handleBreadcrumbNavigate = useCallback(
        (level: number) => {
            if (level === 0) {
                // Root was clicked - navigate to root
                navigateToLevel(-1)
            } else {
                // Path item was clicked - navigate to that level (0-indexed in path)
                navigateToLevel(level - 1)
            }
        },
        [navigateToLevel],
    )

    // Loading state
    if (isLoading && items.length === 0) {
        return (
            <div className={cn("flex flex-col", className)}>
                {showBreadcrumb && (
                    <div className="mb-2">
                        <EntityBreadcrumb
                            path={breadcrumbPath}
                            onNavigate={handleBreadcrumbNavigate}
                            rootLabel={rootLabel ?? "All"}
                        />
                    </div>
                )}
                <div className="flex items-center justify-center py-8">
                    <Spin size="default" />
                    <span className="ml-2 text-zinc-500">{displayLoadingMessage}</span>
                </div>
            </div>
        )
    }

    // Error state
    if (error) {
        return (
            <div className={cn("flex flex-col", className)}>
                <div className="flex items-center justify-center py-8 text-red-500">
                    Error: {error.message}
                </div>
            </div>
        )
    }

    return (
        <div className={cn("flex flex-col", className)}>
            {/* Breadcrumb navigation */}
            {showBreadcrumb && (
                <div className="mb-2 flex items-center gap-2">
                    {showBackButton && !isAtRoot && (
                        <Button
                            type="text"
                            size="small"
                            icon={<ArrowLeft size={16} />}
                            onClick={navigateUp}
                            disabled={disabled}
                        />
                    )}
                    <EntityBreadcrumb
                        path={breadcrumbPath}
                        onNavigate={handleBreadcrumbNavigate}
                        rootLabel={rootLabel ?? "All"}
                    />
                </div>
            )}

            {/* Search input */}
            {showSearch && (
                <div className="mb-2">
                    <SearchInput
                        value={searchTerm}
                        onChange={setSearchTerm}
                        placeholder={`Search ${currentLevelLabel.toLowerCase()}...`}
                        disabled={disabled}
                    />
                </div>
            )}

            {/* Items list */}
            {items.length === 0 ? (
                <div className="py-8">
                    <Empty description={displayEmptyMessage} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                </div>
            ) : infiniteScroll ? (
                // Virtual list for infinite scroll
                <VirtualEntityList
                    items={items}
                    renderItem={renderItem}
                    maxHeight={maxHeight}
                    estimateSize={estimatedItemHeight}
                    onEndReached={!loadMoreButton && hasNextPage ? fetchNextPage : undefined}
                    endReachedThreshold={200}
                    hasMore={hasNextPage}
                    isFetchingMore={isFetchingNextPage}
                />
            ) : (
                // Regular list
                <div
                    className="overflow-auto"
                    style={{maxHeight: typeof maxHeight === "number" ? maxHeight : undefined}}
                >
                    {items.map((item, index) => renderItem(item, index))}
                </div>
            )}

            {/* Load more / Load all buttons */}
            {infiniteScroll && hasNextPage && (
                <div className="flex items-center justify-center gap-2 py-2 border-t border-zinc-200 dark:border-zinc-700">
                    {loadMoreButton && (
                        <LoadMoreButton
                            onClick={fetchNextPage}
                            isLoading={isFetchingNextPage}
                            counts={counts}
                        />
                    )}
                    {showLoadAll && (
                        <LoadAllButton
                            onLoadAll={loadAllPages}
                            isLoading={isLoadingAll}
                            counts={counts}
                        />
                    )}
                </div>
            )}

            {/* Loading more indicator */}
            {isFetchingNextPage && !loadMoreButton && (
                <div className="flex items-center justify-center py-2">
                    <Spin size="small" />
                    <span className="ml-2 text-xs text-zinc-500">Loading more...</span>
                </div>
            )}
        </div>
    )
}
