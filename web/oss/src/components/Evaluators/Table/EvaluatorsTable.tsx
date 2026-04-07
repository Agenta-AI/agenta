import type {ReactNode} from "react"
import {useMemo} from "react"

import {
    InfiniteVirtualTableFeatureShell,
    useTableManager,
    useGroupedTreeData,
} from "@agenta/ui/table"

import type {EvaluatorCategory} from "../assets/types"
import type {EvaluatorTableRow} from "../store/evaluatorsPaginatedStore"
import {evaluatorsPaginatedStore} from "../store/evaluatorsPaginatedStore"

import {createEvaluatorColumns, type EvaluatorColumnActions} from "./assets/evaluatorColumns"

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

const getEvaluatorGroupKey = (row: EvaluatorTableRow) => row.workflowId

const EvaluatorsTable = ({
    category,
    onRowClick,
    actions,
    searchDeps = [],
    filters,
    primaryActions,
    displayMode = "grouped",
}: EvaluatorsTableProps) => {
    const table = useTableManager<EvaluatorTableRow>({
        datasetStore: evaluatorsPaginatedStore.store as never,
        scopeId: "evaluators",
        pageSize: 50,
        onRowClick,
        searchDeps,
        columnVisibilityStorageKey: "agenta:evaluators:column-visibility",
        rowClassName: "variant-table-row",
    })

    const paginationRows = table.shellProps.pagination?.rows ?? []

    const {groupedDataSource, treeExpandable, expandState} = useGroupedTreeData({
        rows: paginationRows,
        getGroupKey: getEvaluatorGroupKey,
        groupKeyPrefix: "evaluator-group-",
    })

    const columns = useMemo(
        () => createEvaluatorColumns(actions, category, expandState),
        [actions, category, expandState],
    )

    const isGrouped = displayMode === "grouped"

    return (
        <InfiniteVirtualTableFeatureShell<EvaluatorTableRow>
            {...table.shellProps}
            useSettingsDropdown
            columns={columns}
            filters={filters}
            primaryActions={primaryActions}
            autoHeight
            dataSource={isGrouped ? groupedDataSource : undefined}
            tableProps={{
                ...table.shellProps.tableProps,
                ...(isGrouped ? {expandable: treeExpandable} : {}),
            }}
        />
    )
}

export default EvaluatorsTable
