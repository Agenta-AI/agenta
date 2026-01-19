/**
 * @agenta/playground - Playground UI Components Package
 *
 * This package provides the playground interface for testing
 * app revisions, evaluators, and managing testcases.
 *
 * ## Usage
 *
 * The package requires a provider to inject OSS/EE-specific components:
 *
 * ```tsx
 * import { PlaygroundUIProvider, PlaygroundContent } from "@agenta/playground"
 * import { EntityDrillInView } from "@/oss/components/DrillInView"
 * import { SharedGenerationResultUtils } from "@/oss/components/SharedGenerationResultUtils"
 * // ... other imports
 *
 * export function PlaygroundTest() {
 *   return (
 *     <PlaygroundUIProvider providers={{
 *       EntityDrillInView,
 *       SharedGenerationResultUtils,
 *       LoadTestsetModal: dynamic(() => import("...LoadTestsetModal")),
 *       CommitVariantChangesButton: dynamic(() => import("...CommitVariantChangesButton")),
 *     }}>
 *       <PlaygroundContent />
 *     </PlaygroundUIProvider>
 *   )
 * }
 * ```
 *
 * ## State Management
 *
 * - Playground state (controllers, atoms) is in this package at ./state
 * - Loadable/runnable hooks are in @agenta/entities/runnable (they depend on entity molecules)
 */

// ============================================================================
// CONTEXT (for OSS/EE injection)
// ============================================================================

export {
    PlaygroundUIProvider,
    usePlaygroundUI,
    usePlaygroundUIOptional,
    type PlaygroundUIProviders,
    type PlaygroundUIProviderProps,
    type PlaygroundUIContextValue,
    // Component prop types
    type EntityDrillInViewProps,
    type SharedGenerationResultUtilsProps,
    type LoadTestsetModalProps,
    type LoadTestsetSelectionPayload,
    type CommitVariantChangesButtonProps,
    type SettingsPreset,
    type SaveModeConfig,
} from "./context"

// ============================================================================
// HOOKS
// ============================================================================

export {useChainExecution, type UseChainExecutionReturn} from "./hooks"

// ============================================================================
// COMPONENTS
// ============================================================================

export {
    // Main orchestrator
    PlaygroundContent,
    // Main panels
    ConfigPanel,
    TestcasePanel,
    RunnableColumnsLayout,
    RunnableEntityPanel,
    ConfigurationSection,
    EmptyState,
    LoadEvaluatorPresetModal,
    // Entity selector
    EntitySelectorProvider,
    EntitySelector,
    EntitySelectorModal,
    useEntitySelector,
    // Input mapping
    InputMappingModalWrapper,
    useMappingState,
    getMappingStatus,
    extractPathsFromValue,
    buildAvailablePaths,
    MappingLegend,
    ObjectMappingRow,
    PathSelector,
    ScalarMappingRow,
    TestRunPreview,
    // Loadable panel
    LoadableEntityPanel,
    LoadableRowCard,
    // Types
    type ConfigPanelProps,
    type OutputReceiverInfo,
    type ConfigurationSectionProps,
    type RunnableEntityPanelProps,
    type RunnableColumnsLayoutProps,
    type RunnableNode,
    type TestcasePanelProps,
    type LoadableEntityPanelProps,
    type LoadableRowCardProps,
    type InputMappingModalProps,
    type InputMappingModalWrapperProps,
    type EntityInfo,
    type PathInfo,
    type MappingStatusInfo,
    type EntitySelectorConfig as EntitySelectorConfigUI,
    type EntityType,
    type LoadEvaluatorPresetModalProps,
} from "./components"

// ============================================================================
// STATE (Playground-specific state management)
// ============================================================================

// Controllers (now in this package)
export {
    playgroundController,
    outputConnectionController,
    entitySelectorController,
} from "./state"

// Context (entity injection)
export {
    PlaygroundEntityProvider,
    usePlaygroundEntities,
    usePlaygroundEntitiesOptional,
    type PlaygroundEntityProviders,
    type EntityRevisionSelectors,
    type EvaluatorRevisionSelectors,
    type EvaluatorRevisionActions,
    type EntityQueryState,
    type AppRevisionRawData,
    type EvaluatorRevisionRawData,
} from "./state"

// Atoms (pure playground state)
export {
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
    outputConnectionsAtom,
    connectionsBySourceAtomFamily,
    connectionsByTargetAtomFamily,
    entitySelectorOpenAtom,
    entitySelectorConfigAtom,
    entitySelectorResolverAtom,
} from "./state"

// Types (re-exported from entities for convenience)
export type {
    RunnableType,
    EntitySelection,
    EntitySelectorConfig,
    TestsetRow,
    TestsetColumn,
    OutputConnection,
    InputMapping,
    InputMappingStatus,
    ExecutionResult,
    StageExecutionResult,
    ChainProgress,
    ChainExecutionProgress,
    RowExecutionResult,
    RunnableInputPort,
    RunnableOutputPort,
    RunnableData,
    AppRevisionData,
    EvaluatorRevisionData,
    PlaygroundNode,
    PlaygroundState,
    PlaygroundAction,
    ConnectedTestset,
    ExtraColumn,
    ExecutionStatus,
    TraceInfo,
    ExecutionMetrics,
    ExtendedPathInfo,
    PathItem,
} from "./state"

// ============================================================================
// RE-EXPORTS FROM @agenta/entities/runnable
// (Loadable/runnable - depend on entity molecules, stay in entities)
// ============================================================================

export {
    // Hooks
    useRunnable,
    useLoadable,
    useRunnableSelectors,
    useRunnableActions,
    // Controllers that depend on entities
    loadableController,
    // Utilities
    computeTopologicalOrder,
    resolveChainInputs,
    executeRunnable,
    getRunnableRootItems,
    // Types
    type ConnectedSource,
    type UseLoadableReturn,
} from "@agenta/entities/runnable"
