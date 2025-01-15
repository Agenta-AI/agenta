import {Modal, Typography} from "antd"
import {Trash} from "@phosphor-icons/react"
import {DeleteVariantModalProps} from "./types"
import {useStyles} from "./styles"
import {useCallback} from "react"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"

const {Text} = Typography

const DeleteVariantModal: React.FC<DeleteVariantModalProps> = ({variantId, ...props}) => {
    const classes = useStyles()
    const {deleteVariant, variant, variants, setSelectedVariant} = usePlayground({
        variantId,
        hookId: "DeleteVariantModal",
    })

    const onClose = useCallback(() => {
        props.onCancel?.({} as any)
    }, [])

    const onDeleteVariant = useCallback(() => {
        const itemIndex = variants?.findIndex((variant) => variant.id === variantId) as number
        if (itemIndex === -1) return

        deleteVariant?.()
            .then(() => {
                // Update the variants by excluding the deleted one directly in the state
                const updatedVariants = variants
                    ?.slice(0, itemIndex)
                    .concat(variants?.slice(itemIndex + 1))

                let nextId: string | undefined

                // If there's a variant after the deleted one, select it. If there's no variant after, select the previous one
                if (itemIndex < (updatedVariants?.length as number)) {
                    nextId = updatedVariants?.[itemIndex]?.id
                } else if (itemIndex - 1 >= 0) {
                    nextId = updatedVariants?.[itemIndex - 1]?.id
                }

                setSelectedVariant?.(nextId as string)
            })
            .then(() => {
                onClose()
            })
    }, [deleteVariant, variants, setSelectedVariant])

    return (
        <Modal
            centered
            destroyOnClose
            title="Are you sure you want to delete?"
            onCancel={onClose}
            okText="Delete"
            onOk={onDeleteVariant}
            confirmLoading={variant?.__isMutating}
            okButtonProps={{danger: true, icon: <Trash size={14} />}}
            classNames={{footer: "flex items-center justify-end"}}
            {...props}
        >
            <section className="flex flex-col gap-4">
                <Text>This action is not reversible. Deleting the variant will also</Text>

                <div className="flex flex-col gap-1">
                    <Text>You are about to delete:</Text>

                    <Text className={classes.heading}>{variant?.variantName}</Text>
                </div>
            </section>
        </Modal>
    )
}

export default DeleteVariantModal
