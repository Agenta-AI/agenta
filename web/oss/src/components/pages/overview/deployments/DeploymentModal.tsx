import {useCallback} from "react"

import type {AppEnvironmentDeployment} from "@agenta/entities/environment"
import {publishMutationAtom} from "@agenta/entities/runnable"
import type {Workflow} from "@agenta/entities/workflow"
import {message} from "@agenta/ui/app-message"
import {Rocket} from "@phosphor-icons/react"
import {Modal, Typography} from "antd"
import {useAtomValue} from "jotai"

type DeploymentModalProps = {
    selectedEnvironment: AppEnvironmentDeployment
    selectedVariant: Workflow
    loadEnvironments: () => Promise<void>
    setIsDeploymentModalOpen: (value: React.SetStateAction<boolean>) => void
} & React.ComponentProps<typeof Modal>

const DeploymentModal = ({
    selectedEnvironment,
    selectedVariant,
    loadEnvironments: _loadEnvironments,
    setIsDeploymentModalOpen,
    ...props
}: DeploymentModalProps) => {
    const {isPending: isPublishVariantLoading, mutateAsync: publish} =
        useAtomValue(publishMutationAtom)

    const publishVariant = useCallback(async () => {
        try {
            if (!selectedEnvironment || !selectedVariant) return

            await publish({
                revisionId: selectedVariant.id,
                environmentSlug: selectedEnvironment.slug,
                applicationId: selectedVariant.workflow_id || "",
                workflowVariantId: selectedVariant.workflow_variant_id ?? undefined,
                variantSlug:
                    selectedVariant.workflow_variant_slug ??
                    selectedVariant.variant_slug ??
                    undefined,
                revisionVersion: selectedVariant.version ?? undefined,
            })
            message.success(`Published ${selectedVariant.name} to ${selectedEnvironment.name}`)
        } catch (error) {
            console.error(error)
        } finally {
            setIsDeploymentModalOpen(false)
        }
    }, [selectedEnvironment, selectedVariant, publish, setIsDeploymentModalOpen])

    return (
        <Modal
            className="[&_.ant-modal-footer]:flex [&_.ant-modal-footer]:items-center [&_.ant-modal-footer]:justify-end"
            okText={
                <div className="flex gap-2 items-center">
                    <Rocket size={16} />
                    Deploy
                </div>
            }
            onOk={publishVariant}
            okButtonProps={{loading: isPublishVariantLoading}}
            centered
            {...props}
        >
            <div className="[&_h1]:text-sm [&_h1]:font-semibold [&_h1]:leading-[1.5714285714285714] [&_h1]:mb-2 [&_span]:text-colorPrimary [&_span]:text-sm [&_span]:leading-[1.5714285714285714] [&_span]:font-medium">
                <Typography.Title>Confirm Deployment</Typography.Title>

                <div className="flex flex-col gap-4">
                    <div>
                        You are about to deploy {selectedVariant.name}{" "}
                        <span className="bg-[var(--ag-colorFillSecondary)] px-2 !text-xs">
                            {selectedVariant.version}
                        </span>{" "}
                        to {selectedEnvironment.name} environment. This will overwrite the existing
                        configuration. This change will affect all future calls to this environment.
                    </div>
                    <div className="flex flex-col">
                        You are about to deploy {selectedEnvironment.name} environment:
                        <span>Revision v{selectedEnvironment.revision || 0}</span>
                    </div>
                </div>
            </div>
        </Modal>
    )
}

export default DeploymentModal
