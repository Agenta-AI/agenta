/**
 * TestsetSelectionModal
 *
 * Modal for selecting testcases from testsets using entity-layer state management.
 * Supports "load" (initial), "edit" (modify selection), and "save" (create new) modes.
 *
 * Note: TestcaseTable and TestsetPicker are now provided by @agenta/entities/ui
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

// Re-export shared component types for backwards compatibility
export type {TestcaseTableProps, TestsetPickerProps} from "@agenta/entities/ui"

// Export hooks
export {useTestsetSelection, useSaveTestset} from "./hooks"

// Export sub-components for potential reuse
export {TestsetPicker, TestcaseTable, SelectionSummary, SaveTestsetPanel} from "./components"
