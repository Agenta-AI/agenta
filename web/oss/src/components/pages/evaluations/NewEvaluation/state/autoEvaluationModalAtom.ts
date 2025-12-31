import {atom} from "jotai"

interface AutoEvaluationModalState {
    open: boolean
}

const defaultModalState: AutoEvaluationModalState = {
    open: false,
}

export const autoEvaluationModalAtom = atom(defaultModalState)

export const openAutoEvaluationModalAtom = atom(null, (get, set) => {
    const current = get(autoEvaluationModalAtom)
    if (current.open) return
    set(autoEvaluationModalAtom, {...current, open: true})
})

export const closeAutoEvaluationModalAtom = atom(null, (get, set) => {
    const current = get(autoEvaluationModalAtom)
    if (!current.open) return
    set(autoEvaluationModalAtom, {...current, open: false})
})
