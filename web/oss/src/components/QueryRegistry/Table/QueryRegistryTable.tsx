import type {ReactNode} from "react"
import {useMemo} from "react"

import {InfiniteVirtualTableFeatureShell, useTableManager} from "@agenta/ui/table"

import getFilterColumns from "@/oss/components/pages/observability/assets/getFilterColumns"

import type {QueryRegistryStatus} from "../store/queryRegistryFilterAtoms"
import type {QueryRegistryRow} from "../store/queryRegistryStore"
import {getQueryRegistryTableState} from "../store/queryRegistryStore"

import {
    buildFieldLabelMap,
    createQueryRegistryColumns,
    type QueryColumnActions,
} from "./assets/queryRegistryColumns"

interface QueryRegistryTableProps {
    actions: QueryColumnActions
    onRowClick?: (record: QueryRegistryRow) => void
    filters?: ReactNode
    primaryActions?: ReactNode
    /** Rendered by the antd Table when there are no rows (post-load). */
    emptyState?: ReactNode
    searchDeps?: unknown[]
    /** Active vs archived view — selects the store and the restore-only actions. */
    mode?: QueryRegistryStatus
}

const QueryRegistryTable = ({
    actions,
    onRowClick,
    filters,
    primaryActions,
    emptyState,
    searchDeps = [],
    mode = "active",
}: QueryRegistryTableProps) => {
    const isArchived = mode === "archived"
    const datasetStore = getQueryRegistryTableState(mode).store
    const table = useTableManager<QueryRegistryRow>({
        datasetStore: datasetStore as never,
        scopeId: isArchived ? "query-registry-archived" : "query-registry",
        pageSize: 50,
        onRowClick,
        searchDeps,
        columnVisibilityStorageKey: isArchived
            ? "agenta:query-registry-archived:column-visibility"
            : "agenta:query-registry:column-visibility",
    })

    const fieldLabels = useMemo(() => buildFieldLabelMap(getFilterColumns()), [])
    const columns = useMemo(
        () => createQueryRegistryColumns(actions, fieldLabels, isArchived),
        [actions, fieldLabels, isArchived],
    )

    return (
        <InfiniteVirtualTableFeatureShell<QueryRegistryRow>
            {...table.shellProps}
            useSettingsDropdown
            columns={columns}
            filters={filters}
            primaryActions={primaryActions}
            className="flex-1 min-h-0"
            autoHeight
            tableProps={{
                ...table.shellProps.tableProps,
                ...(emptyState ? {locale: {emptyText: emptyState}} : {}),
            }}
        />
    )
}

export default QueryRegistryTable
