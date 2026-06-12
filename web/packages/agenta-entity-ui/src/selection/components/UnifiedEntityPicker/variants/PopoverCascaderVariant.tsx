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

import React, {useCallback, useEffect, useMemo, useRef, useState, type CSSProperties} from "react"

import {cn} from "@agenta/ui"
import {EntityListItem, SearchInput} from "@agenta/ui/components/selection"
import {CaretDown, Plus, X} from "@phosphor-icons/react"
import {Button, Checkbox, Empty, Popover, Spin, Tabs} from "antd"

import {useEntitySelectionCore} from "../../../hooks/useEntitySelectionCore"
import {useLevelData} from "../../../hooks/utilities"
import type {EntitySelectionResult, HierarchyLevel, SelectionPathItem} from "../../../types"
import {AutoSelectHandler, getParentCheckboxState} from "../shared/AutoSelectHandler"
import type {PopoverCascaderVariantProps} from "../types"

const POPOVER_CASCADER_TEST_IDS = {
    content: "popover-cascader-content",
    rootPanel: "popover-cascader-root-panel",
    childPanel: "popover-cascader-child-panel",
} as const

// ============================================================================
// CHILD PANEL (internal component)
// ============================================================================

/**
 * Renders the right-side child panel with:
 * - Header showing parent name + selection count (multi-select)
 * - List of child items (checkboxes in multi-select, click in single-select)
 */
function ChildPanelContent({
    parentId,
    parentLabel,
    childLevelConfig,
    onSelect,
    selectedId,
    maxHeight,
    panelStyle,
    disabledIds,
    disabledTooltip,
    // Multi-select props
    multiSelect = false,
    selectedChildIds,
    childItemLabelMode = "full",
    showSelectAll = false,
}: {
    parentId: string
    parentLabel: string
    childLevelConfig: HierarchyLevel<unknown>
    onSelect: (child: unknown) => void
    selectedId?: string | null
    maxHeight: number
    panelStyle: CSSProperties
    disabledIds?: Set<string>
    disabledTooltip?: string
    // Multi-select props
    multiSelect?: boolean
    selectedChildIds?: Set<string>
    childItemLabelMode?: "full" | "simple"
    showSelectAll?: boolean
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

    // Select every enabled child that isn't selected yet. Only unselected items
    // are passed to onSelect, which has toggle semantics in multi-select mode.
    const handleSelectAll = useCallback(() => {
        for (const item of enabledChildren) {
            if (!selectedChildIds?.has(childLevelConfig.getId(item))) {
                onSelect(item)
            }
        }
    }, [enabledChildren, selectedChildIds, childLevelConfig, onSelect])

    if (query.isPending) {
        return (
            <div className="flex items-center justify-center py-4 px-6" style={panelStyle}>
                <Spin size="small" />
            </div>
        )
    }

    return (
        <div data-testid={POPOVER_CASCADER_TEST_IDS.childPanel} style={panelStyle}>
            {/* Child panel header */}
            {multiSelect && (
                <div className="px-3 py-2 border-0 border-b border-solid border-[var(--ag-rgba-051729-06)] bg-[var(--ag-c-05172905)] h-8 flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span
                            className="block truncate text-[10px] font-medium"
                            title={parentLabel}
                        >
                            {parentLabel}
                        </span>
                        {multiSelect && (
                            <span className="text-zinc-500 text-[10px]">
                                {selectedCount} of {filteredItems.length} selected
                            </span>
                        )}
                    </div>
                    {showSelectAll &&
                        enabledChildren.length > 0 &&
                        selectedCount < enabledChildren.length && (
                            <Button
                                type="link"
                                size="small"
                                className="shrink-0 !h-auto !p-0 !text-[10px]"
                                onClick={handleSelectAll}
                            >
                                Select all
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
                                        : "cursor-pointer hover:bg-[var(--ag-rgba-051729-04)]",
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
// SELECTED CHILD CHIPS (rendered under a root item's label)
// ============================================================================

/**
 * Compact removable chips for a root item's selected children (e.g. "v2 ×").
 * Only the "×" stops propagation (it deselects); clicks anywhere else in the
 * chips row bubble up to the row so they open the child panel like the rest
 * of the row body.
 */
function SelectedChildChips({
    chips,
    onDeselectChild,
}: {
    chips: {id: string; label: string}[]
    onDeselectChild?: (childId: string) => void
}) {
    return (
        <div className="flex flex-wrap gap-1 mt-0.5">
            {chips.map((chip) => (
                <span
                    key={chip.id}
                    className="inline-flex items-center gap-1 rounded bg-[var(--ag-rgba-051729-06)] px-1.5 py-0.5 text-[10px] leading-none"
                >
                    {chip.label}
                    <X
                        size={10}
                        className="cursor-pointer opacity-60 hover:opacity-100"
                        onClick={(e) => {
                            e.stopPropagation()
                            onDeselectChild?.(chip.id)
                        }}
                    />
                </span>
            ))}
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
    showParentCheckboxes = false,
    selectedChildrenByParent,
    totalChildrenByParent,
    onParentCheckboxChange,
    onDeselectChild,
    isParentSelectionPending = false,
    showParentDescription = false,
}: {
    item: unknown
    rootLevel: HierarchyLevel<unknown>
    totalLevels: number
    selectedParentId?: string | null
    selectedRootId: string | null
    openChildOnHover: boolean
    onRootItemClick: (item: unknown) => void
    showParentCheckboxes?: boolean
    selectedChildrenByParent?: Map<string, {id: string; label: string}[]>
    totalChildrenByParent?: Map<string, number>
    onParentCheckboxChange: (item: unknown, checked: boolean) => void
    onDeselectChild?: (childId: string) => void
    isParentSelectionPending?: boolean
    showParentDescription?: boolean
}) {
    const id = rootLevel.getId(item)

    const selectedChildren = selectedChildrenByParent?.get(id)
    const selectedCount = selectedChildren?.length ?? 0
    const totalChildren = totalChildrenByParent?.get(id)
    const {checked: isChecked, indeterminate: isIndeterminate} = getParentCheckboxState(
        selectedCount,
        totalChildren,
    )

    // Checkbox toggles selection only; clicks must not bubble to the row
    // (which opens the child panel).
    const prefixNode = showParentCheckboxes ? (
        <span onClick={(e) => e.stopPropagation()} className="flex items-center">
            <Checkbox
                checked={isChecked}
                indeterminate={isIndeterminate}
                disabled={isParentSelectionPending}
                onChange={() => onParentCheckboxChange(item, !isChecked)}
            />
        </span>
    ) : undefined

    // Subtitle metadata is replaced by the selected-child chips when present.
    const description =
        showParentDescription && selectedCount === 0 ? rootLevel.getDescription?.(item) : undefined

    const footerNode =
        selectedCount > 0 && selectedChildren ? (
            <SelectedChildChips chips={selectedChildren} onDeselectChild={onDeselectChild} />
        ) : undefined

    return (
        <div
            onMouseEnter={
                openChildOnHover && totalLevels > 1 ? () => onRootItemClick(item) : undefined
            }
        >
            <EntityListItem
                label={rootLevel.getLabel(item)}
                labelNode={rootLevel.getLabelNode?.(item)}
                description={description}
                prefixNode={prefixNode}
                footerNode={footerNode}
                suffixNode={rootLevel.getSuffixNode?.(item)}
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
    panelWidth,
    childPanelWidth,
    defaultOpenChildPanel = false,
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
    selectionSummary,
    childItemLabelMode = "full",
    // Parent multi-select props
    showParentCheckboxes = false,
    selectedChildrenByParent,
    totalChildrenByParent,
    onDeselectChild,
    // Root row metadata
    showParentDescription = false,
    // Group headers
    showGroupHeaders = false,
    // Bulk actions
    showChildSelectAll = false,
    onClearAll,
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
    const [pendingParentSelection, setPendingParentSelection] = useState<{
        id: string
        label: string
    } | null>(null)
    const pendingCreateRef = useRef(false)

    // Active tab state — always starts on "all", reset on close
    const [activeTabKey, setActiveTabKey] = useState<string>("all")

    // Fetch root items
    const {items: rootItems, query: rootQuery} = useLevelData({
        levelConfig: rootLevel,
        parentId: null,
        isEnabled: true,
    })

    // Derive tabs dynamically from loaded items (adapter provides buildTabs function)
    const tabs = useMemo(() => rootLevel?.buildTabs?.(rootItems) ?? null, [rootItems, rootLevel])

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

    const resolvedPanelWidth = panelWidth ?? panelMinWidth
    const resolvedChildWidth = childPanelWidth ?? resolvedPanelWidth
    const isChildPanelVisible = selectedRootId !== null && totalLevels > 1

    // Keep the total popover width stable when the child panel opens. While
    // closed, the root panel occupies both configured panel widths.
    const panelStyle = useMemo<CSSProperties>(
        () => ({
            width: isChildPanelVisible
                ? resolvedPanelWidth
                : resolvedPanelWidth + (totalLevels > 1 ? resolvedChildWidth : 0),
        }),
        [isChildPanelVisible, resolvedPanelWidth, resolvedChildWidth, totalLevels],
    )

    const childPanelStyle = useMemo<CSSProperties>(
        () => ({width: resolvedChildWidth}),
        [resolvedChildWidth],
    )

    const childPanelOuterStyle = useMemo<CSSProperties>(
        () => ({width: resolvedChildWidth}),
        [resolvedChildWidth],
    )

    // Keep a user-opened child panel aligned with the filtered root list. The
    // initial/default opening behavior remains opt-in.
    useEffect(() => {
        if (!open || totalLevels <= 1) return

        // Wait until rootItems are loaded
        if (rootQuery.isPending && rootItems.length === 0) return

        // If something is already selected locally, ensure it's still in the filtered view
        if (selectedRootId) {
            const stillExists = tabFilteredRootItems.some(
                (item) => rootLevel.getId(item) === selectedRootId,
            )
            if (stillExists) return

            setSelectedRootId(null)
            setSelectedRootEntity(null)
        }

        if (!defaultOpenChildPanel) return

        // Prefer the controlled parent selection when default opening is enabled.
        if (selectedParentId) {
            const matchingRoot = tabFilteredRootItems.find(
                (item) => rootLevel.getId(item) === selectedParentId,
            )
            if (matchingRoot) {
                setSelectedRootId(selectedParentId)
                setSelectedRootEntity(matchingRoot)
                hierarchyLevels[1]?.onBeforeLoad?.(selectedParentId)
                return
            }
        }

        // Otherwise open the first available item without selecting a child.
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
        defaultOpenChildPanel,
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

    const handleParentCheckboxChange = useCallback(
        (parentEntity: unknown, checked: boolean) => {
            if (pendingParentSelection) return

            const parentId = rootLevel.getId(parentEntity)
            if (!checked) {
                selectedChildrenByParent
                    ?.get(parentId)
                    ?.forEach((child) => onDeselectChild?.(child.id))
                return
            }

            const childLevel = hierarchyLevels[1]
            if (!childLevel) return

            childLevel.onBeforeLoad?.(parentId)
            setPendingParentSelection({
                id: parentId,
                label: rootLevel.getLabel(parentEntity),
            })
        },
        [
            hierarchyLevels,
            onDeselectChild,
            pendingParentSelection,
            rootLevel,
            selectedChildrenByParent,
        ],
    )

    // Reset state when popover closes
    const handleOpenChange = useCallback((newOpen: boolean) => {
        setOpen(newOpen)
        if (!newOpen) {
            setSearchTerm("")
            setSelectedRootId(null)
            setSelectedRootEntity(null)
            setActiveTabKey("all")
        }
    }, [])

    const handleCreateNew = useCallback(() => {
        pendingCreateRef.current = true
        setOpen(false)
    }, [])

    const handleAfterOpenChange = useCallback(
        (isOpen: boolean) => {
            if (isOpen || !pendingCreateRef.current) return
            pendingCreateRef.current = false
            onCreateNew?.()
        },
        [onCreateNew],
    )

    // Shared props for RootItemRenderer
    const rootItemProps = useMemo(
        () => ({
            rootLevel,
            totalLevels,
            selectedParentId,
            selectedRootId,
            openChildOnHover,
            onRootItemClick: handleRootItemClick,
            showParentCheckboxes,
            selectedChildrenByParent,
            totalChildrenByParent,
            onParentCheckboxChange: handleParentCheckboxChange,
            onDeselectChild,
            isParentSelectionPending: pendingParentSelection !== null,
            showParentDescription,
        }),
        [
            rootLevel,
            totalLevels,
            selectedParentId,
            selectedRootId,
            openChildOnHover,
            handleRootItemClick,
            showParentCheckboxes,
            selectedChildrenByParent,
            totalChildrenByParent,
            handleParentCheckboxChange,
            onDeselectChild,
            pendingParentSelection,
            showParentDescription,
        ],
    )

    // Popover content
    const content = (
        <div className="flex flex-col" data-testid={POPOVER_CASCADER_TEST_IDS.content}>
            {/* HEADER ROW: Search + Action Button */}
            <div className="flex items-center gap-2 p-2 pb-2 border-0 border-b border-solid border-[var(--ag-rgba-051729-06)]">
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
                        "border-0 border-b border-solid border-[var(--ag-rgba-051729-06)]",
                    )}
                />
            )}

            {/* PANELS: Root + Child side-by-side */}
            <div className="flex">
                {/* ROOT PANEL */}
                <div
                    data-testid={POPOVER_CASCADER_TEST_IDS.rootPanel}
                    className="flex flex-col border-0 border-r border-solid border-[var(--ag-rgba-051729-06)]"
                    style={panelStyle}
                >
                    {/* Selection summary */}
                    {selectionSummaryText ? (
                        <div className="px-3 py-2 border-0 border-b border-solid border-[var(--ag-rgba-051729-06)] bg-[var(--ag-c-05172905)] h-8 flex items-center justify-between">
                            <span className="text-zinc-500 text-[10px]">
                                {selectionSummaryText}
                            </span>
                            {onClearAll && (selectedChildIds?.size ?? 0) > 0 && (
                                <Button
                                    type="link"
                                    size="small"
                                    className="!h-auto !p-0 !text-[10px]"
                                    onClick={onClearAll}
                                >
                                    Clear all
                                </Button>
                            )}
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
                                            {showGroupHeaders && (
                                                <div className="flex items-center gap-2 px-2 pt-2 pb-1">
                                                    <span className="text-[10px] font-medium text-zinc-400">
                                                        {rootLevel.getGroupLabel?.(groupKey) ??
                                                            groupKey}
                                                    </span>
                                                    <div className="flex-1 h-px bg-[var(--ag-rgba-051729-06)]" />
                                                </div>
                                            )}
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
                                {groupedItems.ungrouped.length > 0 && (
                                    <div>
                                        {showGroupHeaders && groupedItems.groups.size > 0 && (
                                            <div className="flex items-center gap-2 px-2 pt-2 pb-1">
                                                <span className="text-[10px] font-medium text-zinc-400">
                                                    Other
                                                </span>
                                                <div className="flex-1 h-px bg-[var(--ag-rgba-051729-06)]" />
                                            </div>
                                        )}
                                        {groupedItems.ungrouped.map((item) => (
                                            <RootItemRenderer
                                                key={rootLevel.getId(item)}
                                                item={item}
                                                {...rootItemProps}
                                            />
                                        ))}
                                    </div>
                                )}
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
                    <div className="flex flex-col" style={childPanelOuterStyle}>
                        <ChildPanelContent
                            parentId={selectedRootId}
                            parentLabel={rootLevel.getLabel(selectedRootEntity!)}
                            childLevelConfig={hierarchyLevels[1]}
                            onSelect={handleChildSelect}
                            selectedId={
                                selectedRootId === selectedParentId ? selectedChildId : null
                            }
                            maxHeight={maxHeight}
                            panelStyle={childPanelStyle}
                            disabledIds={disabledChildIds}
                            disabledTooltip={disabledChildTooltip}
                            multiSelect={multiSelect}
                            selectedChildIds={selectedChildIds}
                            childItemLabelMode={childItemLabelMode}
                            showSelectAll={showChildSelectAll}
                        />
                    </div>
                )}
            </div>
        </div>
    )

    return (
        <>
            {pendingParentSelection && hierarchyLevels[1] ? (
                <AutoSelectHandler
                    parentId={pendingParentSelection.id}
                    parentLabel={pendingParentSelection.label}
                    parentLevelConfig={rootLevel}
                    childLevelConfig={hierarchyLevels[1]}
                    disabledChildIds={disabledChildIds}
                    selectedChildIds={selectedChildIds}
                    selectionMode="all"
                    createSelection={createSelection}
                    onSelect={onSelect}
                    onComplete={() => setPendingParentSelection(null)}
                />
            ) : null}
            <Popover
                content={content}
                trigger="click"
                open={open}
                onOpenChange={handleOpenChange}
                afterOpenChange={handleAfterOpenChange}
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
                        className
                            ? `flex items-center gap-1 ${className}`
                            : "flex items-center gap-1"
                    }
                >
                    {icon}
                    {placeholder}
                    {showDropdownIcon ? <CaretDown size={10} /> : null}
                </Button>
            </Popover>
        </>
    )
}
