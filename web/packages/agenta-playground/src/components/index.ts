/**
 * Playground Components exports
 *
 * All UI components for the playground feature
 */

// Leaf components
export {EmptyState} from "./EmptyState"

// Loadable entity panel
export {
    LoadableEntityPanel,
    type LoadableEntityPanelProps,
    LoadableRowCard,
    type LoadableRowCardProps,
    useLoadable,
} from "./LoadableEntityPanel"

// Input mapping modal
export {
    InputMappingModalWrapper,
    type InputMappingModalProps,
    type InputMappingModalWrapperProps,
    type EntityInfo,
    type PathInfo,
    type MappingStatusInfo,
    useMappingState,
    getMappingStatus,
    extractPathsFromValue,
    buildAvailablePaths,
    // Sub-components
    MappingLegend,
    ObjectMappingRow,
    PathSelector,
    ScalarMappingRow,
    TestRunPreview,
} from "./InputMappingModal"

// Entity selector
export {
    EntitySelectorProvider,
    EntitySelector,
    EntitySelectorModal,
    useEntitySelector,
    type EntitySelection,
    type EntitySelectorConfig,
    type EntityType,
} from "./EntitySelector"

// Load evaluator preset modal
export {
    LoadEvaluatorPresetModal,
    type LoadEvaluatorPresetModalProps,
    type SettingsPreset,
} from "./LoadEvaluatorPresetModal"

// Configuration section
export {ConfigurationSection, type ConfigurationSectionProps} from "./ConfigurationSection"

// Runnable entity panel
export {RunnableEntityPanel, type RunnableEntityPanelProps} from "./RunnableEntityPanel"

// Config panel (left panel)
export {ConfigPanel, type ConfigPanelProps, type OutputReceiverInfo} from "./ConfigPanel"

// Testcase panel (right panel)
export {TestcasePanel, type TestcasePanelProps} from "./TestcasePanel"

// Runnable columns layout (multi-column navigation)
export {
    RunnableColumnsLayout,
    type RunnableColumnsLayoutProps,
    type RunnableNode,
} from "./RunnableColumnsLayout"

// Main orchestrator
export {PlaygroundContent} from "./PlaygroundContent"

// Testset selection modal (entity-based)
export {
    TestsetSelectionModal,
    type TestsetSelectionModalProps,
    type TestsetSelectionMode,
    type TestsetSelectionPayload,
    type TestsetPickerProps,
    type TestcaseTableProps,
    type SelectionSummaryProps,
    useTestsetSelection,
    // Sub-components
    TestsetPicker,
    TestcaseTable,
    SelectionSummary,
} from "./TestsetSelectionModal"

// Execution metrics display
export {ExecutionMetrics, type ExecutionMetricsProps, type InlineTreeData} from "./ExecutionMetrics"
