import {EnhancedModal} from "@agenta/ui/components/modal"
import {Rocket} from "@phosphor-icons/react"

type DeploymentRevertModalProps = {
    revisionVersion: number
    environmentName: string
    variantName: string | null
} & React.ComponentProps<typeof EnhancedModal>

const DeploymentRevertModal = ({
    environmentName,
    revisionVersion,
    variantName,
    ...props
}: DeploymentRevertModalProps) => {
    return (
        <EnhancedModal
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
                <h4 className="!mb-2 text-base font-semibold leading-snug">Revert Deployment</h4>

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
        </EnhancedModal>
    )
}

export default DeploymentRevertModal
