import {ComponentProps, Dispatch, SetStateAction} from "react"

import {VariantDetailsWithStatus} from "@agenta/entity-ui/variant"
import {Button} from "@agenta/primitive-ui/components/button"
import {CommitMessageInput} from "@agenta/ui"
import {EnhancedModal} from "@agenta/ui/components/modal"
import {CloseOutlined} from "@ant-design/icons"
import {Space} from "antd"

import type {DeploymentVariantInfo} from "@/oss/components/DeploymentsDashboard/modals/store/deploymentModalsStore"

type DeploymentConfirmationModalProps = {
    note?: string
    setNote?: Dispatch<SetStateAction<string>>
    displayNote?: boolean
    variant?: DeploymentVariantInfo
    envName: string
    actionType?: "deploy" | "revert"
} & ComponentProps<typeof EnhancedModal>

const DeploymentConfirmationModalContent = ({
    variant,
    note,
    setNote,
    isDeploy,
    displayNote = true,
    actionType = "deploy",
}: DeploymentConfirmationModalProps & {isDeploy?: boolean}) => {
    const confirmationText =
        actionType === "deploy"
            ? "Are you sure you want to deploy"
            : "Are you sure you want to revert?"
    return (
        <Space orientation="vertical" size={16} className="w-full">
            <Space orientation="vertical" size={4}>
                <span>{confirmationText}</span>

                {variant && (
                    <VariantDetailsWithStatus
                        variantName={variant.name || ""}
                        revision={variant.version}
                        className="font-medium"
                    />
                )}
            </Space>
            {displayNote && (
                <CommitMessageInput
                    value={note || ""}
                    onChange={setNote || (() => {})}
                    label={`${isDeploy ? "Deploy" : "Revert"} message`}
                />
            )}
        </Space>
    )
}

const DeploymentConfirmationModal = ({
    variant,
    note,
    setNote,
    displayNote = true,
    envName,
    actionType = "deploy",
    ...props
}: DeploymentConfirmationModalProps) => {
    const isDeploy = actionType === "deploy"
    const actionText = isDeploy ? "Deploy" : "Revert"

    return (
        <EnhancedModal
            closeIcon={null}
            title={
                <div className="flex items-center justify-between">
                    <span className="text-lg font-medium leading-relaxed capitalize">
                        {actionText} {envName}
                    </span>
                    <Button onClick={() => props.onCancel?.({} as any)} variant="ghost" size="icon">
                        {<CloseOutlined />}
                    </Button>
                </div>
            }
            okText={actionText}
            width={520}
            {...props}
        >
            <DeploymentConfirmationModalContent
                variant={variant}
                note={note}
                setNote={setNote}
                isDeploy={isDeploy}
                envName={envName}
                actionType={actionType}
            />
        </EnhancedModal>
    )
}

export default DeploymentConfirmationModal
