/**
 * Runnable Module
 *
 * State management for runnable entities (app revisions, evaluators).
 *
 * ## Bridge API (Recommended for UI)
 *
 * ```typescript
 * import { runnableBridge } from '@agenta/entities/runnable'
 * import { useAtomValue } from 'jotai'
 * import { useMemo } from 'react'
 *
 * // Flattened API (preferred) - memoize atoms for stability
 * const dataAtom = useMemo(() => runnableBridge.data(runnableId), [runnableId])
 * const data = useAtomValue(dataAtom)
 *
 * const inputPortsAtom = useMemo(() => runnableBridge.inputPorts(runnableId), [runnableId])
 * const inputPorts = useAtomValue(inputPortsAtom)
 *
 * const outputPortsAtom = useMemo(() => runnableBridge.outputPorts(runnableId), [runnableId])
 * const outputPorts = useAtomValue(outputPortsAtom)
 *
 * const configAtom = useMemo(() => runnableBridge.config(runnableId), [runnableId])
 * const config = useAtomValue(configAtom)
 *
 * // Evaluator-specific features
 * const evalController = runnableBridge.runnable('evaluatorRevision')
 * const presetsAtom = useMemo(() => evalController.selectors.presets(evaluatorId), [evaluatorId])
 * const presets = useAtomValue(presetsAtom)
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
// LOADABLE RE-EXPORTS (convenience)
// ============================================================================

export {loadableController, testsetLoadable} from "../loadable"
export type {ConnectedSource} from "../loadable"

// Loadable atoms (pure state)
export {
    loadableStateAtomFamily,
    loadableColumnsAtomFamily,
    loadableModeAtomFamily,
    loadableExecutionResultsAtomFamily,
    loadableDataAtomFamily,
    loadableConnectedSourceAtomFamily,
    loadableLinkedRunnableAtomFamily,
} from "../loadable"

// ============================================================================
// BRIDGE (Recommended for UI)
// ============================================================================

export {runnableBridge, loadableColumnsFromRunnableAtomFamily, getRunnableRootItems} from "./bridge"
export {extractInputPortsFromSchema, extractOutputPortsFromSchema, formatKeyAsName} from "./bridge"

// Re-export loadable bridge for convenience
export {loadableBridge, createLoadableBridge} from "../loadable"

// Bridge factories for custom configurations
export {createRunnableBridge} from "../shared"

// Bridge types
export type {
    RunnableBridge,
    RunnableBridgeSelectors,
    RunnableTypeConfig,
    CreateRunnableBridgeConfig,
    RunnablePort,
    RunnableData as BridgeRunnableData,
} from "../shared"

// ============================================================================
// UTILITIES
// ============================================================================

export {
    computeTopologicalOrder,
    resolveChainInputs,
    resolveInputsFromMappings,
    autoMapInputs,
    executeRunnable,
    // Template variable extraction
    extractTemplateVariables,
    extractTemplateVariablesFromJson,
    extractVariablesFromPrompts,
    extractVariablesFromAgConfig,
} from "./utils"
export type {PathSource, ExecuteRunnableOptions} from "./utils"

// ============================================================================
// SNAPSHOT ADAPTER
// ============================================================================

export {snapshotAdapterRegistry} from "./snapshotAdapter"
export type {
    RunnableSnapshotAdapter,
    RunnableDraftPatch,
    BuildDraftPatchResult,
} from "./snapshotAdapter"

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
