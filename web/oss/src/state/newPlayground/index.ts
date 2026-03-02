/**
 * New Playground State Architecture
 *
 * This module provides a clean, optimized state management system for the playground
 * that eliminates sync overhead and separates concerns properly.
 *
 * Key Benefits:
 * 1. No sync logic - configs are independent from revisions
 * 2. Derived state - request bodies always calculated from current config
 * 3. Clean separation - config vs generation data
 * 4. Optimized mutations - direct updates without transformations
 * 5. Better performance - targeted updates and efficient equality checks
 */

// Core atoms
export {pendingWebWorkerRequestsAtom} from "./mutations/execution"

// Legacy entity bridge (for @agenta/entities integration)
export {
    // Molecule re-exports for convenience
    legacyAppRevisionMolecule,
    ossRevision,
    // Drop-in replacement selectors (molecule-backed)
    moleculeBackedVariantAtomFamily,
    revisionIsDirtyAtomFamily,
    revisionQueryStateAtomFamily,
    // Molecule-backed prompts (single source of truth)
    moleculeBackedPromptsAtomFamily,
    moleculeBackedCustomPropertiesAtomFamily,
    // Mutation redirect (route updates to molecule)
    moleculePropertyUpdateAtom,
    // Debug utilities (available at window.__legacyEntityBridge in dev)
    debugBridge,
    // Local draft utilities
    localDraftIdsAtom,
    localDraftsListAtom,
    hasUnsavedLocalDraftsAtom,
    isLocalDraft,
    getSourceRevisionId,
    cloneAsLocalDraft,
    discardLocalDraft,
} from "./legacyEntityBridge"

// Types
export type {
    PlaygroundVariantConfig,
    PlaygroundConfig,
    TestInput,
    ChatMessage,
    ChatHistoryItem,
    TestRun,
    GenerationData,
    PlaygroundState,
    UpdateConfigParams,
    AddTestcaseParams,
    RunTestParams,
    DeleteMessageParams,
    DerivedRequestBody,
    DirtyState,
} from "./types"
