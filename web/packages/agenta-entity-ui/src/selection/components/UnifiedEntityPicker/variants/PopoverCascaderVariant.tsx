/**
 * PopoverCascaderVariant Component
 *
 * Button-triggered popover with side-by-side cascading panels.
 * The left panel shows root items with search + optional create/footer actions.
 * The right panel shows children when a root item is selected.
 *
 * Supports:
 * - Adapter-driven tabs for filtering root items by group
 * - Grouped item display with section headers
 * - Multi-select mode with checkboxes in child panel
 * - Selection summary and child panel header
 *
 * Pattern: Button trigger → Popover → [Root Panel | Child Panel]
 */

import React, {useCallback, useEffect, useMemo, useState} from "react"

import {cn} from "@agenta/ui"
import {EntityListItem, SearchInput} from "@agenta/ui/components/selection"
import {CaretDown, Plus} from "@phosphor-icons/react"
import {Button, Checkbox, Empty, Popover, Spin, Tabs} from "antd"

import {useEntitySelectionCore} from "../../../hooks/useEntitySelectionCore"
import {useLevelData} from "../../../hooks/utilities"
import type {EntitySelectionResult, HierarchyLevel, SelectionPathItem} from "../../../types"
import type {PopoverCascaderVariantProps} from "../types"

// ============================================================================
// CHILD PANEL (internal component)
// ============================================================================

/**
 * Renders the right-side child panel with:
 * - Header showing parent name + selection count (multi-select)
 * - List of child items (checkboxes in multi-select, click in single-select)
 */
function ChildPanelContent<TSelection = EntitySelectionResult>({
    parentId,
    parentLabel,
    childLevelConfig,
    onSelect,
    selectedId,
    maxHeight,
    panelWidth,
    disabledIds,
    disabledTooltip,
    // Multi-select props
    multiSelect = false,
    selectedChildIds,
    onSelectAll,
    createSelection,
    rootLevel,
    rootEntity,
    hierarchyLevels,
    childItemLabelMode = "full",
}: {
    parentId: string
    parentLabel: string
    childLevelConfig: HierarchyLevel<unknown>
    onSelect: (child: unknown) => void
    selectedId?: string | null
    maxHeight: number
    panelWidth: number
    disabledIds?: Set<string>
    disabledTooltip?: string
    // Multi-select props
    multiSelect?: boolean
    selectedChildIds?: Set<string>
    onSelectAll?: (
        selections: TSelection[],
        action: "select" | "deselect",
        parentId: string,
    ) => void
    createSelection?: (path: SelectionPathItem[], leafEntity: unknown) => TSelection
    rootLevel?: HierarchyLevel<unknown>
    rootEntity?: unknown
    hierarchyLevels?: HierarchyLevel<unknown>[]
    childItemLabelMode?: "full" | "simple"
}) {
    const {items, query} = useLevelData({
        levelConfig: childLevelConfig,
        parentId,
        isEnabled: true,
    })

    const filteredItems = useMemo(() => {
        if (!childLevelConfig.filterItems) return items
        return items.filter(childLevelConfig.filterItems)
    }, [items, childLevelConfig])

    const getItemLabelNode = useMemo(
        () =>
            childItemLabelMode === "full" && childLevelConfig.getLabelNode
                ? (item: unknown) => childLevelConfig.getLabelNode!(item)
                : undefined,
        [childLevelConfig, childItemLabelMode],
    )

    // Multi-select derived state
    const enabledChildren = useMemo(
        () => filteredItems.filter((item) => !disabledIds?.has(childLevelConfig.getId(item))),
        [filteredItems, disabledIds, childLevelConfig],
    )

    const selectedCount =
        multiSelect && selectedChildIds
            ? enabledChildren.filter((item) => selectedChildIds.has(childLevelConfig.getId(item)))
                  .length
            : 0

    const allSelected =
        multiSelect && selectedCount === enabledChildren.length && enabledChildren.length > 0

    const handleSelectAll = useCallback(() => {
        if (!onSelectAll || !createSelection || !rootLevel || !rootEntity || !hierarchyLevels)
            return

        const childLevel = hierarchyLevels[1]
        if (!childLevel) return

        if (allSelected) {
            // Deselect all — send full items and 'deselect'
            const allSelections = enabledChildren.map((childEntity) => {
                const path: SelectionPathItem[] = [
                    {type: rootLevel.type, id: parentId, label: parentLabel},
                    {
                        type: childLevel.type,
                        id: childLevel.getId(childEntity),
                        label: childLevel.getLabel(childEntity),
                    },
                ]
                return createSelection(path, childEntity)
            })
            onSelectAll(allSelections, "deselect", parentId)
        } else {
            // Select all unselected enabled children
            const unselected = enabledChildren.filter(
                (item) => !selectedChildIds?.has(childLevelConfig.getId(item)),
            )
            const selections = unselected.map((childEntity) => {
                const path: SelectionPathItem[] = [
                    {type: rootLevel.type, id: parentId, label: parentLabel},
                    {
                        type: childLevel.type,
                        id: childLevel.getId(childEntity),
                        label: childLevel.getLabel(childEntity),
                    },
                ]
                return createSelection(path, childEntity)
            })
            onSelectAll(selections, "select", parentId)
        }
    }, [
        onSelectAll,
        createSelection,
        rootLevel,
        rootEntity,
        hierarchyLevels,
        allSelected,
        enabledChildren,
        selectedChildIds,
        childLevelConfig,
        parentId,
        parentLabel,
    ])

    if (query.isPending) {
        return (
            <div
                className="flex items-center justify-center py-4 px-6"
                style={{minWidth: panelWidth}}
            >
                <Spin size="small" />
            </div>
        )
    }

    return (
        <div style={{minWidth: panelWidth, maxWidth: panelWidth}}>
            {/* Child panel header */}
            {multiSelect && (
                <div className="px-3 py-2 border-0 border-b border-solid border-[rgba(5,23,41,0.06)] bg-[#05172905] h-8 flex items-start justify-between">
                    <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] font-medium truncate" title={parentLabel}>
                            {parentLabel}
                        </span>
                        {multiSelect && (
                            <span className="text-zinc-500 text-[10px]">
                                {selectedCount} of {filteredItems.length} selected
                            </span>
                        )}
                    </div>
                    {multiSelect && enabledChildren.length > 0 && (
                        <Button type="text" onClick={handleSelectAll} size="small">
                            {allSelected ? "Deselect all" : "Select all"}
                        </Button>
                    )}
                </div>
            )}

            {/* Child items */}
            <div className="overflow-y-auto py-1 px-1" style={{maxHeight}}>
                {filteredItems.length === 0 ? (
                    <Empty
                        description="No items"
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        className="my-4"
                    />
                ) : multiSelect ? (
                    // Multi-select: checkboxes
                    filteredItems.map((item) => {
                        const itemId = childLevelConfig.getId(item)
                        const label = childLevelConfig.getLabel(item)
                        const labelNode = getItemLabelNode?.(item)
                        const isDisabled = disabledIds?.has(itemId) ?? false
                        const isChecked = selectedChildIds?.has(itemId) ?? false

                        return (
                            <div
                                key={itemId}
                                className={cn(
                                    "flex items-center gap-2 px-2 py-1.5 rounded-md",
                                    isDisabled
                                        ? "opacity-50 cursor-not-allowed"
                                        : "cursor-pointer hover:bg-[rgba(5,23,41,0.04)]",
                                )}
                                onClick={() => {
                                    if (!isDisabled) onSelect(item)
                                }}
                            >
                                <Checkbox
                                    checked={isChecked}
                                    disabled={isDisabled}
                                    className="pointer-events-none"
                                />
                                <span className="truncate text-sm" title={label}>
                                    {labelNode ?? label}
                                </span>
                            </div>
                        )
                    })
                ) : (
                    // Single-select: click items
                    filteredItems.map((item) => {
                        const itemId = childLevelConfig.getId(item)
                        const label = childLevelConfig.getLabel(item)
                        const labelNode = getItemLabelNode?.(item)
                        const isSelected = itemId === selectedId
                        const isDisabled = disabledIds?.has(itemId) ?? false

                        return (
                            <EntityListItem
                                key={itemId}
                                label={label}
                                labelNode={labelNode}
                                isSelectable={!isDisabled}
                                isSelected={isSelected}
                                isDisabled={isDisabled}
                                onClick={() => !isDisabled && onSelect(item)}
                                onSelect={() => !isDisabled && onSelect(item)}
                                className="!py-1.5"
                            />
                        )
                    })
                )}
            </div>
        </div>
    )
}

// ============================================================================
// ROOT ITEM RENDERER (shared between grouped and flat rendering)
// ============================================================================

function RootItemRenderer({
    item,
    rootLevel,
    totalLevels,
    selectedParentId,
    selectedRootId,
    openChildOnHover,
    onRootItemClick,
}: {
    item: unknown
    rootLevel: HierarchyLevel<unknown>
    totalLevels: number
    selectedParentId?: string | null
    selectedRootId: string | null
    openChildOnHover: boolean
    onRootItemClick: (item: unknown) => void
}) {
    const id = rootLevel.getId(item)
    return (
        <div
            onMouseEnter={
                openChildOnHover && totalLevels > 1 ? () => onRootItemClick(item) : undefined
            }
        >
            <EntityListItem
                label={rootLevel.getLabel(item)}
                labelNode={rootLevel.getLabelNode?.(item)}
                hasChildren={totalLevels > 1}
                isSelectable={totalLevels <= 1}
                isSelected={id === selectedParentId}
                isHovered={id === selectedRootId}
                onClick={() => onRootItemClick(item)}
                onSelect={() => onRootItemClick(item)}
            />
        </div>
    )
}

// ============================================================================
// COMPONENT
// ============================================================================

export function PopoverCascaderVariant<TSelection = EntitySelectionResult>({
    adapter: adapterProp,
    onSelect,
    instanceId,
    className,
    disabled = false,
    size = "small",
    placeholder = "Select...",
    icon,
    showDropdownIcon = true,
    placement = "bottomLeft",
    panelMinWidth = 220,
    maxHeight = 340,
    popupFooter,
    onCreateNew,
    createNewLabel,
    selectedParentId,
    selectedChildId,
    disabledChildIds,
    disabledChildTooltip = "Already connected",
    openChildOnHover = false,
    // New props
    multiSelect = false,
    selectedChildIds,
    onSelectAll,
    selectionSummary,
    childItemLabelMode = "full",
}: PopoverCascaderVariantProps<TSelection>) {
    const {hierarchyLevels, createSelection} = useEntitySelectionCore({
        adapter: adapterProp,
        instanceId,
        onSelect,
    })

    const totalLevels = hierarchyLevels.length
    const rootLevel = hierarchyLevels[0]
    const rootLabel = rootLevel?.label ?? "Item"

    // Popover state
    const [open, setOpen] = useState(false)
    const [searchTerm, setSearchTerm] = useState("")
    const [selectedRootId, setSelectedRootId] = useState<string | null>(null)
    const [selectedRootEntity, setSelectedRootEntity] = useState<unknown>(null)

    // Tab state (driven by adapter's rootLevel.tabs)
    const tabs = rootLevel?.tabs
    const [activeTabKey, setActiveTabKey] = useState<string>(tabs?.[0]?.key ?? "all")

    // Fetch root items
    const {items: rootItems, query: rootQuery} = useLevelData({
        levelConfig: rootLevel,
        parentId: null,
        isEnabled: true,
    })

    // Filter root items by search
    const filteredRootItems = useMemo(() => {
        if (!searchTerm) return rootItems
        const term = searchTerm.toLowerCase()
        return rootItems.filter((item) => rootLevel.getLabel(item).toLowerCase().includes(term))
    }, [rootItems, searchTerm, rootLevel])

    // Filter by active tab
    const tabFilteredRootItems = useMemo(() => {
        if (!tabs || activeTabKey === "all") return filteredRootItems
        if (!rootLevel.getGroupKey) return filteredRootItems
        return filteredRootItems.filter((item) => rootLevel.getGroupKey!(item) === activeTabKey)
    }, [filteredRootItems, tabs, activeTabKey, rootLevel])

    // Group items for display (only when "all" tab is active and getGroupKey exists)
    const groupedItems = useMemo(() => {
        if (!tabs || activeTabKey !== "all" || !rootLevel.getGroupKey) {
            return null // No grouping — render flat list
        }
        const groups = new Map<string, unknown[]>()
        const ungrouped: unknown[] = []

        for (const item of tabFilteredRootItems) {
            const key = rootLevel.getGroupKey(item)
            if (key) {
                if (!groups.has(key)) groups.set(key, [])
                groups.get(key)!.push(item)
            } else {
                ungrouped.push(item)
            }
        }

        return {groups, ungrouped}
    }, [tabs, activeTabKey, rootLevel, tabFilteredRootItems])

    const selectionSummaryText = useMemo(() => {
        if (!selectionSummary) return null

        const selectionCount = selectedChildIds?.size ?? (selectedChildId ? 1 : 0)

        if (selectionCount === 0) return "No selections"
        if (selectionCount === 1) return "1 selected"
        return `${selectionCount} selected`
    }, [selectionSummary, selectedChildIds, selectedChildId])

    // Maintain auto-selection to prevent pixel shifts when searching/filtering
    useEffect(() => {
        if (!open || totalLevels <= 1) return

        // Wait until rootItems are loaded
        if (rootQuery.isPending && rootItems.length === 0) return

        // On open/mount, if we have a parent ID pre-selected and no root ID is selected locally yet
        if (!selectedRootId && selectedParentId) {
            const matchingRoot = rootItems.find(
                (item) => rootLevel.getId(item) === selectedParentId,
            )
            if (matchingRoot) {
                setSelectedRootId(selectedParentId)
                setSelectedRootEntity(matchingRoot)
                hierarchyLevels[1]?.onBeforeLoad?.(selectedParentId)
                return
            }
        }

        // If something is already selected locally, ensure it's still in the filtered view
        if (selectedRootId) {
            const stillExists = tabFilteredRootItems.some(
                (item) => rootLevel.getId(item) === selectedRootId,
            )
            if (stillExists) return
        }

        // Auto-select the first available item in the filtered view (UI ONLY, don't trigger selection)
        if (tabFilteredRootItems.length > 0) {
            const firstItem = tabFilteredRootItems[0]
            const id = rootLevel.getId(firstItem)
            setSelectedRootId(id)
            setSelectedRootEntity(firstItem)
            hierarchyLevels[1]?.onBeforeLoad?.(id)
        } else {
            setSelectedRootId(null)
            setSelectedRootEntity(null)
        }
    }, [
        open,
        totalLevels,
        selectedRootId,
        selectedParentId,
        tabFilteredRootItems,
        rootLevel,
        hierarchyLevels,
        rootQuery.isPending,
        rootItems,
    ])

    // Handle root item click
    const handleRootItemClick = useCallback(
        (entity: unknown) => {
            const id = rootLevel.getId(entity)

            if (totalLevels <= 1) {
                // Single-level: select immediately
                const path: SelectionPathItem[] = [
                    {type: rootLevel.type, id, label: rootLevel.getLabel(entity)},
                ]
                const selection = createSelection(path, entity)
                onSelect?.(selection)
                setOpen(false)
                return
            }

            // Multi-level: show child panel
            setSelectedRootId(id)
            setSelectedRootEntity(entity)

            // Trigger lazy load for child level
            hierarchyLevels[1]?.onBeforeLoad?.(id)
        },
        [rootLevel, hierarchyLevels, totalLevels, createSelection, onSelect],
    )

    // Handle child selection
    const handleChildSelect = useCallback(
        (childEntity: unknown) => {
            if (!selectedRootId || !selectedRootEntity) return

            const childLevel = hierarchyLevels[1]
            const path: SelectionPathItem[] = [
                {
                    type: rootLevel.type,
                    id: selectedRootId,
                    label: rootLevel.getLabel(selectedRootEntity),
                },
                {
                    type: childLevel.type,
                    id: childLevel.getId(childEntity),
                    label: childLevel.getLabel(childEntity),
                },
            ]

            const selection = createSelection(path, childEntity)
            onSelect?.(selection)

            // Only close popover in single-select mode
            if (!multiSelect) {
                setOpen(false)
                setSelectedRootId(null)
                setSelectedRootEntity(null)
            }
        },
        [
            selectedRootId,
            selectedRootEntity,
            rootLevel,
            hierarchyLevels,
            createSelection,
            onSelect,
            multiSelect,
        ],
    )

    // Reset state when popover closes
    const handleOpenChange = useCallback(
        (newOpen: boolean) => {
            setOpen(newOpen)
            if (!newOpen) {
                setSearchTerm("")
                setSelectedRootId(null)
                setSelectedRootEntity(null)
                setActiveTabKey(tabs?.[0]?.key ?? "all")
            }
        },
        [tabs],
    )

    const handleCreateNew = useCallback(() => {
        onCreateNew?.()
        setOpen(false)
    }, [onCreateNew])

    // Shared props for RootItemRenderer
    const rootItemProps = useMemo(
        () => ({
            rootLevel,
            totalLevels,
            selectedParentId,
            selectedRootId,
            openChildOnHover,
            onRootItemClick: handleRootItemClick,
        }),
        [
            rootLevel,
            totalLevels,
            selectedParentId,
            selectedRootId,
            openChildOnHover,
            handleRootItemClick,
        ],
    )

    // Popover content
    const content = (
        <div className="flex flex-col">
            {/* HEADER ROW: Search + Action Button */}
            <div className="flex items-center gap-2 p-2 pb-2 border-0 border-b border-solid border-[rgba(5,23,41,0.06)]">
                <div className="flex-1">
                    <SearchInput
                        value={searchTerm}
                        onChange={setSearchTerm}
                        placeholder={`Search ${rootLabel.toLowerCase()}...`}
                    />
                </div>
                {onCreateNew && (
                    <Button type="primary" icon={<Plus size={14} />} onClick={handleCreateNew}>
                        {createNewLabel ?? `New ${rootLabel}`}
                    </Button>
                )}
            </div>

            {/* TABS (optional, only when adapter provides tabs) */}
            {tabs && tabs.length > 0 && (
                <Tabs
                    activeKey={activeTabKey}
                    onChange={setActiveTabKey}
                    items={tabs.map((tab) => ({
                        key: tab.key,
                        label: tab.label,
                    }))}
                    size="small"
                    tabBarGutter={16}
                    className={cn(
                        "[&_.ant-tabs-nav]:px-3 [&_.ant-tabs-nav]:mb-0 [&_.ant-tabs-nav::before]:border-b-0",
                        "[&_.ant-tabs-tab]:text-xs [&_.ant-tabs-tab]:py-2",
                        "[&_.ant-tabs-nav-wrap]:pb-0",
                        "border-0 border-b border-solid border-[rgba(5,23,41,0.06)]",
                    )}
                />
            )}

            {/* PANELS: Root + Child side-by-side */}
            <div className="flex">
                {/* ROOT PANEL */}
                <div
                    className="flex flex-col border-0 border-r border-solid border-[rgba(5,23,41,0.06)]"
                    style={{minWidth: panelMinWidth}}
                >
                    {/* Selection summary */}
                    {selectionSummaryText ? (
                        <div className="px-3 py-2 border-0 border-b border-solid border-[rgba(5,23,41,0.06)] bg-[#05172905] h-8 flex items-center">
                            <span className="text-zinc-500 text-[10px]">
                                {selectionSummaryText}
                            </span>
                        </div>
                    ) : null}

                    {/* Root items */}
                    <div className="overflow-y-auto flex-1 py-0.5 px-1" style={{maxHeight}}>
                        {rootQuery.isPending ? (
                            <div className="flex items-center justify-center py-4">
                                <Spin size="small" />
                            </div>
                        ) : tabFilteredRootItems.length === 0 ? (
                            <Empty
                                description="No items found"
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                className="my-4"
                            />
                        ) : groupedItems ? (
                            // Grouped rendering (when "All" tab is active with getGroupKey)
                            <>
                                {Array.from(groupedItems.groups.entries()).map(
                                    ([groupKey, items]) => (
                                        <div key={groupKey}>
                                            <div className="px-2 pt-3 pb-1 text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                                                <span>
                                                    {rootLevel.getGroupLabel?.(groupKey) ??
                                                        groupKey}
                                                </span>
                                                <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700" />
                                            </div>
                                            {items.map((item) => (
                                                <RootItemRenderer
                                                    key={rootLevel.getId(item)}
                                                    item={item}
                                                    {...rootItemProps}
                                                />
                                            ))}
                                        </div>
                                    ),
                                )}
                                {groupedItems.ungrouped.length > 0 &&
                                    groupedItems.ungrouped.map((item) => (
                                        <RootItemRenderer
                                            key={rootLevel.getId(item)}
                                            item={item}
                                            {...rootItemProps}
                                        />
                                    ))}
                            </>
                        ) : (
                            // Flat rendering (no grouping)
                            tabFilteredRootItems.map((item) => (
                                <RootItemRenderer
                                    key={rootLevel.getId(item)}
                                    item={item}
                                    {...rootItemProps}
                                />
                            ))
                        )}
                    </div>

                    {/* Footer (e.g., Disconnect all) */}
                    {popupFooter}
                </div>

                {/* CHILD PANEL */}
                {selectedRootId && totalLevels > 1 && (
                    <div className="flex flex-col" style={{minWidth: panelMinWidth}}>
                        <ChildPanelContent<TSelection>
                            parentId={selectedRootId}
                            parentLabel={rootLevel.getLabel(selectedRootEntity!)}
                            childLevelConfig={hierarchyLevels[1]}
                            onSelect={handleChildSelect}
                            selectedId={
                                selectedRootId === selectedParentId ? selectedChildId : null
                            }
                            maxHeight={maxHeight}
                            panelWidth={panelMinWidth}
                            disabledIds={disabledChildIds}
                            disabledTooltip={disabledChildTooltip}
                            multiSelect={multiSelect}
                            selectedChildIds={selectedChildIds}
                            onSelectAll={onSelectAll}
                            createSelection={createSelection}
                            rootLevel={rootLevel}
                            rootEntity={selectedRootEntity}
                            hierarchyLevels={hierarchyLevels}
                            childItemLabelMode={childItemLabelMode}
                        />
                    </div>
                )}
            </div>
        </div>
    )

    return (
        <Popover
            content={content}
            trigger="click"
            open={open}
            onOpenChange={handleOpenChange}
            placement={placement}
            styles={{container: {padding: 0}}}
            arrow={false}
            destroyOnHidden
            autoAdjustOverflow
        >
            <Button
                size={size}
                disabled={disabled}
                className={
                    className ? `flex items-center gap-1 ${className}` : "flex items-center gap-1"
                }
            >
                {icon}
                {placeholder}
                {showDropdownIcon ? <CaretDown size={10} /> : null}
            </Button>
        </Popover>
    )
}
