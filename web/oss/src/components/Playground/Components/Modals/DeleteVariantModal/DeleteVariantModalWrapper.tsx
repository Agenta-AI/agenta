import {useAtomValue, useSetAtom} from "jotai"

import {
    closeDeleteVariantModalAtom,
    deleteVariantModalOpenAtom,
    deleteVariantModalRevisionIdsAtom,
} from "./store/deleteVariantModalStore"

import DeleteVariantModal from "."

const DeleteVariantModalWrapper = () => {
    const open = useAtomValue(deleteVariantModalOpenAtom)
    const revisionIds = useAtomValue(deleteVariantModalRevisionIdsAtom)
    const close = useSetAtom(closeDeleteVariantModalAtom)

    if (!revisionIds || revisionIds.length === 0) return null

    return <DeleteVariantModal open={open} onCancel={() => close()} revisionIds={revisionIds} />
}

export default DeleteVariantModalWrapper
