/**
 * EntityListWithPopover Component
 *
 * A hybrid selection component that displays a vertical scrollable list of parent entities,
 * with hover-triggered popovers showing child entities for selection.
 *
 * Use case: Testset list where hovering shows revision options
 */

import React, {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {EntityListItem, SearchInput} from "@agenta/ui"
import {Popover, Spin, Empty} from "antd"
import {atom, useAtomValue, type Atom} from "jotai"

import {resolveAdapter} from "../adapters/createAdapter"
import type {
    EntitySelectionAdapter,
    EntitySelectionResult,
    SelectionPathItem,
    ListQueryState,
    HierarchyLevel,
} from "../types"

// ============================================================================
// TYPES
// ============================================================================

export interface EntityListWithPopoverProps<TSelection = EntitySelectionResult> {
    /**
     * The adapter defining the entity hierarchy (must have exactly 2 levels)
     */
    adapter: EntitySelectionAdapter<TSelection> | string

    /**
     * Callback when an entity is selected
     */
    onSelect?: (selection: TSelection) => void

    /**
     * Currently selected parent entity ID (for highlighting)
     */
    selectedParentId?: string | null

    /**
     * Currently selected child entity ID (for highlighting)
     */
    selectedChildId?: string | null

    /**
     * Show search input
     * @default true
     */
    showSearch?: boolean

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
     * Popover placement
     * @default "rightTop"
     */
    popoverPlacement?: "right" | "rightTop" | "rightBottom" | "left" | "leftTop" | "leftBottom"

    /**
     * Popover trigger
     * @default "hover"
     */
    popoverTrigger?: "hover" | "click"

    /**
     * Auto-select first parent on mount if none selected
     * @default false
     */
    autoSelectFirst?: boolean

    /**
     * Callback when a parent entity is hovered (for preloading)
     */
    onParentHover?: (parentId: string) => void

    /**
     * Callback when a parent entity is clicked directly (not via child selection).
     * Use this to auto-select the latest child (e.g., latest revision).
     * If not provided, clicking parent does nothing (user must select from popover).
     */
    onParentClick?: (parentId: string, parentLabel: string) => void
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function defaultFilter<T>(items: T[], searchTerm: string, getLabel: (item: T) => string): T[] {
    if (!searchTerm.trim()) return items
    const term = searchTerm.toLowerCase().trim()
    return items.filter((item) => getLabel(item).toLowerCase().includes(term))
}

// Empty atom for fallback when no listAtom is available
const emptyListAtom = atom<ListQueryState<unknown>>({
    data: [],
    isPending: false,
    isError: false,
    error: null,
})

// ============================================================================
// CHILD LIST COMPONENT (uses useAtomValue for proper React integration)
// ============================================================================

interface ChildListProps<TSelection> {
    parentId: string
    parentLabel: string
    adapter: EntitySelectionAdapter<TSelection>
    childLevelConfig: HierarchyLevel<unknown>
    listAtom: Atom<ListQueryState<unknown>>
    onSelect: (selection: TSelection) => void
    selectedChildId?: string | null
}

function ChildList<TSelection = EntitySelectionResult>({
    parentId,
    parentLabel,
    adapter,
    childLevelConfig,
    listAtom,
    onSelect,
    selectedChildId,
}: ChildListProps<TSelection>) {
    const [searchTerm, setSearchTerm] = useState("")

    // Use useAtomValue to properly subscribe and trigger the query
    const queryState = useAtomValue(listAtom) as ListQueryState<unknown>
    const children = queryState.data ?? []
    const isLoading = queryState.isPending

    // Filter children by search
    const filteredChildren = useMemo(() => {
        return defaultFilter(children, searchTerm, (item) => childLevelConfig.getLabel(item))
    }, [children, searchTerm, childLevelConfig])

    // Handle child selection
    const handleChildSelect = useCallback(
        (childEntity: unknown) => {
            const parentPathItem: SelectionPathItem = {
                type: adapter.hierarchy.levels[0].type,
                id: parentId,
                label: parentLabel,
            }

            const childPathItem: SelectionPathItem = {
                type: childLevelConfig.type,
                id: childLevelConfig.getId(childEntity),
                label: childLevelConfig.getLabel(childEntity),
            }

            const fullPath = [parentPathItem, childPathItem]
            const selection = adapter.toSelection(fullPath, childEntity)
            onSelect(selection)
        },
        [adapter, parentId, parentLabel, childLevelConfig, onSelect],
    )

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-4 px-6 min-w-[200px]">
                <Spin size="small" />
                <span className="ml-2 text-gray-500">Loading...</span>
            </div>
        )
    }

    if (filteredChildren.length === 0) {
        return (
            <div className="py-4 px-6 min-w-[200px]">
                <Empty
                    description={searchTerm ? "No matches" : "No revisions"}
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
            </div>
        )
    }

    return (
        <div className="min-w-[220px] max-w-[320px]">
            {children.length > 5 && (
                <div className="p-2 border-b border-gray-100">
                    <SearchInput
                        value={searchTerm}
                        onChange={setSearchTerm}
                        placeholder={`Search ${childLevelConfig.type}s...`}
                        autoFocus={false}
                    />
                </div>
            )}
            <div className="max-h-[300px] overflow-y-auto p-2 space-y-1">
                {filteredChildren.map((child) => {
                    const childId = childLevelConfig.getId(child)
                    const label = childLevelConfig.getLabel(child)
                    const labelNode = childLevelConfig.getLabelNode?.(child)
                    const isSelected = childId === selectedChildId

                    return (
                        <EntityListItem
                            key={childId}
                            label={label}
                            labelNode={labelNode}
                            isSelectable
                            isSelected={isSelected}
                            onClick={() => handleChildSelect(child)}
                            onSelect={() => handleChildSelect(child)}
                        />
                    )
                })}
            </div>
        </div>
    )
}

// ============================================================================
// CHILD POPOVER CONTENT (wrapper that creates the atom)
// ============================================================================

interface ChildPopoverContentProps<TSelection> {
    parentId: string
    parentLabel: string
    adapter: EntitySelectionAdapter<TSelection>
    childLevelConfig: HierarchyLevel<unknown>
    onSelect: (selection: TSelection) => void
    selectedChildId?: string | null
}

function ChildPopoverContent<TSelection = EntitySelectionResult>({
    parentId,
    parentLabel,
    adapter,
    childLevelConfig,
    onSelect,
    selectedChildId,
}: ChildPopoverContentProps<TSelection>) {
    // Call onBeforeLoad to enable the query (e.g., for lazy-enabled queries)
    // This runs once when the popover content mounts
    useEffect(() => {
        childLevelConfig.onBeforeLoad?.(parentId)
    }, [childLevelConfig, parentId])

    // Create the list atom for this parent
    const listAtom = useMemo(() => {
        if (childLevelConfig.listAtomFamily) {
            return childLevelConfig.listAtomFamily(parentId)
        }
        if (childLevelConfig.listAtom) {
            return childLevelConfig.listAtom
        }
        return null
    }, [childLevelConfig, parentId])

    if (!listAtom) {
        return (
            <div className="py-4 px-6 min-w-[200px]">
                <Empty description="No revisions available" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            </div>
        )
    }

    return (
        <ChildList
            parentId={parentId}
            parentLabel={parentLabel}
            adapter={adapter}
            childLevelConfig={childLevelConfig}
            listAtom={listAtom}
            onSelect={onSelect}
            selectedChildId={selectedChildId}
        />
    )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * Entity list with hover popover for child selection
 *
 * @example
 * ```tsx
 * <EntityListWithPopover
 *   adapter="testset"
 *   onSelect={(selection) => {
 *     console.log('Selected:', selection.metadata)
 *   }}
 *   selectedParentId={selectedTestsetId}
 *   selectedChildId={selectedRevisionId}
 *   showSearch
 * />
 * ```
 */
export function EntityListWithPopover<TSelection = EntitySelectionResult>({
    adapter: adapterOrName,
    onSelect,
    selectedParentId,
    selectedChildId,
    showSearch = true,
    emptyMessage,
    loadingMessage,
    maxHeight = 400,
    className = "",
    popoverPlacement = "rightTop",
    popoverTrigger = "hover",
    autoSelectFirst = false,
    onParentHover,
    onParentClick,
}: EntityListWithPopoverProps<TSelection>) {
    const [searchTerm, setSearchTerm] = useState("")
    const hasAutoSelectedRef = useRef(false)

    // Resolve adapter
    const adapter = useMemo(
        () => resolveAdapter(adapterOrName) as EntitySelectionAdapter<TSelection>,
        [adapterOrName],
    )

    // Get level configs
    const parentLevelConfig = adapter.hierarchy.levels[0]
    const childLevelConfig = adapter.hierarchy.levels[1]

    // Validate adapter has exactly 2 levels
    if (adapter.hierarchy.levels.length !== 2) {
        console.warn(
            `EntityListWithPopover requires an adapter with exactly 2 levels, got ${adapter.hierarchy.levels.length}`,
        )
    }

    // Get display messages
    const displayEmptyMessage = emptyMessage ?? adapter.emptyMessage ?? "No items found"
    const displayLoadingMessage = loadingMessage ?? adapter.loadingMessage ?? "Loading..."

    // Use useAtomValue to properly subscribe and trigger the parent query
    const parentListAtom = parentLevelConfig?.listAtom
    const parentQueryState = useAtomValue(
        parentListAtom ?? emptyListAtom,
    ) as ListQueryState<unknown>
    const parentItems = parentQueryState.data ?? []
    const isLoading = parentQueryState.isPending

    // Filter parents by search
    const filteredParents = useMemo(() => {
        if (!parentLevelConfig) return []
        return defaultFilter(parentItems, searchTerm, (item) => parentLevelConfig.getLabel(item))
    }, [parentItems, searchTerm, parentLevelConfig])

    // Auto-select first parent if enabled
    useEffect(() => {
        if (
            !autoSelectFirst ||
            hasAutoSelectedRef.current ||
            isLoading ||
            filteredParents.length === 0 ||
            selectedParentId
        ) {
            return
        }

        hasAutoSelectedRef.current = true
        const firstParent = filteredParents[0]
        const parentId = parentLevelConfig.getId(firstParent)
        onParentHover?.(parentId)
    }, [
        autoSelectFirst,
        isLoading,
        filteredParents,
        selectedParentId,
        parentLevelConfig,
        onParentHover,
    ])

    // Handle selection callback
    const handleSelect = useCallback(
        (selection: TSelection) => {
            onSelect?.(selection)
        },
        [onSelect],
    )

    // Render loading state
    if (isLoading) {
        return (
            <div className={`flex flex-col ${className}`}>
                <div className="flex items-center justify-center py-8">
                    <Spin size="default" />
                    <span className="ml-2 text-gray-500">{displayLoadingMessage}</span>
                </div>
            </div>
        )
    }

    // Render empty state
    if (filteredParents.length === 0) {
        return (
            <div className={`flex flex-col ${className}`}>
                {showSearch && parentItems.length > 0 && (
                    <div className="mb-3">
                        <SearchInput
                            value={searchTerm}
                            onChange={setSearchTerm}
                            placeholder={`Search ${parentLevelConfig?.type ?? "items"}...`}
                            autoFocus={false}
                        />
                    </div>
                )}
                <Empty description={displayEmptyMessage} image={Empty.PRESENTED_IMAGE_SIMPLE} />
            </div>
        )
    }

    return (
        <div className={`flex flex-col ${className}`}>
            {/* Search input */}
            {showSearch && (
                <div className="mb-3">
                    <SearchInput
                        value={searchTerm}
                        onChange={setSearchTerm}
                        placeholder={`Search ${parentLevelConfig?.type ?? "items"}...`}
                        autoFocus={false}
                    />
                </div>
            )}

            {/* Parent items list with hover popovers */}
            <div
                className="overflow-y-auto"
                style={{
                    maxHeight: typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight,
                }}
            >
                <div className="space-y-1">
                    {filteredParents.map((parent) => {
                        const parentId = parentLevelConfig.getId(parent)
                        const label = parentLevelConfig.getLabel(parent)
                        const labelNode = parentLevelConfig.getLabelNode?.(parent)
                        const description = parentLevelConfig.getDescription?.(parent)
                        const icon = parentLevelConfig.getIcon?.(parent)
                        const isSelected = parentId === selectedParentId

                        return (
                            <Popover
                                key={parentId}
                                placement={popoverPlacement}
                                trigger={popoverTrigger}
                                arrow={false}
                                overlayInnerStyle={{padding: 0}}
                                onOpenChange={(open) => {
                                    if (open) {
                                        onParentHover?.(parentId)
                                    }
                                }}
                                content={
                                    <ChildPopoverContent
                                        parentId={parentId}
                                        parentLabel={label}
                                        adapter={adapter}
                                        childLevelConfig={childLevelConfig}
                                        onSelect={handleSelect}
                                        selectedChildId={
                                            parentId === selectedParentId ? selectedChildId : null
                                        }
                                    />
                                }
                            >
                                <div
                                    onClick={
                                        onParentClick
                                            ? () => onParentClick(parentId, label)
                                            : undefined
                                    }
                                    className={onParentClick ? "cursor-pointer" : undefined}
                                >
                                    <EntityListItem
                                        label={label}
                                        labelNode={labelNode}
                                        description={description}
                                        icon={icon}
                                        hasChildren
                                        isSelectable={!!onParentClick}
                                        isSelected={isSelected}
                                        onClick={
                                            onParentClick
                                                ? () => onParentClick(parentId, label)
                                                : undefined
                                        }
                                    />
                                </div>
                            </Popover>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
