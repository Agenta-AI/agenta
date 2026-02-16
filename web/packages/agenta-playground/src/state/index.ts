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
    // Entity types
    EntityType,
    RunnableType,
    EntitySelection,
    EntitySelectorConfig,
    // Node types
    PlaygroundNode,
    ExtraColumn,
    ConnectedTestset,
    // Connection types
    InputMappingStatus,
    InputMapping,
    OutputConnection,
    // Testset types
    TestsetRow,
    TestsetColumn,
    // Execution types
    ExecutionStatus,
    TraceInfo,
    ExecutionMetrics,
    ExecutionResult,
    StageExecutionResult,
    ChainProgress,
    ChainExecutionProgress,
    RowExecutionResult,
    // Runnable types
    RunnableInputPort,
    RunnableOutputPort,
    RunnableData,
    AppRevisionData,
    EvaluatorRevisionData,
    // Path types
    PathInfo,
    ExtendedPathInfo,
    PathItem,
    // State types
    PlaygroundState,
    PlaygroundAction,
    // View model types (playground-specific)
    ChainExecutionResult,
    ChainNodeInfo,
} from "./types"

// Multi-session execution types (from execution module)
export type {
    ExecutionMode,
    ExecutionSession,
    ExecutionInput,
    ChatExecutionInput,
    CompletionExecutionInput,
    ExecutionStep,
    RunStatus,
    RunResult,
    InitSessionsPayload,
    RunStepPayload,
    AddStepPayload,
    CancelStepPayload,
    SessionExecutionOptions,
    ExecutionState,
    RunStepWithContextPayload,
    ExecutionAdapter,
    PlaygroundTestResult,
    CancelTestsParams,
    ExecutionItem,
    ExecutionItemHandle,
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
} from "./execution"

// Execution adapter atom (for DI)
export {executionAdapterAtom} from "./execution"

// Execution item builders (invocation-ready payload construction)
export {
    buildCompletionExecutionItem,
    buildChatExecutionItem,
    resolveAgConfigCandidate,
} from "./execution"

// Execution reducer atoms (for OSS adapter writes)
export {
    startRunAtom,
    completeRunAtom,
    failRunAtom,
    cancelRunAtom,
    resetExecutionAtom,
    setRepetitionCountAtom,
    setRepetitionIndexAtom,
    clearResponseByRowEntityWithContextAtom,
    resultsByKeyAtomFamily,
    resultAtomFamily,
    buildResultKey,
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
export {generationRowIdsAtom, executionRowIdsAtom} from "./execution"
export {
    renderableExecutionItemsAtom,
    renderableExecutionRowsAtom,
    renderableExecutionItemsByRowAtomFamily,
    renderableExecutionItemsByExecutionIdAtomFamily,
    type RenderableExecutionItem,
    type RenderableExecutionRow,
} from "./execution"

// Variable names (derived from entity input ports)
export {inputVariableNamesAtom} from "./execution"

// Message schema metadata (from entity metadata)
export {messageSchemaMetadataAtom} from "./execution"

// App-level mode selectors
export {isChatModeAtom, appTypeAtom, type AppType} from "./execution"

// Row run status
export {isAnyRunningForRowAtomFamily} from "./execution"

// Generation selectors (higher-level UI selectors)
export {
    resolvedGenerationResultAtomFamily,
    generationHeaderDataAtomFamily,
    generationVariableRowIdsAtom,
    cancelTestsMutationAtom,
    clearAllRunsMutationAtom,
    canRunAllChatComparisonAtom,
} from "./execution"

// Displayed entities (validated entity IDs, layout, readiness, status)
export {
    playgroundRevisionsReadyAtom,
    playgroundStatusAtom,
    playgroundInitializedAtom,
    type PlaygroundStatus,
    displayedEntityIdsAtom,
    resolvedEntityIdsAtom,
    isComparisonViewAtom,
    playgroundLayoutAtom,
    schemaInputKeysAtom,
} from "./execution"

// Web worker integration
export {
    executionHeadersAtom,
    executionWorkerBridgeAtom,
    pendingWebWorkerRequestsAtom,
    ignoredWebWorkerRunIdsAtom,
    triggerExecutionAtom,
    triggerExecutionsAtom,
    handleExecutionResultFromWorkerAtom,
} from "./execution"

// Chat types
export type {
    SimpleChatMessage,
    ChatMessageNode,
    AddUserMessagePayload,
    TruncateChatPayload,
    MessageTarget,
    PatchMessagePayload,
    DeleteMessagePayload,
    ChatMessage,
    MessageExecution,
    MessageExecutionStatus,
    FlatChatState,
    DerivedTurn,
    AddMessagePayload,
    UpdateMessagePayload,
    RemoveMessagesPayload,
    ClearSessionResponsesPayload,
    StartExecutionPayload,
    CompleteExecutionPayload,
    FailExecutionPayload,
} from "./chat"
export {SHARED_SESSION_ID, createInitialFlatChatState} from "./chat"

// Chat atoms
export {
    messageIdsAtomFamily,
    messagesByIdAtomFamily,
    executionByMessageIdAtomFamily,
    messageAtomFamily,
    messageExecutionAtomFamily,
    orderedMessagesAtomFamily,
    messageCountAtomFamily,
} from "./chat"

// Chat reducer actions
export {
    generateMessageId,
    // CRUD
    addMessageAtom,
    addMessagesAtom,
    updateMessageAtom,
    removeMessagesAtom,
    clearSessionResponsesAtom,
    truncateAfterMessageAtom,
    clearAllMessagesAtom,
    // Execution lifecycle
    startMessageExecutionAtom,
    completeMessageExecutionAtom,
    failMessageExecutionAtom,
    cancelMessageExecutionAtom,
    // Session operations
    duplicateSessionResponsesAtom,
    // Domain-level (turn-aware)
    addUserMessageAtom,
    truncateChatAtom,
    patchMessageAtom,
    deleteMessageAtom,
    // Context-aware
    addUserMessageWithContextAtom,
    truncateChatWithContextAtom,
    patchMessageWithContextAtom,
    deleteMessageWithContextAtom,
    addMessageWithContextAtom,
    addMessagesWithContextAtom,
    updateMessageWithContextAtom,
    removeMessagesWithContextAtom,
    clearSessionResponsesWithContextAtom,
    truncateAfterMessageWithContextAtom,
    clearAllMessagesWithContextAtom,
    duplicateSessionResponsesWithContextAtom,
} from "./chat"

// Chat selectors
export {
    sharedMessageIdsAtomFamily,
    sharedMessageIdsWithContextAtom,
    derivedTurnsAtomFamily,
    groupMessagesIntoTurns,
    apiHistoryForSessionAtomFamily,
    buildApiHistory,
    apiHistoryBeforeMessageAtomFamily,
    messagesForSessionAtomFamily,
    activeSessionIdsFromMessagesAtomFamily,
    isSessionRunningAtomFamily,
    isAnySessionRunningAtomFamily,
    derivedTurnsWithContextAtom,
    messageIdsWithContextAtom,
    messagesByIdWithContextAtom,
    executionByMessageIdWithContextAtom,
    messageCountWithContextAtom,
} from "./chat"

// Chat utilities
export {messageHasContent, messageHasToolCalls} from "./chat"

// Testset import mutation
export {loadTestsetNormalizedMutationAtom} from "./helpers/loadTestsetNormalizedMutation"

// ============================================================================
// CONTROLLERS (Public)
// ============================================================================

export {
    playgroundController,
    outputConnectionController,
    entitySelectorController,
    executionController,
    executionItemController,
    playgroundSnapshotController,
    applyPendingHydration,
    applyPendingHydrationsForRevision,
    clearPendingHydrations,
    pendingHydrations,
    pendingHydrationsAtom,
    setSelectionUpdateCallback,
    setOnSelectionChangeCallback,
    isPlaceholderId,
    urlSnapshotController,
    setRunnableTypeResolver,
    getRunnableTypeResolver,
    resetRunnableTypeResolver,
} from "./controllers"

export {setRunnableBridge, getRunnableBridge, resetRunnableBridge} from "./controllers"

export type {
    CreateSnapshotResult,
    HydrateSnapshotResult,
    HydratedSnapshotEntity,
    SnapshotSelectionInput,
    RunnableTypeResolver,
    BuildEncodedSnapshotResult,
    UrlComponents,
    HydrateFromUrlResult,
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
    PlaygroundEntityProviders,
    EntityRevisionSelectors,
    EvaluatorSelectors,
    EvaluatorRevisionSelectors,
    EvaluatorRevisionActions,
    EntityQueryState,
    SettingsPreset,
    AppRevisionRawData,
    EvaluatorRawData,
    EvaluatorRevisionRawData,
    AppRevisionListSelectors,
    AppRevisionActions,
    AppRevisionCreateVariantPayload,
    AppRevisionCommitPayload,
    AppRevisionCrudResult,
} from "./context"

// ============================================================================
// INTERNAL ATOMS (for controller implementation only)
// ============================================================================
// These are exported for use by controllers within this package,
// but they are NOT re-exported from the main @agenta/playground package.
// External consumers should use controllers instead.

export {
    // Playground atoms
    defaultLocalTestsetName,
    playgroundNodesAtom,
    selectedNodeIdAtom,
    connectedTestsetAtom,
    extraColumnsAtom,
    testsetModalOpenAtom,
    mappingModalOpenAtom,
    editingConnectionIdAtom,
    hasMultipleNodesAtom,
    entityIdsAtom,
    playgroundDispatchAtom,
    // Connection atoms
    outputConnectionsAtom,
    connectionsBySourceAtomFamily,
    connectionsByTargetAtomFamily,
    // Entity selector atoms
    entitySelectorOpenAtom,
    entitySelectorConfigAtom,
    entitySelectorResolverAtom,
} from "./atoms"

// ============================================================================
// HELPERS (Public)
// ============================================================================

export {buildAssistantMessage, buildToolMessages, buildUserMessage} from "./helpers/messageFactory"
