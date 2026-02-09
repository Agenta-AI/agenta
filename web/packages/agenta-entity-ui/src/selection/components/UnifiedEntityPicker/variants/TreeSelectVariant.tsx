/**
 * TreeSelectVariant Component
 *
 * Tree-select variant for EntityPicker.
 * Renders an Ant Design TreeSelect with expandable parent groups
 * containing selectable children.
 *
 * Pattern: TreeSelect with Parent Groups → Expand to show Children → Select Child
 *
 * Designed for 2-level hierarchies like Variant → Revision.
 */

import React, {useCallback, useId, useMemo} from "react"

import {cn} from "@agenta/ui/styles"
import {Input, Spin, TreeSelect} from "antd"

import {useTreeSelectMode} from "../../../hooks"
import type {EntitySelectionResult} from "../../../types"
import type {TreeSelectVariantProps} from "../types"

import styles from "./TreeSelectVariant.module.css"

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Tree-select variant.
 *
 * Renders an Ant Design TreeSelect with expandable parent groups
 * containing selectable children.
 *
 * @example
 * ```tsx
 * <TreeSelectVariant
 *     adapter={playgroundSelectionAdapter}
 *     onSelect={handleSelect}
 *     selectedValue={currentRevisionId}
 *     childActions={[
 *         {
 *             key: 'copy',
 *             handler: handleCreateCopy,
 *             shouldShow: (item) => !item.isLocalDraft,
 *         },
 *     ]}
 *     renderChildTitle={(child, parent, defaultNode) => (
 *         <div className="flex items-center justify-between">
 *             {defaultNode}
 *             <CopyButton onClick={(e) => handleCopy(child, e)} />
 *         </div>
 *     )}
 * />
 * ```
 */
export function TreeSelectVariant<TSelection = EntitySelectionResult>({
    adapter,
    onSelect,
    instanceId: providedInstanceId,
    showSearch = true,
    emptyMessage,
    loadingMessage,
    className,
    disabled = false,
    // Tree-select specific props
    selectedValue: selectedValueProp,
    disabledParentIds,
    disabledChildIds,
    childActions,
    parentActions,
    renderParentTitle,
    renderChildTitle,
    renderSelectedLabel,
    defaultExpandAll = true,
    parentFilter,
    childFilter,
    // TreeSelect component props
    size = "small",
    placeholder = "Select...",
    dropdownStyle,
    dropdownClassName,
    treeNodeLabelProp = "label",
    popupMatchSelectWidth = false,
    popupMinWidth = 280,
    maxHeight = 400,
    // Custom popup renderer
    popupHeader,
    popupHeaderAction,
    popupFooter,
}: TreeSelectVariantProps<TSelection>) {
    const generatedId = useId()
    const instanceId = providedInstanceId ?? generatedId

    // Use the tree-select mode hook
    const {
        treeData,
        flatNodes,
        handleSelect,
        searchTerm,
        setSearchTerm,
        expandedKeys,
        setExpandedKeys,
        isLoadingParents,
        isLoadingChildren,
        parentsError,
        selectedValue,
        adapter: resolvedAdapter,
    } = useTreeSelectMode({
        adapter,
        instanceId,
        onSelect,
        selectedValue: selectedValueProp,
        disabledParentIds,
        disabledChildIds,
        childActions,
        parentActions,
        renderParentTitle,
        renderChildTitle,
        renderSelectedLabel,
        defaultExpandAll,
        parentFilter,
        childFilter,
    })

    // Get display messages
    const displayEmptyMessage = emptyMessage ?? resolvedAdapter.emptyMessage ?? "No items found"
    const displayLoadingMessage = loadingMessage ?? resolvedAdapter.loadingMessage ?? "Loading..."

    // Handle TreeSelect onChange
    const handleChange = useCallback(
        (value: string, _labelList: React.ReactNode[], _extra: unknown) => {
            if (disabled) return

            // The triggerNode from TreeSelect doesn't have our custom properties (entity, selectable, etc.)
            // We MUST look up the actual node from flatNodes to get the full data
            const actualNode = flatNodes.find((n) => n.id === value)

            if (!actualNode) {
                console.warn("[TreeSelectVariant] Could not find node for value:", value)
                return
            }

            handleSelect(value, actualNode)
        },
        [disabled, handleSelect, flatNodes],
    )

    // Handle tree expansion
    const handleTreeExpand = useCallback(
        (keys: React.Key[]) => {
            setExpandedKeys(keys as string[])
        },
        [setExpandedKeys],
    )

    // Custom popup render with search header
    const popupRender = useCallback(
        (menu: React.ReactNode) => {
            return (
                <div className="flex flex-col">
                    {/* Search input row with optional action */}
                    {(showSearch || popupHeaderAction) && (
                        <div className="flex items-center gap-2 px-2 py-1.5 border-b border-gray-100">
                            {showSearch && (
                                <Input
                                    className="flex-1"
                                    variant="borderless"
                                    placeholder="Search"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    allowClear
                                />
                            )}
                            {popupHeaderAction}
                        </div>
                    )}

                    {/* Custom header */}
                    {popupHeader}

                    {/* Loading state */}
                    {(isLoadingParents || isLoadingChildren) && (
                        <div className="flex items-center justify-center py-4">
                            <Spin size="small" />
                            <span className="ml-2 text-sm text-gray-500">
                                {displayLoadingMessage}
                            </span>
                        </div>
                    )}

                    {/* Error state */}
                    {parentsError && (
                        <div className="px-3 py-4 text-sm text-red-500">
                            Error: {parentsError.message}
                        </div>
                    )}

                    {/* Empty state */}
                    {!isLoadingParents && !parentsError && treeData.length === 0 && (
                        <div className="px-3 py-4 text-sm text-gray-500 text-center">
                            {displayEmptyMessage}
                        </div>
                    )}

                    {/* Tree menu */}
                    {!isLoadingParents && !parentsError && treeData.length > 0 && (
                        <div style={{maxHeight, overflow: "auto"}} className={dropdownClassName}>
                            {menu}
                        </div>
                    )}

                    {/* Custom footer */}
                    {popupFooter}
                </div>
            )
        },
        [
            showSearch,
            searchTerm,
            setSearchTerm,
            popupHeader,
            popupHeaderAction,
            popupFooter,
            isLoadingParents,
            isLoadingChildren,
            parentsError,
            treeData.length,
            displayLoadingMessage,
            displayEmptyMessage,
            maxHeight,
            dropdownClassName,
        ],
    )

    // Compute popup styles (replacing deprecated dropdownStyle)
    const computedPopupStyles = useMemo(
        () => ({
            minWidth: popupMinWidth,
            ...dropdownStyle,
        }),
        [popupMinWidth, dropdownStyle],
    )

    return (
        <TreeSelect
            className={cn("w-full", className)}
            value={selectedValue ?? undefined}
            onChange={handleChange}
            treeData={treeData}
            treeExpandedKeys={expandedKeys}
            onTreeExpand={handleTreeExpand}
            treeDefaultExpandAll={defaultExpandAll}
            treeExpandAction="click"
            treeNodeLabelProp={treeNodeLabelProp}
            size={size}
            placeholder={placeholder}
            disabled={disabled}
            popupMatchSelectWidth={popupMatchSelectWidth}
            popupRender={popupRender}
            // Hide the default search (we use custom search in popup)
            showSearch={false}
            // Styling for tree nodes
            styles={{
                popup: {
                    root: computedPopupStyles,
                },
            }}
            classNames={{
                popup: {
                    root: cn([
                        "pt-0",
                        // Hide checkbox for tree nodes
                        "[&_.ant-select-tree-checkbox]:hidden",
                        // Highlight selected nodes (but not if disabled)
                        "[&_.ant-select-tree-treenode-checkbox-checked:not(.ant-select-tree-treenode-disabled)>.ant-select-tree-node-content-wrapper]:bg-[var(--ant-blue-1,#e6f4ff)]",
                        // Node content wrapper styling
                        "[&_.ant-select-tree-node-content-wrapper]:!pl-1",
                        "[&_.ant-select-tree-node-content-wrapper]:flex",
                        "[&_.ant-select-tree-node-content-wrapper]:items-center",
                        "[&_.ant-select-tree-node-content-wrapper]:!justify-between",
                        "[&_.ant-select-tree-node-content-wrapper]:!rounded-md",
                        // Switcher styling
                        "[&_.ant-select-tree-switcher]:!mx-0",
                        "[&_.ant-select-tree-switcher]:!me-0",
                        "[&_.ant-select-tree-switcher]:flex",
                        "[&_.ant-select-tree-switcher]:items-center",
                        "[&_.ant-select-tree-switcher]:justify-center",
                        // Hide noop switcher (for leaf nodes)
                        "[&_.ant-select-tree-switcher-noop]:!hidden",
                        // Leaf node styling
                        "[&_.ant-select-tree-treenode-leaf_.ant-select-tree-node-content-wrapper]:!pl-0",
                        // Title width
                        "[&_.ant-select-tree-title]:w-full",
                        // Remove active background
                        "[&_.ant-select-tree-treenode-active]:!bg-transparent",
                        // Disabled node styling - opacity handled in renderChildTitle, cursor here
                        "[&_.ant-select-tree-treenode-disabled]:cursor-not-allowed",
                        styles.popupRoot,
                    ]),
                },
            }}
        />
    )
}
