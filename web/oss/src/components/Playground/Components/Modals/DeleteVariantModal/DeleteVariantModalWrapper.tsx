import {useAtomValue, useSetAtom} from "jotai"

import {
    closeDeleteVariantModalAtom,
    deleteVariantModalForceVariantIdsAtom,
    deleteVariantModalOpenAtom,
    deleteVariantModalRevisionIdsAtom,
} from "./store/deleteVariantModalStore"

import DeleteVariantModal from "."

const DeleteVariantModalWrapper = () => {
    const open = useAtomValue(deleteVariantModalOpenAtom)
    const revisionIds = useAtomValue(deleteVariantModalRevisionIdsAtom)
    const forceVariantIds = useAtomValue(deleteVariantModalForceVariantIdsAtom)
    const close = useSetAtom(closeDeleteVariantModalAtom)

    if (!revisionIds || revisionIds.length === 0) return null

    return (
        <DeleteVariantModal
            open={open}
            onCancel={() => close()}
            revisionIds={revisionIds}
            forceVariantIds={forceVariantIds}
        />
    )
}

export default DeleteVariantModalWrapper
