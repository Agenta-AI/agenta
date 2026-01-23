/**
 * ListPopoverVariant Component
 *
 * List with popover variant for EntityPicker.
 * Shows a vertical list of parent entities with hover/click popovers
 * for selecting child entities.
 *
 * Pattern: Testset List → Hover to show Revision Popover → Click Revision
 *
 * Designed for 2-level hierarchies.
 */

import React, {useCallback, useId} from "react"

import {cn, EntityListItem, SearchInput} from "@agenta/ui"
import {Empty, Popover, Spin, Tooltip} from "antd"

import {useListPopoverMode} from "../../../hooks"
import type {EntitySelectionResult} from "../../../types"
import {AutoSelectHandler, ChildPopoverContent} from "../shared"
import type {ListPopoverVariantProps} from "../types"

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * List with popover variant.
 *
 * Shows a vertical list of parent entities with popovers for child selection.
 * Designed for 2-level hierarchies like Testset → Revision.
 *
 * @example
 * ```tsx
 * <ListPopoverVariant
 *     adapter="testset"
 *     onSelect={handleSelect}
 *     autoSelectLatest
 *     selectLatestOnParentClick
 * />
 * ```
 */
export function ListPopoverVariant<TSelection = EntitySelectionResult>({
    adapter,
    onSelect,
    instanceId: providedInstanceId,
    showSearch = true,
    emptyMessage,
    loadingMessage,
    className,
    disabled = false,
    // List-popover specific props
    selectedParentId,
    selectedChildId,
    autoSelectFirst = false,
    autoSelectLatest = false,
    selectLatestOnParentClick = false,
    disabledParentIds,
    disabledTooltip = "Already connected",
    disabledChildIds,
    disabledChildTooltip = "Already connected",
    popoverPlacement = "rightTop",
    popoverTrigger = "hover",
    maxHeight = 400,
    onParentHover,
}: ListPopoverVariantProps<TSelection>) {
    const generatedId = useId()
    const instanceId = providedInstanceId ?? generatedId

    // Use the list-popover mode hook
    const {
        parents,
        parentLevelConfig,
        childLevelConfig,
        parentLabel,
        searchTerm,
        setSearchTerm,
        setOpenPopoverId,
        handleParentHover,
        handleParentClick,
        handleChildSelect,
        autoSelectingParent,
        isLoadingParents,
        parentsError,
        adapter: resolvedAdapter,
    } = useListPopoverMode({
        adapter,
        instanceId,
        onSelect,
        selectedParentId,
        selectedChildId,
        autoSelectFirst,
        autoSelectLatest,
        selectLatestOnParentClick,
        disabledParentIds,
        disabledChildIds,
    })

    // Get display messages
    const displayEmptyMessage = emptyMessage ?? resolvedAdapter.emptyMessage ?? "No items found"
    const displayLoadingMessage = loadingMessage ?? resolvedAdapter.loadingMessage ?? "Loading..."

    // Handle parent hover (combines internal + external callbacks)
    const onParentHoverCombined = useCallback(
        (parentId: string) => {
            handleParentHover(parentId)
            onParentHover?.(parentId)
        },
        [handleParentHover, onParentHover],
    )

    // Handle popover open change
    const handlePopoverOpenChange = useCallback(
        (parentId: string, open: boolean) => {
            setOpenPopoverId(open ? parentId : null)
        },
        [setOpenPopoverId],
    )

    // Handle parent click (for selectLatestOnParentClick)
    const onParentClickHandler = useCallback(
        (parent: unknown) => {
            if (disabled) return
            handleParentClick(parent)
        },
        [disabled, handleParentClick],
    )

    // Loading state
    if (isLoadingParents) {
        return (
            <div className={cn("flex flex-col", className)}>
                <div className="flex items-center justify-center py-8">
                    <Spin size="default" />
                    <span className="ml-2 text-zinc-500">{displayLoadingMessage}</span>
                </div>
            </div>
        )
    }

    // Error state
    if (parentsError) {
        return (
            <div className={cn("flex flex-col", className)}>
                <div className="flex items-center justify-center py-8 text-red-500">
                    Error: {parentsError.message}
                </div>
            </div>
        )
    }

    return (
        <div className={cn("flex flex-col", className)}>
            {/* Search input */}
            {showSearch && (
                <div className="mb-2">
                    <SearchInput
                        value={searchTerm}
                        onChange={setSearchTerm}
                        placeholder={`Search ${parentLabel.toLowerCase()}...`}
                        disabled={disabled}
                    />
                </div>
            )}

            {/* Parents list */}
            {parents.length === 0 ? (
                <div className="py-8">
                    <Empty description={displayEmptyMessage} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                </div>
            ) : (
                <div
                    className="overflow-auto"
                    style={{maxHeight: typeof maxHeight === "number" ? maxHeight : undefined}}
                >
                    {parents.map((parent) => {
                        const isDisabled = parent.isDisabled
                        const isHovered = parent.isPopoverOpen

                        // Disabled parent - show tooltip, not clickable
                        if (isDisabled) {
                            return (
                                <Tooltip key={parent.id} title={disabledTooltip}>
                                    <div className="opacity-50 cursor-not-allowed">
                                        <EntityListItem
                                            label={parent.label}
                                            labelNode={parent.labelNode}
                                            isSelectable={false}
                                            isSelected={parent.isSelected}
                                        />
                                    </div>
                                </Tooltip>
                            )
                        }

                        // Regular parent with popover
                        return (
                            <Popover
                                key={parent.id}
                                open={parent.isPopoverOpen}
                                onOpenChange={(open) => handlePopoverOpenChange(parent.id, open)}
                                placement={popoverPlacement}
                                trigger={popoverTrigger}
                                content={
                                    <ChildPopoverContent
                                        parentId={parent.id}
                                        parentLabel={parent.label}
                                        childLevelConfig={childLevelConfig}
                                        selectedChildId={selectedChildId}
                                        disabledChildIds={disabledChildIds}
                                        disabledChildTooltip={disabledChildTooltip}
                                        onSelect={(child) =>
                                            handleChildSelect(parent.id, parent.label, child)
                                        }
                                    />
                                }
                            >
                                <div
                                    onMouseEnter={() => onParentHoverCombined(parent.id)}
                                    onClick={() => onParentClickHandler(parent.entity)}
                                >
                                    <EntityListItem
                                        label={parent.label}
                                        labelNode={parent.labelNode}
                                        isSelectable={!disabled}
                                        isSelected={parent.isSelected}
                                        isHovered={isHovered}
                                        hasChildren
                                    />
                                </div>
                            </Popover>
                        )
                    })}
                </div>
            )}

            {/* Auto-select handler (invisible component) */}
            {autoSelectingParent && (
                <AutoSelectHandler
                    parentId={autoSelectingParent.id}
                    parentLabel={autoSelectingParent.label}
                    parentLevelConfig={parentLevelConfig}
                    childLevelConfig={childLevelConfig}
                    createSelection={(path, entity) =>
                        resolvedAdapter.toSelection(path, entity) as TSelection
                    }
                    onSelect={onSelect}
                    onComplete={() => {
                        // The hook will handle clearing autoSelectingParent
                    }}
                />
            )}
        </div>
    )
}
