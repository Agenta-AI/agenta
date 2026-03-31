import {memo, useCallback} from "react"

import {legacyAppRevisionMolecule} from "@agenta/entities/legacyAppRevision"
import {publishMutationAtom} from "@agenta/entities/legacyAppRevision"
import {CloseOutlined, FullscreenExitOutlined, FullscreenOutlined} from "@ant-design/icons"
import {ArrowCounterClockwise} from "@phosphor-icons/react"
import {Button, Tag} from "antd"
import {atom, useAtomValue, useSetAtom} from "jotai"
import {atomFamily} from "jotai/utils"

import {envRevisionsAtom} from "@/oss/components/DeploymentsDashboard/atoms"
import {openDeploymentConfirmationModalAtom} from "@/oss/components/DeploymentsDashboard/modals/store/deploymentModalsStore"
import EnvironmentTagLabel from "@/oss/components/EnvironmentTagLabel"
import {useQueryParam} from "@/oss/hooks/useQuery"
import {environmentsAtom} from "@/oss/state/environment/atoms/fetcher"

import {DeploymentDrawerTitleProps} from "../types"

const deployedRevisionIdByEnvAtomFamily = atomFamily((envName: string) =>
    atom<string | null>((get) => {
        const envs = get(environmentsAtom)
        if (!Array.isArray(envs)) return null
        const env = envs.find((e: any) => e.name === envName || e.environment_name === envName)
        return env?.deployed_app_variant_revision_id ?? env?.deployedAppVariantRevisionId ?? null
    }),
)

const DeploymentDrawerTitle = ({
    variantId,
    onClose,
    onToggleWidth,
    isExpanded,
}: DeploymentDrawerTitleProps) => {
    const selectedVariant = useAtomValue(legacyAppRevisionMolecule.atoms.data(variantId))
    const [envNameParam] = useQueryParam("selectedEnvName")
    const envRevisions = useAtomValue(envRevisionsAtom)
    const envName = envNameParam || envRevisions?.name || ""
    const {isPending: isPublishing, mutateAsync: publish} = useAtomValue(publishMutationAtom)
    const deployedRevisionId = useAtomValue(deployedRevisionIdByEnvAtomFamily(envName ?? ""))
    const canRevert = variantId !== deployedRevisionId
    const openDeploymentConfirmationModal = useSetAtom(openDeploymentConfirmationModalAtom)

    const handleRevert = useCallback(() => {
        openDeploymentConfirmationModal({
            envName,
            actionType: "revert",
            variant: selectedVariant,
            onConfirm: async (noteValue) => {
                await publish({
                    type: "revision",
                    note: noteValue,
                    revision_id: variantId,
                    environment_ref: envName,
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
                    <EnvironmentTagLabel environment={envName || ""} />
                    <Tag bordered={false} className="bg-[#0517290F]">
                        v{selectedVariant?.revision}
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
