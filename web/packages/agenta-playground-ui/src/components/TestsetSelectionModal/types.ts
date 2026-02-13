/**
 * TestsetSelectionModal Types
 *
 * Type definitions for the testset selection modal that uses shared entity packages.
 * This modal supports both "load" (initial connection) and "edit" (modify selection) modes.
 */

import type {ModalProps} from "antd"

// ============================================================================
// CORE TYPES
// ============================================================================

/**
 * Mode for the selection modal
 * - load: Initial load of testcases into a loadable
 * - edit: Modify the selection of an already-connected loadable
 * - save: Save local loadable data as a new testset
 */
export type TestsetSelectionMode = "load" | "edit" | "save"

/**
 * Import mode - how to handle selected testcases
 * - replace: Discard current data, connect to testset, sync with selected testcases
 * - import: Keep current data, add selected testcases as new local rows (no connection change)
 */
export type TestsetImportMode = "replace" | "import"

/**
 * Payload returned when selection is confirmed (load/edit modes)
 */
export interface TestsetSelectionPayload {
    /** The revision ID that testcases are loaded from */
    revisionId: string
    /** Array of selected testcase IDs */
    selectedTestcaseIds: string[]
    /** The actual testcase data for import mode */
    testcases?: Record<string, unknown>[]
    /** Name of the testset (for display) */
    testsetName?: string
    /** Testset ID */
    testsetId?: string
    /** Revision version number */
    revisionVersion?: number
    /** Import mode - how the parent should handle the data */
    importMode: TestsetImportMode
}

/**
 * Payload returned when save is confirmed (save mode)
 */
export interface TestsetSavePayload {
    /** Name for the new testset */
    testsetName: string
    /** The new revision ID after saving */
    revisionId: string
    /** The new testset ID */
    testsetId: string
}

// ============================================================================
// COMPONENT PROPS
// ============================================================================

/**
 * Props for the main TestsetSelectionModal
 */
export interface TestsetSelectionModalProps extends Omit<ModalProps, "onCancel"> {
    /** Loadable ID for context */
    loadableId: string
    /** Current connected revision ID (for edit mode) */
    connectedRevisionId?: string
    /** Mode: 'load' for initial, 'edit' for modifying selection, 'save' for creating new testset */
    mode: TestsetSelectionMode
    /** Called when selection is confirmed (load/edit modes) */
    onConfirm: (payload: TestsetSelectionPayload) => void
    /** Called when save is confirmed (save mode) */
    onSave?: (payload: TestsetSavePayload) => void
    /** Called when cancelled */
    onCancel: () => void
    /** Default name for new testset (save mode) */
    defaultTestsetName?: string
}

/**
 * Props for the TestsetSelectionModalContent component
 * Contains the data layer logic, only rendered when modal is open
 */
export interface TestsetSelectionModalContentProps {
    /** Loadable ID for context */
    loadableId: string
    /** Current connected revision ID (for edit mode, also used to disable in picker) */
    connectedRevisionId?: string
    /** Mode: 'load' for initial, 'edit' for modifying selection, 'save' for creating new testset */
    mode: TestsetSelectionMode
    /** Called when selection is confirmed (load/edit modes) */
    onConfirm: (payload: TestsetSelectionPayload) => void
    /** Called when save is confirmed (save mode) */
    onSave?: (payload: TestsetSavePayload) => void
    /** Called when cancelled */
    onCancel: () => void
    /** Default name for new testset (save mode) */
    defaultTestsetName?: string
}

// Note: TestcaseTableProps is provided by @agenta/entity-ui and re-exported from index.ts

/**
 * Props for the SelectionSummary component (footer)
 */
export interface SelectionSummaryProps {
    /** Number of selected testcases */
    selectedCount: number
    /** Total number of available testcases */
    totalCount: number
    /** Callback when confirm is clicked */
    onConfirm: () => void
    /** Callback when cancel is clicked */
    onCancel: () => void
    /** Whether confirm is disabled */
    confirmDisabled?: boolean
    /** Text for the confirm button */
    confirmText?: string
    /** Current import mode (only used when showImportModeSelector is true) */
    importMode?: TestsetImportMode
    /** Callback when import mode changes (only used when showImportModeSelector is true) */
    onImportModeChange?: (mode: TestsetImportMode) => void
    /** Whether to show import mode selector (only when there's existing data) */
    showImportModeSelector?: boolean
    /** Whether the entire panel is disabled (e.g., viewing already connected revision) */
    disabled?: boolean
    /** Message to show when disabled */
    disabledMessage?: string
}

// ============================================================================
// HOOK TYPES
// ============================================================================

/**
 * Return type for useTestsetSelection hook
 */
export interface UseTestsetSelectionReturn {
    /** Currently selected revision ID */
    selectedRevisionId: string | null
    /** Currently selected testset ID */
    selectedTestsetId: string | null
    /** Set the selected revision and testset IDs */
    setSelection: (revisionId: string | null, testsetId: string | null) => void
    /** Information about the selected revision */
    revisionInfo: RevisionInfo | null
    /** Whether revision data is loading */
    isLoading: boolean
}

/**
 * Information about a selected revision
 */
export interface RevisionInfo {
    /** Testset name */
    testsetName: string
    /** Testset ID */
    testsetId: string
    /** Revision version number */
    version: number
}

/**
 * Return type for useTestcaseFiltering hook
 */
export interface UseTestcaseFilteringReturn {
    /** Search term */
    searchTerm: string
    /** Set search term */
    setSearchTerm: (term: string) => void
    /** Filtered testcase IDs */
    filteredIds: string[]
    /** Total count before filtering */
    totalCount: number
}
