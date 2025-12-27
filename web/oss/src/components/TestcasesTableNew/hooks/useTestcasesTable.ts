import {useCallback, useEffect, useRef, useState} from "react"

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
    hasInitialFetchCompletedAtom,
    markFetchCompletedForRevisionAtom,
    revisionChangeEffectAtom,
    setDebouncedSearchTermAtom,
    syncRowIdsToEntityAtom,
    tableQueryFetchingAtom,
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

    // Extract metadata loading state early (needed by initialization logic)
    const metadata = useAtomValue(testsetMetadataAtom)
    const metadataLoading = useAtomValue(metadataLoadingAtom)

    // Row IDs are synced automatically via revisionChangeEffectAtom
    // which subscribes to testcaseRowIdsAtom changes
    const rowIds = useAtomValue(testcaseRowIdsAtom)

    // Trigger sync when row IDs change (data arrives from paginated fetch)
    const syncRowIds = useSetAtom(syncRowIdsToEntityAtom)
    const markFetchCompleted = useSetAtom(markFetchCompletedForRevisionAtom)

    // Sync rowIds to entities when data arrives
    useEffect(() => {
        console.log("[useTestcasesTable] Sync effect running:", {
            revisionId,
            rowIdsLength: rowIds.length,
        })

        if (rowIds.length > 0) {
            console.log("[useTestcasesTable] Syncing rowIds to entities")
            syncRowIds()
        }
    }, [rowIds, syncRowIds, revisionId])

    // Monitor table query fetching state and mark fetch completed when query finishes
    // This works for both empty and non-empty revisions by watching the actual query state
    const isFetching = useAtomValue(tableQueryFetchingAtom)
    const prevFetchingRef = useRef(isFetching)

    useEffect(() => {
        const wasFetching = prevFetchingRef.current
        const isCurrentlyFetching = isFetching

        console.log("[useTestcasesTable] Query state:", {
            revisionId,
            wasFetching,
            isCurrentlyFetching,
            rowIdsLength: rowIds.length,
        })

        // Detect transition from fetching -> not fetching (query completed)
        if (wasFetching && !isCurrentlyFetching && revisionId) {
            console.log(
                "[useTestcasesTable] Query completed, marking fetch done:",
                revisionId,
                "rowIds:",
                rowIds.length,
            )
            markFetchCompleted()
        }

        prevFetchingRef.current = isCurrentlyFetching
    }, [isFetching, revisionId, markFetchCompleted, rowIds.length])

    // Initialize empty revision ONLY after initial fetch completes
    // This ensures testcasesAlreadyLoaded check in initializeEmptyRevisionAtom is accurate
    const initializeEmptyRevision = useSetAtom(initializeEmptyRevisionAtom)
    const hasInitialFetchCompleted = useAtomValue(hasInitialFetchCompletedAtom)

    useEffect(() => {
        if (skipEmptyRevisionInit) return
        if (!revisionId) return
        if (revisionQuery.isPending) return
        if (!revisionQuery.data) return
        if (!hasInitialFetchCompleted) return // Wait for fetch to complete

        console.log("[useTestcasesTable] Running initialization check for revision:", revisionId)

        // Now that fetch has completed, check if we need to initialize
        // initializeEmptyRevisionAtom will check loadedTestcaseIds.length and only
        // initialize if truly empty (no server data, no local data, no columns)
        const wasInitialized = initializeEmptyRevision()

        console.log("[useTestcasesTable] Initialization result:", {
            revisionId,
            wasInitialized,
        })
    }, [
        skipEmptyRevisionInit,
        revisionId,
        revisionQuery.isPending,
        revisionQuery.data,
        hasInitialFetchCompleted,
        initializeEmptyRevision,
    ])

    // Extract data from query atoms
    const testsetId = useAtomValue(testsetIdAtom)
    const availableRevisions = revisionsListQuery.data ?? []
    const loadingRevisions = revisionsListQuery.isPending

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
    const baseColumns = useAtomValue(currentColumnsAtom) // Original columns (for drawer/editing)
    const columns = useAtomValue(expandedColumnsAtom) // Expanded columns (for table display)
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
        columns, // Expanded columns for table display
        baseColumns, // Original columns for drawer/editing
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
