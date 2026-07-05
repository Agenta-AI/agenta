import type {Key, ReactNode} from "react"
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

export interface EvaluatorsTableSelection {
    selectedRowKeys: Key[]
    selectedRecords: EvaluatorTableRow[]
}

interface EvaluatorsTableProps {
    category: EvaluatorCategory
    mode?: "active" | "archived"
    onRowClick?: (record: EvaluatorTableRow) => void
    actions: EvaluatorColumnActions
    searchDeps?: unknown[]
    filters?: ReactNode
    primaryActions?: ReactNode
    renderPrimaryActions?: (selection: EvaluatorsTableSelection) => ReactNode
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
    renderPrimaryActions,
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

    const {groupedDataSource, treeExpandable, expandState, resolveSelectableId, toDisplayKeys} =
        useGroupedTreeData({
            rows: paginationRows,
            getGroupKey: getEvaluatorGroupKey,
            getSelectableId: (row) => String(row.key),
            groupKeyPrefix: "evaluator-group-",
        })

    // Mark top-level group parent rows so the name cell can read from the
    // workflow entity (which holds the user-entered name) instead of the
    // revision entity (which may have a null name field).
    // useGroupedTreeData is generic and doesn't set evaluator-specific flags,
    // so we annotate them here after the grouping step.
    const annotatedGroupedDataSource = useMemo(
        () =>
            groupedDataSource.map((row) =>
                row.__isSkeleton ? row : {...row, __isEvaluatorGroup: true as const},
            ),
        [groupedDataSource],
    )

    const columns = useMemo(
        () => createEvaluatorColumns(actions, category, expandState, {mode}),
        [actions, category, expandState, mode],
    )

    const isGrouped = !isArchived && displayMode === "grouped"
    const rowSelection = useMemo(() => {
        if (!isGrouped) return table.rowSelection

        return {
            ...table.rowSelection,
            selectedRowKeys: toDisplayKeys(table.selectedRowKeys.map(String)),
            onChange: (keys: Key[]) => {
                table.setSelectedRowKeys(keys.map((key) => resolveSelectableId(String(key))))
            },
        }
    }, [isGrouped, resolveSelectableId, table, toDisplayKeys])
    const resolvedPrimaryActions = renderPrimaryActions
        ? renderPrimaryActions({
              selectedRowKeys: table.selectedRowKeys,
              selectedRecords: table.getSelectedRecords(),
          })
        : primaryActions

    return (
        <InfiniteVirtualTableFeatureShell<EvaluatorTableRow>
            {...table.shellProps}
            useSettingsDropdown
            columns={columns}
            filters={filters}
            primaryActions={resolvedPrimaryActions}
            rowSelection={rowSelection}
            className="flex-1 min-h-0"
            autoHeight
            enableExport={isArchived}
            dataSource={isGrouped ? annotatedGroupedDataSource : undefined}
            tableProps={{
                ...table.shellProps.tableProps,
                ...(isGrouped ? {expandable: treeExpandable} : {}),
            }}
        />
    )
}

export default EvaluatorsTable
