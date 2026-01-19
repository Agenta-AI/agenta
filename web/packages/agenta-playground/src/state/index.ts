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
 * - **Atoms**: Jotai atoms for reactive state
 * - **Controllers**: High-level APIs for managing state
 * - **Context**: Entity provider injection for OSS/EE compatibility
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
 * } from "@agenta/playground/state"
 *
 * // Use controllers for state management
 * const nodes = useAtomValue(playgroundController.selectors.nodes())
 * const addPrimary = useSetAtom(playgroundController.actions.addPrimaryNode)
 * ```
 */

// ============================================================================
// TYPES
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
} from "./types"

// ============================================================================
// ATOMS
// ============================================================================

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

// ============================================================================
// CONTROLLERS
// ============================================================================

export {
    playgroundController,
    outputConnectionController,
    entitySelectorController,
} from "./controllers"

// ============================================================================
// CONTEXT
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
