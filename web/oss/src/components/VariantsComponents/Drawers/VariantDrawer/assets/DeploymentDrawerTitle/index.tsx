import {memo, useCallback} from "react"

import {CloseOutlined} from "@ant-design/icons"
import {ArrowCounterClockwise} from "@phosphor-icons/react"
import {Button, Tag} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {openDeploymentConfirmationModalAtom} from "@/oss/components/DeploymentsDashboard/modals/store/deploymentModalsStore"
import EnvironmentTagLabel from "@/oss/components/EnvironmentTagLabel"
import {variantByRevisionIdAtomFamily} from "@/oss/components/Playground/state/atoms"
import {useQueryParam} from "@/oss/hooks/useQuery"
import {publishMutationAtom} from "@/oss/state/deployment/atoms/publish"
import {deployedRevisionByEnvironmentAtomFamily} from "@/oss/state/variant/atoms/fetcher"

import {DeploymentDrawerTitleProps} from "../types"

const DeploymentDrawerTitle = ({variantId, onClose}: DeploymentDrawerTitleProps) => {
    const selectedVariant = useAtomValue(variantByRevisionIdAtomFamily(variantId))
    const [envName] = useQueryParam("selectedEnvName")
    const {isPending: isPublishing, mutateAsync: publish} = useAtomValue(publishMutationAtom)
    const deployedRevision = useAtomValue(deployedRevisionByEnvironmentAtomFamily(envName))
    const canRevert = variantId !== deployedRevision?.id
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
