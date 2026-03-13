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
 */
export type TestsetSelectionMode = "load" | "edit"

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
    /** Mode: 'load' for initial, 'edit' for modifying selection */
    mode: TestsetSelectionMode
    /** Called when selection is confirmed */
    onConfirm: (payload: TestsetSelectionPayload) => void
    /** Called when cancelled */
    onCancel: () => void
    /** Selection mode: 'single' for radio-style, 'multiple' for checkboxes (default: 'multiple') */
    selectionMode?: "single" | "multiple"
    /** Optional render prop for the create card */
    renderCreateCard?: (props: CreateCardRenderProps) => React.ReactNode
    /** Called when "Create & Load" is clicked in create mode. Returns success. */
    onCreateAndLoad?: (params: {
        testsetName: string
        commitMessage: string
    }) => Promise<{success: boolean; revisionId?: string; testsetId?: string}>
    /** Optional render prop to replace the entire right panel (search + table) */
    renderPreviewPanel?: (props: PreviewPanelRenderProps) => React.ReactNode
    /** Warning message to show in the footer (e.g., input compatibility) */
    warningMessage?: string
    /** Whether there is a compatibility warning */
    hasWarning?: boolean
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
    /** Mode: 'load' for initial, 'edit' for modifying selection */
    mode: TestsetSelectionMode
    /** Called when selection is confirmed */
    onConfirm: (payload: TestsetSelectionPayload) => void
    /** Called when cancelled */
    onCancel: () => void
    /** Selection mode: 'single' for radio-style, 'multiple' for checkboxes (default: 'multiple') */
    selectionMode?: "single" | "multiple"
    /** Optional render prop for the create card */
    renderCreateCard?: (props: CreateCardRenderProps) => React.ReactNode
    /** Called when "Create & Load" is clicked in create mode. Returns success. */
    onCreateAndLoad?: (params: {
        testsetName: string
        commitMessage: string
    }) => Promise<{success: boolean; revisionId?: string; testsetId?: string}>
    /** Optional render prop to replace the entire right panel (search + table) */
    renderPreviewPanel?: (props: PreviewPanelRenderProps) => React.ReactNode
    /** Warning message to show in the footer (e.g., input compatibility) */
    warningMessage?: string
    /** Whether there is a compatibility warning */
    hasWarning?: boolean
}

// Note: TestcaseTableProps is provided by @agenta/entity-ui and re-exported from index.ts

/**
 * Render props passed to the custom preview panel
 */
export interface PreviewPanelRenderProps {
    /** Currently selected revision ID */
    revisionId: string | null
    /** Currently selected testcase IDs */
    selectedIds: string[]
    /** Callback when selection changes */
    onSelectionChange: (ids: string[]) => void
    /** Selection mode */
    selectionMode?: "single" | "multiple"
    /** Whether selection is disabled */
    selectionDisabled?: boolean
    /** Whether the panel is in "create" mode (Build in UI) */
    isCreateMode?: boolean
    /** Callback to go back from create mode to list mode */
    onExitCreateMode?: () => void
}

/**
 * Props passed to the renderCreateCard render prop
 */
export interface CreateCardRenderProps {
    onTestsetCreated: (revisionId: string, testsetId: string) => void
    onBuildInUI: () => void
    /** Whether the modal is currently in create mode */
    isCreateMode: boolean
    /** Exit create mode and go back to list */
    onExitCreateMode: () => void
    /** Current testset name value */
    newTestsetName: string
    /** Callback when testset name changes */
    onTestsetNameChange: (name: string) => void
    /** Current commit message value */
    newTestsetCommitMessage: string
    /** Callback when commit message changes */
    onCommitMessageChange: (message: string) => void
}

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
    /** Whether the entire panel is disabled (e.g., viewing already connected revision) */
    disabled?: boolean
    /** Message to show when disabled */
    disabledMessage?: string
    /** Warning message to show (e.g., input-variable compatibility) */
    warningMessage?: string
    /** Whether there is a compatibility warning */
    hasWarning?: boolean
    /** Whether the modal is in create mode (Build in UI) */
    isCreateMode?: boolean
    /** Whether the create action is disabled */
    createDisabled?: boolean
    /** Whether the create action is loading */
    createLoading?: boolean
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
