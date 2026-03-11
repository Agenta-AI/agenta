import {atom} from "jotai"

export type TestsetUnsavedChangesIntent = "disconnect" | "change-testset"

interface TestsetDisconnectConfirmModalState {
    open: boolean
    loadableId: string | null
    isSaving: boolean
    intent: TestsetUnsavedChangesIntent
    meta?: {
        targetTestsetName?: string | null
    }
    /** Called after the user confirms (save or discard). Lets the opener decide what happens next. */
    onComplete?: () => void
}

export const initialState: TestsetDisconnectConfirmModalState = {
    open: false,
    loadableId: null,
    isSaving: false,
    intent: "disconnect",
    meta: undefined,
    onComplete: undefined,
}

export const testsetDisconnectConfirmModalAtom =
    atom<TestsetDisconnectConfirmModalState>(initialState)
