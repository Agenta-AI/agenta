import {memo, useCallback} from "react"

import {publishMutationAtom} from "@agenta/entities/runnable/deploy"
import {workflowMolecule} from "@agenta/entities/workflow"
import {EnvironmentTag} from "@agenta/ui"
import {CloseOutlined, FullscreenExitOutlined, FullscreenOutlined} from "@ant-design/icons"
import {ArrowCounterClockwise} from "@phosphor-icons/react"
import {Button, Tag} from "antd"
import {atom, useAtomValue, useSetAtom} from "jotai"
import {atomFamily} from "jotai/utils"

import {deploymentsDrawerStateAtom} from "@/oss/components/DeploymentsDashboard/modals/store/deploymentDrawerStore"
import {openDeploymentConfirmationModalAtom} from "@/oss/components/DeploymentsDashboard/modals/store/deploymentModalsStore"
import {useQueryParam} from "@/oss/hooks/useQuery"
import {appEnvironmentsAtom} from "@/oss/state/environment/appEnvironmentAtoms"

import {DeploymentDrawerTitleProps} from "../types"

const deployedRevisionIdByEnvAtomFamily = atomFamily((envName: string) =>
    atom<string | null>((get) => {
        const envs = get(appEnvironmentsAtom)
        if (!Array.isArray(envs)) return null
        const env = envs.find((e) => e.name === envName)
        return env?.deployedRevisionId ?? null
    }),
)

const DeploymentDrawerTitle = ({
    variantId,
    onClose,
    onToggleWidth,
    isExpanded,
}: DeploymentDrawerTitleProps) => {
    const selectedVariant = useAtomValue(workflowMolecule.selectors.data(variantId))
    const [envNameParam] = useQueryParam("selectedEnvName")
    const drawerState = useAtomValue(deploymentsDrawerStateAtom)
    const envName = envNameParam || drawerState.envName || ""
    const {isPending: isPublishing, mutateAsync: publish} = useAtomValue(publishMutationAtom)
    const deployedRevisionId = useAtomValue(deployedRevisionIdByEnvAtomFamily(envName ?? ""))
    const canRevert = variantId !== deployedRevisionId
    const openDeploymentConfirmationModal = useSetAtom(openDeploymentConfirmationModalAtom)

    // Environment revision version from drawer state (passed when opening the drawer)
    const envRevisionVersion = drawerState.envRevisionVersion

    const handleRevert = useCallback(() => {
        openDeploymentConfirmationModal({
            envName,
            actionType: "revert",
            variant: selectedVariant,
            onConfirm: async (noteValue) => {
                await publish({
                    revisionId: variantId,
                    environmentSlug: envName,
                    applicationId: selectedVariant?.workflow_id || "",
                    workflowVariantId: selectedVariant?.workflow_variant_id ?? undefined,
                    variantSlug: selectedVariant?.slug ?? undefined,
                    revisionVersion: selectedVariant?.version ?? undefined,
                    note: noteValue,
                })
                onClose()
            },
            successMessage: `Reverted in ${envName}`,
        })
    }, [envName, selectedVariant, variantId, publish, openDeploymentConfirmationModal, onClose])

    return (
        <section className="flex items-center justify-between">
            <div className="flex items-center gap-3">
                <Button onClick={onClose} type="text" icon={<CloseOutlined />} size="small" />
                <Button
                    onClick={onToggleWidth}
                    type="text"
                    size="small"
                    icon={isExpanded ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                />

                <div className="flex items-center gap-2">
                    {/*TODO: update this with select variant deployment */}
                    <EnvironmentTag environment={envName || ""} />
                    <Tag bordered={false} className="bg-[#0517290F]">
                        v{envRevisionVersion ?? selectedVariant?.version}
                    </Tag>
                </div>
            </div>

            <Button
                icon={<ArrowCounterClockwise size={16} />}
                size="small"
                disabled={!canRevert}
                loading={isPublishing}
                onClick={handleRevert}
            >
                Revert
            </Button>
        </section>
    )
}

export default memo(DeploymentDrawerTitle)
