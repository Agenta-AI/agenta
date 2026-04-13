/**
 * CascaderVariant Component
 *
 * Ant Design Cascader variant for EntityPicker.
 * Renders a single compact dropdown with cascading panels matching the adapter's hierarchy.
 *
 * Pattern: Evaluator → Variant → Revision (all in one dropdown)
 */

import React, {type ReactNode, useCallback, useEffect, useRef, useState} from "react"

import {Cascader} from "antd"
import {getDefaultStore} from "jotai/vanilla"

import {useEntitySelectionCore} from "../../../hooks/useEntitySelectionCore"
import {useLevelData} from "../../../hooks/utilities"
import type {
    EntitySelectionResult,
    HierarchyLevel,
    ListQueryState,
    SelectionPathItem,
} from "../../../types"
import type {CascaderVariantProps} from "../types"

// ============================================================================
// TYPES
// ============================================================================

interface CascaderOption {
    value: string
    label: ReactNode
    isLeaf: boolean
    children?: CascaderOption[]
    disabled?: boolean
    /** Raw entity data for building selection results */
    __entity: unknown
    /** Level index in hierarchy */
    __levelIndex: number
    /** Plain text label for search filtering and display rendering */
    __textLabel: string
    /** Internal placeholder marker used for transient loading rows */
    __isPlaceholder?: boolean
}

// ============================================================================
// HELPERS
// ============================================================================

function buildOptionsFromItems(
    items: unknown[],
    levelConfig: HierarchyLevel<unknown>,
    levelIndex: number,
    isLastLevel: boolean,
): CascaderOption[] {
    return items.map((item) => {
        const textLabel = levelConfig.getLabel(item)
        const labelNode = levelConfig.getLabelNode?.(item)
        return {
            value: levelConfig.getId(item),
            label: labelNode ?? textLabel,
            isLeaf: isLastLevel,
            __entity: item,
            __levelIndex: levelIndex,
            __textLabel: textLabel,
        }
    })
}

function filterLevelItems(items: unknown[], levelConfig: HierarchyLevel<unknown>): unknown[] {
    if (!levelConfig.filterItems) return items
    return items.filter(levelConfig.filterItems)
}

function buildLoadingOption(
    levelConfig: HierarchyLevel<unknown>,
    levelIndex: number,
): CascaderOption {
    const textLabel = "Loading..."

    return {
        value: `__loading__-${levelIndex}`,
        label: levelConfig.getPlaceholderNode?.(textLabel) ?? textLabel,
        isLeaf: true,
        disabled: true,
        __entity: null,
        __levelIndex: levelIndex,
        __textLabel: textLabel,
        __isPlaceholder: true,
    }
}

// ============================================================================
// COMPONENT
// ============================================================================

export function CascaderVariant<TSelection = EntitySelectionResult>({
    adapter: adapterProp,
    onSelect,
    instanceId,
    className,
    disabled = false,
    size = "middle",
    placeholder = "Select...",
    popupMatchSelectWidth = false,
    popupClassName,
    placement,
    dropdownRender,
    displayRender: displayRenderProp,
}: CascaderVariantProps<TSelection>) {
    const {hierarchyLevels, selectableLevel, createSelection} = useEntitySelectionCore({
        adapter: adapterProp,
        instanceId,
        onSelect,
    })

    const totalLevels = hierarchyLevels.length
    const isLastLevel = (levelIndex: number) => levelIndex >= totalLevels - 1

    // Fetch root items (level 0)
    const rootLevel = hierarchyLevels[0]
    const {items: rootItems, query: rootQuery} = useLevelData({
        levelConfig: rootLevel,
        parentId: null,
        isEnabled: true,
    })

    // Options tree state — root options are derived from rootItems,
    // children are loaded lazily via loadData
    const [optionsTree, setOptionsTree] = useState<CascaderOption[]>([])

    // Track active subscriptions for cleanup
    const subscriptionsRef = useRef<(() => void)[]>([])

    // Track the last rootItems reference to avoid unnecessary rebuilds
    const prevRootItemsRef = useRef<unknown[]>([])

    useEffect(() => {
        if (rootItems !== prevRootItemsRef.current) {
            prevRootItemsRef.current = rootItems
            setOptionsTree((prev) => {
                const freshOptions = buildOptionsFromItems(rootItems, rootLevel, 0, isLastLevel(0))
                // Preserve previously loaded children so clicks don't flash "Loading..." again
                if (prev.length > 0) {
                    const prevByValue = new Map(prev.map((opt) => [opt.value, opt]))
                    for (const opt of freshOptions) {
                        const existing = prevByValue.get(opt.value)
                        if (existing?.children && !existing.children[0]?.__isPlaceholder) {
                            opt.children = existing.children
                        }
                    }
                }
                return freshOptions
            })
        }
    }, [rootItems, rootLevel, totalLevels])

    // Cleanup subscriptions on unmount
    useEffect(() => {
        return () => {
            subscriptionsRef.current.forEach((unsub) => unsub())
            subscriptionsRef.current = []
        }
    }, [])

    // Lazy load children when a cascading panel opens
    const loadData = useCallback(
        (selectedOptions: CascaderOption[]) => {
            const targetOption = selectedOptions[selectedOptions.length - 1]
            const nextLevelIndex = targetOption.__levelIndex + 1

            if (nextLevelIndex >= totalLevels) return
            // Skip if children are already loaded (but allow re-entry for placeholder-only children)
            if (
                targetOption.children &&
                targetOption.children.length > 0 &&
                !targetOption.children[0].__isPlaceholder
            ) {
                return
            }

            const nextLevelConfig = hierarchyLevels[nextLevelIndex]
            if (!nextLevelConfig.listAtomFamily) return

            nextLevelConfig.onBeforeLoad?.(targetOption.value)

            const store = getDefaultStore()
            const childAtom = nextLevelConfig.listAtomFamily(targetOption.value)

            const applyChildState = (childState: ListQueryState<unknown>) => {
                const isSettled =
                    !childState.isPending && (childState.data !== undefined || childState.isError)

                if (!isSettled) {
                    return false
                }

                const childItems = filterLevelItems(
                    (childState.data ?? []) as unknown[],
                    nextLevelConfig,
                )

                targetOption.children = buildOptionsFromItems(
                    childItems,
                    nextLevelConfig,
                    nextLevelIndex,
                    isLastLevel(nextLevelIndex),
                )
                setOptionsTree((prev) => [...prev])
                return true
            }

            const readAndApplyChildState = () =>
                applyChildState(store.get(childAtom) as ListQueryState<unknown>)

            // Try reading synchronously first — if data is cached, skip loading state entirely
            const isSettledImmediately = readAndApplyChildState()
            if (isSettledImmediately) return

            // Data not available yet — show loading placeholder
            targetOption.children = [buildLoadingOption(nextLevelConfig, nextLevelIndex)]
            setOptionsTree((prev) => [...prev])

            // Subscribe for async resolution
            const unsub = store.sub(childAtom, () => {
                const isSettled = readAndApplyChildState()
                if (isSettled) {
                    unsub()
                    subscriptionsRef.current = subscriptionsRef.current.filter((u) => u !== unsub)
                }
            })
            subscriptionsRef.current.push(unsub)

            // Re-check after subscribing to handle race where the atom
            // resolved between store.get() and store.sub()
            const isSettledAfterSub = readAndApplyChildState()
            if (isSettledAfterSub) {
                unsub()
                subscriptionsRef.current = subscriptionsRef.current.filter((u) => u !== unsub)
            }
        },
        [hierarchyLevels, totalLevels],
    )

    // Handle selection
    const handleChange = useCallback(
        (_value: (string | number)[], selectedOptions: CascaderOption[]) => {
            if (!selectedOptions || selectedOptions.length === 0) return

            const lastOption = selectedOptions[selectedOptions.length - 1]
            if (lastOption.__isPlaceholder) return

            const targetLevel = Math.min(selectableLevel, totalLevels - 1)

            // Only fire if we reached the selectable level
            if (lastOption.__levelIndex < targetLevel) return

            // Build path from selected options
            const path: SelectionPathItem[] = selectedOptions.map((opt) => ({
                type: hierarchyLevels[opt.__levelIndex].type,
                id: opt.value,
                label: opt.__textLabel,
            }))

            const selection = createSelection(path, lastOption.__entity)
            onSelect?.(selection)
        },
        [selectableLevel, totalLevels, hierarchyLevels, createSelection, onSelect],
    )

    const defaultDisplayRender = useCallback(
        (labels: string[], selectedOptions?: CascaderOption[]) => {
            if (selectedOptions && selectedOptions.length > 0) {
                return selectedOptions
                    .map((opt) => opt?.__textLabel ?? String(opt?.label ?? ""))
                    .join(" / ")
            }
            return Array.isArray(labels) ? labels.join(" / ") : ""
        },
        [],
    )

    const displayRender = useCallback(
        (labels: string[], selectedOptions?: CascaderOption[]) => {
            if (displayRenderProp) {
                // Extract plain text labels from options since antd's `labels` may contain ReactNodes
                const textLabels =
                    selectedOptions && selectedOptions.length > 0
                        ? selectedOptions.map((opt) => opt?.__textLabel ?? String(opt?.label ?? ""))
                        : labels
                return displayRenderProp(textLabels, selectedOptions)
            }
            return defaultDisplayRender(labels, selectedOptions)
        },
        [displayRenderProp, defaultDisplayRender],
    )

    return (
        <Cascader
            options={optionsTree}
            loadData={loadData as (selectedOptions: readonly CascaderOption[]) => void}
            onChange={
                handleChange as (
                    value: (string | number)[],
                    selectedOptions: readonly CascaderOption[],
                ) => void
            }
            displayRender={
                displayRender as (
                    labels: string[],
                    selectedOptions?: readonly CascaderOption[],
                ) => string
            }
            placeholder={placeholder}
            size={size}
            disabled={disabled}
            className={className}
            popupMatchSelectWidth={popupMatchSelectWidth}
            popupClassName={popupClassName}
            placement={placement}
            dropdownRender={
                dropdownRender as ((menu: React.ReactElement) => React.ReactElement) | undefined
            }
            showSearch={{
                filter: (inputValue, path) =>
                    path.some((option) => {
                        const text =
                            (option as CascaderOption).__textLabel ?? String(option.label ?? "")
                        return text.toLowerCase().includes(inputValue.toLowerCase())
                    }),
            }}
            loading={rootQuery.isPending}
            expandTrigger="click"
            changeOnSelect={false}
        />
    )
}
