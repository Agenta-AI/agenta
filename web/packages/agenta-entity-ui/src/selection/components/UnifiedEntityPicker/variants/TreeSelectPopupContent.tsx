/**
 * TreeSelectPopupContent Component
 *
 * Renders the popup content (search + tree list) for tree-select entity selection.
 * This is a standalone component that can be used inside a Popover or other container
 * without the TreeSelect trigger.
 *
 * Designed for use cases like the Compare button dropdown in Playground.
 */

import React, {useCallback, useId} from "react"

import {cn} from "@agenta/ui/styles"
import {Input, Spin, Tree} from "antd"

import {useTreeSelectMode, type TreeSelectNode} from "../../../hooks"
import type {EntitySelectionResult} from "../../../types"
import type {TreeSelectVariantProps} from "../types"

// ============================================================================
// TYPES
// ============================================================================

export type TreeSelectPopupContentProps<TSelection = EntitySelectionResult> = Omit<
    TreeSelectVariantProps<TSelection>,
    | "variant"
    | "size"
    | "placeholder"
    | "dropdownStyle"
    | "dropdownClassName"
    | "treeNodeLabelProp"
    | "popupMatchSelectWidth"
    | "popupMinWidth"
> & {
    /** Width of the popup content */
    width?: number | string
}

// ============================================================================
// COMPONENT
// ============================================================================

export function TreeSelectPopupContent<TSelection = EntitySelectionResult>({
    adapter,
    onSelect,
    instanceId: providedInstanceId,
    showSearch = true,
    emptyMessage,
    loadingMessage,
    className,
    disabled = false,
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
    maxHeight = 400,
    popupHeader,
    popupHeaderAction,
    popupFooter,
    width = 280,
}: TreeSelectPopupContentProps<TSelection>) {
    const generatedId = useId()
    const instanceId = providedInstanceId ?? generatedId

    // Use the tree-select mode hook
    const {
        treeData,
        handleSelect,
        searchTerm,
        setSearchTerm,
        expandedKeys,
        setExpandedKeys,
        isLoadingParents,
        isLoadingChildren,
        parentsError,
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

    // Handle tree node selection
    const handleTreeSelect = useCallback(
        (selectedKeys: React.Key[], info: {node: TreeSelectNode}) => {
            if (disabled) return
            const node = info.node
            if (node.selectable && !node.disabled) {
                handleSelect(node.value, node)
            }
        },
        [disabled, handleSelect],
    )

    // Handle tree expansion
    const handleTreeExpand = useCallback(
        (keys: React.Key[]) => {
            setExpandedKeys(keys as string[])
        },
        [setExpandedKeys],
    )

    return (
        <div className={cn("flex flex-col", className)} style={{width}}>
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
                    <span className="ml-2 text-sm text-gray-500">{displayLoadingMessage}</span>
                </div>
            )}

            {/* Error state */}
            {parentsError && (
                <div className="px-3 py-4 text-sm text-red-500">Error: {parentsError.message}</div>
            )}

            {/* Empty state */}
            {!isLoadingParents && !parentsError && treeData.length === 0 && (
                <div className="px-3 py-4 text-sm text-gray-500 text-center">
                    {displayEmptyMessage}
                </div>
            )}

            {/* Tree list */}
            {!isLoadingParents && !parentsError && treeData.length > 0 && (
                <div style={{maxHeight, overflow: "auto"}} className="tree-popup-compact">
                    <style>{`
                        .tree-popup-compact .ant-tree-treenode-leaf .ant-tree-indent { display: none !important; }
                        .tree-popup-compact .ant-tree-treenode-leaf { padding-left: 24px !important; }
                        .tree-popup-compact .ant-tree-checkbox { display: none; }
                        .tree-popup-compact .ant-tree-treenode-selected > .ant-tree-node-content-wrapper { background: var(--ant-blue-1, #e6f4ff); }
                        .tree-popup-compact .ant-tree-node-content-wrapper { padding-left: 4px !important; display: flex; align-items: center; justify-content: space-between; border-radius: 6px; }
                        .tree-popup-compact .ant-tree-switcher { margin: 0 !important; display: flex; align-items: center; justify-content: center; }
                        .tree-popup-compact .ant-tree-switcher-noop { display: none !important; }
                        .tree-popup-compact .ant-tree-title { width: 100%; }
                        .tree-popup-compact .ant-tree-treenode-disabled > .ant-tree-node-content-wrapper { opacity: 0.5; cursor: not-allowed; background: transparent !important; }
                    `}</style>
                    <Tree
                        treeData={treeData}
                        expandedKeys={expandedKeys}
                        onExpand={handleTreeExpand}
                        onSelect={handleTreeSelect}
                        selectedKeys={selectedValueProp ? [selectedValueProp] : []}
                        blockNode
                        showLine={false}
                    />
                </div>
            )}

            {/* Custom footer */}
            {popupFooter}
        </div>
    )
}

export default TreeSelectPopupContent
