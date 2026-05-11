import {Rocket} from "@phosphor-icons/react"
import {Modal, Typography} from "antd"

type DeploymentRevertModalProps = {
    revisionVersion: number
    environmentName: string
    variantName: string | null
} & React.ComponentProps<typeof Modal>

const DeploymentRevertModal = ({
    environmentName,
    revisionVersion,
    variantName,
    ...props
}: DeploymentRevertModalProps) => {
    return (
        <Modal
            className="[&_.ant-modal-footer]:flex [&_.ant-modal-footer]:items-center [&_.ant-modal-footer]:justify-end"
            okText={
                <div className="flex gap-2 items-center">
                    <Rocket size={16} />
                    Deploy
                </div>
            }
            centered
            destroyOnHidden
            zIndex={3000}
            {...props}
        >
            <div>
                <Typography.Title level={4} className="!mb-2">
                    Revert Deployment
                </Typography.Title>

                <div className="flex flex-col gap-4">
                    <div>
                        {variantName
                            ? `You are about to deploy ${variantName} to ${environmentName} environment. `
                            : `You are about to revert the ${environmentName} environment. `}
                        This will overwrite the existing configuration. This change will affect all
                        future calls to this environment.
                    </div>
                    <div className="flex flex-col">
                        You are about to deploy {environmentName} environment:
                        <span className="text-primary text-base font-medium">
                            Revision v{revisionVersion || 0}
                        </span>
                    </div>
                </div>
            </div>
        </Modal>
    )
}

export default DeploymentRevertModal
