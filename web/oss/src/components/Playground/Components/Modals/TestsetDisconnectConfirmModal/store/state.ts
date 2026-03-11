import {atom} from "jotai"

interface TestsetDisconnectConfirmModalState {
    open: boolean
    loadableId: string | null
    isSaving: boolean
}

export const initialState: TestsetDisconnectConfirmModalState = {
    open: false,
    loadableId: null,
    isSaving: false,
}

export const testsetDisconnectConfirmModalAtom =
    atom<TestsetDisconnectConfirmModalState>(initialState)
