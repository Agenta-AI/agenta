/**
 * AutoSelectHandler Component
 *
 * Invisible component that handles automatic child selection.
 */

import {useEffect, useRef} from "react"

import {useAutoSelectLatestChild} from "../../../hooks"
import {useLevelData, type LevelQueryState} from "../../../hooks/utilities"
import type {HierarchyLevel, SelectionPathItem, EntitySelectionResult} from "../../../types"

// ============================================================================
// TYPES
// ============================================================================

export interface AutoSelectHandlerProps<TSelection = EntitySelectionResult> {
    /**
     * Parent entity ID
     */
    parentId: string

    /**
     * Parent entity label
     */
    parentLabel: string

    /**
     * Parent level configuration
     */
    parentLevelConfig: HierarchyLevel<unknown>

    /**
     * Child level configuration
     */
    childLevelConfig: HierarchyLevel<unknown>

    /**
     * Child IDs that should be skipped when resolving the latest selectable child
     */
    disabledChildIds?: Set<string>

    /**
     * Child IDs that should not be selected again in all mode
     */
    selectedChildIds?: Set<string>

    /**
     * Select the latest eligible child or every eligible child
     * @default "latest"
     */
    selectionMode?: "latest" | "all"

    /**
     * Function to create selection result
     */
    createSelection: (path: SelectionPathItem[], entity: unknown) => TSelection

    /**
     * Callback when selection is made
     */
    onSelect?: (selection: TSelection) => void

    /**
     * Callback when auto-selection is complete
     */
    onComplete: () => void
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

export type SelectAllChildrenDecision<T> =
    | {status: "wait"}
    | {status: "select"; children: T[]}
    | {status: "complete"}

interface ResolveSelectAllChildrenOptions<T> {
    children: T[]
    query: LevelQueryState
    getId: (child: T) => string
    disabledChildIds?: Set<string>
    selectedChildIds?: Set<string>
}

/**
 * @internal
 */
export function resolveSelectAllChildren<T>({
    children,
    query,
    getId,
    disabledChildIds,
    selectedChildIds,
}: ResolveSelectAllChildrenOptions<T>): SelectAllChildrenDecision<T> {
    if (query.isPending) return {status: "wait"}

    const selectableChildren = children.filter((child) => {
        const id = getId(child)
        return !disabledChildIds?.has(id) && !selectedChildIds?.has(id)
    })

    if (selectableChildren.length > 0) {
        return {status: "select", children: selectableChildren}
    }

    if (!query.isError && query.isFetched === false && children.length === 0) {
        return {status: "wait"}
    }

    return {status: "complete"}
}

/**
 * @internal
 */
export function getParentCheckboxState(
    selectedCount: number,
    totalChildren?: number,
): {checked: boolean; indeterminate: boolean} {
    const hasSelection = selectedCount > 0
    const hasKnownTotal = totalChildren != null
    const checked =
        hasSelection && (!hasKnownTotal || (totalChildren > 0 && selectedCount >= totalChildren))

    return {
        checked,
        indeterminate: hasSelection && hasKnownTotal && !checked,
    }
}

function SelectLatestChild<TSelection>({
    parentId,
    parentLabel,
    parentLevelConfig,
    childLevelConfig,
    disabledChildIds,
    createSelection,
    onSelect,
    onComplete,
}: AutoSelectHandlerProps<TSelection>) {
    useAutoSelectLatestChild({
        parentId,
        parentLabel,
        parentLevelConfig,
        childLevelConfig,
        disabledChildIds,
        createSelection,
        onSelect,
        onComplete,
    })

    return null
}

function SelectAllChildren<TSelection>({
    parentId,
    parentLabel,
    parentLevelConfig,
    childLevelConfig,
    disabledChildIds,
    selectedChildIds,
    createSelection,
    onSelect,
    onComplete,
}: AutoSelectHandlerProps<TSelection>) {
    const hasCompletedRef = useRef(false)
    const {items: children, query} = useLevelData({
        levelConfig: childLevelConfig,
        parentId,
        isEnabled: true,
    })

    useEffect(() => {
        hasCompletedRef.current = false
    }, [parentId])

    useEffect(() => {
        if (hasCompletedRef.current) return

        const decision = resolveSelectAllChildren({
            children,
            query,
            getId: childLevelConfig.getId,
            disabledChildIds,
            selectedChildIds,
        })
        if (decision.status === "wait") return

        hasCompletedRef.current = true

        if (decision.status === "select") {
            const parentPathItem: SelectionPathItem = {
                type: parentLevelConfig.type,
                id: parentId,
                label: parentLabel,
            }

            for (const child of decision.children) {
                const childPathItem: SelectionPathItem = {
                    type: childLevelConfig.type,
                    id: childLevelConfig.getId(child),
                    label: childLevelConfig.getLabel(child),
                }
                onSelect?.(createSelection([parentPathItem, childPathItem], child))
            }
        }

        onComplete()
    }, [
        children,
        query,
        parentId,
        parentLabel,
        parentLevelConfig,
        childLevelConfig,
        disabledChildIds,
        selectedChildIds,
        createSelection,
        onSelect,
        onComplete,
    ])

    return null
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Invisible component that selects the latest child by default, or every
 * eligible child when selectionMode is "all".
 */
export function AutoSelectHandler<TSelection = EntitySelectionResult>(
    props: AutoSelectHandlerProps<TSelection>,
) {
    if (props.selectionMode === "all") {
        return <SelectAllChildren {...props} />
    }

    return <SelectLatestChild {...props} />
}
