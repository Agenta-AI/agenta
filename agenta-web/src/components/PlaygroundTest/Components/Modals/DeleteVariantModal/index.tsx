import {Modal, Typography} from "antd"
import {Trash} from "@phosphor-icons/react"
import {DeleteVariantModalProps} from "./types"
import {useStyles} from "./styles"

const {Text} = Typography

const DeleteVariantModal: React.FC<DeleteVariantModalProps> = ({...props}) => {
    const classes = useStyles()
    const variantName = "app.v6"
    const deploymentNameEnv = "production"

    const onClose = (e: any) => {
        props.onCancel?.(e)
    }

    return (
        <Modal
            centered
            destroyOnClose
            title="Are you sure you want to delete?"
            onCancel={onClose}
            okButtonProps={{danger: true, icon: <Trash size={14} />}}
            okText={"Delete"}
            {...props}
        >
            <section className="flex flex-col gap-4">
                <Text>This action is not reversible. Deleting the variant will also </Text>

                <div className="flex flex-col gap-1">
                    <Text>You are about to delete:</Text>

                    <Text className={classes.heading}>{variantName}</Text>
                </div>

                <div className="flex flex-col gap-1">
                    <Text type="danger">Warning</Text>
                    <Text>
                        <span className="font-bold">{deploymentNameEnv}</span> is also deployed on
                        following environment
                    </Text>
                </div>
            </section>
        </Modal>
    )
}

export default DeleteVariantModal
