/**
 * Testset Selection Module
 *
 * Shared state management for testset/revision selection.
 * Used by both TestsetDrawer and LoadTestsetModal.
 */

export {
    // Selection state
    selectedTestsetIdAtom,
    selectedRevisionIdAtom,
    selectedTestsetInfoAtom,
    isNewTestsetAtom,
    // Loading state
    loadingRevisionsAtom,
    loadingTestsetMapAtom,
    loadedRevisionsMapAtom,
    availableRevisionsAtom,
    // Loading actions
    loadRevisionsForTestsetAtom,
    isLoadingRevisionsForTestsetAtomFamily,
    cachedRevisionsForTestsetAtomFamily,
    setRevisionsForTestsetAtom,
    // Selection actions
    selectTestsetAtom,
    selectRevisionAtom,
    resetSelectionAtom,
    clearRevisionsCacheAtom,
} from "./atoms"
