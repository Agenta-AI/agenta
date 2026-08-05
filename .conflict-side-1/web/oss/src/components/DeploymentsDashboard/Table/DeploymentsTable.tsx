import type {ReactNode} from "react"
import {useMemo} from "react"

import {InfiniteVirtualTableFeatureShell, useTableManager} from "@agenta/ui/table"

import {deploymentSearchTermAtom} from "../store/deploymentFilterAtoms"
import type {DeploymentRevisionRow} from "../store/deploymentStore"
import {deploymentPaginatedStore} from "../store/deploymentStore"

import {createDeploymentColumns, type DeploymentColumnActions} from "./assets/deploymentColumns"

interface DeploymentsTableProps {
    onRowClick?: (record: DeploymentRevisionRow) => void
    actions: DeploymentColumnActions
    /** Additional dependencies that should trigger pagination reset alongside search */
    searchDeps?: unknown[]
    primaryActions?: ReactNode
}

const DeploymentsTable = ({
    onRowClick,
    actions,
    searchDeps = [],
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
        search: {atom: deploymentSearchTermAtom},
    })

    const columns = useMemo(() => createDeploymentColumns(actions), [actions])

    return (
        <InfiniteVirtualTableFeatureShell<DeploymentRevisionRow>
            {...table.shellProps}
            columns={columns}
            primaryActions={primaryActions}
            autoHeight
        />
    )
}

export default DeploymentsTable
