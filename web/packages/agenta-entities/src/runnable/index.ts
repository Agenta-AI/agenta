/**
 * Runnable Module
 *
 * Utilities, types, and integration helpers for runnable entities.
 *
 * ## Preferred API: Workflow Molecule
 *
 * ```typescript
 * import { workflowMolecule } from '@agenta/entities/workflow'
 * import { useAtomValue } from 'jotai'
 *
 * const data = useAtomValue(workflowMolecule.selectors.data(revisionId))
 * const inputPorts = useAtomValue(workflowMolecule.selectors.inputPorts(revisionId))
 * const config = useAtomValue(workflowMolecule.selectors.configuration(revisionId))
 * ```
 */

// ============================================================================
// TYPES
// ============================================================================

export type {
    // Entity types
    EntityType,
    RunnableType,
    RunnableExecutionMode,
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
    // Path types
    PathInfo,
    ExtendedPathInfo,
    PathItem,
    // Request payload
    RequestPayloadData,
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
// INTEGRATION UTILITIES
// ============================================================================

export {loadableColumnsFromRunnableAtomFamily, getRunnableRootItems} from "./bridge"

// Port/schema helpers (standalone utilities)
export {
    extractInputPortsFromSchema,
    extractOutputPortsFromSchema,
    formatKeyAsName,
    resolveSchemaRef,
    resolveSchemaType,
} from "./portHelpers"

// Evaluator config transforms (standalone utilities)
export {
    isEvaluatorFlatParams,
    nestEvaluatorConfiguration,
    flattenEvaluatorConfiguration,
    nestEvaluatorSchema,
} from "./evaluatorTransforms"

// Response normalization
export {normalizeWorkflowResponse} from "./responseHelpers"

// Re-export loadable bridge for convenience
export {loadableBridge, createLoadableBridge} from "../loadable"

// Standalone types
export type {RunnablePort} from "../shared"

// ============================================================================
// UTILITIES
// ============================================================================

export {
    computeTopologicalOrder,
    computeTopologicalLevels,
    resolveChainInputs,
    resolveInputsFromMappings,
    autoMapInputs,
    executeRunnable,
    buildEvaluatorExecutionInputs,
    validateEvaluatorInputs,
    // Template variable extraction
    extractTemplateVariables,
    extractTemplateVariablesFromJson,
    extractVariablesFromPrompts,
    extractVariablesFromConfig,
    extractVariablesFromEnhancedPrompts,
} from "./utils"
export type {ExecuteRunnableOptions} from "./utils"

// ============================================================================
// DEPLOYMENT
// ============================================================================

export {publishMutationAtom, publishToEnvironment} from "./deploy"
export type {PublishPayload} from "./deploy"

// ============================================================================
// SNAPSHOT ADAPTER
// ============================================================================

export {snapshotAdapterRegistry} from "./snapshotAdapter"
export type {
    RunnableSnapshotAdapter,
    RunnableDraftPatch,
    BuildDraftPatchResult,
} from "./snapshotAdapter"

export {computeShallowDiff, applyShallowPatch} from "./snapshotDiff"
export type {ShallowDiffOptions} from "./snapshotDiff"

// ============================================================================
// PROVIDER TYPES (for playground entity injection)
// ============================================================================

export type {
    PlaygroundEntityProviders,
    EntityRevisionSelectors,
    EvaluatorSelectors,
    EntityQueryState,
    SettingsPreset,
    AppRevisionRawData,
    EvaluatorRawData,
    AppRevisionListSelectors,
    AppRevisionActions,
    AppRevisionCreateVariantPayload,
    AppRevisionCommitPayload,
    AppRevisionCrudResult,
} from "./providerTypes"
