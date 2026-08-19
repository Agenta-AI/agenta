/**
 * TreeSelectPopupContent Component
 *
 * Renders the popup content (search + tree list) for tree-select entity selection.
 * This is a standalone component that can be used inside a Popover or other container
 * without the TreeSelect trigger.
 *
 * Designed for use cases like the Compare button dropdown in Playground.
 */

import React, {useCallback, useEffect, useId, useMemo, useRef, useState} from "react"

import {cn} from "@agenta/ui/styles"
import {InputAffix, Spinner} from "@agenta/ui/ui"
import {CaretDown, CaretRight} from "@phosphor-icons/react"

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
    /**
     * Whether to show dates/subtitles in labels.
     * @default false
     */
    showDate?: boolean
    /**
     * Parent IDs to expand initially (when defaultExpandAll is false).
     * Children for these parents will be fetched on mount.
     */
    initialExpandedKeys?: string[]
    /** Hide a sole structural parent and render its children as a flat list. */
    flattenSingleParent?: boolean
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Focus ring lives on the row box (`[data-row]`), not the `<li>` that owns the group. */
const ROW_FOCUS_RING = [
    "outline-none",
    "[&:focus-visible>[data-row]]:outline",
    "[&:focus-visible>[data-row]]:outline-4",
    "[&:focus-visible>[data-row]]:outline-focus-ring",
    "[&:focus-visible>[data-row]]:outline-offset-[-3px]",
].join(" ")

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
    showDate = false,
    initialExpandedKeys,
    flattenSingleParent = false,
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
        initialExpandedKeys,
        parentFilter,
        childFilter,
        showDate,
    })

    // Ref for scroll container — used to auto-scroll to selected item
    const scrollContainerRef = useRef<HTMLDivElement>(null)
    // Ref for search input — auto-focus on mount
    const searchInputRef = useRef<HTMLInputElement>(null)
    // Row elements by node key — drives roving-tabindex focus moves.
    const rowRefs = useRef(new Map<string, HTMLElement>())
    // Roving-tabindex cursor; null until the user first interacts.
    const [activeKey, setActiveKey] = useState<string | null>(null)

    // Auto-focus the search input when the popup mounts
    useEffect(() => {
        if (!showSearch) return
        const timer = setTimeout(() => searchInputRef.current?.focus(), 0)
        return () => clearTimeout(timer)
    }, [showSearch])

    // Auto-scroll to the selected item when the popup opens.
    // Retries across frames: the row usually exists in the same commit, but auto-expand
    // of its parent group can land a frame later.
    const scrollRetryRef = useRef(0)
    useEffect(() => {
        if (!selectedValueProp || treeData.length === 0) return
        scrollRetryRef.current = 0
        let rafId: number
        const attempt = () => {
            const el = scrollContainerRef.current
            if (!el) return
            const hit = el.querySelector('[data-selected="true"]')
            if (hit) {
                hit.scrollIntoView({block: "center", inline: "nearest"})
                if (flattenSingleParent) el.scrollLeft = 0
                return
            }
            if (++scrollRetryRef.current < 5) rafId = requestAnimationFrame(attempt)
        }
        rafId = requestAnimationFrame(attempt)
        return () => cancelAnimationFrame(rafId)
    }, [flattenSingleParent, selectedValueProp, treeData])

    // Get display messages
    const displayEmptyMessage = emptyMessage ?? resolvedAdapter.emptyMessage ?? "No items found"
    const displayLoadingMessage = loadingMessage ?? resolvedAdapter.loadingMessage ?? "Loading..."
    // Flattening only applies when there's exactly one structural parent — its children become
    // the top-level (and only) rows, rendered as selectable leaves rather than a collapsible group.
    const isFlatMode = flattenSingleParent && treeData.length === 1
    const displayTreeData = isFlatMode ? (treeData[0].children ?? []) : treeData

    const expandedSet = useMemo(() => new Set(expandedKeys), [expandedKeys])

    // Flattened view of what is actually on screen — the keyboard navigation order.
    const visibleRows = useMemo(() => {
        const rows: {node: TreeSelectNode; isParent: boolean}[] = []
        if (isFlatMode) {
            displayTreeData.forEach((node) => rows.push({node, isParent: false}))
            return rows
        }
        treeData.forEach((parent) => {
            rows.push({node: parent, isParent: true})
            if (!expandedSet.has(parent.key)) return
            ;(parent.children ?? []).forEach((child) => rows.push({node: child, isParent: false}))
        })
        return rows
    }, [displayTreeData, isFlatMode, treeData, expandedSet])

    // Handle tree node selection
    const handleTreeSelect = useCallback(
        (node: TreeSelectNode) => {
            if (disabled) return
            setActiveKey(node.key)
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

    const setExpanded = useCallback(
        (key: string, next: boolean) => {
            const current = new Set(expandedKeys)
            if (next) current.add(key)
            else current.delete(key)
            handleTreeExpand(Array.from(current))
        },
        [expandedKeys, handleTreeExpand],
    )

    const toggleParent = useCallback(
        (node: TreeSelectNode) => {
            setActiveKey(node.key)
            setExpanded(node.key, !expandedSet.has(node.key))
        },
        [expandedSet, setExpanded],
    )

    const focusRow = useCallback((key: string) => {
        setActiveKey(key)
        rowRefs.current.get(key)?.focus()
    }, [])

    const handleKeyDown = useCallback(
        (event: React.KeyboardEvent<HTMLUListElement>) => {
            if (visibleRows.length === 0) return
            const currentKey = activeKey ?? visibleRows[0].node.key
            const index = Math.max(
                0,
                visibleRows.findIndex((row) => row.node.key === currentKey),
            )
            const row = visibleRows[index]
            const moveTo = (nextIndex: number) => {
                const target = visibleRows[Math.min(visibleRows.length - 1, Math.max(0, nextIndex))]
                if (target) focusRow(target.node.key)
            }

            switch (event.key) {
                case "ArrowDown":
                    event.preventDefault()
                    moveTo(index + 1)
                    break
                case "ArrowUp":
                    event.preventDefault()
                    moveTo(index - 1)
                    break
                case "Home":
                    event.preventDefault()
                    moveTo(0)
                    break
                case "End":
                    event.preventDefault()
                    moveTo(visibleRows.length - 1)
                    break
                case "ArrowRight":
                    if (!row.isParent) break
                    event.preventDefault()
                    if (expandedSet.has(row.node.key)) moveTo(index + 1)
                    else setExpanded(row.node.key, true)
                    break
                case "ArrowLeft":
                    event.preventDefault()
                    if (row.isParent) {
                        if (expandedSet.has(row.node.key)) setExpanded(row.node.key, false)
                    } else {
                        const parentIndex = visibleRows.findIndex(
                            (candidate) => candidate.node.key === row.node.parentId,
                        )
                        if (parentIndex >= 0) moveTo(parentIndex)
                    }
                    break
                case "Enter":
                case " ":
                    event.preventDefault()
                    if (row.isParent) toggleParent(row.node)
                    else handleTreeSelect(row.node)
                    break
                default:
                    break
            }
        },
        [
            activeKey,
            expandedSet,
            focusRow,
            handleTreeSelect,
            setExpanded,
            toggleParent,
            visibleRows,
        ],
    )

    // Roving tabindex: exactly one row is tabbable, so Tab enters the tree once. Falls back
    // to the first row when the active row is no longer rendered (its group got collapsed).
    const tabbableKey = useMemo(() => {
        if (activeKey && visibleRows.some((row) => row.node.key === activeKey)) return activeKey
        return visibleRows[0]?.node.key
    }, [activeKey, visibleRows])
    const registerRow = useCallback(
        (key: string) => (element: HTMLLIElement | null) => {
            if (element) rowRefs.current.set(key, element)
            else rowRefs.current.delete(key)
        },
        [],
    )

    return (
        <div className={cn("flex flex-col", className)} style={{width}}>
            {/* Search input row with optional action */}
            {(showSearch || popupHeaderAction) && (
                <div className="flex items-center gap-2 px-2 py-1 box-border border-0 border-b border-solid border-colorBorderSecondary mb-2">
                    {showSearch && (
                        <InputAffix
                            ref={searchInputRef}
                            className="flex-1"
                            variant="ghost"
                            placeholder="Search"
                            value={searchTerm}
                            onValueChange={setSearchTerm}
                            allowClear
                        />
                    )}
                    {popupHeaderAction}
                </div>
            )}

            {/* Custom header */}
            {popupHeader}

            {/* Loading state — only shown when no tree data is available yet */}
            {(isLoadingParents || isLoadingChildren) && displayTreeData.length === 0 && (
                <div className="flex items-center justify-center py-4">
                    <Spinner size="small" />
                    <span className="ml-2 text-xs text-colorTextSecondary">
                        {displayLoadingMessage}
                    </span>
                </div>
            )}

            {/* Error state */}
            {parentsError && (
                <div className="px-3 py-4 text-xs text-colorError">
                    Error: {parentsError.message}
                </div>
            )}

            {/* Empty state */}
            {!isLoadingParents &&
                !isLoadingChildren &&
                !parentsError &&
                displayTreeData.length === 0 && (
                    <div className="px-3 py-4 text-xs text-colorTextSecondary text-center">
                        {displayEmptyMessage}
                    </div>
                )}

            {/* Tree list */}
            {!isLoadingParents && !parentsError && displayTreeData.length > 0 && (
                <div
                    ref={scrollContainerRef}
                    style={{
                        maxHeight,
                        overflowY: "auto",
                        overflowX: flattenSingleParent ? "hidden" : "auto",
                    }}
                    className={cn("pb-2", isFlatMode ? "px-1.5 pt-2.5" : "px-2")}
                >
                    <ul
                        role="tree"
                        className="m-0 list-none p-0 text-xs text-colorText"
                        onKeyDown={handleKeyDown}
                    >
                        {isFlatMode
                            ? displayTreeData.map((node) => {
                                  const isSelected = selectedValueProp === node.value
                                  return (
                                      <li
                                          key={node.key}
                                          ref={registerRow(node.key)}
                                          role="treeitem"
                                          aria-selected={isSelected}
                                          aria-disabled={node.disabled || undefined}
                                          data-selected={isSelected ? "true" : undefined}
                                          tabIndex={tabbableKey === node.key ? 0 : -1}
                                          onClick={() => handleTreeSelect(node)}
                                          className={cn(
                                              "m-0 flex list-none bg-colorBgElevated pb-1",
                                              ROW_FOCUS_RING,
                                          )}
                                      >
                                          <span
                                              data-row
                                              className={cn(
                                                  "flex min-h-6 min-w-0 flex-1 items-center justify-between rounded-md pl-1",
                                                  node.disabled
                                                      ? "cursor-not-allowed opacity-80"
                                                      : "cursor-pointer",
                                                  isSelected &&
                                                      !node.disabled &&
                                                      "bg-controlItemBgActive",
                                                  !isSelected &&
                                                      !node.disabled &&
                                                      "hover:bg-muted",
                                              )}
                                          >
                                              {node.title}
                                          </span>
                                      </li>
                                  )
                              })
                            : treeData.map((parent) => {
                                  const isExpanded = expandedSet.has(parent.key)
                                  const children = parent.children ?? []
                                  return (
                                      <li
                                          key={parent.key}
                                          ref={registerRow(parent.key)}
                                          role="treeitem"
                                          aria-expanded={isExpanded}
                                          aria-selected={false}
                                          aria-disabled={parent.disabled || undefined}
                                          tabIndex={tabbableKey === parent.key ? 0 : -1}
                                          className={cn("m-0 list-none", ROW_FOCUS_RING)}
                                      >
                                          <div
                                              data-row
                                              onClick={() => toggleParent(parent)}
                                              className="sticky top-0 z-[1] flex items-center bg-colorBgElevated pb-1"
                                          >
                                              <span
                                                  aria-hidden="true"
                                                  className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center text-colorTextSecondary"
                                              >
                                                  {isExpanded ? (
                                                      <CaretDown size={12} />
                                                  ) : (
                                                      <CaretRight size={12} />
                                                  )}
                                              </span>
                                              <span
                                                  className={cn(
                                                      "flex min-h-6 min-w-0 flex-1 cursor-pointer items-center justify-between rounded-md pl-1",
                                                      parent.disabled
                                                          ? "cursor-not-allowed opacity-80"
                                                          : "hover:bg-muted",
                                                  )}
                                              >
                                                  {parent.title}
                                              </span>
                                          </div>

                                          {isExpanded && children.length > 0 && (
                                              <ul role="group" className="m-0 list-none p-0">
                                                  {children.map((child) => {
                                                      const isSelected =
                                                          selectedValueProp === child.value
                                                      return (
                                                          <li
                                                              key={child.key}
                                                              ref={registerRow(child.key)}
                                                              role="treeitem"
                                                              aria-selected={isSelected}
                                                              aria-disabled={
                                                                  child.disabled || undefined
                                                              }
                                                              data-selected={
                                                                  isSelected ? "true" : undefined
                                                              }
                                                              tabIndex={
                                                                  tabbableKey === child.key ? 0 : -1
                                                              }
                                                              onClick={() => handleTreeSelect(child)}
                                                              className={cn(
                                                                  "m-0 flex list-none bg-colorBgElevated pb-1 pl-6",
                                                                  ROW_FOCUS_RING,
                                                              )}
                                                          >
                                                              <span
                                                                  data-row
                                                                  className={cn(
                                                                      "flex min-h-6 min-w-0 flex-1 items-center justify-between rounded-md pl-1",
                                                                      child.disabled
                                                                          ? "cursor-not-allowed opacity-80"
                                                                          : "cursor-pointer",
                                                                      isSelected &&
                                                                          !child.disabled &&
                                                                          "bg-controlItemBgActive",
                                                                      !isSelected &&
                                                                          !child.disabled &&
                                                                          "hover:bg-muted",
                                                                  )}
                                                              >
                                                                  {child.title}
                                                              </span>
                                                          </li>
                                                      )
                                                  })}
                                              </ul>
                                          )}
                                      </li>
                                  )
                              })}
                    </ul>
                </div>
            )}

            {/* Custom footer */}
            {popupFooter}
        </div>
    )
}

export default TreeSelectPopupContent
