import {useAtomValue, useSetAtom} from "jotai"

import DeleteEvaluationModal from "@/oss/components/DeleteEvaluationModal/DeleteEvaluationModal"

import {
    closeDeleteEvaluationModalAtom,
    deleteEvaluationModalAtom,
} from "./store/deleteEvaluationModalStore"

const DeleteEvaluationModalWrapper = () => {
    const state = useAtomValue(deleteEvaluationModalAtom)
    const close = useSetAtom(closeDeleteEvaluationModalAtom)

    if (!state.open) return null

    return (
        <DeleteEvaluationModal
            open={state.open}
            onCancel={() => close()}
            onOk={() => state.onOk?.()}
            evaluationType={state.evaluationType || "-"}
        />
    )
}

export default DeleteEvaluationModalWrapper
