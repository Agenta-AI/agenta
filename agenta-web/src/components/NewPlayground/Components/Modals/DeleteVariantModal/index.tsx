import {Modal, Typography} from "antd"
import {Trash} from "@phosphor-icons/react"
import {DeleteVariantModalProps} from "./types"
import {useStyles} from "./styles"
import {useCallback} from "react"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"

const {Text} = Typography

const DeleteVariantModal: React.FC<DeleteVariantModalProps> = ({variantId, ...props}) => {
    const classes = useStyles()
    const {deleteVariant, variant} = usePlayground({
        variantId,
        hookId: "DeleteVariantModal",
    })

    const deploymentNameEnv = "production"

    const onClose = useCallback(() => {
        props.onCancel?.({} as any)
    }, [])

    const onDeleteVariant = useCallback(async () => {
        try {
            // TODO: add loading indecator here
            // TODO: add functionality to load the next/prev varaint after deleting the current variant
            await deleteVariant?.()

            onClose()
        } catch (error) {}
    }, [])

    return (
        <Modal
            centered
            destroyOnClose
            title="Are you sure you want to delete?"
            onCancel={onClose}
            okText="Delete"
            onOk={onDeleteVariant}
            okButtonProps={{danger: true, icon: <Trash size={14} />}}
            classNames={{footer: "flex items-center justify-end"}}
            {...props}
        >
            <section className="flex flex-col gap-4">
                <Text>This action is not reversible. Deleting the variant will also </Text>

                <div className="flex flex-col gap-1">
                    <Text>You are about to delete:</Text>

                    <Text className={classes.heading}>{variant?.variantName}</Text>
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
