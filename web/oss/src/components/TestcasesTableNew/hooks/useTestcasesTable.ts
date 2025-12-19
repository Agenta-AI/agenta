import {useCallback, useEffect, useMemo, useState} from "react"

import {keepPreviousData, useInfiniteQuery} from "@tanstack/react-query"
import {useAtomValue, useSetAtom} from "jotai"

import {
    addColumnAtom,
    currentColumnsAtom,
    deleteColumnAtom,
    renameColumnAtom,
    resetColumnsAtom,
} from "@/oss/state/entities/testcase/columnState"
import {changesSummaryAtom, hasUnsavedChangesAtom} from "@/oss/state/entities/testcase/dirtyState"
import {displayRowRefsAtom} from "@/oss/state/entities/testcase/displayRows"
import {
    currentRevisionIdAtom,
    initializeV0DraftAtom,
} from "@/oss/state/entities/testcase/editSession"
import {
    addTestcaseAtom,
    appendTestcasesAtom,
    clearChangesAtom,
    deleteTestcasesAtom,
    saveTestsetAtom,
} from "@/oss/state/entities/testcase/mutations"
import {
    currentRevisionIdAtom as queryCurrentRevisionIdAtom,
    fetchTestcasesPage,
    metadataLoadingAtom,
    revisionQueryAtom,
    revisionsListQueryAtom,
    testsetIdAtom,
    testsetMetadataAtom,
    testsetNameQueryAtom,
} from "@/oss/state/entities/testcase/queries"
import type {FlattenedTestcase} from "@/oss/state/entities/testcase/schema"
import {testcaseStore} from "@/oss/state/entities/testcase/store"
import {setTestcaseIdsAtom} from "@/oss/state/entities/testcase/testcaseEntity"
import {
    currentDescriptionAtom,
    currentTestsetNameAtom,
    descriptionChangedAtom,
    setLocalDescriptionAtom,
    setLocalTestsetNameAtom,
    testsetNameChangedAtom,
} from "@/oss/state/entities/testcase/testsetMetadata"
import {projectIdAtom} from "@/oss/state/project/selectors/project"

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

    // Search state
    const [searchTerm, setSearchTerm] = useState("")

    // Save state
    const [isSaving, setIsSaving] = useState(false)

    // Testset metadata atoms - local edits stored in atoms
    const setLocalName = useSetAtom(setLocalTestsetNameAtom)
    const setLocalDesc = useSetAtom(setLocalDescriptionAtom)
    const testsetName = useAtomValue(currentTestsetNameAtom)
    const description = useAtomValue(currentDescriptionAtom)
    const testsetNameChanged = useAtomValue(testsetNameChangedAtom)
    const descriptionChanged = useAtomValue(descriptionChangedAtom)

    // Set revision context for query atoms FIRST (before reading query atoms)
    const setQueryRevisionId = useSetAtom(queryCurrentRevisionIdAtom)
    useEffect(() => {
        setQueryRevisionId(revisionId ?? null)
    }, [revisionId, setQueryRevisionId])

    // Query atoms - reactive data fetching via atomWithQuery
    const revisionQuery = useAtomValue(revisionQueryAtom)
    const testsetNameQuery = useAtomValue(testsetNameQueryAtom)
    const revisionsListQuery = useAtomValue(revisionsListQueryAtom)

    // Extract data from query atoms
    const testsetId = useAtomValue(testsetIdAtom)
    const availableRevisions = revisionsListQuery.data ?? []
    const loadingRevisions = revisionsListQuery.isPending

    // Metadata from query atoms (automatically updates when queries complete)
    const metadata = useAtomValue(testsetMetadataAtom)
    const metadataLoading = useAtomValue(metadataLoadingAtom)

    // Entity store - for local edits only (server data lives in serverTestcasesAtom)
    const updateEntity = useSetAtom(testcaseStore.updateAtom)

    /**
     * Paginated testcases query using useInfiniteQuery
     * Uses revisionId to fetch testcases for the specific revision being viewed
     * Hydrates entity store when data arrives (per entity store pattern from README)
     */
    const queryEnabled = Boolean(projectId && revisionId)

    const testcasesQuery = useInfiniteQuery({
        queryKey: ["testcases-paginated", projectId, revisionId],
        queryFn: async ({pageParam}) => {
            if (!projectId || !revisionId) {
                return {testcases: [], count: 0, nextCursor: null, hasMore: false}
            }
            const result = await fetchTestcasesPage(projectId, revisionId, pageParam)
            // NOTE: We don't upsertMany here anymore.
            // Server data goes to serverTestcasesAtom (for display + dirty comparison)
            // Entity store only gets data when user creates/edits rows
            return result
        },
        initialPageParam: null as string | null,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        enabled: queryEnabled,
        staleTime: 30_000,
        placeholderData: keepPreviousData,
    })

    /**
     * Extract testcase IDs from all pages
     */
    const testcaseIds = useMemo(() => {
        if (!testcasesQuery.data?.pages) return []
        return testcasesQuery.data.pages
            .flatMap((page) => page.testcases)
            .map((tc) => tc.id)
            .filter(Boolean) as string[]
    }, [testcasesQuery.data?.pages])

    /**
     * Total count from first page
     */
    const serverTotalCount = testcasesQuery.data?.pages[0]?.count ?? 0

    /**
     * Whether there are more pages to load
     */
    const hasMorePages = testcasesQuery.hasNextPage

    /**
     * Load next page callback
     */
    const loadNextPage = useCallback(() => {
        if (hasMorePages && !testcasesQuery.isFetchingNextPage) {
            testcasesQuery.fetchNextPage()
        }
    }, [hasMorePages, testcasesQuery])

    /**
     * Reset pages callback (for refresh)
     */
    const resetPages = useCallback(() => {
        testcasesQuery.refetch()
    }, [testcasesQuery])

    // Set testcase IDs when data arrives (triggers entity atom initialization)
    const setTestcaseIds = useSetAtom(setTestcaseIdsAtom)
    useEffect(() => {
        if (testcaseIds.length > 0) {
            setTestcaseIds(testcaseIds)
        }
    }, [testcaseIds, setTestcaseIds])

    // Set revision context for all revision-scoped atoms
    // This is the ONLY thing needed - atoms are automatically scoped by revision
    const setCurrentRevisionId = useSetAtom(currentRevisionIdAtom)
    useEffect(() => {
        setCurrentRevisionId(revisionId ?? null)
    }, [revisionId, setCurrentRevisionId])

    // =========================================================================
    // COLUMN STATE (from atoms instead of useEditableTable)
    // Columns are derived directly from entity/server data - no useEffect sync needed
    // =========================================================================
    const columns = useAtomValue(currentColumnsAtom)
    const addColumn = useSetAtom(addColumnAtom)
    const deleteColumn = useSetAtom(deleteColumnAtom)
    const renameColumnAction = useSetAtom(renameColumnAtom)
    const resetColumns = useSetAtom(resetColumnsAtom)

    // =========================================================================
    // DISPLAY ROW REFS (optimized - only IDs, cells read from entity atoms)
    // =========================================================================
    const displayRowRefs = useAtomValue(displayRowRefsAtom)

    // Reset column state when revision changes
    useEffect(() => {
        resetColumns()
    }, [revisionId, resetColumns])

    // Initialize v0 draft (empty testset gets starter column + row)
    const initializeV0Draft = useSetAtom(initializeV0DraftAtom)
    useEffect(() => {
        // Only run after both testcases and revision queries complete
        if (!testcasesQuery.isLoading && !revisionQuery.isPending) {
            initializeV0Draft()
        }
    }, [testcasesQuery.isLoading, revisionQuery.isPending, initializeV0Draft])

    /**
     * Row refs for table display
     * Filtering by search term is handled at the component level
     * since row refs don't contain cell data (cells read from entity atoms)
     */
    const totalCount = displayRowRefs.length

    /**
     * Update a testcase cell
     * Uses entity store updateAtom
     */
    const updateTestcase = useCallback(
        (rowKey: string, columnKey: string, value: unknown) => {
            updateEntity({
                id: rowKey,
                updates: {[columnKey]: value} as Partial<FlattenedTestcase>,
            })
        },
        [updateEntity],
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
        isLoading: metadataLoading || testcasesQuery.isLoading,
        error: (revisionQuery.error ||
            testsetNameQuery.error ||
            testcasesQuery.error) as Error | null,

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

        // Pagination
        loadNextPage,
        resetPages,
        hasMorePages: hasMorePages ?? false,
        isFetchingNextPage: testcasesQuery.isFetchingNextPage,
        serverTotalCount,

        // Revisions
        availableRevisions,
        loadingRevisions,

        // Refetch
        refetch: () => {
            // Refetch is handled by invalidating the query - atomWithQuery doesn't expose refetch directly
            // For now, just refetch testcases
            testcasesQuery.refetch()
        },
    }
}
