import {atom} from "jotai"

interface DeleteEvaluationModalState {
    open: boolean
    evaluationType?: string
    onOk?: () => void
}

export const deleteEvaluationModalAtom = atom<DeleteEvaluationModalState>({
    open: false,
})

export const openDeleteEvaluationModalAtom = atom(
    null,
    (get, set, params: {evaluationType: string; onOk: () => void}) => {
        set(deleteEvaluationModalAtom, {
            open: true,
            evaluationType: params.evaluationType,
            onOk: params.onOk,
        })
    },
)

export const closeDeleteEvaluationModalAtom = atom(null, (get, set) => {
    set(deleteEvaluationModalAtom, {open: false})
})
