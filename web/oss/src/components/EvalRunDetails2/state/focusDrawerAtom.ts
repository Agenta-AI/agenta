import {atom} from "jotai"
import {atomWithImmer} from "jotai-immer"

export interface FocusTarget {
    focusRunId: string | null
    focusScenarioId: string | null
}

interface FocusDrawerState extends FocusTarget {
    open: boolean
    isClosing: boolean
}

const initialFocusDrawerState: FocusDrawerState = {
    open: false,
    isClosing: false,
    focusRunId: null,
    focusScenarioId: null,
}

export const focusDrawerAtom = atomWithImmer<FocusDrawerState>(initialFocusDrawerState)

export const focusScenarioAtom = atom<FocusTarget | null>((get) => {
    const {focusRunId, focusScenarioId} = get(focusDrawerAtom)
    if (!focusScenarioId) return null
    return {focusRunId, focusScenarioId}
})

export const isFocusDrawerOpenAtom = atom((get) => get(focusDrawerAtom).open)

export const focusDrawerTargetAtom = atom<FocusTarget>((get) => {
    const {focusRunId, focusScenarioId} = get(focusDrawerAtom)
    return {focusRunId, focusScenarioId}
})

export const setFocusDrawerTargetAtom = atom(null, (_get, set, target: FocusTarget) => {
    set(focusDrawerAtom, (draft) => {
        if (
            draft.focusRunId === target.focusRunId &&
            draft.focusScenarioId === target.focusScenarioId
        ) {
            return
        }
        draft.focusRunId = target.focusRunId
        draft.focusScenarioId = target.focusScenarioId
    })
})

export const openFocusDrawerAtom = atom(null, (_get, set, target: FocusTarget) => {
    set(focusDrawerAtom, (draft) => {
        const sameTarget =
            draft.focusRunId === target.focusRunId &&
            draft.focusScenarioId === target.focusScenarioId &&
            draft.open
        draft.open = true
        draft.isClosing = false
        if (!sameTarget) {
            draft.focusRunId = target.focusRunId
            draft.focusScenarioId = target.focusScenarioId
        }
    })
})

export const closeFocusDrawerAtom = atom(null, (_get, set) => {
    set(focusDrawerAtom, (draft) => {
        if (!draft.open && !draft.focusScenarioId && !draft.focusRunId) {
            return
        }
        draft.open = false
        draft.isClosing = true
    })
})

export const resetFocusDrawerAtom = atom(null, (_get, set) => {
    set(focusDrawerAtom, () => ({...initialFocusDrawerState}))
})

export const applyFocusDrawerStateAtom = atom(
    null,
    (_get, set, payload: Partial<FocusDrawerState>) => {
        set(focusDrawerAtom, (draft) => {
            const next = {...draft, ...payload}
            draft.open = Boolean(next.open)
            draft.isClosing = Boolean(next.isClosing)
            draft.focusRunId = next.focusRunId ?? null
            draft.focusScenarioId = next.focusScenarioId ?? null
        })
    },
)

export const initialFocusDrawerStateAtom = atom(initialFocusDrawerState)

export interface FocusDrawerAtoms {
    focusTarget: FocusTarget | null
    isOpen: boolean
}
