/**
 * Playground State Module
 *
 * This module provides the state management for the playground feature.
 * It includes types, atoms, and controllers for managing playground state.
 *
 * ## Architecture
 *
 * The state is organized into:
 * - **Types**: Type definitions for playground entities and state
 * - **Controllers**: High-level APIs for managing state (PUBLIC)
 * - **Context**: Entity provider injection for OSS/EE compatibility
 * - **Atoms**: Internal implementation (NOT exported from main package)
 *
 * ## Usage
 *
 * ```typescript
 * import {
 *   playgroundController,
 *   outputConnectionController,
 *   entitySelectorController,
 *   type PlaygroundNode,
 *   type RunnableType,
 * } from "@agenta/playground"
 *
 * // Use controllers for state management
 * const nodes = useAtomValue(playgroundController.selectors.nodes())
 * const addPrimary = useSetAtom(playgroundController.actions.addPrimaryNode)
 * ```
 *
 * ## Internal Note
 *
 * Atoms are exported from this module for internal use by controllers,
 * but they are NOT re-exported from the main @agenta/playground package.
 * External consumers should use controllers, not internal atoms.
 */

// ============================================================================
// TYPES (Public)
// ============================================================================

export type {
    ChainExecutionProgress,
    // View model types (playground-specific)
    ChainExecutionResult,
    ChainNodeInfo,
    ChainProgress,
    ConnectedTestset,
    EntitySelection,
    EntitySelectorConfig,
    // Entity types
    EntityType,
    ExecutionMetrics,
    ExecutionResult,
    // Execution types
    ExecutionStatus,
    ExtendedPathInfo,
    ExtraColumn,
    InputMapping,
    // Connection types
    InputMappingStatus,
    OutputConnection,
    // Path types
    PathInfo,
    PathItem,
    PlaygroundAction,
    // Node types
    PlaygroundNode,
    // State types
    PlaygroundState,
    RowExecutionResult,
    RunnableData,
    // Runnable types
    RunnableInputPort,
    RunnableOutputPort,
    RunnableType,
    StageExecutionResult,
    TestsetColumn,
    // Testset types
    TestsetRow,
    TraceInfo,
} from "./types"

// Multi-session execution types (from execution module)
export type {
    AddStepPayload,
    AgConfigFallbackCandidate,
    BuildChatExecutionItemParams,
    BuildCompletionExecutionItemParams,
    CancelStepPayload,
    CancelTestsParams,
    ChatExecutionInput,
    CompletionExecutionInput,
    ExecutionAdapter,
    ExecutionInput,
    ExecutionItem,
    ExecutionItemCancelParams,
    ExecutionItemHandle,
    ExecutionItemInvocation,
    ExecutionItemLifecycleApi,
    ExecutionItemLifecyclePhase,
    ExecutionItemLifecycleSnapshot,
    ExecutionItemReference,
    ExecutionItemRunParams,
    ExecutionMode,
    ExecutionSession,
    ExecutionState,
    ExecutionStep,
    InitSessionsPayload,
    PlaygroundTestResult,
    RunResult,
    RunStatus,
    RunStepPayload,
    RunStepWithContextPayload,
    SessionExecutionOptions,
    WorkerRunEntityRowPayload,
} from "./execution"

// Execution adapter atom (for DI)
export {executionAdapterAtom} from "./execution"

// Execution item builders (invocation-ready payload construction)
export {
    buildChatExecutionItem,
    buildCompletionExecutionItem,
    resolveAgConfigCandidate,
} from "./execution"

// Execution reducer atoms (for OSS adapter writes)
export {
    buildResultKey,
    cancelRunAtom,
    clearResponseByRowEntityWithContextAtom,
    completeRunAtom,
    failRunAtom,
    resetExecutionAtom,
    resultAtomFamily,
    resultsByKeyAtomFamily,
    setRepetitionCountAtom,
    setRepetitionIndexAtom,
    startRunAtom,
} from "./execution"

// Row-entity convenience selectors
export {responseByRowEntityAtomFamily, fullResultByRowEntityAtomFamily} from "./execution"

// Repetition atoms
export {repetitionCountAtom, repetitionIndexAtomFamily} from "./execution"

// Run status map
export {runStatusByRowEntityAtom} from "./execution"

// Context selectors
export {
    derivedLoadableIdAtom,
    rowDataWithContextAtomFamily,
    rowVariableKeysWithContextAtom,
} from "./execution"

// Unified row IDs (chat/completion)
export {
    executionRowIdsAtom,
    generationRowIdsAtom,
    renderableExecutionItemsAtom,
    renderableExecutionItemsByExecutionIdAtomFamily,
    renderableExecutionItemsByRowAtomFamily,
    renderableExecutionRowsAtom,
    type RenderableExecutionItem,
    type RenderableExecutionRow,
} from "./execution"

// Variable names (derived from entity input ports)
export {inputVariableNamesAtom} from "./execution"

// App-level mode selectors
export {appTypeAtom, isChatModeAtom, type AppType} from "./execution"

// Row run status
export {isAnyRunningForRowAtomFamily} from "./execution"

// Generation selectors (higher-level UI selectors)
export {
    cancelTestsMutationAtom,
    canRunAllChatComparisonAtom,
    clearAllRunsMutationAtom,
    generationHeaderDataAtomFamily,
    generationVariableRowIdsAtom,
    resolvedGenerationResultAtomFamily,
} from "./execution"

// Displayed entities (validated entity IDs, layout, readiness, status)
export {
    displayedEntityIdsAtom,
    isComparisonViewAtom,
    playgroundInitializedAtom,
    playgroundLayoutAtom,
    playgroundRevisionsReadyAtom,
    playgroundStatusAtom,
    resolvedEntityIdsAtom,
    schemaInputKeysAtom,
    type PlaygroundStatus,
} from "./execution"

// Web worker integration
export {
    executionHeadersAtom,
    executionWorkerBridgeAtom,
    handleExecutionResultFromWorkerAtom,
    ignoredWebWorkerRunIdsAtom,
    pendingWebWorkerRequestsAtom,
    triggerExecutionAtom,
    triggerExecutionsAtom,
} from "./execution"

// Chat types
export {createInitialFlatChatState, SHARED_SESSION_ID} from "./chat"
export type {
    AddMessagePayload,
    AddUserMessagePayload,
    ChatMessage,
    ChatMessageNode,
    ClearSessionResponsesPayload,
    CompleteExecutionPayload,
    DeleteMessagePayload,
    DerivedTurn,
    FailExecutionPayload,
    FlatChatState,
    MessageExecution,
    MessageExecutionStatus,
    MessageTarget,
    PatchMessagePayload,
    RemoveMessagesPayload,
    SimpleChatMessage,
    StartExecutionPayload,
    TruncateChatPayload,
    UpdateMessagePayload,
} from "./chat"

// Chat atoms
export {
    executionByMessageIdAtomFamily,
    messageAtomFamily,
    messageCountAtomFamily,
    messageExecutionAtomFamily,
    messageIdsAtomFamily,
    messagesByIdAtomFamily,
    orderedMessagesAtomFamily,
} from "./chat"

// Chat reducer actions
export {
    // CRUD
    addMessageAtom,
    addMessagesAtom,
    addMessagesWithContextAtom,
    addMessageWithContextAtom,
    // Domain-level (turn-aware)
    addUserMessageAtom,
    // Context-aware
    addUserMessageWithContextAtom,
    cancelMessageExecutionAtom,
    clearAllMessagesAtom,
    clearAllMessagesWithContextAtom,
    clearSessionResponsesAtom,
    clearSessionResponsesWithContextAtom,
    completeMessageExecutionAtom,
    deleteMessageAtom,
    deleteMessageWithContextAtom,
    // Session operations
    duplicateSessionResponsesAtom,
    duplicateSessionResponsesWithContextAtom,
    failMessageExecutionAtom,
    generateMessageId,
    patchMessageAtom,
    patchMessageWithContextAtom,
    removeMessagesAtom,
    removeMessagesWithContextAtom,
    // Execution lifecycle
    startMessageExecutionAtom,
    truncateAfterMessageAtom,
    truncateAfterMessageWithContextAtom,
    truncateChatAtom,
    truncateChatWithContextAtom,
    updateMessageAtom,
    updateMessageWithContextAtom,
} from "./chat"

// Chat selectors
export {
    activeSessionIdsFromMessagesAtomFamily,
    apiHistoryBeforeMessageAtomFamily,
    apiHistoryForSessionAtomFamily,
    buildApiHistory,
    derivedTurnsAtomFamily,
    derivedTurnsWithContextAtom,
    executionByMessageIdWithContextAtom,
    groupMessagesIntoTurns,
    isAnySessionRunningAtomFamily,
    isSessionRunningAtomFamily,
    messageCountWithContextAtom,
    messageIdsWithContextAtom,
    messagesByIdWithContextAtom,
    messagesForSessionAtomFamily,
    sharedMessageIdsAtomFamily,
    sharedMessageIdsWithContextAtom,
} from "./chat"

// Chat utilities
export {messageHasContent, messageHasToolCalls} from "./chat"

// Testset import mutation
export {
    extractAndLoadChatMessagesAtom,
    type ExtractChatMessagesParams,
} from "./helpers/extractAndLoadChatMessages"
export {loadTestsetNormalizedMutationAtom} from "./helpers/loadTestsetNormalizedMutation"

// Chat ↔ entity sync (writes chat messages back to testcase drafts)
export {syncChatMessagesToEntityAtom} from "./helpers/syncChatMessagesToEntity"

// ============================================================================
// CONTROLLERS (Public)
// ============================================================================

export {
    applyPendingHydration,
    applyPendingHydrationsForRevision,
    clearPendingHydrations,
    entitySelectorController,
    executionController,
    executionItemController,
    getRunnableTypeResolver,
    hasPendingHydrationAtomFamily,
    isPlaceholderId,
    outputConnectionController,
    pendingHydrations,
    pendingHydrationsAtom,
    playgroundController,
    playgroundSnapshotController,
    resetRunnableTypeResolver,
    setOnSelectionChangeCallback,
    setRunnableTypeResolver,
    setSelectionUpdateCallback,
    urlSnapshotController,
} from "./controllers"

export type {
    BuildEncodedSnapshotResult,
    CreateSnapshotResult,
    HydrateFromUrlResult,
    HydrateSnapshotResult,
    HydratedSnapshotEntity,
    OpenFromTraceResult,
    RunnableTypeResolver,
    SnapshotSelectionInput,
    UrlComponents,
} from "./controllers"

// ============================================================================
// CONTEXT (Public)
// ============================================================================

export {
    PlaygroundEntityProvider,
    usePlaygroundEntities,
    usePlaygroundEntitiesOptional,
} from "./context"

export type {
    AppRevisionActions,
    AppRevisionCommitPayload,
    AppRevisionCreateVariantPayload,
    AppRevisionCrudResult,
    AppRevisionListSelectors,
    AppRevisionRawData,
    EntityQueryState,
    EntityRevisionSelectors,
    EvaluatorRawData,
    EvaluatorSelectors,
    PlaygroundEntityProviders,
    SettingsPreset,
} from "./context"

// ============================================================================
// INTERNAL ATOMS (for controller implementation only)
// ============================================================================
// These are exported for use by controllers within this package,
// but they are NOT re-exported from the main @agenta/playground package.
// External consumers should use controllers instead.

export {
    connectedTestsetAtom,
    connectionsBySourceAtomFamily,
    connectionsByTargetAtomFamily,
    // Playground atoms
    defaultLocalTestsetName,
    editingConnectionIdAtom,
    entityIdsAtom,
    entitySelectorConfigAtom,
    // Entity selector atoms
    entitySelectorOpenAtom,
    entitySelectorResolverAtom,
    extraColumnsAtom,
    hasMultipleNodesAtom,
    mappingModalOpenAtom,
    // Connection atoms
    outputConnectionsAtom,
    playgroundDispatchAtom,
    playgroundNodesAtom,
    primaryEntityIdAtom,
    primaryNodeAtom,
    selectedNodeIdAtom,
    testsetModalOpenAtom,
} from "./atoms"

// ============================================================================
// HELPERS (Public)
// ============================================================================

export {buildAssistantMessage, buildUserMessage} from "./helpers/messageFactory"
