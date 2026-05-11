/**
 * TestsetSelectionModal
 *
 * Modal for selecting testcases from testsets using entity-layer state management.
 * Supports "load" (initial connection) and "edit" (modify selection) modes.
 *
 * For saving new testsets, use EntityCommitModal from @agenta/entity-ui.
 */

export {default, TestsetSelectionModal} from "./TestsetSelectionModal"
export type {
    CreateCardRenderProps,
    PreviewPanelRenderProps,
    RevisionInfo,
    SelectionSummaryProps,
    TestsetSelectionModalContentProps,
    TestsetSelectionModalProps,
    TestsetSelectionMode,
    TestsetSelectionPayload,
    UseTestsetSelectionReturn,
} from "./types"

// Re-export TestcaseTable type from shared entities
export type {TestcaseTableProps} from "@agenta/entity-ui"

// Export hooks
export {useTestsetSelection} from "./hooks"

// Export sub-components for potential reuse
export {CreateTestsetCard, SelectionSummary, TestcaseTable} from "./components"
