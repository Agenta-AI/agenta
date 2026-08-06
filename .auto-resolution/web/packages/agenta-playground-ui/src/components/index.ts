/**
 * Playground Components exports
 *
 * All UI components for the playground feature
 */

// Leaf components
export {EmptyState} from "./EmptyState"

// Entity selector
export {
    EntitySelector,
    EntitySelectorModal,
    EntitySelectorProvider,
    useEntitySelector,
    type EntitySelection,
    type EntitySelectorConfig,
    type EntityType,
} from "./EntitySelector"

// Execution result view (unified completion result renderer)
export {default as ExecutionResultView} from "./ExecutionResultView"

// Execution header (unified single + comparison header)
export {default as ExecutionHeader} from "./ExecutionHeader"
export type {ExecutionHeaderProps} from "./ExecutionHeader"

// Tool call view
export {default as ToolCallView, ToolCallViewHeader, createToolCallPayloads} from "./ToolCallView"

// Chat controls
export {default as ControlsBar, type ControlsBarProps} from "./ControlsBar"

// Playground outputs (Outputs panel — header + single/comparison body)
export {default as PlaygroundOutputs} from "./PlaygroundOutputs"
export type {PlaygroundOutputsProps} from "./PlaygroundOutputs"

// Execution items. ChatMode/CompletionMode are code-split inside ExecutionItems and the
// comparison view is loaded on demand by its consumers via the subpath entry — neither is
// re-exported here, because a barrel value re-export would statically pull them into every
// chunk that imports this entry (the package has no sideEffects config to tree-shake it).
export {
    default as ExecutionItems,
    GatewayToolAssistantActions,
    GatewayToolExecuteButton,
    type ChatModeProps,
    type CompletionModeProps,
    type PlaygroundGenerationsProps as ExecutionItemsProps,
    type ExecutionRowProps,
} from "./ExecutionItems"

// Testset selection modal (entity-based, for load/edit modes)
// For saving new testsets, use EntityCommitModal from @agenta/entity-ui with renderModeContent
export {
    CreateTestsetCard,
    SelectionSummary,
    TestcaseTable,
    TestsetSelectionModal,
    useTestsetSelection,
    type CreateCardRenderProps,
    type PreviewPanelRenderProps,
    type SelectionSummaryProps,
    type TestcaseTableProps,
    type TestsetSelectionModalProps,
    type TestsetSelectionMode,
    type TestsetSelectionPayload,
} from "./TestsetSelectionModal"
