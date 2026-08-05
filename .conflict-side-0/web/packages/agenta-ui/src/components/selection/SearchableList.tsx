/**
 * SearchableList Component
 *
 * Generic list wrapper with optional search input, loading/empty/error states,
 * and support for virtualized or adaptive rendering.
 */

import React from "react"

import {Empty, Spin} from "antd"

import {cn, flexLayouts, justifyClasses, textColors} from "../../utils/styles"

import {SearchInput} from "./SearchInput"
import {AdaptiveList, SimpleList, VirtualList} from "./VirtualList"

// ============================================================================
// TYPES
// ============================================================================

export type SearchableListVariant = "adaptive" | "virtual" | "simple"

export interface SearchableListProps<T> {
    items: T[]
    renderItem: (item: T, index: number) => React.ReactNode
    searchValue: string
    onSearchChange: (value: string) => void
    maxHeight: number | string
    showSearch?: boolean
    searchPlaceholder?: string
    searchAutoFocus?: boolean
    searchDisabled?: boolean
    searchClassName?: string
    listClassName?: string
    className?: string
    header?: React.ReactNode
    footer?: React.ReactNode
    emptyState?: React.ReactNode
    loadingState?: React.ReactNode
    errorState?: React.ReactNode
    emptyMessage?: string
    loadingMessage?: string
    errorMessage?: string
    isLoading?: boolean
    isError?: boolean
    error?: Error | null
    listVariant?: SearchableListVariant
    estimateSize?: number
    overscan?: number
    virtualizeThreshold?: number
    onEndReached?: () => void
    endReachedThreshold?: number
    hasMore?: boolean
    isFetchingMore?: boolean
    getItemKey?: (item: T, index: number) => string | number
}

// ============================================================================
// COMPONENT
// ============================================================================

export function SearchableList<T>({
    items,
    renderItem,
    searchValue,
    onSearchChange,
    maxHeight,
    showSearch = true,
    searchPlaceholder = "Search...",
    searchAutoFocus = false,
    searchDisabled = false,
    searchClassName,
    listClassName,
    className,
    header,
    footer,
    emptyState,
    loadingState,
    errorState,
    emptyMessage = "No items",
    loadingMessage = "Loading...",
    errorMessage,
    isLoading = false,
    isError = false,
    error,
    listVariant = "adaptive",
    estimateSize,
    overscan,
    virtualizeThreshold,
    onEndReached,
    endReachedThreshold,
    hasMore,
    isFetchingMore,
    getItemKey,
}: SearchableListProps<T>) {
    const resolvedErrorMessage = errorMessage ?? error?.message ?? "Something went wrong"

    const renderLoading = () =>
        loadingState ?? (
            <div className={cn(flexLayouts.rowCenter, justifyClasses.center, "py-8")}>
                <Spin size="default" />
                <span className={cn("ml-2", textColors.tertiary)}>{loadingMessage}</span>
            </div>
        )

    const renderEmpty = () =>
        emptyState ?? <Empty description={emptyMessage} image={Empty.PRESENTED_IMAGE_SIMPLE} />

    const renderError = () =>
        errorState ?? (
            <div className={cn("py-6 text-center text-red-500")}>{resolvedErrorMessage}</div>
        )

    const renderList = () => {
        const baseProps = {
            items,
            renderItem,
            maxHeight,
            isFetchingMore,
            hasMore,
            onEndReached,
            endReachedThreshold,
            loadingMessage,
            className: listClassName,
            getItemKey,
        }

        if (listVariant === "simple") {
            return (
                <SimpleList
                    items={items}
                    renderItem={renderItem}
                    maxHeight={maxHeight}
                    isFetchingMore={isFetchingMore}
                    loadingMessage={loadingMessage}
                    className={listClassName}
                />
            )
        }

        if (listVariant === "virtual") {
            return (
                <VirtualList
                    {...baseProps}
                    estimateSize={estimateSize}
                    overscan={overscan}
                    isLoading={false}
                />
            )
        }

        return (
            <AdaptiveList
                {...baseProps}
                estimateSize={estimateSize}
                overscan={overscan}
                virtualizeThreshold={virtualizeThreshold}
                isLoading={false}
            />
        )
    }

    return (
        <div className={cn("flex flex-col", className)}>
            {header}
            {showSearch && (
                <div className={cn("mb-2", searchClassName)}>
                    <SearchInput
                        value={searchValue}
                        onChange={onSearchChange}
                        placeholder={searchPlaceholder}
                        autoFocus={searchAutoFocus}
                        disabled={searchDisabled}
                    />
                </div>
            )}

            {isError || error
                ? renderError()
                : isLoading
                  ? renderLoading()
                  : items.length === 0
                    ? renderEmpty()
                    : renderList()}

            {footer}
        </div>
    )
}

export default SearchableList
