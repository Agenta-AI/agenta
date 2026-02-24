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
export {createToolCallPayloads, default as ToolCallView, ToolCallViewHeader} from "./ToolCallView"

// Chat controls
export {default as ControlsBar, type ControlsBarProps} from "./ControlsBar"

// Focus drawer
export {default as PlaygroundFocusDrawer} from "./FocusDrawer"

// Execution items
export {
    ChatMode,
    ChatTurnView,
    CompletionMode,
    default as ExecutionItems,
    ExecutionRow,
    type ChatModeProps,
    type CompletionModeProps,
    type PlaygroundGenerationsProps as ExecutionItemsProps,
    type ExecutionRowProps,
} from "./ExecutionItems"

// Execution item comparison view
export {
    GenerationComparisonChatOutput,
    GenerationComparisonCompletionOutput,
    GenerationComparisonInputHeader,
    GenerationComparisonOutput,
    GenerationComparisonOutputHeader,
} from "./ExecutionItemComparisonView"

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
