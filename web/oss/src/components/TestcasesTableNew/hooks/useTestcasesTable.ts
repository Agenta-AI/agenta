import {useCallback, useEffect, useState} from "react"

import {useAtomValue, useSetAtom} from "jotai"

import {
    addColumnAtom,
    currentColumnsAtom,
    deleteColumnAtom,
    renameColumnAtom,
} from "@/oss/state/entities/testcase/columnState"
import {displayRowRefsAtom} from "@/oss/state/entities/testcase/displayRows"
import {initializeV0DraftAtom} from "@/oss/state/entities/testcase/editSession"
import {
    addTestcaseAtom,
    appendTestcasesAtom,
    clearChangesAtom,
    deleteTestcasesAtom,
    saveTestsetAtom,
} from "@/oss/state/entities/testcase/mutations"
import {
    metadataLoadingAtom,
    revisionQueryAtom,
    revisionsListQueryAtom,
    testsetIdAtom,
    testsetMetadataAtom,
    testsetNameQueryAtom,
} from "@/oss/state/entities/testcase/queries"
import type {FlattenedTestcase} from "@/oss/state/entities/testcase/schema"
import {updateTestcaseAtom} from "@/oss/state/entities/testcase/testcaseEntity"
import {
    changesSummaryAtom,
    hasUnsavedChangesAtom,
    revisionDraftAtomFamily,
    revisionEntityAtomFamily,
    revisionHasDraftAtomFamily,
} from "@/oss/state/entities/testset"
import {projectIdAtom} from "@/oss/state/project/selectors/project"

import {
    revisionChangeEffectAtom,
    syncRowIdsToEntityAtom,
    testcaseRowIdsAtom,
    testcasesSearchTermAtom,
} from "../atoms/tableStore"

import type {TestcaseTableRow, UseTestcasesTableOptions, UseTestcasesTableResult} from "./types"

// Re-export types for external consumers
export type {
    TestcaseTableRow,
    TestsetMetadata,
    UseTestcasesTableOptions,
    UseTestcasesTableResult,
} from "./types"

/**
 * Main hook for testcases table state management
 *
 * **Git-based revision model:**
 * - Fetches entire revision (all testcases at once)
 * - Tracks edits in local state via useEditableTable
 * - Save creates new revision (not individual updates)
 *
 * @example
 * ```tsx
 * function TestcasesTable() {
 *   const table = useTestcasesTable({ revisionId })
 *
 *   return (
 *     <>
 *       <Input
 *         value={table.testsetName}
 *         onChange={(e) => table.setTestsetName(e.target.value)}
 *       />
 *       <Button
 *         onClick={table.saveTestset}
 *         disabled={!table.hasUnsavedChanges}
 *       >
 *         Save Testset
 *       </Button>
 *       <Table dataSource={table.filteredTestcases} />
 *     </>
 *   )
 * }
 * ```
 */
export function useTestcasesTable(options: UseTestcasesTableOptions = {}): UseTestcasesTableResult {
    const projectId = useAtomValue(projectIdAtom)
    const {revisionId} = options

    // Search state - synced with tableStore atom
    const searchTerm = useAtomValue(testcasesSearchTermAtom)
    const setSearchTermAtom = useSetAtom(testcasesSearchTermAtom)
    const setSearchTerm = useCallback(
        (term: string) => setSearchTermAtom(term),
        [setSearchTermAtom],
    )

    // Save state
    const [isSaving, setIsSaving] = useState(false)

    // Revision entity - uses entity pattern directly
    // Server data merged with local draft
    const revisionEntity = useAtomValue(
        revisionId ? revisionEntityAtomFamily(revisionId) : revisionEntityAtomFamily(""),
    )
    const _hasDraft = useAtomValue(
        revisionId ? revisionHasDraftAtomFamily(revisionId) : revisionHasDraftAtomFamily(""),
    )
    const setDraft = useSetAtom(
        revisionId ? revisionDraftAtomFamily(revisionId) : revisionDraftAtomFamily(""),
    )

    // Query atoms - reactive data fetching via atomWithQuery
    const revisionQuery = useAtomValue(revisionQueryAtom)
    const testsetNameQuery = useAtomValue(testsetNameQueryAtom)
    const revisionsListQuery = useAtomValue(revisionsListQueryAtom)

    // Derived values from entity
    // For v0, revision name may be empty, so fall back to testset name from query
    const testsetName = revisionEntity?.name || testsetNameQuery.data || ""
    const description = revisionEntity?.description ?? ""

    // Write functions using entity draft pattern
    const setLocalName = useCallback(
        (name: string) => {
            setDraft((prev) => ({...prev, name}))
        },
        [setDraft],
    )
    const setLocalDesc = useCallback(
        (desc: string) => {
            setDraft((prev) => ({...prev, description: desc}))
        },
        [setDraft],
    )

    // Dirty state from draft
    const getDraft = useAtomValue(
        revisionId ? revisionDraftAtomFamily(revisionId) : revisionDraftAtomFamily(""),
    )
    const testsetNameChanged = getDraft?.name !== undefined
    const descriptionChanged = getDraft?.description !== undefined

    // Set revision context and run all side effects via consolidated effect atom
    // This handles: setting revision ID, cleanup, column reset, v0 draft init
    const runRevisionChangeEffect = useSetAtom(revisionChangeEffectAtom)
    useEffect(() => {
        runRevisionChangeEffect(revisionId ?? null)
    }, [revisionId, runRevisionChangeEffect])

    // Sync row IDs from datasetStore to entity atoms
    // This runs AFTER the query settles and data is in the cache
    const rowIds = useAtomValue(testcaseRowIdsAtom)
    const syncRowIds = useSetAtom(syncRowIdsToEntityAtom)
    useEffect(() => {
        if (rowIds.length > 0) {
            syncRowIds()
        }
    }, [rowIds, syncRowIds])

    // Initialize v0 draft when revision query completes (for new testsets)
    // This is the single point of initialization for v0 revisions
    const initializeV0Draft = useSetAtom(initializeV0DraftAtom)
    useEffect(() => {
        if (!revisionQuery.isPending && revisionId && revisionQuery.data) {
            initializeV0Draft()
        }
    }, [revisionQuery.isPending, revisionQuery.data, revisionId, initializeV0Draft])

    // Extract data from query atoms
    const testsetId = useAtomValue(testsetIdAtom)
    const availableRevisions = revisionsListQuery.data ?? []
    const loadingRevisions = revisionsListQuery.isPending

    // Metadata from query atoms (automatically updates when queries complete)
    const metadata = useAtomValue(testsetMetadataAtom)
    const metadataLoading = useAtomValue(metadataLoadingAtom)

    // Update testcase atom - for local edits
    const executeUpdateTestcase = useSetAtom(updateTestcaseAtom)

    // NOTE: Pagination is handled by InfiniteVirtualTableFeatureShell via datasetStore
    // The shell calls datasetStore.hooks.usePagination() internally
    // testcaseIdsAtom is populated by fetchData in tableStore when data arrives

    // Display row refs - derived from testcaseIdsAtom (set by fetchData)
    const displayRowRefs = useAtomValue(displayRowRefsAtom)
    const testcaseIds = displayRowRefs
        .filter((row) => !row.__isNew && row.id)
        .map((row) => row.id as string)

    // =========================================================================
    // COLUMN STATE (from atoms instead of useEditableTable)
    // Columns are derived directly from entity/server data - no useEffect sync needed
    // Note: Column reset and v0 draft init are handled by revisionChangeEffectAtom
    // =========================================================================
    const columns = useAtomValue(currentColumnsAtom)
    const addColumn = useSetAtom(addColumnAtom)
    const deleteColumn = useSetAtom(deleteColumnAtom)
    const renameColumnAction = useSetAtom(renameColumnAtom)

    /**
     * Row refs for table display
     * Filtering by search term is handled at the component level
     * since row refs don't contain cell data (cells read from entity atoms)
     */
    const totalCount = displayRowRefs.length

    /**
     * Update a testcase cell
     * Uses updateTestcaseAtom from entity layer
     */
    const updateTestcase = useCallback(
        (rowKey: string, columnKey: string, value: unknown) => {
            executeUpdateTestcase({
                id: rowKey,
                updates: {[columnKey]: value} as Partial<FlattenedTestcase>,
            })
        },
        [executeUpdateTestcase],
    )

    /**
     * Delete testcases - uses deleteTestcasesAtom
     */
    const executeDeleteTestcases = useSetAtom(deleteTestcasesAtom)
    const deleteTestcases = useCallback(
        (rowKeys: string[]) => executeDeleteTestcases(rowKeys),
        [executeDeleteTestcases],
    )

    /**
     * Rename a column - uses renameColumnAtom
     */
    const renameColumn = useCallback(
        (oldName: string, newName: string): boolean => renameColumnAction({oldName, newName}),
        [renameColumnAction],
    )

    /**
     * Add a new testcase - uses addTestcaseAtom
     */
    const executeAddTestcase = useSetAtom(addTestcaseAtom)
    const addTestcase = useCallback((): TestcaseTableRow => {
        const result = executeAddTestcase()
        return {
            ...result.data,
            key: result.id,
            __isSkeleton: false,
            __isNew: true,
        }
    }, [executeAddTestcase])

    /**
     * Append multiple testcases - uses appendTestcasesAtom
     */
    const executeAppendTestcases = useSetAtom(appendTestcasesAtom)
    const appendTestcases = useCallback(
        (rows: Record<string, unknown>[]): number => executeAppendTestcases(rows),
        [executeAppendTestcases],
    )

    /**
     * Clear all local changes - uses clearChangesAtom
     */
    const executeClearChanges = useSetAtom(clearChangesAtom)
    const clearChanges = useCallback(() => executeClearChanges(), [executeClearChanges])

    /**
     * Save all changes - uses saveTestsetAtom mutation
     * @returns New revision ID on success, null on failure
     */
    const executeSave = useSetAtom(saveTestsetAtom)
    const saveTestset = useCallback(
        async (commitMessage?: string): Promise<string | null> => {
            if (!projectId || !testsetId) {
                console.error("[useTestcasesTable] Missing projectId or testsetId")
                return null
            }

            setIsSaving(true)
            try {
                const result = await executeSave({
                    projectId,
                    testsetId,
                    revisionId,
                    commitMessage,
                })

                if (result.success && result.newRevisionId) {
                    // Invalidate revisions query so the list updates
                    // Note: atomWithQuery doesn't expose refetch - use queryClient.invalidateQueries instead
                    return result.newRevisionId
                }

                if (result.error) {
                    throw result.error
                }

                return null
            } finally {
                setIsSaving(false)
            }
        },
        [projectId, testsetId, revisionId, executeSave],
    )

    /**
     * Get summary of pending changes for commit modal
     * Now derived from changesSummaryAtom - no useCallback needed
     */
    const changesSummary = useAtomValue(changesSummaryAtom)

    /**
     * Check if there are any unsaved changes
     * Uses entity-level hasUnsavedChangesAtom which combines:
     * - Cell edits (entity vs server comparison)
     * - Column changes (current vs server column keys)
     * - Edit session (new/deleted rows)
     * - Metadata changes (name/description)
     */
    const hasUnsavedChanges = useAtomValue(hasUnsavedChangesAtom)

    return {
        // Data - row refs (optimized: cells read from entity atoms)
        rowRefs: displayRowRefs,
        testcaseIds, // IDs for entity atom access
        columns,
        isLoading: metadataLoading,
        error: (revisionQuery.error || testsetNameQuery.error) as Error | null,

        // Metadata
        metadata,
        testsetName,
        setTestsetName: setLocalName,
        testsetNameChanged,
        description,
        setDescription: setLocalDesc,
        descriptionChanged,

        // Stats
        totalCount,

        // Mutations
        updateTestcase,
        deleteTestcases,
        addTestcase,
        appendTestcases,
        addColumn,
        renameColumn,
        deleteColumn,

        // Save
        saveTestset,
        isSaving,
        hasUnsavedChanges,
        clearChanges,
        changesSummary,

        // Search/Filter
        searchTerm,
        setSearchTerm,

        // Revisions
        availableRevisions,
        loadingRevisions,
    }
}
