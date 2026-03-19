import type {ReactNode} from "react"
import {useCallback, useMemo, useState} from "react"

import {InfiniteVirtualTableFeatureShell, useTableManager} from "@agenta/ui/table"

import type {EvaluatorCategory} from "../assets/types"
import type {EvaluatorTableRow} from "../store/evaluatorsPaginatedStore"
import {evaluatorsPaginatedStore} from "../store/evaluatorsPaginatedStore"

import {
    createEvaluatorColumns,
    type EvaluatorColumnActions,
    type EvaluatorExpandState,
} from "./assets/evaluatorColumns"

// ============================================================================
// GROUPED VIEW HELPERS
// ============================================================================

interface EvaluatorGroup {
    representative: EvaluatorTableRow
    revisions: EvaluatorTableRow[]
}

function groupByEvaluator(rows: EvaluatorTableRow[]): EvaluatorGroup[] {
    const map = new Map<string, EvaluatorGroup>()
    for (const row of rows) {
        if (row.__isSkeleton) continue
        const existing = map.get(row.workflowId)
        if (existing) {
            existing.revisions.push(row)
        } else {
            map.set(row.workflowId, {representative: row, revisions: [row]})
        }
    }
    return Array.from(map.values())
}

// ============================================================================
// EVALUATORS TABLE
// ============================================================================

interface EvaluatorsTableProps {
    category: EvaluatorCategory
    onRowClick?: (record: EvaluatorTableRow) => void
    actions: EvaluatorColumnActions
    searchDeps?: unknown[]
    filters?: ReactNode
    primaryActions?: ReactNode
    displayMode?: "flat" | "grouped"
}

const EvaluatorsTable = ({
    category,
    onRowClick,
    actions,
    searchDeps = [],
    filters,
    primaryActions,
    displayMode = "grouped",
}: EvaluatorsTableProps) => {
    // Track which evaluator groups are expanded
    const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([])

    const handleExpand = useCallback((expanded: boolean, rowKey: string) => {
        if (expanded) {
            setExpandedRowKeys((prev) => [...prev, rowKey])
        } else {
            setExpandedRowKeys((prev) => prev.filter((k) => k !== rowKey))
        }
    }, [])

    // Adapter for Ant Design's onExpand which passes the full record
    const handleExpandRecord = useCallback(
        (expanded: boolean, record: EvaluatorTableRow) => {
            if (record.__isGroupChild) return
            handleExpand(expanded, String(record.key))
        },
        [handleExpand],
    )

    const table = useTableManager<EvaluatorTableRow>({
        datasetStore: evaluatorsPaginatedStore.store as never,
        scopeId: "evaluators",
        pageSize: 50,
        onRowClick,
        searchDeps,
        columnVisibilityStorageKey: "agenta:evaluators:column-visibility",
        rowClassName: "variant-table-row",
    })

    const expandState: EvaluatorExpandState = useMemo(
        () => ({expandedRowKeys, handleExpand}),
        [expandedRowKeys, handleExpand],
    )

    const columns = useMemo(
        () => createEvaluatorColumns(actions, category, expandState),
        [actions, category, expandState],
    )

    const paginationRows = table.shellProps.pagination?.rows ?? []

    // Grouped view: build parent rows with children for tree data
    const groupedDataSource = useMemo(() => {
        if (displayMode !== "grouped") return undefined

        // During loading, pass skeleton rows through as-is
        const hasOnlySkeletons =
            paginationRows.length > 0 && paginationRows.every((r) => r.__isSkeleton)
        if (hasOnlySkeletons) return paginationRows

        const groups = groupByEvaluator(paginationRows)
        return groups.map((group) => {
            // Exclude representative (latest) from children — it's the parent row
            const childRevisions = group.revisions.filter(
                (rev) => rev.key !== group.representative.key,
            )
            const children: EvaluatorTableRow[] = childRevisions.map((rev) => ({
                ...rev,
                __isGroupChild: true,
            }))

            return {
                ...group.representative,
                key: `evaluator-group-${group.representative.workflowId}`,
                __isEvaluatorGroup: true,
                __revisionCount: group.revisions.length,
                children,
            }
        })
    }, [displayMode, paginationRows])

    // Tree expandable config — hides default expand column (icon is in Name cell)
    const treeExpandable = useMemo(() => {
        if (displayMode !== "grouped") return undefined
        return {
            expandedRowKeys,
            onExpand: handleExpandRecord,
            expandIcon: () => null,
        }
    }, [displayMode, expandedRowKeys, handleExpandRecord])

    return (
        <InfiniteVirtualTableFeatureShell<EvaluatorTableRow>
            {...table.shellProps}
            useSettingsDropdown
            columns={columns}
            filters={filters}
            primaryActions={primaryActions}
            autoHeight
            dataSource={groupedDataSource}
            tableProps={{
                ...table.shellProps.tableProps,
                ...(treeExpandable ? {expandable: treeExpandable} : {}),
            }}
        />
    )
}

export default EvaluatorsTable
