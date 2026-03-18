import {useCallback, useMemo, useState} from "react"

/**
 * Shared hook for grouped tree-style table selection.
 *
 * Groups rows by a parent key (e.g., variantId, workflowId), creates
 * a tree data source for IVT, and manages expand/collapse + key mapping
 * between synthetic group keys and actual row IDs.
 */

interface BaseRow {
    key: string
    __isSkeleton?: boolean
    __isGroupChild?: boolean
    [k: string]: unknown
}

interface GroupedTreeSelectionConfig<T extends BaseRow> {
    /** All rows from the paginated store */
    rows: T[]
    /** Extract the parent grouping key from a row */
    getGroupKey: (row: T) => string
    /** Extract the selectable ID from a row (e.g., revisionId) */
    getSelectableId: (row: T) => string
    /** Prefix for synthetic group row keys (e.g., "variant-group-") */
    groupKeyPrefix: string
}

interface GroupedTreeSelectionResult<T extends BaseRow> {
    /** Tree data source with children nested under group parents */
    groupedDataSource: T[]
    /** Maps synthetic group keys → actual selectable IDs */
    groupKeyToSelectableId: Map<string, string>
    /** Maps actual selectable IDs → synthetic group keys */
    selectableIdToGroupKey: Map<string, string>
    /** Expandable config for antd Table */
    treeExpandable: {
        expandedRowKeys: string[]
        onExpand: (expanded: boolean, record: T) => void
        expandIcon: () => null
    }
    /** Resolve a key (group or direct) to its selectable ID */
    resolveSelectableId: (key: string) => string
    /** Map selected IDs to display keys (group keys when applicable) */
    toDisplayKeys: (selectedIds: string[]) => React.Key[]
    /** Current expanded row keys */
    expandedRowKeys: string[]
    /** Handle expand/collapse */
    handleExpand: (expanded: boolean, record: T) => void
}

export function useGroupedTreeSelection<T extends BaseRow>(
    config: GroupedTreeSelectionConfig<T>,
): GroupedTreeSelectionResult<T> {
    const {rows, getGroupKey, getSelectableId, groupKeyPrefix} = config
    const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([])

    const handleExpand = useCallback((expanded: boolean, record: T) => {
        const rowKey = String(record.key)
        if (record.__isGroupChild) return

        if (expanded) {
            setExpandedRowKeys((prev) => [...prev, rowKey])
        } else {
            setExpandedRowKeys((prev) => prev.filter((k) => k !== rowKey))
        }
    }, [])

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
            gToS.set(syntheticKey, getSelectableId(group.representative))
            sToG.set(getSelectableId(group.representative), syntheticKey)

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
            onExpand: handleExpand,
            expandIcon: () => null as unknown as null,
        }),
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
        resolveSelectableId,
        toDisplayKeys,
        expandedRowKeys,
        handleExpand,
    }
}
