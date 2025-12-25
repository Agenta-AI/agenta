import type {Column} from "@/oss/state/entities/testcase/columnState"
import type {ChangesSummary} from "@/oss/state/entities/testcase/dirtyState"
import type {DisplayRowRef} from "@/oss/state/entities/testcase/displayRows"
import type {FlattenedTestcase} from "@/oss/state/entities/testcase/schema"
import type {RevisionListItem} from "@/oss/state/entities/testset/revisionSchema"

// Re-export types for external consumers
export type {Column}
export type {ChangesSummary}
export type {DisplayRowRef}
export type {RevisionListItem}

/**
 * @deprecated Use DisplayRowRef instead - cells read from entity atoms
 */
export interface TestcaseTableRow extends FlattenedTestcase {
    key: string
    __isSkeleton?: boolean
    __isNew?: boolean
}

/**
 * Configuration options for the testcases table hook
 */
export interface UseTestcasesTableOptions {
    /** Revision ID (the URL param - what we're viewing/editing) */
    revisionId?: string | null
    /** Skip automatic initialization of empty revisions (default columns/row) */
    skipEmptyRevisionInit?: boolean
    /** Initial testset name for new testsets (when revisionId is "new") */
    initialTestsetName?: string
}

/**
 * Testset metadata (name, parent testset ID)
 */
export interface TestsetMetadata {
    /** Parent testset ID (used for saving) */
    testsetId: string
    /** Testset name */
    testsetName: string
    /** Current revision version */
    revisionVersion?: number
    /** Testset description */
    description?: string
    /** Commit message for this revision */
    commitMessage?: string
    /** Author of this revision */
    author?: string
    /** Created date */
    createdAt?: string
    /** Updated date */
    updatedAt?: string
}

/**
 * Return type for the useTestcasesTable hook
 */
export interface UseTestcasesTableResult {
    // Data - row refs (optimized: cells read from entity atoms via testcaseCellAtomFamily)
    /** Row references for table display - cells read data from entity atoms */
    rowRefs: DisplayRowRef[]
    /** List of testcase IDs (for entity atom access) */
    testcaseIds: string[]
    /** Expanded column definitions (for table display - objects expanded to sub-columns) */
    columns: Column[]
    /** Base column definitions (original columns before object expansion - for drawer/editing) */
    baseColumns: Column[]
    /** Loading state */
    isLoading: boolean
    /** Error state */
    error: Error | null

    // Metadata
    /** Testset metadata (name, testsetId, revisionVersion, description) */
    metadata: TestsetMetadata | null
    /** Testset name (editable) */
    testsetName: string
    /** Update testset name */
    setTestsetName: (name: string) => void
    /** Whether testset name has changed */
    testsetNameChanged: boolean
    /** Testset description (editable) */
    description: string
    /** Update testset description */
    setDescription: (description: string) => void
    /** Whether description has changed */
    descriptionChanged: boolean

    // Stats
    /** Total count of rows */
    totalCount: number

    // Local mutations (tracked in state, saved via bulk commit)
    /** Update a testcase field (local only) */
    updateTestcase: (rowKey: string, columnKey: string, value: unknown) => void
    /** Delete testcases by row keys */
    deleteTestcases: (rowKeys: string[]) => void
    /** Add a new testcase row */
    addTestcase: () => TestcaseTableRow
    /** Append multiple testcases from parsed data. Returns count of added rows (duplicates removed). */
    appendTestcases: (rows: Record<string, unknown>[]) => number
    /** Add a new column */
    addColumn: (columnName: string) => boolean
    /** Rename a column */
    renameColumn: (oldName: string, newName: string) => boolean
    /** Delete a column */
    deleteColumn: (columnName: string) => void

    // Save (creates new revision)
    /** Save all changes (creates new testset revision). Returns new revision ID on success, null on failure. */
    saveTestset: (commitMessage?: string) => Promise<string | null>
    /** Whether save is in progress */
    isSaving: boolean
    /** Whether there are unsaved changes */
    hasUnsavedChanges: boolean
    /** Clear all local changes */
    clearChanges: () => void
    /** Summary of pending changes for commit modal (derived from atom) */
    changesSummary: ChangesSummary

    // Search/Filter
    /** Current search term */
    searchTerm: string
    /** Update search term */
    setSearchTerm: (term: string) => void

    // Revisions
    /** Available revisions for this testset */
    availableRevisions: {id: string; version: number; created_at?: string | null}[]
    /** Whether revisions are loading */
    loadingRevisions: boolean
}

/**
 * Paginated testcases response
 */
export interface TestcasesPage {
    testcases: FlattenedTestcase[]
    count: number
    nextCursor: string | null
    hasMore: boolean
}
