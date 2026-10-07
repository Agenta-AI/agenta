/** What a Create button needs to know and do, shared by the blank start and the template creator. */
export interface OnboardingCreateState {
    /** A runnable model is selected. */
    modelReady: boolean
    /** A blank start has a first message; a template has loaded. */
    complete: boolean
    creating: boolean
    error?: string | null
    onCreate: () => void
    onChooseModel: () => void
}
