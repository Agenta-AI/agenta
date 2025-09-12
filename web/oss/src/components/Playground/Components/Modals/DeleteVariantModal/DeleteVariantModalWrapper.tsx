import {useAtomValue, useSetAtom} from "jotai"

import {
    closeDeleteVariantModalAtom,
    deleteVariantModalOpenAtom,
    deleteVariantModalVariantIdAtom,
} from "./store/deleteVariantModalStore"

import DeleteVariantModal from "."

const DeleteVariantModalWrapper = () => {
    const open = useAtomValue(deleteVariantModalOpenAtom)
    const variantId = useAtomValue(deleteVariantModalVariantIdAtom)
    const close = useSetAtom(closeDeleteVariantModalAtom)

    if (!variantId) return null

    return <DeleteVariantModal open={open} onCancel={() => close()} variantId={variantId} />
}

export default DeleteVariantModalWrapper
