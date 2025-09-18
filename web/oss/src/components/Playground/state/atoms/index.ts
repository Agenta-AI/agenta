/**
 * Playground Atoms - New Jotai-based State Management
 *
 * This module exports all atoms for the new playground state architecture.
 * These atoms replace the complex SWR middleware system with a clean,
 * performant, and maintainable atom-based approach.
 */

// Core state atoms
export {selectedVariantsAtom, viewTypeAtom, testRunStatesAtom} from "./core"

// Variant atoms and types
export {
    playgroundLayoutAtom,
    displayedVariantsAtom,
    earlyDisplayedVariantsAtom,
    earlyRevisionIdsAtom,
    displayedVariantsVariablesAtom,
    revisionListAtom,
    isComparisonViewAtom,
} from "./variants"

// UI state mutations
export {
    setSelectedVariantMutationAtom,
    toggleVariantDisplayMutationAtom,
    setDisplayedVariantsMutationAtom,
} from "./mutations"

// Enhanced variant mutations (split into separate files)
export {
    parameterUpdateMutationAtom,
    updateVariantPropertyEnhancedMutationAtom,
    deleteGenerationInputRowMutationAtom,
    duplicateGenerationInputRowMutationAtom,
    createVariantMutationAtom,
    removeVariantFromSelectionMutationAtom,
    clearAllRunsMutationAtom,
    // Prompt-scoped mutations
    addPromptMessageMutationAtomFamily,
    deletePromptMessageMutationAtomFamily,
    addPromptToolMutationAtomFamily,
    type ConfigValue,
} from "./enhancedVariantMutations"

// Property-level selectors for optimized subscriptions
// Prompt-related selectors
export {promptPropertyAtomFamily} from "./promptSelectors"

// Variant listing (flat) selectors
export {variantListDisplayAtom, variantListDisplayFilteredAtomFamily} from "./variantListing"

// Variant options (grouped) selectors
export {variantOptionsAtomFamily} from "./optionsSelectors"

// Generation-related selectors
export {
    inputRowIdsAtomFamily,
    generationRowIdsAtom,
    generationResultAtomFamily,
    generationHeaderDataAtomFamily,
} from "./generationProperties"

// Query helpers and revision-tracking
export {
    variantRevisionsForVariantIdAtomFamily,
    newestRevisionForVariantIdAtomFamily,
    waitForNewRevisionAfterMutationAtom,
    invalidatePlaygroundQueriesAtom,
} from "./queries"

// Remaining selectors kept in propertySelectors for now
export {variantByRevisionIdAtomFamily} from "./propertySelectors"

// Async/loadable patterns
export {
    variantsLoadableAtom,
    variantsIsLoadingAtom,
    variantsHasDataAtom,
    variantsErrorAtom,
    variantRevisionsLoadableFamily,
    preloadVariantRevisionsAtom,
    type VariantUpdate,
} from "./loadable"

// Dirty state management (derived atoms)
export {promptsDirtyAtomFamily, variantIsDirtyAtomFamily} from "./dirtyState"

// Revision-local editable state (prompts) and memoized transforms
export {metadataVersionAtom, variantIsCustomAtomFamily} from "./revisionLocals"

// Variant CRUD operations
export {
    addVariantMutationAtom,
    saveVariantMutationAtom,
    deleteVariantMutationAtom,
    batchVariantOperationsMutationAtom,
} from "./variantCrud"

// App creation mutations
export {
    createAppMutationAtom,
    createAppAndRedirectMutationAtom,
    ServiceType,
    type CreateAppParams,
    type AppCreationResult,
} from "./appCreationMutations"

// Test execution
export {
    cancelTestsMutationAtom,
    clearTestResultsMutationAtom,
    testStatusAtomFamily,
} from "./testExecution"

// Web worker integration (re-export from newPlayground surface)
export {
    triggerWebWorkerTestAtom,
    handleWebWorkerResultAtom,
    pendingWebWorkerRequestsAtom,
    lastRunTurnForVariantAtomFamily,
    setLastRunTurnForVariantAtom,
} from "@/oss/state/newPlayground/mutations/webWorkerIntegration"

// URL synchronization and derived state
export {
    urlRevisionsAtom,
    urlSyncBypassAtom,
    userSaveStateAtom,
    clearUserSaveFlagsAtom,
    updateUrlRevisionsAtom,
} from "./urlSync"

// App-level configuration
export {appChatModeAtom} from "./app"

// Parameters JSON override (JSON editor integration)
export {parametersOverrideAtomFamily} from "./parametersOverride"

// Comparison chat helpers
export {canRunAllChatComparisonAtom} from "./derived/canRunAllChatComparison"
