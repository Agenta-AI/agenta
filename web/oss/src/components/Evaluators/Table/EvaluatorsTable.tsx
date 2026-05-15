import type {ReactNode} from "react"
import {useMemo} from "react"

import {
    InfiniteVirtualTableFeatureShell,
    useTableManager,
    useGroupedTreeData,
} from "@agenta/ui/table"

import type {EvaluatorCategory} from "../assets/types"
import type {EvaluatorTableRow} from "../store/evaluatorsPaginatedStore"
import {getEvaluatorsTableState} from "../store/evaluatorsPaginatedStore"

import {createEvaluatorColumns, type EvaluatorColumnActions} from "./assets/evaluatorColumns"

// ============================================================================
// EVALUATORS TABLE
// ============================================================================

interface EvaluatorsTableProps {
    category: EvaluatorCategory
    mode?: "active" | "archived"
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
    mode = "active",
    onRowClick,
    actions,
    searchDeps = [],
    filters,
    primaryActions,
    displayMode = "grouped",
}: EvaluatorsTableProps) => {
    const tableState = getEvaluatorsTableState(mode)
    const isArchived = mode === "archived"
    const table = useTableManager<EvaluatorTableRow>({
        datasetStore: tableState.paginatedStore.store as never,
        scopeId: isArchived ? "archived-evaluators" : "evaluators",
        pageSize: 50,
        onRowClick,
        searchDeps,
        columnVisibilityStorageKey: isArchived
            ? "agenta:archived-evaluators:column-visibility"
            : "agenta:evaluators:column-visibility",
        rowClassName: "variant-table-row",
        exportFilename: isArchived ? "archived-evaluators.csv" : "evaluators.csv",
    })

    const paginationRows = table.shellProps.pagination?.rows ?? []

    const {groupedDataSource, treeExpandable, expandState} = useGroupedTreeData({
        rows: paginationRows,
        getGroupKey: getEvaluatorGroupKey,
        groupKeyPrefix: "evaluator-group-",
    })

    const columns = useMemo(
        () => createEvaluatorColumns(actions, category, expandState, {mode}),
        [actions, category, expandState, mode],
    )

    const isGrouped = !isArchived && displayMode === "grouped"

    return (
        <InfiniteVirtualTableFeatureShell<EvaluatorTableRow>
            {...table.shellProps}
            useSettingsDropdown
            columns={columns}
            filters={filters}
            primaryActions={primaryActions}
            className="flex-1 min-h-0"
            autoHeight
            enableExport={isArchived}
            dataSource={isGrouped ? groupedDataSource : undefined}
            tableProps={{
                ...table.shellProps.tableProps,
                ...(isGrouped ? {expandable: treeExpandable} : {}),
            }}
        />
    )
}

export default EvaluatorsTable
