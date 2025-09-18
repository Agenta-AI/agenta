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
export {
    playgroundConfigAtom,
    selectedVariantAtom,
    displayedVariantsAtom,
    initializePlaygroundAtom,
    addVariantAtom,
    deleteVariantAtom,
    updateVariantConfigAtom,
} from "./core/config"

export {
    generationDataAtom,
    testInputsAtom,
    chatMessagesAtom,
    addTestInputAtom,
    addChatMessageAtom,
    deleteTestInputAtom,
    deleteChatMessageAtom,
    deleteChatHistoryItemAtom,
    updateTestRunAtom,
    clearAllResultsAtom,
} from "./core/generation"

// Derived atoms
export {
    selectedVariantRequestBodyAtom,
    displayedVariantsRequestBodiesAtom,
    getVariantRequestBodyAtom,
} from "./derived/requestBody"

export {
    isVariantDirtyAtom,
    isSelectedVariantDirtyAtom,
    hasAnyDirtyVariantAtom,
    selectedVariantValidationAtom,
    allVariantsValidationAtom,
} from "./derived/validation"

// Mutation atoms
export {
    updateVariantPromptAtom,
    updateVariantParameterAtom,
    updateVariantNameAtom,
    bulkUpdateVariantAtom,
    resetVariantAtom,
    duplicateVariantConfigAtom,
    updateVariantPropertyAtom,
    addPromptMessageAtom,
    deletePromptMessageAtom,
    reorderPromptMessagesAtom,
} from "./mutations/config"

export {
    addTestCaseAtom,
    addTestCaseWithModeAtom,
    deleteTestCaseAtom,
    deleteMessageAtom,
    clearResultsAtom,
    duplicateTestCaseAtom,
    updateTestCaseVariablesAtom,
    bulkDeleteTestCasesAtom,
    bulkClearResultsAtom,
} from "./mutations/generation"

export {
    pendingWebWorkerRequestsAtom,
    runSingleTestAtom,
    runRowTestsAtom,
    runAllTestsAtom,
    cancelTestAtom,
    cancelAllTestsAtom,
    handleWebWorkerResultAtom,
} from "./mutations/execution"

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
    AddTestCaseParams,
    RunTestParams,
    DeleteMessageParams,
    DerivedRequestBody,
    DirtyState,
} from "./types"
