import {Modal, Typography} from "antd"
import {Trash} from "@phosphor-icons/react"
import {DeleteVariantModalProps} from "./types"
import {useStyles} from "./styles"
import {useCallback} from "react"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"
import {findVariantById} from "@/components/NewPlayground/hooks/usePlayground/assets/helpers"

const {Text} = Typography

const DeleteVariantModal: React.FC<DeleteVariantModalProps> = ({variantId, ...props}) => {
    const classes = useStyles()
    const {deleteVariant, isMutating, viewType, variantName, setSelectedVariant, _variantIds} =
        usePlayground({
            variantId,
            stateSelector: useCallback(
                (state: PlaygroundStateData) => {
                    const variant = findVariantById(state, variantId)
                    const _variantIds = state.variants.map((variant) => variant.id)

                    return {
                        isMutating: variant?.__isMutating,
                        variantName: variant?.variantName,
                        _variantIds,
                    }
                },
                [variantId],
            ),
        })

    const onClose = useCallback(() => {
        props.onCancel?.({} as any)
    }, [])

    const onDeleteVariant = useCallback(() => {
        const itemIndex = _variantIds?.findIndex((id) => id === variantId) as number
        if (itemIndex === -1) return

        deleteVariant?.()
            .then(() => {
                // Update the variants by excluding the deleted one directly in the state
                const updatedVariants = _variantIds
                    ?.slice(0, itemIndex)
                    .concat(_variantIds?.slice(itemIndex + 1))

                if (viewType === "single") {
                    let nextId: string | undefined

                    // If there's a variant after the deleted one, select it. If there's no variant after, select the previous one
                    if (itemIndex < (updatedVariants?.length as number)) {
                        nextId = updatedVariants?.[itemIndex]
                    } else if (itemIndex - 1 >= 0) {
                        nextId = updatedVariants?.[itemIndex - 1]
                    }

                    setSelectedVariant?.(nextId as string)
                }
            })
            .then(() => {
                onClose()
            })
    }, [deleteVariant, _variantIds, viewType, setSelectedVariant])

    return (
        <Modal
            centered
            destroyOnClose
            title="Are you sure you want to delete?"
            onCancel={onClose}
            okText="Delete"
            onOk={onDeleteVariant}
            confirmLoading={isMutating}
            okButtonProps={{danger: true, icon: <Trash size={14} />}}
            classNames={{footer: "flex items-center justify-end"}}
            {...props}
        >
            <section className="flex flex-col gap-4">
                <Text>This action is not reversible. Deleting the variant will also</Text>

                <div className="flex flex-col gap-1">
                    <Text>You are about to delete:</Text>

                    <Text className={classes.heading}>{variantName}</Text>
                </div>
            </section>
        </Modal>
    )
}

export default DeleteVariantModal
