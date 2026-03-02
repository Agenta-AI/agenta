/**
 * Execution Module
 *
 * Multi-session execution state management for the playground.
 * Supports both completion mode (testcase-based) and chat mode (conversational).
 *
 * ## Features
 *
 * - **Multi-session support**: Compare execution across multiple runnables
 * - **Chat mode**: Conversational execution with message history
 * - **Chain execution**: Execute connected nodes in topological order
 * - **Progress tracking**: Real-time execution progress updates
 *
 * ## Usage
 *
 * Most consumers should use the `executionController` API rather than
 * importing atoms directly. See `../controllers/executionController.ts`.
 *
 * ```typescript
 * import { executionController } from '@agenta/playground'
 *
 * // Initialize sessions
 * const initSessions = useSetAtom(executionController.actions.initSessions)
 * initSessions({
 *     loadableId: "loadable-1",
 *     sessions: [
 *         { id: "sess:rev1", runnableId: "rev1", runnableType: "appRevision", mode: "completion" }
 *     ]
 * })
 *
 * // Run a step
 * const runStep = useSetAtom(executionController.actions.runStep)
 * await runStep({ loadableId: "loadable-1", stepId: "row-123", data: { prompt: "Hello" } })
 *
 * // Check results
 * const resultsForStep = useAtomValue(executionController.selectors.resultsForStep("loadable-1", "row-123"))
 * ```
 *
 * @module execution
 */

// ============================================================================
// TYPES
// ============================================================================

export type {
    // Mode
    ExecutionMode,
    // Session types
    ExecutionSession,
    // Input types
    ExecutionInput,
    ChatExecutionInput,
    CompletionExecutionInput,
    // Step types
    ExecutionStep,
    // Result types
    RunStatus,
    RunResult,
    // Action payloads
    InitSessionsPayload,
    RunStepPayload,
    AddStepPayload,
    CancelStepPayload,
    // State shape
    ExecutionState,
} from "./types"

export {createInitialExecutionState} from "./types"

// ============================================================================
// ATOMS (for advanced usage)
// ============================================================================

export {
    // State atom family
    executionStateAtomFamily,
    // Mode
    executionModeAtomFamily,
    // Session atoms
    sessionsByIdAtomFamily,
    activeSessionIdsAtomFamily,
    sessionsAtomFamily,
    activeSessionsAtomFamily,
    sessionAtomFamily,
    // Step atoms
    stepsByIdAtomFamily,
    stepIdsAtomFamily,
    stepsAtomFamily,
    stepAtomFamily,
    // Result atoms
    resultsByKeyAtomFamily,
    resultsForStepAtomFamily,
    resultAtomFamily,
    isStepRunningAtomFamily,
    isAnyExecutingAtomFamily,
    // Utilities
    buildResultKey,
} from "./atoms"

// ============================================================================
// REDUCER ACTIONS
// ============================================================================

export {
    // Session actions
    initSessionsAtom,
    addSessionAtom,
    removeSessionAtom,
    setActiveSessionsAtom,
    // Step actions
    addStepAtom,
    updateStepInputAtom,
    removeStepAtom,
    // Run lifecycle actions
    startRunAtom,
    completeRunAtom,
    failRunAtom,
    cancelRunAtom,
    updateChainProgressAtom,
    // Compound actions
    runStepAtom,
    cancelStepAtom,
    resetExecutionAtom,
    // Context-aware actions (auto-inject loadableId)
    runStepWithContextAtom,
    initSessionsWithContextAtom,
    cancelStepWithContextAtom,
    resetExecutionWithContextAtom,
    type RunStepWithContextPayload,
} from "./reducer"

// ============================================================================
// SELECTORS
// ============================================================================

export {
    // Context selectors (derived from primary node)
    derivedLoadableIdAtom,
    activeSessionsWithContextAtom,
    isCompareModeWithContextAtom,
    isAnyExecutingWithContextAtom,
    executionProgressWithContextAtom,
    // Session selectors
    sessionCountAtomFamily,
    activeSessionCountAtomFamily,
    isCompareModeAtomFamily,
    sessionLabelsAtomFamily,
    // Step selectors
    stepCountAtomFamily,
    latestStepAtomFamily,
    // Result selectors
    stepAggregateStatusAtomFamily,
    stepResultSummaryAtomFamily,
    allResultsAtomFamily,
    completedResultsCountAtomFamily,
    executionProgressAtomFamily,
    // Combined selectors
    executionStateSummaryAtomFamily,
} from "./selectors"
