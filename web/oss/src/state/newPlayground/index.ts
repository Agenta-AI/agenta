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
export {playgroundConfigAtom, displayedVariantsAtom} from "./core/config"

export {pendingWebWorkerRequestsAtom} from "./mutations/execution"

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
