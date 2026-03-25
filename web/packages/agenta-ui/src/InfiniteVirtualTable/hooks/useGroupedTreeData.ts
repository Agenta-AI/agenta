import {useCallback, useMemo, useState} from "react"

/**
 * Shared hook for grouped tree-style table data.
 *
 * Groups rows by a parent key (e.g., variantId, workflowId), creates
 * a tree data source for IVT, and manages expand/collapse + key mapping
 * between synthetic group keys and actual row IDs.
 *
 * Used by RegistryTable, EvaluatorsTable, and NewEvaluation selection sections.
 */

// ============================================================================
// TYPES
// ============================================================================

export interface GroupableRow {
    key: string
    __isSkeleton?: boolean
    __isGroupChild?: boolean
    [k: string]: unknown
}

export interface GroupedTreeDataConfig<T extends GroupableRow> {
    /** All rows from the paginated store */
    rows: T[]
    /** Extract the parent grouping key from a row */
    getGroupKey: (row: T) => string
    /** Prefix for synthetic group row keys (e.g., "variant-group-") */
    groupKeyPrefix: string
    /** Extract the selectable ID from a row (e.g., revisionId). Optional — only needed for selection mapping. */
    getSelectableId?: (row: T) => string
}

/** Expand state passed to column creators for rendering expand/collapse icons. */
export interface GroupExpandState {
    expandedRowKeys: string[]
    handleExpand: (expanded: boolean, rowKey: string) => void
}

export interface GroupedTreeDataResult<T extends GroupableRow> {
    /** Tree data source with children nested under group parents */
    groupedDataSource: T[]
    /** Maps synthetic group keys → actual selectable IDs (only when getSelectableId is provided) */
    groupKeyToSelectableId: Map<string, string>
    /** Maps actual selectable IDs → synthetic group keys (only when getSelectableId is provided) */
    selectableIdToGroupKey: Map<string, string>
    /** Expandable config for antd Table — hides default expand icon */
    treeExpandable: {
        expandedRowKeys: string[]
        onExpand: (expanded: boolean, record: T) => void
        expandIcon: () => null
    }
    /** Expand state for column renderers (uses string rowKey) */
    expandState: GroupExpandState
    /** Resolve a key (group or direct) to its selectable ID */
    resolveSelectableId: (key: string) => string
    /** Map selected IDs to display keys (group keys when applicable) */
    toDisplayKeys: (selectedIds: string[]) => React.Key[]
    /** Current expanded row keys */
    expandedRowKeys: string[]
}

// ============================================================================
// HOOK
// ============================================================================

export function useGroupedTreeData<T extends GroupableRow>(
    config: GroupedTreeDataConfig<T>,
): GroupedTreeDataResult<T> {
    const {rows, getGroupKey, groupKeyPrefix, getSelectableId} = config
    const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([])

    const handleExpand = useCallback((expanded: boolean, rowKey: string) => {
        if (expanded) {
            setExpandedRowKeys((prev) => [...prev, rowKey])
        } else {
            setExpandedRowKeys((prev) => prev.filter((k) => k !== rowKey))
        }
    }, [])

    const handleExpandRecord = useCallback(
        (expanded: boolean, record: T) => {
            if (record.__isGroupChild) return
            handleExpand(expanded, String(record.key))
        },
        [handleExpand],
    )

    const {groupedDataSource, groupKeyToSelectableId, selectableIdToGroupKey} = useMemo(() => {
        const gToS = new Map<string, string>()
        const sToG = new Map<string, string>()

        const hasOnlySkeletons = rows.length > 0 && rows.every((r) => r.__isSkeleton)
        if (hasOnlySkeletons) {
            return {
                groupedDataSource: rows,
                groupKeyToSelectableId: gToS,
                selectableIdToGroupKey: sToG,
            }
        }

        // Group rows by parent key
        const groupMap = new Map<string, {representative: T; revisions: T[]}>()
        for (const row of rows) {
            if (row.__isSkeleton) continue
            const parentKey = getGroupKey(row)
            const existing = groupMap.get(parentKey)
            if (existing) {
                existing.revisions.push(row)
            } else {
                groupMap.set(parentKey, {representative: row, revisions: [row]})
            }
        }

        const dataSource = Array.from(groupMap.values()).map((group) => {
            const childRevisions = group.revisions.filter(
                (rev) => rev.key !== group.representative.key,
            )
            const children: T[] = childRevisions.map((rev) => ({
                ...rev,
                __isGroupChild: true,
            }))

            const syntheticKey = `${groupKeyPrefix}${getGroupKey(group.representative)}`

            if (getSelectableId) {
                gToS.set(syntheticKey, getSelectableId(group.representative))
                sToG.set(getSelectableId(group.representative), syntheticKey)
            }

            return {
                ...group.representative,
                key: syntheticKey,
                __revisionCount: group.revisions.length,
                children,
            } as T
        })

        return {
            groupedDataSource: dataSource,
            groupKeyToSelectableId: gToS,
            selectableIdToGroupKey: sToG,
        }
    }, [rows, getGroupKey, getSelectableId, groupKeyPrefix])

    const treeExpandable = useMemo(
        () => ({
            expandedRowKeys,
            onExpand: handleExpandRecord,
            expandIcon: () => null as unknown as null,
        }),
        [expandedRowKeys, handleExpandRecord],
    )

    const expandState: GroupExpandState = useMemo(
        () => ({expandedRowKeys, handleExpand}),
        [expandedRowKeys, handleExpand],
    )

    const resolveSelectableId = useCallback(
        (key: string) => groupKeyToSelectableId.get(key) ?? key,
        [groupKeyToSelectableId],
    )

    const toDisplayKeys = useCallback(
        (selectedIds: string[]) =>
            selectedIds.map((id) => selectableIdToGroupKey.get(id) ?? id) as React.Key[],
        [selectableIdToGroupKey],
    )

    return {
        groupedDataSource,
        groupKeyToSelectableId,
        selectableIdToGroupKey,
        treeExpandable,
        expandState,
        resolveSelectableId,
        toDisplayKeys,
        expandedRowKeys,
    }
}
