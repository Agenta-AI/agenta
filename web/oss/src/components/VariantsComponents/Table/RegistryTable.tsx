import type {ReactNode} from "react"
import {useMemo} from "react"

import {
    InfiniteVirtualTableFeatureShell,
    useTableManager,
    useGroupedTreeData,
} from "@agenta/ui/table"

import type {RegistryRevisionRow} from "../store/registryStore"
import {registryPaginatedStore} from "../store/registryStore"

import {createRegistryColumns, type RegistryColumnActions} from "./assets/registryColumns"

interface RegistryTableProps {
    onRowClick?: (record: RegistryRevisionRow) => void
    actions: RegistryColumnActions
    searchDeps?: unknown[]
    scopeId?: string
    pageSize?: number
    columnVisibilityStorageKey?: string
    filters?: ReactNode
    primaryActions?: ReactNode
    displayMode?: "flat" | "grouped"
}

const getVariantGroupKey = (row: RegistryRevisionRow) => row.variantId

// ============================================================================
// REGISTRY TABLE
// ============================================================================

const RegistryTable = ({
    onRowClick,
    actions,
    searchDeps = [],
    scopeId = "registry-revisions",
    pageSize = 50,
    columnVisibilityStorageKey = "agenta:registry:column-visibility",
    filters,
    primaryActions,
    displayMode = "flat",
}: RegistryTableProps) => {
    const table = useTableManager<RegistryRevisionRow>({
        datasetStore: registryPaginatedStore.store as never,
        scopeId,
        pageSize,
        onRowClick,
        searchDeps,
        columnVisibilityStorageKey,
        rowClassName: "variant-table-row",
    })

    const paginationRows = table.shellProps.pagination?.rows ?? []

    const {groupedDataSource, treeExpandable, expandState} = useGroupedTreeData({
        rows: paginationRows,
        getGroupKey: getVariantGroupKey,
        groupKeyPrefix: "variant-group-",
    })

    const columns = useMemo(
        () => createRegistryColumns(actions, expandState),
        [actions, expandState],
    )

    const isGrouped = displayMode === "grouped"

    return (
        <InfiniteVirtualTableFeatureShell<RegistryRevisionRow>
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

export default RegistryTable
