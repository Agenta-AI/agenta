/**
 * Playground Atoms — Jotai-based State Management
 *
 * Barrel export for all playground state atoms.
 */

// Core state atoms
export {selectedVariantsAtom, testRunStatesAtom, isSelectionStorageHydrated} from "./core"

// Variant atoms and types
export {
    playgroundLayoutAtom,
    displayedVariantsAtom,
    earlyDisplayedVariantsAtom,
    earlyRevisionIdsAtom,
    displayedVariantsVariablesAtom,
    playgroundRevisionListAtom,
    playgroundRevisionsReadyAtom,
    playgroundLatestRevisionIdAtom,
    revisionListAtom,
    isComparisonViewAtom,
    appsListAtom,
    variantsListAtomFamily,
    revisionsListAtomFamily,
    // Re-export types
    type AppListItem,
    type VariantListItem,
    type RevisionListItem,
} from "./variants"

// UI state mutations
export {toggleVariantDisplayMutationAtom, setDisplayedVariantsMutationAtom} from "./mutations"

// Property-level selectors for optimized subscriptions
// Prompt-related selectors
export {promptPropertyAtomFamily} from "./promptSelectors"

// Variant listing (flat) selectors
export {variantListDisplayAtom, variantListDisplayFilteredAtomFamily} from "./variantListing"

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

// Molecule-backed entity state (single source of truth)
export {
    moleculeBackedVariantAtomFamily,
    moleculeBackedPromptsAtomFamily,
    moleculeBackedCustomPropertiesAtomFamily,
} from "@/oss/state/newPlayground/legacyEntityBridge"

// Async/loadable patterns
export {
    appsListLoadingAtom,
    appsListHasDataAtom,
    revisionsListLoadingAtomFamily,
    revisionsListHasDataAtomFamily,
    type VariantUpdate,
} from "./loadable"

// Dirty state management - use molecule-backed version from legacyEntityBridge
export {revisionIsDirtyAtomFamily} from "@/oss/state/newPlayground/legacyEntityBridge"

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

// App-scoped atoms (wrappers over per-revision entity data)
export {
    playgroundAppSchemaAtom,
    playgroundAppRoutePathAtom,
    playgroundAppUriInfoAtom,
    playgroundAppStatusAtom,
    playgroundAppStatusLoadingAtom,
    playgroundIsChatModeAtom,
    playgroundRevisionDeploymentAtomFamily,
    playgroundLatestAppRevisionIdAtom,
} from "./playgroundAppAtoms"

// App-level configuration
export {appChatModeAtom} from "./app"
export {promptTemplateFormatAtomFamily, type PromptTemplateFormat} from "./promptTemplateFormat"

// Parameters JSON override (JSON editor integration)
export {parametersOverrideAtomFamily} from "./parametersOverride"

// Comparison chat helpers
export {canRunAllChatComparisonAtom} from "./derived/canRunAllChatComparison"

// Playground selection adapter for EntityPicker integration
export {
    createPlaygroundSelectionAdapter,
    type PlaygroundRevisionSelectionResult,
} from "./playgroundSelectionAdapter"
