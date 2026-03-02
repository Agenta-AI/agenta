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
    RunnableNode,
    OutputReceiverInfo,
    EntityInfo,
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
    ExecutionState,
    RunStepWithContextPayload,
} from "./execution"

// ============================================================================
// CONTROLLERS (Public)
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
} from "./controllers"

export type {
    CreateSnapshotResult,
    HydrateSnapshotResult,
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
    EvaluatorRevisionSelectors,
    EvaluatorRevisionActions,
    EntityQueryState,
    SettingsPreset,
    AppRevisionRawData,
    EvaluatorRevisionRawData,
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
    primaryNodeAtom,
    hasMultipleNodesAtom,
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
