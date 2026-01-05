import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {useAtomValue, useSetAtom} from "jotai"

import {
    clearChangesAtom,
    displayRowRefsAtom,
    initializeEmptyRevisionAtom,
    metadataLoadingAtom,
    revisionQueryAtom,
    saveNewTestsetAtom,
    saveTestsetAtom,
    testcase,
    testsetIdAtom,
    type FlattenedTestcase,
} from "@/oss/state/entities/testcase"
import {changesSummaryAtom, hasUnsavedChangesAtom, revision} from "@/oss/state/entities/testset"
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
    const {revisionId, skipEmptyRevisionInit = false} = options

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

    // Query atoms - reactive data fetching via atomWithQuery
    const revisionQuery = useAtomValue(revisionQueryAtom)

    // Set revision context and run all side effects via consolidated effect atom
    // This handles: setting revision ID, cleanup, column reset, row ID sync
    const runRevisionChangeEffect = useSetAtom(revisionChangeEffectAtom)
    useEffect(() => {
        runRevisionChangeEffect(revisionId ?? null)
    }, [revisionId, runRevisionChangeEffect])

    // Extract metadata loading state early (needed by initialization logic)
    const metadataLoading = useAtomValue(metadataLoadingAtom)

    // Row IDs are synced automatically via revisionChangeEffectAtom
    // which subscribes to testcaseRowIdsAtom changes
    const rowIds = useAtomValue(testcaseRowIdsAtom)

    // Trigger sync when row IDs change (data arrives from paginated fetch)
    const syncRowIds = useSetAtom(syncRowIdsToEntityAtom)
    const markFetchCompleted = useSetAtom(markFetchCompletedForRevisionAtom)

    // Sync rowIds to entities when data arrives
    useEffect(() => {
        if (rowIds.length > 0) {
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

        // Detect transition from fetching -> not fetching (query completed)
        if (wasFetching && !isCurrentlyFetching && revisionId) {
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

        // Now that fetch has completed, check if we need to initialize
        // initializeEmptyRevisionAtom will check loadedTestcaseIds.length and only
        // initialize if truly empty (no server data, no local data, no columns)
        initializeEmptyRevision()
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

    // Update testcase action - for local edits (uses controller pattern)
    const executeUpdateTestcase = useSetAtom(testcase.actions.update)

    // NOTE: Pagination is handled by InfiniteVirtualTableFeatureShell via datasetStore
    // The shell calls datasetStore.hooks.usePagination() internally
    // testcaseIdsAtom is populated by fetchData in tableStore when data arrives

    // Display row refs - derived from testcaseIdsAtom (set by fetchData)
    const displayRowRefs = useAtomValue(displayRowRefsAtom)
    const testcaseIds = displayRowRefs
        .filter((row) => !row.__isNew && row.id)
        .map((row) => row.id as string)

    // =========================================================================
    // COLUMN STATE (via revision controller)
    // Columns are derived directly from entity/server data - no useEffect sync needed
    // Note: Column reset and v0 draft init are handled by revisionChangeEffectAtom
    // Uses expandedColumns for dynamic object expansion (e.g., "event" -> "event.type", "event.date")
    // =========================================================================
    const columnsAtom = useMemo(() => revision.selectors.columns(revisionId ?? ""), [revisionId])
    const expandedColumnsAtom = useMemo(
        () => revision.selectors.expandedColumns(revisionId ?? ""),
        [revisionId],
    )
    const baseColumns = useAtomValue(columnsAtom) // Original columns (for drawer/editing)
    const columns = useAtomValue(expandedColumnsAtom) // Expanded columns (for table display)

    // Check if revision data suggests columns should exist but haven't been derived yet
    // This catches the gap between data arriving and columns being populated
    const revisionData = revisionQuery.data
    // Check various indicators that testcases exist:
    // 1. flags.has_testcases - explicit boolean from backend
    // 2. data.testcases array - inline testcases (when include_testcases=true)
    // 3. data.testcase_ids array - list of testcase references
    const revisionHasColumnData =
        revisionData &&
        (revisionData.flags?.has_testcases === true ||
            (revisionData.data?.testcases && revisionData.data.testcases.length > 0) ||
            (revisionData.data?.testcase_ids && revisionData.data.testcase_ids.length > 0))
    const stillDerivingColumns = columns.length === 0 && revisionHasColumnData

    // Combined loading state - true when any data source is still loading
    // This prevents empty state flash between different loading phases:
    // 1. metadataLoading - testset metadata query
    // 2. isFetching - paginated store fetching rows
    // 3. revisionQuery.isPending - revision data (columns come from here)
    // 4. !hasInitialFetchCompleted - initial data sync not yet complete
    // 5. stillDerivingColumns - revision has data but columns not yet derived
    const combinedIsLoading =
        metadataLoading ||
        isFetching ||
        revisionQuery.isPending ||
        !hasInitialFetchCompleted ||
        stillDerivingColumns

    const addColumn = useSetAtom(revision.actions.addColumn)
    const deleteColumn = useSetAtom(revision.actions.deleteColumn)
    const renameColumnAction = useSetAtom(revision.actions.renameColumn)

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
            executeUpdateTestcase(rowKey, {[columnKey]: value} as Partial<FlattenedTestcase>)
        },
        [executeUpdateTestcase],
    )

    /**
     * Delete testcases - uses testcase.actions.delete
     */
    const executeDeleteTestcases = useSetAtom(testcase.actions.delete)
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
     * Add a new testcase - uses testcase.actions.add
     */
    const executeAddTestcase = useSetAtom(testcase.actions.add)
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
     * Append multiple testcases - uses testcase.actions.append
     */
    const executeAppendTestcases = useSetAtom(testcase.actions.append)
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
     * @param params - For new testsets: {testsetName: string, commitMessage?: string}. For existing: {commitMessage?: string}
     * @returns New revision ID on success, null on failure
     */
    const executeSave = useSetAtom(saveTestsetAtom)
    const executeSaveNewTestset = useSetAtom(saveNewTestsetAtom)
    const saveTestset = useCallback(
        async (params?: {testsetName?: string; commitMessage?: string}): Promise<string | null> => {
            if (!projectId) {
                console.error("[useTestcasesTable] Missing projectId")
                return null
            }

            // For new testsets, use saveNewTestsetAtom
            if (isNewTestset) {
                const testsetName = params?.testsetName
                if (!testsetName?.trim()) {
                    console.error("[useTestcasesTable] Missing testset name for new testset")
                    return null
                }

                setIsSaving(true)
                try {
                    const result = await executeSaveNewTestset({
                        projectId,
                        testsetName,
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
                    commitMessage: params?.commitMessage,
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
        [projectId, testsetId, revisionId, executeSave, executeSaveNewTestset, isNewTestset],
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
        // Use combined loading state (includes revisionQuery.isPending for columns)
        isLoading: combinedIsLoading,
        error: revisionQuery.error as Error | null,

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
    }
}
