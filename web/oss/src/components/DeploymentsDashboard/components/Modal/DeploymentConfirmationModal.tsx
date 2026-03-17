import {ComponentProps, Dispatch, SetStateAction} from "react"

import {EnhancedModal} from "@agenta/ui"
import {CloseOutlined} from "@ant-design/icons"
import {Button, Modal, Space, Typography} from "antd"

import type {DeploymentVariantInfo} from "@/oss/components/DeploymentsDashboard/modals/store/deploymentModalsStore"
import CommitNote from "@/oss/components/Playground/assets/CommitNote"
import VariantDetailsWithStatus from "@/oss/components/VariantDetailsWithStatus"

type DeploymentConfirmationModalProps = {
    note?: string
    setNote?: Dispatch<SetStateAction<string>>
    displayNote?: boolean
    variant?: DeploymentVariantInfo
    envName: string
    actionType?: "deploy" | "revert"
} & ComponentProps<typeof Modal>

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
                <Typography.Text>{confirmationText}</Typography.Text>

                {variant && (
                    <VariantDetailsWithStatus
                        variantName={variant.name || ""}
                        revision={variant.version}
                        className="font-medium"
                    />
                )}
            </Space>
            {displayNote && (
                <CommitNote
                    note={note || ""}
                    setNote={setNote || (() => {})}
                    text={`${isDeploy ? "Deploy" : "Revert"} message`}
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
                    <Typography.Text className="text-lg font-medium leading-relaxed capitalize">
                        {actionText} {envName}
                    </Typography.Text>
                    <Button
                        onClick={() => props.onCancel?.({} as any)}
                        type="text"
                        icon={<CloseOutlined />}
                    />
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
