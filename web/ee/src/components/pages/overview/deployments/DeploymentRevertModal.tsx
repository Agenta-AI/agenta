import {Rocket} from "@phosphor-icons/react"
import {Modal, Typography} from "antd"
import {createUseStyles} from "react-jss"

import {Environment, JSSTheme, Variant} from "@/oss/lib/Types"
import {DeploymentRevision} from "@/oss/lib/types_ee"

type DeploymentModalProps = {
    selectedRevert: DeploymentRevision
    selectedEnvironment: Environment
    selectedDeployedVariant: Variant
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
    selectedRevert,
    selectedDeployedVariant,
    ...props
}: DeploymentModalProps) => {
    const classes = useStyles()

    return (
        <Modal
            className={classes.container}
            okText={
                <div className="flex gap-2 items-center">
                    <Rocket size={16} />
                    Deploy
                </div>
            }
            centered
            destroyOnClose
            zIndex={3000}
            {...props}
        >
            <div className={classes.wrapper}>
                <Typography.Title>Revert Deployment</Typography.Title>

                <div className="flex flex-col gap-4">
                    <div>
                        You are about to deploy {selectedDeployedVariant.variantName} to{" "}
                        {selectedEnvironment.name} environment. This will overwrite the existing
                        configuration. This change will affect all future calls to this environment.
                    </div>
                    <div className="flex flex-col">
                        You are about to deploy {selectedEnvironment.name} environment:
                        <span>Revision v{selectedRevert.revision || 0}</span>
                    </div>
                </div>
            </div>
        </Modal>
    )
}

export default DeploymentModal
