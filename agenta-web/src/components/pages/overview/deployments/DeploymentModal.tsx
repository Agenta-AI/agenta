import {Environment, JSSTheme, Variant} from "@/lib/Types"
import {createPublishVariant} from "@/services/deployment/api"
import {Rocket} from "@phosphor-icons/react"
import {message, Modal, Typography} from "antd"
import React, {useState} from "react"
import {createUseStyles} from "react-jss"

type DeploymentModalProps = {
    selectedEnvironment: Environment
    selectedVariant: Variant
    loadEnvironments: () => Promise<void>
    setIsDeploymentModalOpen: (value: React.SetStateAction<boolean>) => void
} & React.ComponentProps<typeof Modal>

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        "& .ant-modal-footer": {
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
        },
    },
    wrapper: {
        "& h1": {
            fontSize: theme.fontSizeLG,
            fontWeight: theme.fontWeightStrong,
            lineHeight: theme.lineHeightLG,
            marginBottom: 8,
        },
        "& span": {
            color: theme.colorPrimary,
            fontSize: theme.fontSizeLG,
            lineHeight: theme.lineHeightLG,
            fontWeight: theme.fontWeightMedium,
        },
    },
}))

const DeploymentModal = ({
    selectedEnvironment,
    selectedVariant,
    loadEnvironments,
    setIsDeploymentModalOpen,
    ...props
}: DeploymentModalProps) => {
    const classes = useStyles()
    const [isPublishVariantLoading, setIsPublishVariantLoading] = useState(false)

    const publishVariant = async () => {
        try {
            setIsPublishVariantLoading(true)
            await createPublishVariant(selectedVariant.variantId, selectedEnvironment.name)
            await loadEnvironments()
            message.success(
                `Published ${selectedVariant.variantName} to ${selectedEnvironment.name}`,
            )
        } catch (error) {
            console.error(error)
        } finally {
            setIsPublishVariantLoading(false)
            setIsDeploymentModalOpen(false)
        }
    }

    return (
        <Modal
            className={classes.container}
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
            <div className={classes.wrapper}>
                <Typography.Title>Confirm Deployment</Typography.Title>

                <div className="flex flex-col gap-4">
                    <div>
                        You are about to deploy {selectedVariant.variantName} to{" "}
                        {selectedEnvironment.name} environment. This will overwrite the existing
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
