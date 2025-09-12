/**
 * Enhanced Variant Mutations - Split into focused files
 * This file re-exports all mutation atoms from their respective split files
 * for backward compatibility with existing imports.
 */

// Property mutations
export {
    parameterUpdateMutationAtom,
    updateVariantPropertyEnhancedMutationAtom,
    updateGenerationDataPropertyMutationAtom,
    type ConfigValue,
} from "./propertyMutations"

// Generation data mutations
export {
    deleteGenerationInputRowMutationAtom,
    duplicateGenerationInputRowMutationAtom,
    addGenerationInputRowMutationAtom,
    ensureInitialChatRowAtom,
    ensureInitialInputRowAtom,
} from "./generationMutations"

// Cross-variant sync mutations
export {
    syncCrossVariantInputsMutationAtom,
    autoSyncedGenerationDataAtom,
    autoSyncCrossVariantInputsEffectAtom,
} from "./syncMutations"

// Variant CRUD mutations
export {
    createVariantMutationAtom,
    removeVariantFromSelectionMutationAtom,
} from "./variantCrudMutations"

// Message mutations
// Legacy message mutations removed; use normalized mutations in state/generation/mutations

// Utility mutations
export {clearAllRunsMutationAtom} from "./utilityMutations"
// Back-compat alias: route legacy load call to normalized loader
export {loadTestsetNormalizedMutationAtom as loadTestsetDataMutationAtom} from "./mutations/testset/loadNormalized"

// Prompt-scoped mutations
export {
    addPromptMessageMutationAtomFamily,
    deletePromptMessageMutationAtomFamily,
    addPromptToolMutationAtomFamily,
} from "./promptMutations"
