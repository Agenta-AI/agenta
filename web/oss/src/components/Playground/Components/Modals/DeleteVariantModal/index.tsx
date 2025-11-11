import {useCallback} from "react"

import {Trash} from "@phosphor-icons/react"
import {Modal, Typography} from "antd"

import usePlayground from "@/oss/components/Playground/hooks/usePlayground"
import {findVariantById} from "@/oss/components/Playground/hooks/usePlayground/assets/helpers"
import {PlaygroundStateData} from "@/oss/components/Playground/hooks/usePlayground/types"

import {useStyles} from "./styles"
import {DeleteVariantModalProps} from "./types"

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

        deleteVariant?.().then(() => {
            onClose()
        })
    }, [deleteVariant, _variantIds, viewType, setSelectedVariant])

    return (
        <Modal
            centered
            destroyOnHidden
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
