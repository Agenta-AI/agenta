import {atom} from "jotai"

/**
 * Atoms for LoadTestsetModal state management
 * These atoms eliminate prop drilling and provide centralized state management
 */

/**
 * Tracks whether the user is in "create new testset" mode
 */
export const isCreatingNewTestsetAtom = atom(false)

/**
 * Stores the name for a new testset being created in the UI
 */
export const newTestsetNameAtom = atom("")

/**
 * Stores the commit message for a new testset being created in the UI
 */
export const newTestsetCommitMessageAtom = atom("")

/**
 * Tracks which table rows are selected for loading into the playground
 */
export const selectedTestcaseRowKeysAtom = atom<React.Key[]>([])

/**
 * Resets all modal state to initial values (call when modal closes)
 * Note: Does NOT manually cleanup testcase atoms - that's handled by revisionChangeEffectAtom
 * when the revision selection changes naturally
 */
export const resetModalStateAtom = atom(null, (_get, set) => {
    set(isCreatingNewTestsetAtom, false)
    set(newTestsetNameAtom, "")
    set(newTestsetCommitMessageAtom, "")
    set(selectedTestcaseRowKeysAtom, [])
})
