import {ComponentProps, Dispatch, SetStateAction} from "react"

import {CloseOutlined} from "@ant-design/icons"
import {Button, Modal, Space, Typography} from "antd"
import {createUseStyles} from "react-jss"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"
import CommitNote from "@/oss/components/Playground/assets/CommitNote"
import VariantDetailsWithStatus from "@/oss/components/VariantDetailsWithStatus"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {JSSTheme} from "@/oss/lib/Types"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        fontSize: theme.fontSizeLG,
        fontWeight: theme.fontWeightMedium,
        lineHeight: theme.lineHeightLG,
        textTransform: "capitalize",
    },
}))

type DeploymentConfirmationModalProps = {
    note?: string
    setNote?: Dispatch<SetStateAction<string>>
    displayNote?: boolean
    variant?: EnhancedVariant
    envName: string
    actionType?: "deploy" | "revert"
} & ComponentProps<typeof Modal>

const DeploymentConfirmationModal = ({
    variant,
    note,
    setNote,
    displayNote = true,
    envName,
    actionType = "deploy",
    ...props
}: DeploymentConfirmationModalProps) => {
    const classes = useStyles()
    const isDeploy = actionType === "deploy"
    const actionText = isDeploy ? "Deploy" : "Revert"
    const confirmationText = isDeploy
        ? "Are you sure you want to deploy"
        : "Are you sure you want to revert?"

    return (
        <EnhancedModal
            closeIcon={null}
            title={
                <div className="flex items-center justify-between">
                    <Typography.Text className={classes.title}>
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
            <Space direction="vertical" size={16} className="w-full">
                <Space direction="vertical" size={4}>
                    <Typography.Text>{confirmationText}</Typography.Text>

                    {variant && (
                        <VariantDetailsWithStatus
                            variantName={variant?.variantName || variant?.name || ""}
                            revision={variant?.revision}
                            variant={variant}
                            className="font-medium"
                        />
                    )}
                </Space>
                {displayNote && (
                    <CommitNote
                        note={note || ""}
                        setNote={setNote || (() => {})}
                        text={`${actionText} message`}
                    />
                )}
            </Space>
        </EnhancedModal>
    )
}

export default DeploymentConfirmationModal
