import {useCallback, useEffect, useMemo, useState} from "react"

import {useAtomValue, useSetAtom} from "jotai"

import {
    addColumnAtom,
    currentColumnsAtom,
    deleteColumnAtom,
    expandedColumnsAtom,
    renameColumnAtom,
} from "@/oss/state/entities/testcase/columnState"
import {displayRowRefsAtom} from "@/oss/state/entities/testcase/displayRows"
import {initializeEmptyRevisionAtom} from "@/oss/state/entities/testcase/editSession"
import {
    addTestcaseAtom,
    appendTestcasesAtom,
    clearChangesAtom,
    deleteTestcasesAtom,
    saveNewTestsetAtom,
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
    setDebouncedSearchTermAtom,
    syncRowIdsToEntityAtom,
    testcaseRowDataMapAtom,
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
    const {revisionId, skipEmptyRevisionInit = false, initialTestsetName} = options

    // Check if this is a new testset (not yet saved to server)
    const isNewTestset = revisionId === "new"

    // Search state - synced with tableStore atom
    // Note: searchTerm is immediate (for UI), but API calls are debounced (300ms)
    const searchTerm = useAtomValue(testcasesSearchTermAtom)
    const setSearchTermDebounced = useSetAtom(setDebouncedSearchTermAtom)
    const setSearchTerm = useCallback(
        (term: string) => setSearchTermDebounced(term),
        [setSearchTermDebounced],
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
    // For new testsets, use initialTestsetName
    const testsetName = isNewTestset
        ? revisionEntity?.name || initialTestsetName || ""
        : revisionEntity?.name || testsetNameQuery.data || ""
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
    // This handles: setting revision ID, cleanup, column reset, row ID sync
    const runRevisionChangeEffect = useSetAtom(revisionChangeEffectAtom)
    useEffect(() => {
        runRevisionChangeEffect(revisionId ?? null)
    }, [revisionId, runRevisionChangeEffect])

    // Initialize new testset with name from URL params
    useEffect(() => {
        if (isNewTestset && initialTestsetName && revisionId) {
            setDraft((prev) => ({...prev, name: initialTestsetName}))
        }
    }, [isNewTestset, initialTestsetName, revisionId, setDraft])

    // Row IDs are synced automatically via revisionChangeEffectAtom
    // which subscribes to testcaseRowIdsAtom changes
    const rowIds = useAtomValue(testcaseRowIdsAtom)

    // Trigger sync when row IDs change (data arrives from paginated fetch)
    const syncRowIds = useSetAtom(syncRowIdsToEntityAtom)
    // Using useMemo to avoid creating effect - sync happens synchronously when rowIds change
    useMemo(() => {
        if (rowIds.length > 0) {
            syncRowIds()
        }
    }, [rowIds, syncRowIds])

    // Initialize empty revision when revision query completes
    // This is the single point of initialization for empty revisions (any version)
    // Adds default columns and one empty row to improve UX
    // Can be skipped via skipEmptyRevisionInit option (e.g., for TestsetDrawer which manages its own columns)
    const initializeEmptyRevision = useSetAtom(initializeEmptyRevisionAtom)
    useEffect(() => {
        if (skipEmptyRevisionInit) return
        if (!revisionQuery.isPending && revisionId && revisionQuery.data) {
            initializeEmptyRevision()
        }
    }, [
        skipEmptyRevisionInit,
        revisionQuery.isPending,
        revisionQuery.data,
        revisionId,
        initializeEmptyRevision,
    ])

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
    // Uses expandedColumnsAtom for dynamic object expansion (e.g., "event" -> "event.type", "event.date")
    // =========================================================================
    const _baseColumns = useAtomValue(currentColumnsAtom) // Keep for potential future use
    const columns = useAtomValue(expandedColumnsAtom)
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
     * Rename a column - uses renameColumnAtom with row data from datasetStore
     */
    const rowDataMap = useAtomValue(testcaseRowDataMapAtom)
    const renameColumn = useCallback(
        (oldName: string, newName: string): boolean =>
            renameColumnAction({oldName, newName, rowDataMap}),
        [renameColumnAction, rowDataMap],
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
     * Save all changes - uses saveTestsetAtom mutation for existing testsets
     * or saveNewTestsetAtom for new testsets
     * @returns New revision ID on success, null on failure
     */
    const executeSave = useSetAtom(saveTestsetAtom)
    const executeSaveNewTestset = useSetAtom(saveNewTestsetAtom)
    const saveTestset = useCallback(
        async (commitMessage?: string): Promise<string | null> => {
            if (!projectId) {
                console.error("[useTestcasesTable] Missing projectId")
                return null
            }

            // For new testsets, use saveNewTestsetAtom
            if (isNewTestset) {
                const nameToSave = getDraft?.name || initialTestsetName || ""
                if (!nameToSave.trim()) {
                    console.error("[useTestcasesTable] Missing testset name for new testset")
                    return null
                }

                setIsSaving(true)
                try {
                    const result = await executeSaveNewTestset({
                        projectId,
                        testsetName: nameToSave,
                    })

                    if (result.success && result.revisionId) {
                        return result.revisionId
                    }

                    if (result.error) {
                        throw result.error
                    }

                    return null
                } finally {
                    setIsSaving(false)
                }
            }

            // For existing testsets, use patch API
            if (!testsetId) {
                console.error("[useTestcasesTable] Missing testsetId")
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
        [
            projectId,
            testsetId,
            revisionId,
            executeSave,
            executeSaveNewTestset,
            isNewTestset,
            getDraft,
            initialTestsetName,
        ],
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
