/**
 * useTreeSelectMode Hook
 *
 * Tree-select selection mode for 2-level hierarchies.
 * Provides data and handlers for an Ant Design TreeSelect component
 * with expandable parent groups containing selectable children.
 *
 * Pattern: TreeSelect with Parent Groups → Expand to show Children → Select Child
 *
 * Used by TreeSelectVariant (Playground SelectVariant style).
 */

import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {atom, useAtomValue} from "jotai"

import type {
    EntitySelectionAdapter,
    EntitySelectionResult,
    HierarchyLevel,
    ListQueryState,
    SelectionPathItem,
} from "../../types"
import {
    useEntitySelectionCore,
    getLevelLabel,
    type EntitySelectionCoreOptions,
} from "../useEntitySelectionCore"
import {useLevelData, buildPathItem, type LevelQueryState} from "../utilities"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Action handler for custom actions on tree items
 */
export interface TreeSelectItemAction {
    /** Unique key for the action */
    key: string
    /** Action handler - receives the item and mouse event */
    handler: (item: unknown, event: React.MouseEvent) => void
    /** Whether to show this action for the item */
    shouldShow?: (item: unknown) => boolean
}

/**
 * Tree node structure for Ant Design TreeSelect
 */
export interface TreeSelectNode {
    /** AntD Tree node key */
    key: string
    /** Unique node id */
    id: string
    /** Value used for selection */
    value: string
    /** Display label (string or ReactNode for selected value display) */
    label: string | React.ReactNode
    /** Rich label node for custom rendering */
    labelNode?: React.ReactNode
    /** Custom selected label node (for value display) */
    selectedLabel?: React.ReactNode
    /** Title for TreeSelect (can be ReactNode) */
    title?: React.ReactNode
    /** Whether this node is selectable */
    selectable: boolean
    /** Whether this node is disabled */
    disabled: boolean
    /** Whether this node is a leaf (no children) */
    isLeaf: boolean
    /** Child nodes */
    children?: TreeSelectNode[]
    /** Original entity data */
    entity: unknown
    /** Parent ID (for child nodes) */
    parentId?: string
    /** Parent label (for child nodes) */
    parentLabel?: string
    /** Custom metadata */
    metadata?: Record<string, unknown>
}

/**
 * Options for useTreeSelectMode
 */
export interface UseTreeSelectModeOptions<TSelection = EntitySelectionResult> extends Omit<
    EntitySelectionCoreOptions<TSelection>,
    "autoSelectByLevel"
> {
    /**
     * Currently selected value (child ID)
     */
    selectedValue?: string | null

    /**
     * Set of parent IDs that should be disabled
     */
    disabledParentIds?: Set<string>

    /**
     * Set of child IDs that should be disabled
     */
    disabledChildIds?: Set<string>

    /**
     * Custom actions for child items (e.g., "Create local copy", "Discard")
     */
    childActions?: TreeSelectItemAction[]

    /**
     * Custom actions for parent items
     */
    parentActions?: TreeSelectItemAction[]

    /**
     * Custom title renderer for parent nodes
     */
    renderParentTitle?: (parent: unknown, defaultNode: React.ReactNode) => React.ReactNode

    /**
     * Custom title renderer for child nodes
     */
    renderChildTitle?: (
        child: unknown,
        parent: unknown,
        defaultNode: React.ReactNode,
    ) => React.ReactNode

    /**
     * Custom renderer for the selected label (value display).
     */
    renderSelectedLabel?: (
        child: unknown,
        parent: unknown,
        defaultNode: React.ReactNode,
    ) => React.ReactNode

    /**
     * Whether to expand all nodes by default
     * @default true
     */
    defaultExpandAll?: boolean

    /**
     * Filter function for parents (in addition to search)
     */
    parentFilter?: (parent: unknown) => boolean

    /**
     * Filter function for children (in addition to search)
     */
    childFilter?: (child: unknown, parent: unknown) => boolean
}

/**
 * Result from useTreeSelectMode
 */
export interface UseTreeSelectModeResult<TSelection = EntitySelectionResult> {
    // Tree data
    /** Tree data for TreeSelect component */
    treeData: TreeSelectNode[]
    /** Flat list of all nodes (for searching) */
    flatNodes: TreeSelectNode[]

    // Level configs
    /** Parent level configuration */
    parentLevelConfig: HierarchyLevel<unknown>
    /** Child level configuration */
    childLevelConfig: HierarchyLevel<unknown>
    /** Parent level label */
    parentLabel: string
    /** Child level label */
    childLabel: string

    // Loading state
    /** Whether parents are loading */
    isLoadingParents: boolean
    /** Whether any children are loading */
    isLoadingChildren: boolean
    /** Parent query error */
    parentsError: Error | null

    // Search
    /** Search term */
    searchTerm: string
    /** Set search term */
    setSearchTerm: (term: string) => void

    // Selection
    /** Handle selection change */
    handleSelect: (value: string, node: TreeSelectNode) => void
    /** Currently selected value */
    selectedValue: string | null

    // Expansion
    /** Expanded parent IDs */
    expandedKeys: string[]
    /** Set expanded keys */
    setExpandedKeys: (keys: string[]) => void

    // Core
    /** Resolved adapter */
    adapter: EntitySelectionAdapter<TSelection>
    /** Instance ID */
    instanceId: string

    // Utilities
    /** Get node by ID */
    getNodeById: (id: string) => TreeSelectNode | undefined
    /** Check if a node is disabled */
    isNodeDisabled: (id: string) => boolean
}

// ============================================================================
// INTERNAL: useChildrenDataForParents Hook
// ============================================================================

/**
 * Hook to fetch children for multiple parents using a combined Jotai atom.
 *
 * Creates a derived atom that reads from all child listAtomFamily atoms at once,
 * allowing us to subscribe to multiple atoms without calling hooks in a loop.
 */
function useChildrenDataForParents(
    childLevelConfig: HierarchyLevel<unknown>,
    parentIds: string[],
): Map<string, {items: unknown[]; query: LevelQueryState}> {
    // Trigger onBeforeLoad for all parents (for lazy loading)
    useEffect(() => {
        parentIds.forEach((parentId) => {
            childLevelConfig.onBeforeLoad?.(parentId)
        })
    }, [childLevelConfig, parentIds])

    // Create a combined atom that reads from all child atoms
    // This is memoized to avoid creating new atoms on every render
    const combinedAtom = useMemo(() => {
        return atom((get) => {
            const results = new Map<string, {items: unknown[]; query: LevelQueryState}>()

            if (!childLevelConfig.listAtomFamily) {
                // No atom family - return empty results
                parentIds.forEach((parentId) => {
                    results.set(parentId, {
                        items: [],
                        query: {isPending: false, isError: false, error: null},
                    })
                })
                return results
            }

            // Read from each child atom
            parentIds.forEach((parentId) => {
                try {
                    const childAtom = childLevelConfig.listAtomFamily!(parentId)
                    const queryState = get(childAtom) as ListQueryState<unknown>

                    // Apply filterItems if configured
                    let items = queryState.data ?? []
                    if (childLevelConfig.filterItems) {
                        items = items.filter(childLevelConfig.filterItems)
                    }

                    results.set(parentId, {
                        items,
                        query: {
                            isPending: queryState.isPending ?? false,
                            isError: queryState.isError ?? false,
                            error: queryState.error ?? null,
                        },
                    })
                } catch (error) {
                    // If reading fails, return empty with error
                    results.set(parentId, {
                        items: [],
                        query: {isPending: false, isError: true, error: error as Error},
                    })
                }
            })

            return results
        })
    }, [childLevelConfig.listAtomFamily, childLevelConfig.filterItems, parentIds])

    // Subscribe to the combined atom
    const results = useAtomValue(combinedAtom)

    return results
}

/**
 * Individual child data hook for a single parent.
 * This is the proper way to fetch children - one hook per parent.
 */
export function useChildDataForParent(
    childLevelConfig: HierarchyLevel<unknown>,
    parentId: string,
    isEnabled = true,
): {items: unknown[]; query: LevelQueryState} {
    return useLevelData({
        levelConfig: childLevelConfig,
        parentId,
        isEnabled,
    })
}

// ============================================================================
// HOOK: useTreeSelectMode
// ============================================================================

/**
 * Hook for tree-select entity selection mode.
 *
 * Provides data and handlers for an Ant Design TreeSelect component
 * with expandable parent groups containing selectable children.
 *
 * Designed for 2-level hierarchies like Variant → Revision.
 *
 * @example
 * ```typescript
 * const {
 *     treeData,
 *     handleSelect,
 *     searchTerm,
 *     setSearchTerm,
 *     expandedKeys,
 *     setExpandedKeys,
 * } = useTreeSelectMode({
 *     adapter: playgroundSelectionAdapter,
 *     onSelect: handleRevisionSelect,
 *     selectedValue: currentRevisionId,
 *     childActions: [
 *         {
 *             key: 'copy',
 *             handler: (item, e) => handleCreateCopy(item, e),
 *             shouldShow: (item) => !item.isLocalDraft,
 *         },
 *     ],
 * })
 *
 * <TreeSelect
 *     treeData={treeData}
 *     value={selectedValue}
 *     onSelect={(value, node) => handleSelect(value, node)}
 *     treeExpandedKeys={expandedKeys}
 *     onTreeExpand={setExpandedKeys}
 *     treeDefaultExpandAll
 * />
 * ```
 */
export function useTreeSelectMode<TSelection = EntitySelectionResult>(
    options: UseTreeSelectModeOptions<TSelection>,
): UseTreeSelectModeResult<TSelection> {
    const {
        onSelect,
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
    } = options

    // Get core utilities
    const {adapter, hierarchyLevels, instanceId, createSelection} = useEntitySelectionCore(options)

    // Validate 2-level hierarchy
    if (hierarchyLevels.length !== 2) {
        console.warn(`useTreeSelectMode requires exactly 2 levels, got ${hierarchyLevels.length}`)
    }

    const parentLevelConfig = hierarchyLevels[0]
    const childLevelConfig = hierarchyLevels[1]

    const parentLabel = getLevelLabel(parentLevelConfig)
    const childLabel = getLevelLabel(childLevelConfig)

    // ========================================================================
    // STATE
    // ========================================================================

    const [searchTerm, setSearchTerm] = useState("")
    const [expandedKeys, setExpandedKeys] = useState<string[]>([])
    const [selectedValue, setSelectedValue] = useState<string | null>(selectedValueProp ?? null)

    // Sync selectedValue with prop
    useEffect(() => {
        if (selectedValueProp !== undefined) {
            setSelectedValue(selectedValueProp)
        }
    }, [selectedValueProp])

    // ========================================================================
    // PARENT DATA
    // ========================================================================

    const {items: parentItems, query: parentQuery} = useLevelData({
        levelConfig: parentLevelConfig,
        parentId: null,
        isEnabled: true,
    })

    // Filter parents
    const filteredParentItems = useMemo(() => {
        let items = parentItems
        if (parentFilter) {
            items = items.filter(parentFilter)
        }
        return items
    }, [parentItems, parentFilter])

    // Get parent IDs for fetching children
    const parentIds = useMemo(() => {
        return filteredParentItems.map((p) => parentLevelConfig.getId(p))
    }, [filteredParentItems, parentLevelConfig])

    // ========================================================================
    // CHILDREN DATA
    // ========================================================================

    const childrenDataMap = useChildrenDataForParents(childLevelConfig, parentIds)

    const isLoadingChildren = useMemo(() => {
        // Debug: log children loading state
        if (process.env.NODE_ENV === "development") {
            const childrenStates: Record<string, {isPending: boolean; itemCount: number}> = {}
            for (const [parentId, data] of childrenDataMap) {
                childrenStates[parentId] = {
                    isPending: data.query.isPending,
                    itemCount: data.items.length,
                }
            }
        }

        for (const [, data] of childrenDataMap) {
            if (data.query.isPending) return true
        }
        return false
    }, [childrenDataMap])

    // ========================================================================
    // BUILD TREE DATA
    // ========================================================================

    const {treeData, flatNodes} = useMemo(() => {
        const flat: TreeSelectNode[] = []
        const tree: TreeSelectNode[] = []

        const getRevisionSortValue = (child: unknown) => {
            const revision = (child as {revision?: number}).revision
            if (typeof revision === "number") return revision

            const createdAt = (child as {createdAt?: string}).createdAt
            if (createdAt) {
                const timestamp = new Date(createdAt).getTime()
                return Number.isNaN(timestamp) ? 0 : timestamp
            }

            return 0
        }

        filteredParentItems.forEach((parent) => {
            const parentId = parentLevelConfig.getId(parent)
            const parentLabelStr = parentLevelConfig.getLabel(parent)
            const parentLabelNode = parentLevelConfig.getLabelNode?.(parent)
            const isParentDisabled = disabledParentIds?.has(parentId) ?? false

            // Get children for this parent
            const childrenData = childrenDataMap.get(parentId)
            let childItems = childrenData?.items ?? []

            // Apply child filter
            if (childFilter) {
                childItems = childItems.filter((child: unknown) => childFilter(child, parent))
            }

            // Apply search filter to children
            let parentMatchesSearch = false
            if (searchTerm) {
                const lowerSearch = searchTerm.toLowerCase()
                parentMatchesSearch = parentLabelStr.toLowerCase().includes(lowerSearch)
                if (!parentMatchesSearch) {
                    childItems = childItems.filter((child: unknown) => {
                        const childLabelStr = childLevelConfig.getLabel(child)
                        return childLabelStr.toLowerCase().includes(lowerSearch)
                    })
                }
            }

            // If search is active and neither parent nor children match, skip this parent
            if (searchTerm && !parentMatchesSearch && childItems.length === 0) {
                return
            }

            // Sort revisions latest → oldest (descending revision number, fallback to createdAt)
            childItems = [...childItems].sort(
                (a, b) => getRevisionSortValue(b) - getRevisionSortValue(a),
            )

            // Build child nodes
            const childNodes: TreeSelectNode[] = childItems.map((child: unknown) => {
                const childId = childLevelConfig.getId(child)
                const childLabelStr = childLevelConfig.getLabel(child)
                const childLabelNode = childLevelConfig.getLabelNode?.(child)
                const isChildDisabled = disabledChildIds?.has(childId) ?? false

                // Build default title node
                const defaultTitle = childLabelNode ?? childLabelStr

                // Apply custom renderer if provided
                const title = renderChildTitle
                    ? renderChildTitle(child, parent, defaultTitle)
                    : defaultTitle
                const selectedLabel = renderSelectedLabel
                    ? renderSelectedLabel(child, parent, defaultTitle)
                    : undefined

                const childNode: TreeSelectNode = {
                    key: childId,
                    id: childId,
                    value: childId,
                    // Use selectedLabel as label if provided - this controls what TreeSelect shows for selected value
                    label: selectedLabel ?? childLabelStr,
                    labelNode: childLabelNode,
                    title,
                    selectedLabel,
                    selectable: !isChildDisabled,
                    disabled: isChildDisabled,
                    isLeaf: true,
                    entity: child,
                    parentId,
                    parentLabel: parentLabelStr,
                    metadata: {
                        isChild: true,
                        actions: childActions,
                    },
                }

                flat.push(childNode)
                return childNode
            })

            // Build default parent title node
            const defaultParentTitle = parentLabelNode ?? parentLabelStr

            // Apply custom renderer if provided
            const parentTitle = renderParentTitle
                ? renderParentTitle(parent, defaultParentTitle)
                : defaultParentTitle

            // Build parent node
            const parentNode: TreeSelectNode = {
                key: parentId,
                id: parentId,
                value: parentId,
                label: parentLabelStr,
                labelNode: parentLabelNode,
                title: parentTitle,
                selectable: false, // Parents are not selectable, only children
                disabled: isParentDisabled,
                isLeaf: false,
                children: childNodes,
                entity: parent,
                metadata: {
                    isParent: true,
                    actions: parentActions,
                },
            }

            flat.push(parentNode)

            // Only include parent if it has children (after filtering) or if not searching
            if (!searchTerm || childNodes.length > 0) {
                tree.push(parentNode)
            }
        })

        return {treeData: tree, flatNodes: flat}
    }, [
        filteredParentItems,
        parentLevelConfig,
        childLevelConfig,
        childrenDataMap,
        searchTerm,
        disabledParentIds,
        disabledChildIds,
        childFilter,
        childActions,
        parentActions,
        renderParentTitle,
        renderChildTitle,
        renderSelectedLabel,
    ])

    // ========================================================================
    // AUTO-EXPAND
    // ========================================================================

    const hasAutoExpandedRef = useRef(false)

    useEffect(() => {
        if (!defaultExpandAll || hasAutoExpandedRef.current || parentQuery.isPending) {
            return
        }

        hasAutoExpandedRef.current = true
        const allParentIds = treeData.map((node) => node.id)
        setExpandedKeys(allParentIds)
    }, [defaultExpandAll, parentQuery.isPending, treeData])

    // ========================================================================
    // SELECTION HANDLER
    // ========================================================================

    const handleSelect = useCallback(
        (value: string, node: TreeSelectNode) => {
            // Note: TreeSelect handles disabled/selectable internally - it won't trigger onChange for disabled nodes
            // The node passed here should have full data since TreeSelectVariant looks it up from flatNodes
            if (!onSelect) return
            if (node?.disabled) return

            setSelectedValue(value)

            // Build selection path
            const parentPathItem: SelectionPathItem = {
                type: parentLevelConfig.type,
                id: node.parentId ?? "",
                label: node.parentLabel ?? "",
            }

            const childPathItem = buildPathItem(node.entity, childLevelConfig)
            const fullPath = [parentPathItem, childPathItem]
            const selection = createSelection(fullPath, node.entity)

            onSelect(selection)
        },
        [onSelect, parentLevelConfig, childLevelConfig, createSelection],
    )

    // ========================================================================
    // UTILITIES
    // ========================================================================

    const getNodeById = useCallback(
        (id: string): TreeSelectNode | undefined => {
            return flatNodes.find((node) => node.id === id)
        },
        [flatNodes],
    )

    const isNodeDisabled = useCallback(
        (id: string): boolean => {
            const node = getNodeById(id)
            return node?.disabled ?? false
        },
        [getNodeById],
    )

    // ========================================================================
    // RETURN
    // ========================================================================

    return {
        // Tree data
        treeData,
        flatNodes,

        // Level configs
        parentLevelConfig,
        childLevelConfig,
        parentLabel,
        childLabel,

        // Loading state
        isLoadingParents: parentQuery.isPending,
        isLoadingChildren,
        parentsError: parentQuery.error,

        // Search
        searchTerm,
        setSearchTerm,

        // Selection
        handleSelect,
        selectedValue,

        // Expansion
        expandedKeys,
        setExpandedKeys,

        // Core
        adapter,
        instanceId,

        // Utilities
        getNodeById,
        isNodeDisabled,
    }
}
