/**
 * @agenta/playground-ui - Playground UI Components Package
 *
 * This package provides the UI components for the playground feature.
 * For state management (controllers, atoms), use @agenta/playground.
 *
 * ## Usage
 *
 * The package requires a provider to inject OSS/EE-specific components:
 *
 * ```tsx
 * import { PlaygroundUIProvider, PlaygroundContent } from "@agenta/playground-ui"
 * import { playgroundController, PlaygroundEntityProvider } from "@agenta/playground"
 * import { EntityDrillInView } from "@/oss/components/DrillInView"
 *
 * export function PlaygroundTest() {
 *   return (
 *     <PlaygroundEntityProvider providers={entityProviders}>
 *       <PlaygroundUIProvider providers={{
 *         EntityDrillInView,
 *         SharedGenerationResultUtils,
 *         LoadTestsetModal: dynamic(() => import("...LoadTestsetModal")),
 *         CommitVariantChangesButton: dynamic(() => import("...CommitVariantChangesButton")),
 *       }}>
 *         <PlaygroundContent />
 *       </PlaygroundUIProvider>
 *     </PlaygroundEntityProvider>
 *   )
 * }
 * ```
 *
 * ## State Management
 *
 * This package does NOT export state controllers or atoms.
 * Import state from @agenta/playground:
 *
 * ```typescript
 * import { playgroundController, outputConnectionController } from "@agenta/playground"
 * import { useAtomValue } from "jotai"
 *
 * const nodes = useAtomValue(playgroundController.selectors.nodes())
 * ```
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
    // Testset selection modal (entity-based)
    TestsetSelectionModal,
    useTestsetSelection,
    TestcaseTable,
    SelectionSummary,
    // Execution metrics display
    ExecutionMetrics,
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
    type EntitySelectorConfig,
    type EntitySelection,
    type EntityType,
    type LoadEvaluatorPresetModalProps,
    // Testset selection modal types
    type TestsetSelectionModalProps,
    type TestsetSelectionMode,
    type TestsetSelectionPayload,
    type TestcaseTableProps,
    type SelectionSummaryProps,
    // Execution metrics types
    type ExecutionMetricsProps,
    type InlineTreeData,
} from "./components"

// ============================================================================
// COMPONENT TYPES
// ============================================================================

export type {ChainExecutionResult, ChainNodeInfo} from "./components/types"

// ============================================================================
// NOTE: State is NOT exported from this package
// ============================================================================
//
// For state management, import from @agenta/playground:
//
//   import { playgroundController, outputConnectionController } from "@agenta/playground"
//   import { useAtomValue, useSetAtom } from "jotai"
//
//   const nodes = useAtomValue(playgroundController.selectors.nodes())
//   const dispatch = useSetAtom(playgroundController.actions.dispatch)
//
