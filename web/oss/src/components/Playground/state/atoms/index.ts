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
export {toggleVariantDisplayMutationAtom, setDisplayedVariantsMutationAtom} from "./mutations"

// Property-level selectors for optimized subscriptions
// Prompt-related selectors
export {promptPropertyAtomFamily} from "./promptSelectors"

// Variant listing (flat) selectors
export {variantListDisplayAtom, variantListDisplayFilteredAtomFamily} from "./variantListing"

// Variant options (grouped) selectors
export {variantOptionsAtomFamily} from "./optionsSelectors"

// Generation-related selectors
export {
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
    type VariantUpdate,
} from "./loadable"

// Dirty state management (derived atoms)
export {promptsDirtyAtomFamily, variantIsDirtyAtomFamily} from "./dirtyState"

// Variant CRUD operations
export {saveVariantMutationAtom, deleteVariantMutationAtom} from "./variantCrud"

// App creation mutations
export {
    createAppMutationAtom,
    ServiceType,
    type CreateAppParams,
    type AppCreationResult,
} from "./appCreationMutations"

// Test execution
export {cancelTestsMutationAtom} from "./testExecution"

// Web worker integration (re-export from newPlayground surface)
export {
    triggerWebWorkerTestAtom,
    handleWebWorkerResultAtom,
    pendingWebWorkerRequestsAtom,
    lastRunTurnForVariantAtomFamily,
    setLastRunTurnForVariantAtom,
} from "@/oss/state/newPlayground/mutations/webWorkerIntegration"

// URL synchronization and derived state
export {urlRevisionsAtom} from "./urlSync"

// App-level configuration
export {appChatModeAtom} from "./app"

// Parameters JSON override (JSON editor integration)
export {parametersOverrideAtomFamily} from "./parametersOverride"

// Comparison chat helpers
export {canRunAllChatComparisonAtom} from "./derived/canRunAllChatComparison"
