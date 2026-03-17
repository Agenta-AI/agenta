import type {ReactNode} from "react"
import {useMemo} from "react"

import {InfiniteVirtualTableFeatureShell, useTableManager} from "@agenta/ui/table"

import type {DeploymentRevisionRow} from "../store/deploymentStore"
import {deploymentPaginatedStore} from "../store/deploymentStore"

import {createDeploymentColumns, type DeploymentColumnActions} from "./assets/deploymentColumns"

interface DeploymentsTableProps {
    onRowClick?: (record: DeploymentRevisionRow) => void
    actions: DeploymentColumnActions
    searchDeps?: unknown[]
    filters?: ReactNode
    primaryActions?: ReactNode
}

const DeploymentsTable = ({
    onRowClick,
    actions,
    searchDeps = [],
    filters,
    primaryActions,
}: DeploymentsTableProps) => {
    const table = useTableManager<DeploymentRevisionRow>({
        datasetStore: deploymentPaginatedStore.store as never,
        scopeId: "deployment-revisions",
        pageSize: 50,
        onRowClick,
        searchDeps,
        columnVisibilityStorageKey: "agenta:deployments:column-visibility",
        rowClassName: "variant-table-row",
    })

    const columns = useMemo(() => createDeploymentColumns(actions), [actions])

    return (
        <InfiniteVirtualTableFeatureShell<DeploymentRevisionRow>
            {...table.shellProps}
            columns={columns}
            filters={filters}
            primaryActions={primaryActions}
            autoHeight
        />
    )
}

export default DeploymentsTable
