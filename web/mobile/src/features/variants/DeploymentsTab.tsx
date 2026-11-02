import {useMemo, useState} from "react"

import {
    appEnvironmentsLoadableAtomFamily,
    environmentsListQueryAtomFamily,
    type AppDeploymentRow,
} from "@agenta/entities/environment"
import {workflowVariantsListDataAtomFamily, type Workflow} from "@agenta/entities/workflow"
import {useSettledValue} from "@agenta/shared/hooks"
import {LoadError} from "@agenta/ui/components/presentational"
import {ListTableToolbar} from "@agenta/ui/list-table"
import {Button} from "@agenta/ui/ui"
import {CloudArrowUp, Lightning} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import Link from "next/link"

import {useProjectPermission} from "../context/useProjectPermission"
import {useDeveloperViewEnabled} from "../developer/developerViewAccess"
import {useUrlParams} from "../developer/useUrlParams"
import {useRevisionParam} from "../revisions/useRevisionParam"

import {DeploymentHistoryTable} from "./DeploymentHistoryTable"
import {DeployToEnvironmentDialog} from "./DeployToEnvironmentDialog"
import {EnvironmentCards} from "./EnvironmentCards"
import {RevertDeploymentDialog} from "./RevertDeploymentDialog"
import {DeploymentsEmpty} from "./states/DeploymentsEmpty"
import {EnvironmentCardsSkeleton} from "./states/EnvironmentCardsSkeleton"
import {useAppDeploymentHistory} from "./useAppDeploymentHistory"

const RevisionDrawerHost = dynamic(
    () => import("../revisions/RevisionDrawerHost").then((module) => module.RevisionDrawerHost),
    {ssr: false},
)

/** The Deployments tab: one card per environment, and the history of the chosen one. */
export const DeploymentsTab = ({
    projectId,
    app,
    base,
}: {
    projectId: string
    app: Workflow
    /** `/w/<workspace>/p/<project>`, for the link to the endpoints view. */
    base: string
}) => {
    const {read, write} = useUrlParams()
    const environments = useAtomValue(appEnvironmentsLoadableAtomFamily(app.id))
    const environmentList = useAtomValue(environmentsListQueryAtomFamily(false))
    const variants = useAtomValue(workflowVariantsListDataAtomFamily(app.id))
    const variantNames = useMemo(
        () =>
            new Map(
                variants.flatMap((variant) => {
                    const name = variant.name || variant.slug
                    return name ? [[variant.id, name] as const] : []
                }),
            ),
        [variants],
    )
    const canDeploy = useProjectPermission(projectId, "deploy_environments")
    const endpointsEnabled = useDeveloperViewEnabled("endpoints")
    const [revisionId, setRevisionId] = useRevisionParam()
    const [search, setSearch] = useState("")
    const term = useSettledValue(search).trim()
    const [revertRow, setRevertRow] = useState<AppDeploymentRow | null>(null)
    const [deployOpen, setDeployOpen] = useState(false)

    const slugParam = read("env")
    const selected = useMemo(
        () =>
            environments.data.find((entry) => entry.slug === slugParam) ??
            environments.data.find((entry) => entry.slug === "development") ??
            environments.data[0] ??
            null,
        [environments.data, slugParam],
    )
    const environmentId =
        environmentList.data?.environments.find((entry) => entry.slug === selected?.slug)?.id ??
        null

    const history = useAppDeploymentHistory({
        projectId,
        appId: app.id,
        appSlug: app.slug ?? null,
        environmentId,
        search: term,
    })
    const rows = useMemo(() => history.data ?? [], [history.data])
    const currentRevisionId = selected?.deployedRevisionId ?? null

    const navigationIds = useMemo(
        () => [
            ...new Set(
                rows.flatMap((row) => (row.deployedRevisionId ? [row.deployedRevisionId] : [])),
            ),
        ],
        [rows],
    )
    const open = (row: AppDeploymentRow) => {
        if (row.deployedRevisionId) setRevisionId(row.deployedRevisionId)
    }
    const shownRow = revisionId
        ? (rows.find((row) => row.deployedRevisionId === revisionId) ?? null)
        : null
    const canRevert = (row: AppDeploymentRow | null) =>
        canDeploy && row?.deployedRevisionId != null && row.deployedRevisionId !== currentRevisionId

    if (environments.isError || environmentList.isError) {
        return (
            <LoadError
                framed
                title="Could not load deployments"
                onRetry={() => void environments.refetch()}
            />
        )
    }
    if (environments.isPending) return <EnvironmentCardsSkeleton />

    return (
        <div className="flex flex-col gap-4">
            <EnvironmentCards
                environments={environments.data}
                selectedSlug={selected?.slug ?? null}
                onSelect={(slug) => write({env: slug, revisionId: null})}
            />
            <div>
                <ListTableToolbar
                    search={search}
                    onSearchChange={setSearch}
                    searchPlaceholder="Search"
                    actions={
                        <div className="ml-auto flex items-center gap-2">
                            {endpointsEnabled ? (
                                <Button asChild variant="outline" size="sm">
                                    <Link href={`${base}/endpoints?app=${app.id}`} prefetch={false}>
                                        <Lightning aria-hidden size={14} />
                                        Use API
                                    </Link>
                                </Button>
                            ) : null}
                            {canDeploy && selected ? (
                                <Button size="sm" onClick={() => setDeployOpen(true)}>
                                    <CloudArrowUp aria-hidden size={14} />
                                    Deploy
                                </Button>
                            ) : null}
                        </div>
                    }
                />
                {history.isError ? (
                    <LoadError
                        framed
                        title="Could not load deployments"
                        onRetry={() => void history.refetch()}
                    />
                ) : (
                    <DeploymentHistoryTable
                        rows={rows}
                        isLoading={history.isPending && environmentId !== null}
                        variantNames={variantNames}
                        currentRevisionId={currentRevisionId}
                        canRevert={canDeploy}
                        onOpen={open}
                        onRevert={setRevertRow}
                        empty={<DeploymentsEmpty />}
                    />
                )}
            </div>

            {revisionId ? (
                <RevisionDrawerHost
                    kind="deployment"
                    navigationIds={navigationIds}
                    actions={
                        canRevert(shownRow) ? (
                            <Button size="sm" onClick={() => setRevertRow(shownRow)}>
                                Revert
                            </Button>
                        ) : null
                    }
                />
            ) : null}
            {revertRow && selected ? (
                <RevertDeploymentDialog
                    key={revertRow.envRevisionId}
                    row={revertRow}
                    environment={selected}
                    appId={app.id}
                    appSlug={app.slug ?? null}
                    onClose={() => setRevertRow(null)}
                />
            ) : null}
            {deployOpen && selected ? (
                <DeployToEnvironmentDialog
                    projectId={projectId}
                    appId={app.id}
                    appSlug={app.slug ?? null}
                    environment={{
                        slug: selected.slug,
                        name: selected.name,
                        deployedRevisionId: currentRevisionId,
                        deployedLabel: selected.deployedVariantName
                            ? `${selected.deployedVariantName}${selected.revision ? ` v${selected.revision}` : ""}`
                            : null,
                    }}
                    onClose={() => setDeployOpen(false)}
                />
            ) : null}
        </div>
    )
}
