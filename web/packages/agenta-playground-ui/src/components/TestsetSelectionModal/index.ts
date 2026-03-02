/**
 * TestsetSelectionModal
 *
 * Modal for selecting testcases from testsets using entity-layer state management.
 * Supports "load" (initial), "edit" (modify selection), and "save" (create new) modes.
 */

export {TestsetSelectionModal, default} from "./TestsetSelectionModal"
export type {
    TestsetSelectionModalProps,
    TestsetSelectionModalContentProps,
    TestsetSelectionMode,
    TestsetSelectionPayload,
    TestsetSavePayload,
    SelectionSummaryProps,
    UseTestsetSelectionReturn,
    RevisionInfo,
} from "./types"

// Re-export TestcaseTable type from shared entities
export type {TestcaseTableProps} from "@agenta/entity-ui"

// Export hooks
export {useTestsetSelection, useSaveTestset} from "./hooks"

// Export sub-components for potential reuse
export {TestcaseTable, SelectionSummary, SaveTestsetPanel} from "./components"
