/**
 * @agenta/playground - Playground State Management
 *
 * This package provides state controllers for the playground feature.
 * Internal atoms are NOT exported - use controllers for all state access.
 * For UI components, use @agenta/playground-ui.
 *
 * ## Usage
 *
 * ```typescript
 * import { playgroundController, outputConnectionController } from '@agenta/playground'
 * import { useAtomValue, useSetAtom } from 'jotai'
 *
 * // Read state via controller selectors
 * const nodes = useAtomValue(playgroundController.selectors.nodes())
 * const selectedNode = useAtomValue(playgroundController.selectors.selectedNode())
 *
 * // Write state via controller actions
 * const dispatch = useSetAtom(playgroundController.dispatch)
 * dispatch({ type: 'ADD_NODE', payload: { ... } })
 * ```
 *
 * ## Architecture
 *
 * - Controllers provide clean API for state access (selectors + actions)
 * - Internal atoms are hidden - use controllers instead
 * - Entity injection via PlaygroundEntityProvider
 * - UI components are in @agenta/playground-ui
 */

// ============================================================================
// CONTROLLERS (Public API)
// ============================================================================

export {
    playgroundController,
    outputConnectionController,
    entitySelectorController,
    executionController,
    playgroundSnapshotController,
    applyPendingHydration,
    applyPendingHydrationsForRevision,
    clearPendingHydrations,
    pendingHydrations,
    pendingHydrationsAtom,
    setSelectionUpdateCallback,
    isPlaceholderId,
    urlSnapshotController,
    setRunnableTypeResolver,
    getRunnableTypeResolver,
    resetRunnableTypeResolver,
} from "./state"

// Re-export parseSnapshot for debugging
export {parseSnapshot} from "./snapshot"

export type {
    CreateSnapshotResult,
    HydrateSnapshotResult,
    SnapshotSelectionInput,
    RunnableTypeResolver,
    BuildEncodedSnapshotResult,
    UrlComponents,
    HydrateFromUrlResult,
} from "./state"

export type {
    ConnectToTestsetPayload,
    ImportTestcasesPayload,
    AddRowWithInitPayload,
    ExtraColumnPayload,
} from "./state/controllers/playgroundController"

// Execution types
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
    ExecutionState,
    RunStepWithContextPayload,
} from "./state"

// ============================================================================
// ENTITY CONTEXT (Dependency Injection)
// ============================================================================

export {
    PlaygroundEntityProvider,
    usePlaygroundEntities,
    usePlaygroundEntitiesOptional,
} from "./state"

export type {
    PlaygroundEntityProviders,
    EntityRevisionSelectors,
    EvaluatorRevisionSelectors,
    EvaluatorRevisionActions,
    EntityQueryState,
    AppRevisionRawData,
    EvaluatorRevisionRawData,
} from "./state"

// ============================================================================
// REACT HOOKS
// ============================================================================

export {
    useChainExecution,
    type UseChainExecutionReturn,
    usePlaygroundState,
    useDerivedState,
    type DerivedStateParams,
} from "./react"

// ============================================================================
// TYPES (Public Types Only)
// ============================================================================

export type {
    // Entity types
    RunnableType,
    EntitySelection,
    EntitySelectorConfig,
    EntityType,
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
    RunnableNode,
    OutputReceiverInfo,
    EntityInfo,
} from "./state"

// ============================================================================
// NOTE: Internal atoms are NOT exported
// ============================================================================
//
// DO NOT import internal atoms directly.
// Use controllers instead:
//
//   playgroundController.selectors.nodes()      (not playgroundNodesAtom)
//   playgroundController.selectors.primaryNode() (not primaryNodeAtom)
//   outputConnectionController.selectors.allConnections() (not outputConnectionsAtom)
//
// This keeps the public API stable while allowing internal refactoring.
