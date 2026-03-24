/**
 * PopoverCascaderVariant Component
 *
 * Button-triggered popover with side-by-side cascading panels.
 * The left panel shows root items with search + optional create/footer actions.
 * The right panel shows children when a root item is selected.
 *
 * Pattern: Button trigger → Popover → [Root Panel | Child Panel]
 */

import React, {useCallback, useEffect, useMemo, useState} from "react"

import {EntityListItem, SearchInput, SearchablePopoverList} from "@agenta/ui/components/selection"
import {CaretDown, Plus} from "@phosphor-icons/react"
import {Button, Empty, Popover, Spin} from "antd"

import {useEntitySelectionCore} from "../../../hooks/useEntitySelectionCore"
import {useLevelData} from "../../../hooks/utilities"
import type {EntitySelectionResult, HierarchyLevel, SelectionPathItem} from "../../../types"
import type {PopoverCascaderVariantProps} from "../types"

// ============================================================================
// CHILD PANEL (internal component)
// ============================================================================

/**
 * Renders the right-side child panel using SearchablePopoverList.
 * Separate component because useLevelData hook needs a component boundary
 * for the dynamic parentId prop.
 */
function ChildPanelContent({
    parentId,
    childLevelConfig,
    onSelect,
    selectedId,
    maxHeight,
    panelWidth,
    disabledIds,
    disabledTooltip,
}: {
    parentId: string
    childLevelConfig: HierarchyLevel<unknown>
    onSelect: (child: unknown) => void
    selectedId?: string | null
    maxHeight: number
    panelWidth: number
    disabledIds?: Set<string>
    disabledTooltip?: string
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

    const getItemId = useCallback(
        (item: unknown) => childLevelConfig.getId(item),
        [childLevelConfig],
    )
    const getItemLabel = useCallback(
        (item: unknown) => childLevelConfig.getLabel(item),
        [childLevelConfig],
    )
    const getItemLabelNode = useMemo(
        () =>
            childLevelConfig.getLabelNode
                ? (item: unknown) => childLevelConfig.getLabelNode!(item)
                : undefined,
        [childLevelConfig],
    )

    return (
        <SearchablePopoverList
            items={filteredItems}
            selectedId={selectedId}
            onSelect={onSelect}
            getItemId={getItemId}
            getItemLabel={getItemLabel}
            getItemLabelNode={getItemLabelNode}
            isLoading={query.isPending}
            maxHeight={maxHeight}
            searchThreshold={Infinity}
            minWidth={panelWidth}
            maxWidth={panelWidth}
            itemClassName="!py-1.5"
            disabledIds={disabledIds}
            disabledTooltip={disabledTooltip}
        />
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

    useEffect(() => {
        if (!open || selectedRootId || !selectedParentId) return

        const matchingRoot = rootItems.find((item) => rootLevel.getId(item) === selectedParentId)
        if (!matchingRoot) return

        setSelectedRootId(selectedParentId)
        setSelectedRootEntity(matchingRoot)
        hierarchyLevels[1]?.onBeforeLoad?.(selectedParentId)
    }, [hierarchyLevels, open, rootItems, rootLevel, selectedParentId, selectedRootId])

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
            setOpen(false)
            setSelectedRootId(null)
            setSelectedRootEntity(null)
        },
        [selectedRootId, selectedRootEntity, rootLevel, hierarchyLevels, createSelection, onSelect],
    )

    // Reset state when popover closes
    const handleOpenChange = useCallback((newOpen: boolean) => {
        setOpen(newOpen)
        if (!newOpen) {
            setSearchTerm("")
            setSelectedRootId(null)
            setSelectedRootEntity(null)
        }
    }, [])

    const handleCreateNew = useCallback(() => {
        onCreateNew?.()
        setOpen(false)
    }, [onCreateNew])

    // Popover content
    const content = (
        <div className="flex">
            {/* ROOT PANEL */}
            <div className="flex flex-col" style={{minWidth: panelMinWidth}}>
                {/* Search */}
                <div className="p-2 pb-1">
                    <SearchInput
                        value={searchTerm}
                        onChange={setSearchTerm}
                        placeholder={`Search ${rootLabel.toLowerCase()}...`}
                    />
                </div>

                {/* Root items */}
                <div className="overflow-y-auto flex-1 py-0.5 px-1" style={{maxHeight}}>
                    {rootQuery.isPending ? (
                        <div className="flex items-center justify-center py-4">
                            <Spin size="small" />
                        </div>
                    ) : filteredRootItems.length === 0 ? (
                        <Empty
                            description="No items found"
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            className="my-4"
                        />
                    ) : (
                        filteredRootItems.map((item) => {
                            const id = rootLevel.getId(item)
                            return (
                                <div
                                    key={id}
                                    onMouseEnter={
                                        openChildOnHover && totalLevels > 1
                                            ? () => handleRootItemClick(item)
                                            : undefined
                                    }
                                >
                                    <EntityListItem
                                        label={rootLevel.getLabel(item)}
                                        labelNode={rootLevel.getLabelNode?.(item)}
                                        hasChildren={totalLevels > 1}
                                        isSelectable={totalLevels <= 1}
                                        isSelected={id === selectedParentId}
                                        isHovered={id === selectedRootId}
                                        onClick={() => handleRootItemClick(item)}
                                        onSelect={() => handleRootItemClick(item)}
                                    />
                                </div>
                            )
                        })
                    )}
                </div>

                {/* Create new button */}
                {onCreateNew && (
                    <div className="border-t border-solid border-[rgba(5,23,41,0.06)] px-2 py-1.5">
                        <Button
                            type="text"
                            size="small"
                            className="w-full flex items-center justify-start gap-1"
                            icon={<Plus size={14} />}
                            onClick={handleCreateNew}
                        >
                            {createNewLabel ?? `New ${rootLabel}`}
                        </Button>
                    </div>
                )}

                {/* Footer (e.g., Disconnect all) */}
                {popupFooter}
            </div>

            {/* CHILD PANEL */}
            {selectedRootId && totalLevels > 1 && (
                <div
                    className="border-l border-solid border-[rgba(5,23,41,0.06)]"
                    style={{minWidth: panelMinWidth}}
                >
                    <ChildPanelContent
                        parentId={selectedRootId}
                        childLevelConfig={hierarchyLevels[1]}
                        onSelect={handleChildSelect}
                        selectedId={selectedRootId === selectedParentId ? selectedChildId : null}
                        maxHeight={maxHeight}
                        panelWidth={panelMinWidth}
                        disabledIds={disabledChildIds}
                        disabledTooltip={disabledChildTooltip}
                    />
                </div>
            )}
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
