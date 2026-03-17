import {type FC, useCallback, useMemo} from "react"

import {publishMutationAtom} from "@agenta/entities/runnable"
import {workflowMolecule} from "@agenta/entities/workflow"
import {CloudArrowUpIcon, CodeSimpleIcon} from "@phosphor-icons/react"
import {Button, Input, Space} from "antd"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {usePlaygroundNavigation} from "@/oss/hooks/usePlaygroundNavigation"
import {useQueryParamState} from "@/oss/state/appState"

import {openDeploymentsDrawerAtom} from "./modals/store/deploymentDrawerStore"
import {
    openDeploymentConfirmationModalAtom,
    openSelectDeployVariantModalAtom,
} from "./modals/store/deploymentModalsStore"
import {deploymentSearchTermAtom} from "./store/deploymentFilterAtoms"
import type {DeploymentRevisionRow} from "./store/deploymentStore"
import type {DeploymentColumnActions} from "./Table/assets/deploymentColumns"
import DeploymentsTable from "./Table/DeploymentsTable"

interface DeploymentsDashboardProps {
    environmentId: string | null
    environmentName: string
    /** The currently deployed app revision ID (for disabling revert on current deploy) */
    currentDeployedRevisionId?: string | null
}

const DeploymentsDashboard: FC<DeploymentsDashboardProps> = ({
    environmentId,
    environmentName,
    currentDeployedRevisionId,
}) => {
    const {mutateAsync: publish} = useAtomValue(publishMutationAtom)
    const {goToPlayground} = usePlaygroundNavigation()

    const [searchTerm, setSearchTerm] = useAtom(deploymentSearchTermAtom)
    const [, setQueryVariant] = useQueryParamState("revisionId")

    const openDeploymentsDrawer = useSetAtom(openDeploymentsDrawerAtom)
    const openDeploymentConfirmationModal = useSetAtom(openDeploymentConfirmationModalAtom)
    const openSelectDeployVariantModal = useSetAtom(openSelectDeployVariantModalAtom)

    // Row click → opens drawer via query param
    const handleRowClick = useCallback(
        (record: DeploymentRevisionRow) => {
            const targetId = record.deployedRevisionId
            if (targetId) {
                setQueryVariant(targetId, {shallow: true})
            }
        },
        [setQueryVariant],
    )

    // Column action handlers
    const handleOpenDetails = useCallback(
        (record: DeploymentRevisionRow) => {
            const targetId = record.deployedRevisionId
            if (targetId) {
                setQueryVariant(targetId, {shallow: true})
            }
        },
        [setQueryVariant],
    )

    const handleOpenInPlayground = useCallback(
        (record: DeploymentRevisionRow) => {
            if (record.deployedRevisionId) {
                goToPlayground(record.deployedRevisionId)
            }
        },
        [goToPlayground],
    )

    const handleUseApi = useCallback(
        (record: DeploymentRevisionRow) => {
            openDeploymentsDrawer({
                initialWidth: 720,
                revisionId: record.deployedRevisionId ?? undefined,
                deploymentRevisionId: record.envRevisionId,
                envRevisionVersion: record.version,
                envName: environmentName,
                mode: "deployment",
            })
        },
        [environmentName, openDeploymentsDrawer],
    )

    const handleRevert = useCallback(
        (record: DeploymentRevisionRow) => {
            if (!record.deployedRevisionId) return
            const workflowData = workflowMolecule.get.data(record.deployedRevisionId!)
            openDeploymentConfirmationModal({
                envName: environmentName,
                actionType: "revert",
                onConfirm: async (noteValue) => {
                    await publish({
                        revisionId: record.deployedRevisionId!,
                        environmentSlug: environmentName,
                        applicationId: workflowData?.workflow_id || "",
                        workflowVariantId: workflowData?.workflow_variant_id ?? undefined,
                        variantSlug: workflowData?.slug ?? undefined,
                        revisionVersion: workflowData?.version ?? undefined,
                        note: noteValue,
                    })
                },
            })
        },
        [environmentName, openDeploymentConfirmationModal, publish],
    )

    const columnActions = useMemo<DeploymentColumnActions>(
        () => ({
            handleOpenDetails,
            handleOpenInPlayground,
            handleUseApi,
            handleRevert,
            currentDeployedRevisionId,
        }),
        [
            handleOpenDetails,
            handleOpenInPlayground,
            handleUseApi,
            handleRevert,
            currentDeployedRevisionId,
        ],
    )

    const filtersNode = useMemo(
        () => (
            <Input.Search
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search"
                allowClear
                className="max-w-[320px]"
            />
        ),
        [searchTerm, setSearchTerm],
    )

    const actionsNode = useMemo(
        () => (
            <Space>
                <Button
                    icon={<CloudArrowUpIcon size={14} />}
                    onClick={() => openSelectDeployVariantModal({envName: environmentName})}
                >
                    Deploy
                </Button>
                <Button
                    type="primary"
                    icon={<CodeSimpleIcon size={14} />}
                    onClick={() =>
                        openDeploymentsDrawer({
                            initialWidth: 720,
                            mode: "deployment",
                            envName: environmentName,
                        })
                    }
                >
                    Use API
                </Button>
            </Space>
        ),
        [environmentName, openDeploymentsDrawer, openSelectDeployVariantModal],
    )

    return (
        <div className="flex flex-col h-full min-h-0 grow">
            <DeploymentsTable
                onRowClick={handleRowClick}
                actions={columnActions}
                searchDeps={[searchTerm, environmentId]}
                filters={filtersNode}
                primaryActions={actionsNode}
            />
        </div>
    )
}

export default DeploymentsDashboard
