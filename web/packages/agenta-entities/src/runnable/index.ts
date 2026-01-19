/**
 * Runnable & Loadable State Module
 *
 * Shared state management for runnables (executable entities like app revisions, evaluators)
 * and loadables (data sources like testsets that provide inputs to runnables).
 *
 * ## New API (Recommended)
 *
 * ```typescript
 * import { runnableBridge, loadableBridge } from '@agenta/entities/runnable'
 *
 * // Unified runnable API
 * const data = useAtomValue(runnableBridge.selectors.data(runnableId))
 * const inputPorts = useAtomValue(runnableBridge.selectors.inputPorts(runnableId))
 *
 * // Access evaluator-specific features
 * const evalController = runnableBridge.runnable('evaluatorRevision')
 * const presets = useAtomValue(evalController.selectors.presets(evaluatorId))
 *
 * // Unified loadable API (re-exported from @agenta/entities/loadable)
 * const rows = useAtomValue(loadableBridge.selectors.rows(loadableId))
 * ```
 *
 * ## Legacy API (Backwards Compatible)
 *
 * ```typescript
 * import { useRunnable, useLoadable } from '@agenta/entities/runnable'
 *
 * // Hook usage
 * const runnable = useRunnable('appRevision', revisionId)
 * const loadable = useLoadable(loadableId)
 * ```
 *
 * These stay in @agenta/entities because hooks/controllers depend on entity molecules.
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
    // Node types
    PlaygroundNode,
    ExtraColumn,
    ConnectedTestset,
} from "./types"

// ============================================================================
// LOADABLE STATE (re-exported from ../loadable for backwards compatibility)
// ============================================================================

export {loadableController, testsetLoadable} from "../loadable"
export {useLoadable} from "../loadable"
export type {ConnectedSource, UseLoadableReturn} from "../loadable"

// Loadable atoms (pure state - no entity dependencies)
export {
    loadableStateAtomFamily,
    loadableRowsAtomFamily,
    loadableColumnsAtomFamily,
    loadableAllColumnsAtomFamily,
    loadableActiveRowAtomFamily,
    loadableRowCountAtomFamily,
    loadableModeAtomFamily,
    loadableIsDirtyAtomFamily,
    loadableHasLocalChangesAtomFamily,
    loadableExecutionResultsAtomFamily,
    loadableDataAtomFamily,
    loadableConnectedSourceAtomFamily,
    loadableLinkedRunnableAtomFamily,
} from "../loadable"

// ============================================================================
// NEW API: RUNNABLE BRIDGE (Recommended)
// ============================================================================

export {runnableBridge} from "./bridge"
export {extractInputPortsFromSchema, extractOutputPortsFromSchema, formatKeyAsName} from "./bridge"

// Re-export loadable bridge for convenience
export {loadableBridge, createLoadableBridge} from "../loadable"

// Re-export the factory for custom configurations
export {createRunnableBridge} from "../shared"

// Re-export bridge types
export type {
    RunnableBridge,
    RunnableBridgeSelectors,
    RunnableTypeConfig,
    CreateRunnableBridgeConfig,
    RunnablePort,
    RunnableData as BridgeRunnableData,
} from "../shared"

// ============================================================================
// LEGACY API: RUNNABLE HOOKS (Backwards Compatible)
// ============================================================================

export {
    useRunnable,
    useRunnableSelectors,
    useRunnableActions,
    createRunnableSelectors,
    createRunnableActions,
    getRunnableRootItems,
} from "./useRunnable"

// ============================================================================
// UTILITIES
// ============================================================================

export {
    computeTopologicalOrder,
    resolveChainInputs,
    resolveInputsFromMappings,
    autoMapInputs,
    executeRunnable,
} from "./utils"
export type {PathSource, ExecuteRunnableOptions} from "./utils"

// ============================================================================
// PROVIDER TYPES (for playground entity injection)
// ============================================================================

export type {
    PlaygroundEntityProviders,
    EntityRevisionSelectors,
    EvaluatorRevisionSelectors,
    EvaluatorRevisionActions,
    EntityQueryState,
    SettingsPreset,
    AppRevisionRawData,
    EvaluatorRevisionRawData,
} from "./providerTypes"
