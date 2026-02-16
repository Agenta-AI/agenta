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
    // Per-session execution options
    SessionExecutionOptions,
    // State shape
    ExecutionState,
    // Adapter
    ExecutionAdapter,
    // Legacy compat
    PlaygroundTestResult,
    // Cancel params
    CancelTestsParams,
} from "./types"

export {createInitialExecutionState} from "./types"

export type {
    ExecutionItem,
    ExecutionItemHandle,
    CreateExecutionItemParams,
    ExecutionItemRunParams,
    ExecutionItemCancelParams,
    ExecutionItemLifecyclePhase,
    ExecutionItemLifecycleSnapshot,
    ExecutionItemLifecycleApi,
    ExecutionItemReference,
    ExecutionItemInvocation,
    WorkerRunEntityRowPayload,
    AgConfigFallbackCandidate,
    BuildCompletionExecutionItemParams,
    BuildChatExecutionItemParams,
} from "./executionItems"

export {
    createExecutionItemHandle,
    resolveAgConfigCandidate,
    buildCompletionExecutionItem,
    buildChatExecutionItem,
    handleExecutionResultAtom,
} from "./executionItems"

export type {HandleExecutionResultPayload} from "./executionItems"

// ============================================================================
// ATOMS (for advanced usage)
// ============================================================================

export {
    // Execution adapter
    executionAdapterAtom,
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
    // Abort/cancellation
    abortRun,
    // Concurrency
    executionConcurrencyAtom,
    // Repetition
    repetitionCountAtom,
    repetitionIndexAtomFamily,
    // UI state
    allRowsCollapsedAtom,
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
    setRepetitionCountAtom,
    setRepetitionIndexAtom,
    clearResponseByRowEntityWithContextAtom,
    addRowWithContextAtom,
    deleteRowWithContextAtom,
    duplicateRowWithContextAtom,
    setRowValueWithContextAtom,
    // Direct testcase entity write
    setTestcaseCellValueAtom,
} from "./reducer"
export type {RunStepWithContextPayload} from "./reducer"

// ============================================================================
// SELECTORS
// ============================================================================

// ============================================================================
// WEB WORKER INTEGRATION
// ============================================================================

export {
    // Injectable auth headers
    executionHeadersAtom,
    // Injectable worker bridge
    executionWorkerBridgeAtom,
    // Pending requests tracking
    pendingWebWorkerRequestsAtom,
    ignoredWebWorkerRunIdsAtom,
    // Trigger and result handler
    triggerExecutionAtom,
    handleExecutionResultFromWorkerAtom,
} from "./webWorkerIntegration"
export type {ExecutionItemStepPayload, TriggerExecutionItemPayload} from "./webWorkerIntegration"

// ============================================================================
// SELECTORS
// ============================================================================

export {
    // Context selectors (derived from primary node)
    derivedLoadableIdAtom,
    rowDataWithContextAtomFamily,
    rowVariableValueAtomFamily,
    rowVariableKeysWithContextAtom,
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
    // Row-entity convenience selectors
    responseByRowEntityAtomFamily,
    fullResultByRowEntityAtomFamily,
    // Run status map
    runStatusByRowEntityAtom,
    // Unified row IDs
    generationRowIdsAtom,
    executionRowIdsAtom,
    // Render model (single source of truth for UI iteration)
    renderableExecutionItemsAtom,
    renderableExecutionRowsAtom,
    renderableExecutionItemsByRowAtomFamily,
    renderableExecutionItemsByExecutionIdAtomFamily,
    executionRowIdsForEntityAtomFamily,
    // Variable names (from entity input ports)
    inputVariableNamesAtom,
    // Message schema metadata (from entity metadata)
    messageSchemaMetadataAtom,
    // App-level mode selectors
    isChatModeAtom,
    appTypeAtom,
    type AppType,
    // Row run status
    isAnyRunningForRowAtomFamily,
    // Direct testcase entity selectors
    testcaseCellValueAtomFamily,
    testcaseDataAtomFamily,
} from "./selectors"
export type {RenderableExecutionItem, RenderableExecutionRow} from "./selectors"

// ============================================================================
// GENERATION SELECTORS (higher-level UI selectors)
// ============================================================================

export {
    // Generation result selectors
    resolvedGenerationResultAtomFamily,
    generationHeaderDataAtomFamily,
    // Variable-input row IDs (shared variable row in chat)
    generationVariableRowIdsAtom,
    // Multi-run trigger orchestration
    triggerExecutionsAtom,
    // Mutations
    cancelTestsMutationAtom,
    clearAllRunsMutationAtom,
    // Chat comparison
    canRunAllChatComparisonAtom,
    // Row-level busy state
    isBusyForRowAtomFamily,
    // Chain execution status (composite per-row chain state)
    chainExecutionStatusAtomFamily,
    // Aggregated header data
    aggregatedHeaderDataAtom,
    // Turn-level message selectors
    assistantForTurnAtomFamily,
    toolsForTurnAtomFamily,
    // Rerun from turn
    rerunFromTurnAtom,
    // Run all orchestration
    runAllWithContextAtom,
    // Row-level run/cancel
    runRowAtom,
    runRowStepAtom,
    cancelRowAtom,
    // Cancel all
    cancelAllWithContextAtom,
} from "./generationSelectors"
export type {TriggerExecutionItemsPayload, ChainExecutionStatus} from "./generationSelectors"

// ============================================================================
// DISPLAYED ENTITIES (validated entity IDs, layout, readiness)
// ============================================================================

export {
    // Readiness signal
    playgroundRevisionsReadyAtom,
    // Lifecycle status
    playgroundStatusAtom,
    playgroundInitializedAtom,
    type PlaygroundStatus,
    // Validated entity IDs (filtered against revisions)
    displayedEntityIdsAtom,
    // Strict resolved entity IDs (excludes pending)
    resolvedEntityIdsAtom,
    // Comparison state (validated)
    isComparisonViewAtom,
    // Layout composite
    playgroundLayoutAtom,
    // Schema input keys
    schemaInputKeysAtom,
} from "./displayedEntities"
