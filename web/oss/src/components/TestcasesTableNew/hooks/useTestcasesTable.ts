import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {keepPreviousData, useInfiniteQuery, useQuery} from "@tanstack/react-query"
import {useAtomValue, useSetAtom} from "jotai"

import {useEditableTable, type EditableTableColumn} from "@/oss/components/InfiniteVirtualTable"
import type {InfiniteTableRowBase} from "@/oss/components/InfiniteVirtualTable/types"
import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {
    patchTestsetRevision,
    updateTestset,
    type TestsetRevisionPatchOperations,
} from "@/oss/services/testsets/api"
import {testcaseDraftStore} from "@/oss/state/entities/testcase/draftStore"
import {unflattenTestcase} from "@/oss/state/entities/testcase/schema"
import {
    flattenTestcase,
    testcasesResponseSchema,
    type FlattenedTestcase,
} from "@/oss/state/entities/testcase/schema"
import {testcaseStore} from "@/oss/state/entities/testcase/store"
import {projectIdAtom} from "@/oss/state/project/selectors/project"

/** Page size for testcases pagination */
const PAGE_SIZE = 50

/**
 * Testcase row type for the table
 * Extends InfiniteTableRowBase for compatibility with useEditableTable
 */
export interface TestcaseTableRow extends InfiniteTableRowBase {
    id?: string
    testset_id?: string
    created_at?: string
    [key: string]: unknown
}

/**
 * Configuration options for the testcases table hook
 */
export interface UseTestcasesTableOptions {
    /** Revision ID (the URL param - what we're viewing/editing) */
    revisionId?: string | null
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
    // Data
    /** List of testcases to display (with local edits applied) */
    testcases: TestcaseTableRow[]
    /** List of testcase IDs (for entity atom access) */
    testcaseIds: string[]
    /** Derived column definitions */
    columns: EditableTableColumn[]
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
    /** Total count of testcases (after filtering) */
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
    /** Get summary of pending changes for commit modal */
    getChangesSummary: () => {
        modifiedCount: number
        addedCount: number
        deletedCount: number
        nameChanged: boolean
        descriptionChanged: boolean
        originalData?: string
        modifiedData?: string
    }

    // Search/Filter
    /** Current search term */
    searchTerm: string
    /** Update search term */
    setSearchTerm: (term: string) => void
    /** Filtered testcases based on search */
    filteredTestcases: TestcaseTableRow[]

    // Pagination
    /** Load next page of testcases */
    loadNextPage: () => void
    /** Reset and refetch all pages */
    resetPages: () => void
    /** Whether there are more pages to load */
    hasMorePages: boolean
    /** Whether currently fetching next page */
    isFetchingNextPage: boolean
    /** Server-side total count */
    serverTotalCount: number

    // Revisions
    /** Available revisions for this testset */
    availableRevisions: {id: string; version: number; created_at: string}[]
    /** Whether revisions are loading */
    loadingRevisions: boolean

    // Refetch
    /** Manually refetch revision data */
    refetch: () => void
}

/**
 * System columns that should not be displayed or edited
 */
const SYSTEM_COLUMNS = [
    "id",
    "key",
    "testset_id",
    "set_id",
    "created_at",
    "updated_at",
    "deleted_at",
    "created_by_id",
    "updated_by_id",
    "deleted_by_id",
    "flags",
    "tags",
    "meta",
    "__isSkeleton",
    "testcase_dedup_id",
]

/**
 * Fetch revision metadata from API (no testcases - just metadata)
 */
async function fetchRevision(projectId: string, revisionId: string) {
    const response = await axios.get(
        `${getAgentaApiUrl()}/preview/testsets/revisions/${revisionId}`,
        {params: {project_id: projectId}},
    )
    return response.data?.testset_revision
}

/**
 * Paginated testcases response
 */
interface TestcasesPage {
    testcases: FlattenedTestcase[]
    count: number
    nextCursor: string | null
    hasMore: boolean
}

/**
 * Fetch paginated testcases using /preview/testcases/query endpoint
 * Uses testset_revision_id to fetch testcases for a specific revision
 */
async function fetchTestcasesPage(
    projectId: string,
    revisionId: string,
    cursor: string | null,
): Promise<TestcasesPage> {
    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/testcases/query`,
        {
            testset_revision_id: revisionId,
            windowing: {
                limit: PAGE_SIZE,
                ...(cursor && {next: cursor}),
            },
        },
        {params: {project_id: projectId}},
    )

    // Validate response with Zod
    const validated = testcasesResponseSchema.parse(response.data)

    // Flatten testcases for table display
    const flattenedTestcases = validated.testcases.map(flattenTestcase)

    return {
        testcases: flattenedTestcases,
        count: validated.count,
        nextCursor: validated.windowing?.next || null,
        hasMore: Boolean(validated.windowing?.next),
    }
}

/**
 * Fetch testset metadata (name) from API
 */
async function fetchTestsetName(projectId: string, testsetId: string): Promise<string> {
    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/testsets/query`,
        {
            testset_refs: [{id: testsetId}],
            windowing: {limit: 1},
        },
        {params: {project_id: projectId}},
    )
    const testsets = response.data?.testsets ?? []
    return testsets[0]?.name ?? ""
}

/**
 * Fetch all revisions for a testset (using already-known testsetId)
 */
async function fetchRevisionsByTestsetId(
    projectId: string,
    testsetId: string,
): Promise<{id: string; version: number; created_at: string}[]> {
    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/testsets/revisions/query`,
        {
            testset_refs: [{id: testsetId}],
            windowing: {limit: 100},
        },
        {params: {project_id: projectId}},
    )
    const revisions = response.data?.testset_revisions ?? []
    return revisions.map((rev: any) => ({
        id: rev.id,
        version: rev.version ?? 0,
        created_at: rev.created_at,
    }))
}

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

    // Testset name state
    const [localTestsetName, setLocalTestsetName] = useState<string | null>(null)

    // Save state
    const [isSaving, setIsSaving] = useState(false)

    /**
     * Fetch revision data using React Query
     */
    const revisionQuery = useQuery({
        queryKey: ["testset-revision", projectId, revisionId],
        queryFn: async () => {
            if (!projectId || !revisionId) return null
            return fetchRevision(projectId, revisionId)
        },
        enabled: Boolean(projectId && revisionId),
        staleTime: 30_000,
        placeholderData: keepPreviousData,
    })

    // Extract data from revision
    const revision = revisionQuery.data
    const testsetId = revision?.testset_id
    const revisionVersion = revision?.version

    /**
     * Fetch testset name (uses testsetId from revision - no duplicate call)
     */
    const testsetNameQuery = useQuery({
        queryKey: ["testset-name", projectId, testsetId],
        queryFn: async () => {
            if (!projectId || !testsetId) return ""
            return fetchTestsetName(projectId, testsetId)
        },
        enabled: Boolean(projectId && testsetId),
        staleTime: 60_000,
    })

    /**
     * Fetch available revisions (uses testsetId from revision - no duplicate call)
     */
    const revisionsQuery = useQuery({
        queryKey: ["testset-revisions", projectId, testsetId],
        queryFn: async () => {
            if (!projectId || !testsetId) return []
            return fetchRevisionsByTestsetId(projectId, testsetId)
        },
        enabled: Boolean(projectId && testsetId),
        staleTime: 60_000,
    })

    const fetchedTestsetName = testsetNameQuery.data ?? ""
    const testsetName = localTestsetName ?? fetchedTestsetName
    const testsetNameChanged = localTestsetName !== null && localTestsetName !== fetchedTestsetName
    const availableRevisions = revisionsQuery.data ?? []
    const loadingRevisions = revisionsQuery.isLoading

    // Description from revision
    const fetchedDescription = revision?.description ?? ""
    const [localDescription, setLocalDescription] = useState<string | null>(null)
    const description = localDescription ?? fetchedDescription
    const descriptionChanged = localDescription !== null && localDescription !== fetchedDescription

    // Reset local name/description state when revision changes
    useEffect(() => {
        setLocalTestsetName(null)
        setLocalDescription(null)
    }, [revisionId])

    /**
     * Paginated testcases query using useInfiniteQuery
     * Uses revisionId to fetch testcases for the specific revision being viewed
     */
    const testcasesQuery = useInfiniteQuery({
        queryKey: ["testcases-paginated", projectId, revisionId],
        queryFn: async ({pageParam}) => {
            if (!projectId || !revisionId) {
                return {testcases: [], count: 0, nextCursor: null, hasMore: false}
            }
            return fetchTestcasesPage(projectId, revisionId, pageParam)
        },
        initialPageParam: null as string | null,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        enabled: Boolean(projectId && revisionId),
        staleTime: 30_000,
        placeholderData: keepPreviousData,
    })

    /**
     * Flatten all pages into a single array of testcases
     */
    const allTestcases = useMemo(() => {
        if (!testcasesQuery.data?.pages) return []
        return testcasesQuery.data.pages.flatMap((page) => page.testcases)
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

    /**
     * Transform flattened testcases to table rows
     */
    const serverRows = useMemo<TestcaseTableRow[]>(() => {
        const rows = allTestcases.map((tc, index) => {
            const {created_at, ...rest} = tc
            return {
                ...rest,
                key: tc.id || `row-${index}`,
                id: tc.id,
                testset_id: tc.testset_id || testsetId,
                created_at: created_at ?? undefined,
                __isSkeleton: false,
            } as TestcaseTableRow
        })
        return rows
    }, [allTestcases, testsetId])

    /**
     * Entity store hydration - populate entity atoms from paginated testcases
     */
    const upsertMany = useSetAtom(testcaseStore.upsertManyAtom)
    const upsert = useSetAtom(testcaseStore.upsertAtom)
    const updateEntity = useSetAtom(testcaseStore.updateAtom)
    const clearAllEntities = useSetAtom(testcaseStore.clearAllAtom)
    const clearAllDirty = useSetAtom(testcaseStore.clearAllDirtyAtom)
    const allEntities = useAtomValue(testcaseStore.entitiesAtom)

    // Draft store - for clearing drafts when discarding changes
    const clearAllDrafts = useSetAtom(testcaseDraftStore.clearAllDrafts)

    // Track which testcases have been hydrated to avoid duplicates
    const hydratedIdsRef = useRef<Set<string>>(new Set())

    // Track column renames for migrating newly loaded pages
    // Maps oldColumnName -> newColumnName (supports chained renames: a->b->c stored as a->c)
    const columnRenamesRef = useRef<Map<string, string>>(new Map())

    useEffect(() => {
        if (allTestcases.length > 0) {
            // Only hydrate new testcases (not already in store)
            const newTestcases = allTestcases.filter(
                (tc) => tc.id && !hydratedIdsRef.current.has(tc.id),
            )
            if (newTestcases.length > 0) {
                // Apply any pending column renames to new data before hydrating
                const migratedTestcases = newTestcases.map((tc) => {
                    if (columnRenamesRef.current.size === 0) return tc
                    const migrated = {...tc}
                    columnRenamesRef.current.forEach((newName, oldName) => {
                        if (oldName in migrated) {
                            ;(migrated as Record<string, unknown>)[newName] = (
                                migrated as Record<string, unknown>
                            )[oldName]
                            delete (migrated as Record<string, unknown>)[oldName]
                        }
                    })
                    return migrated as FlattenedTestcase
                })
                upsertMany(migratedTestcases)
                newTestcases.forEach((tc) => {
                    if (tc.id) hydratedIdsRef.current.add(tc.id)
                })
            }
        }
    }, [allTestcases, upsertMany, allEntities])

    // Reset hydrated IDs, column renames, and clear entity store when revision changes
    // This ensures entities from previous revision don't persist
    useEffect(() => {
        hydratedIdsRef.current = new Set()
        columnRenamesRef.current = new Map()
        clearAllEntities()
        clearAllDirty()
    }, [revisionId, clearAllEntities, clearAllDirty])

    /**
     * Track testcase IDs (for entity atom access)
     */
    const testcaseIds = useMemo(() => {
        return allTestcases.map((tc) => tc.id).filter(Boolean) as string[]
    }, [allTestcases])

    /**
     * Dirty state tracking - which testcases have been modified
     */
    const [_modifiedTestcaseIds, setModifiedTestcaseIds] = useState<Set<string>>(new Set())

    /**
     * Editable table hook - handles all local edit state
     */
    const [editState, editActions] = useEditableTable<TestcaseTableRow>({
        systemFields: SYSTEM_COLUMNS,
        createNewRow: () => ({
            testset_id: testsetId || "",
            created_at: new Date().toISOString(),
        }),
    })

    // Track the revision ID that columns were derived from
    // This prevents re-deriving columns from stale placeholder data
    const columnsForRevisionRef = useRef<string | null>(null)

    // Reset all editable table state when revision changes
    // This resets columns, local edits, new rows, deleted rows
    const resetAllState = editActions.resetAllState
    useEffect(() => {
        resetAllState()
        // Reset the columns revision tracker so columns will be re-derived
        columnsForRevisionRef.current = null
    }, [revisionId, resetAllState])

    // Derive columns from first row - only when we have fresh data for current revision
    const deriveColumnsFromRow = editState.deriveColumnsFromRow
    const isPlaceholderData = testcasesQuery.isPlaceholderData
    useEffect(() => {
        // Don't derive columns from placeholder (stale) data
        if (isPlaceholderData) return
        // Don't derive if we already derived for this revision
        if (columnsForRevisionRef.current === revisionId) return
        // Derive columns from first row if we have data
        if (serverRows.length > 0 && editState.columns.length === 0) {
            deriveColumnsFromRow(serverRows[0])
            columnsForRevisionRef.current = revisionId ?? null
        }
    }, [serverRows, editState.columns.length, deriveColumnsFromRow, isPlaceholderData, revisionId])

    // Track if we've initialized draft for v0
    const v0DraftInitializedRef = useRef(false)

    // Reset v0 draft flag when revision changes
    useEffect(() => {
        v0DraftInitializedRef.current = false
    }, [revisionId])

    /**
     * Initialize draft state for v0 revisions with no testcases
     * Creates an example column and row so user can start editing immediately
     */
    useEffect(() => {
        // Only for v0 revisions with no server data
        const isV0 =
            revisionVersion === 0 || revisionVersion === "0" || String(revisionVersion) === "0"
        const hasNoServerData = serverRows.length === 0 && !testcasesQuery.isLoading
        const hasNoLocalData = editState.newRows.length === 0 && editState.columns.length === 0

        if (
            isV0 &&
            hasNoServerData &&
            hasNoLocalData &&
            !v0DraftInitializedRef.current &&
            testsetId
        ) {
            v0DraftInitializedRef.current = true

            // Add example column
            editActions.addColumn("input")

            // Add example row with empty data
            const newRow = editActions.addRow()

            // Set initial value for the example column
            if (newRow.id) {
                editActions.editCell(newRow.id, "input", "")

                // Create entity in store for drawer flow
                const flattenedRow: FlattenedTestcase = {
                    id: newRow.id,
                    testset_id: testsetId,
                    input: "",
                }
                upsert(flattenedRow)
            }
        }
    }, [
        revisionVersion,
        serverRows.length,
        testcasesQuery.isLoading,
        editState.newRows.length,
        editState.columns.length,
        testsetId,
        editActions,
        upsert,
    ])

    /**
     * Get display rows with edits applied
     */
    const displayRows = useMemo(() => {
        return editActions.getDisplayRows(serverRows)
    }, [editActions, serverRows])

    /**
     * Filter rows based on search term
     */
    const filteredTestcases = useMemo(() => {
        if (!searchTerm.trim()) {
            return displayRows
        }

        const lowerSearch = searchTerm.toLowerCase()
        return displayRows.filter((row) => {
            return editState.columns.some((col) => {
                const value = row[col.key]
                if (value == null) return false
                return String(value).toLowerCase().includes(lowerSearch)
            })
        })
    }, [displayRows, searchTerm, editState.columns])

    const totalCount = filteredTestcases.length

    // Reset dirty state when revision changes
    useEffect(() => {
        setLocalTestsetName(null)
        setModifiedTestcaseIds(new Set())
    }, [revisionId])

    /**
     * Update a testcase cell
     */
    const updateTestcase = useCallback(
        (rowKey: string, columnKey: string, value: unknown) => {
            editActions.editCell(rowKey, columnKey, value)
        },
        [editActions],
    )

    /**
     * Delete testcases
     */
    const deleteTestcases = useCallback(
        (rowKeys: string[]) => {
            editActions.deleteRows(rowKeys)
        },
        [editActions],
    )

    /**
     * Rename a column - also migrates data in entity store and tracks for future pages
     */
    const renameColumn = useCallback(
        (oldName: string, newName: string): boolean => {
            // First, rename in the editable table state
            const success = editActions.renameColumn(oldName, newName)
            if (!success) return false

            const trimmedNewName = newName.trim()

            // Track the rename for future page loads (infinite scroll)
            // Handle chained renames: if we already have x->oldName, update to x->newName
            const existingOldName = Array.from(columnRenamesRef.current.entries()).find(
                ([, v]) => v === oldName,
            )?.[0]
            if (existingOldName) {
                // Update existing chain: originalName -> newName
                columnRenamesRef.current.set(existingOldName, trimmedNewName)
            } else {
                // New rename: oldName -> newName
                columnRenamesRef.current.set(oldName, trimmedNewName)
            }

            // Then, migrate data in the entity store for all entities
            // This ensures existing row data is preserved under the new column key
            // Use updateEntity to properly set isDirty flag, then clean up old key
            Object.entries(allEntities).forEach(([entityId, stored]) => {
                if (stored?.data && oldName in stored.data) {
                    const oldValue = (stored.data as Record<string, unknown>)[oldName]
                    // First, add the new column with the old value (this sets isDirty)
                    updateEntity({
                        id: entityId,
                        updates: {
                            [trimmedNewName]: oldValue,
                        } as Partial<FlattenedTestcase>,
                    })
                }
            })

            return true
        },
        [editActions, allEntities, updateEntity],
    )

    /**
     * Add a new testcase
     * Also adds to entity store so dirty indicator shows
     */
    const addTestcase = useCallback(() => {
        const newRow = editActions.addRow()
        // Add to entity store as dirty so indicator shows
        if (newRow.id) {
            const flattenedRow: FlattenedTestcase = {
                id: newRow.id,
                testset_id: testsetId || "",
                ...Object.fromEntries(
                    editState.columns.map((col) => [col.key, newRow[col.key] ?? ""]),
                ),
            }
            upsert(flattenedRow)
        }
        return newRow
    }, [editActions, testsetId, editState.columns, upsert])

    /**
     * Append multiple testcases from parsed data
     * Removes duplicates by comparing JSON stringified data
     * @returns Count of rows actually added (after deduplication)
     */
    const appendTestcases = useCallback(
        (rows: Record<string, unknown>[]): number => {
            if (!rows.length) return 0

            // Get existing row data for deduplication
            // Use allTestcases (server data) and editState.newRows (locally added rows)
            const existingDataSet = new Set<string>()
            const allRows = [...allTestcases, ...(editState.newRows || [])]
            for (const row of allRows) {
                // Extract only data columns (exclude id, testset_id, created_at)
                const dataOnly: Record<string, unknown> = {}
                for (const col of editState.columns) {
                    dataOnly[col.key] = row[col.key]
                }
                existingDataSet.add(JSON.stringify(dataOnly))
            }

            // Add new columns from incoming data if they don't exist
            const existingColumnKeys = new Set(editState.columns.map((c) => c.key))
            for (const row of rows) {
                for (const key of Object.keys(row)) {
                    if (!existingColumnKeys.has(key)) {
                        editActions.addColumn(key)
                        existingColumnKeys.add(key)
                    }
                }
            }

            // Add rows that aren't duplicates
            let addedCount = 0
            for (const row of rows) {
                const rowDataStr = JSON.stringify(row)
                if (!existingDataSet.has(rowDataStr)) {
                    const newRow = editActions.addRow()
                    // Set values for each column
                    for (const [key, value] of Object.entries(row)) {
                        if (newRow.id) {
                            editActions.editCell(newRow.id, key, value)
                        }
                    }
                    // Add to entity store
                    if (newRow.id) {
                        const flattenedRow: FlattenedTestcase = {
                            id: newRow.id,
                            testset_id: testsetId || "",
                            ...row,
                        }
                        upsert(flattenedRow)
                    }
                    existingDataSet.add(rowDataStr)
                    addedCount++
                }
            }

            return addedCount
        },
        [editActions, allTestcases, editState.newRows, editState.columns, testsetId, upsert],
    )

    /**
     * Save all changes - creates new revision using patch API
     * Only sends delta changes (update/create/delete) instead of full snapshot
     * This is safe for infinite scrolling since it doesn't require all data to be loaded
     * @returns New revision ID on success, null on failure
     */
    const saveTestset = useCallback(
        async (commitMessage?: string): Promise<string | null> => {
            if (!projectId || !testsetId) {
                console.error("[useTestcasesTable] Missing projectId or testsetId")
                return null
            }

            if (!testsetName.trim()) {
                console.error("[useTestcasesTable] Testset name is required")
                return null
            }

            setIsSaving(true)
            try {
                // Build patch operations from local changes
                const operations: TestsetRevisionPatchOperations = {}

                // Get current column keys to filter data (handles column renames)
                const currentColumnKeys = new Set(editState.columns.map((c) => c.key))

                // 1. Collect updated testcases (dirty entities in store)
                const updatedTestcases = testcaseIds
                    .filter((id) => {
                        const stored = allEntities[id]
                        return stored?.metadata?.isDirty && !editState.deletedRowIds.has(id)
                    })
                    .map((id) => {
                        const stored = allEntities[id]
                        if (!stored?.data) return null
                        const unflattened = unflattenTestcase(stored.data)
                        // Filter data to only include current columns (handles column renames)
                        const filteredData: Record<string, unknown> = {}
                        if (unflattened.data) {
                            for (const key of Object.keys(unflattened.data)) {
                                if (currentColumnKeys.has(key)) {
                                    filteredData[key] = unflattened.data[key]
                                }
                            }
                        }
                        return {
                            id: unflattened.id!,
                            data: filteredData,
                        }
                    })
                    .filter(Boolean) as {id: string; data: Record<string, unknown>}[]

                if (updatedTestcases.length > 0) {
                    operations.update = updatedTestcases
                }

                // 2. Collect new testcases from local edit state
                // Note: New rows may have been edited via the drawer, which updates the entity store
                // So we need to get the data from the entity store if available
                const newTestcases = editState.newRows.map((row) => {
                    const rowId = row.id || row.key
                    // Check if this new row has been edited in the entity store
                    const entityData = rowId ? allEntities[rowId as string]?.data : null
                    if (entityData) {
                        // Use data from entity store (has drawer edits)
                        const unflattened = unflattenTestcase(entityData)
                        // Filter data to only include current columns (handles column renames)
                        const filteredData: Record<string, unknown> = {}
                        if (unflattened.data) {
                            for (const key of Object.keys(unflattened.data)) {
                                if (currentColumnKeys.has(key)) {
                                    filteredData[key] = unflattened.data[key]
                                }
                            }
                        }
                        return {data: filteredData}
                    }
                    // Fallback to row data (for rows not edited via drawer)
                    // Filter to only include current columns
                    const filteredData: Record<string, unknown> = {}
                    for (const col of editState.columns) {
                        if (col.key in row) {
                            filteredData[col.key] = (row as Record<string, unknown>)[col.key]
                        }
                    }
                    return {data: filteredData}
                })

                if (newTestcases.length > 0) {
                    operations.create = newTestcases
                }

                // 3. Collect deleted testcase IDs
                const deletedIds = Array.from(editState.deletedRowIds)

                if (deletedIds.length > 0) {
                    operations.delete = deletedIds
                }

                // Update testset name if changed (using legacy API for now)
                if (testsetNameChanged) {
                    await updateTestset(testsetId, testsetName, [])
                }

                // Check if there are any operations to apply
                const hasOperations =
                    (operations.update?.length ?? 0) > 0 ||
                    (operations.create?.length ?? 0) > 0 ||
                    (operations.delete?.length ?? 0) > 0

                if (!hasOperations && !testsetNameChanged && !descriptionChanged) {
                    // No changes to save, return current revision ID
                    return revisionId || null
                }

                // Patch revision with delta changes
                // Pass current revisionId as base so patches apply to the viewed revision, not latest
                const response = await patchTestsetRevision(
                    testsetId,
                    operations,
                    commitMessage || undefined, // Use provided commit message or let backend use default
                    revisionId ?? undefined, // Base revision ID - the one currently being viewed
                    descriptionChanged ? description : undefined, // Only pass description if changed
                )

                if (response?.testset_revision) {
                    const newRevisionId = response.testset_revision.id as string

                    // Clear local edit state
                    editActions.clearLocalState()
                    setLocalTestsetName(null)
                    setLocalDescription(null)
                    setModifiedTestcaseIds(new Set())

                    // Clear entire entity store so new revision loads fresh
                    clearAllEntities()

                    // Clear hydrated IDs so new data will be re-hydrated
                    hydratedIdsRef.current = new Set()

                    // Invalidate revisions query so the list updates
                    revisionsQuery.refetch()

                    // Return the new revision ID so caller can navigate to it
                    return newRevisionId
                }
                return null
            } catch (error) {
                console.error("[useTestcasesTable] Failed to save testset:", error)
                throw error
            } finally {
                setIsSaving(false)
            }
        },
        [
            projectId,
            testsetId,
            testsetName,
            testsetNameChanged,
            testcaseIds,
            allEntities,
            editState.deletedRowIds,
            editState.newRows,
            editActions,
            clearAllEntities,
            revisionId,
            revisionsQuery,
        ],
    )

    /**
     * Clear all local changes
     */
    const clearChanges = useCallback(() => {
        editActions.clearLocalState()
        setLocalTestsetName(null)
        setLocalDescription(null)
        setModifiedTestcaseIds(new Set())

        // Clear column rename tracking (columns will be re-derived from original data)
        columnRenamesRef.current = new Map()

        // Clear all drafts from the draft store (used by drawer editor)
        clearAllDrafts()

        // Re-hydrate entities from server data (cached in React Query)
        // This restores original values without a network request
        if (allTestcases.length > 0) {
            const testcasesToRestore = allTestcases.filter((tc) => tc.id)
            if (testcasesToRestore.length > 0) {
                upsertMany(testcasesToRestore)
                // Clear dirty flags after re-hydrating (upsert sets isDirty: true)
                clearAllDirty()
            }
        }
    }, [editActions, allTestcases, upsertMany, clearAllDirty, clearAllDrafts])

    /**
     * Get summary of pending changes for commit modal
     */
    const getChangesSummary = useCallback(() => {
        // Count modified testcases (dirty entities in store)
        const modifiedCount = testcaseIds.filter((id) => {
            const stored = allEntities[id]
            return stored?.metadata?.isDirty && !editState.deletedRowIds.has(id)
        }).length

        // Count new testcases
        const addedCount = editState.newRows.length

        // Count deleted testcases
        const deletedCount = editState.deletedRowIds.size

        // Build diff data - show only meaningful field changes
        let originalData: string | undefined
        let modifiedData: string | undefined

        // Get current column keys to filter data (handles column renames)
        const currentColumnKeys = new Set(editState.columns.map((c) => c.key))

        // Helper to extract only user data fields (exclude metadata, only include current columns)
        const extractUserFields = (
            data: Record<string, unknown> | undefined,
            useCurrentColumns = true,
        ) => {
            if (!data) return {}
            const metadataFields = [
                "id",
                "key",
                "testset_id",
                "set_id",
                "created_at",
                "updated_at",
                "deleted_at",
                "created_by_id",
                "updated_by_id",
                "deleted_by_id",
                "flags",
                "tags",
                "meta",
                "__isSkeleton",
            ]
            const result: Record<string, unknown> = {}
            for (const [key, value] of Object.entries(data)) {
                if (metadataFields.includes(key)) continue
                // For modified data, only include current columns (handles column renames)
                if (useCurrentColumns && !currentColumnKeys.has(key)) continue
                result[key] = value
            }
            return result
        }

        // Collect changes for diff view - show before/after for each change
        const originalChanges: Record<string, unknown>[] = []
        const modifiedChanges: Record<string, unknown>[] = []

        // Modified testcases - show original vs modified
        testcaseIds.forEach((id) => {
            const stored = allEntities[id]
            if (stored?.metadata?.isDirty && !editState.deletedRowIds.has(id)) {
                // Find original data from server cache
                const originalTestcase = allTestcases.find((tc) => tc.id === id)
                // For original, don't filter by current columns (show old column names)
                const originalFields = extractUserFields(
                    originalTestcase as Record<string, unknown>,
                    false,
                )
                // For modified, filter by current columns (only show renamed columns)
                const modifiedFields = extractUserFields(
                    stored.data as Record<string, unknown>,
                    true,
                )

                originalChanges.push({_type: "modified", ...originalFields})
                modifiedChanges.push({_type: "modified", ...modifiedFields})
            }
        })

        // New testcases
        editState.newRows.forEach((row) => {
            const rowId = row.id || row.key
            const entityData = rowId ? allEntities[rowId as string]?.data : null
            const fields = extractUserFields((entityData || row) as Record<string, unknown>)

            // No original for new rows
            modifiedChanges.push({_type: "added", ...fields})
        })

        // Deleted testcases
        editState.deletedRowIds.forEach((id) => {
            const originalTestcase = allTestcases.find((tc) => tc.id === id)
            const originalFields = extractUserFields(originalTestcase as Record<string, unknown>)

            originalChanges.push({_type: "deleted", ...originalFields})
        })

        // Only show diff if there are testcase changes
        if (originalChanges.length > 0 || modifiedChanges.length > 0) {
            originalData = JSON.stringify(originalChanges, null, 2)
            modifiedData = JSON.stringify(modifiedChanges, null, 2)
        }

        return {
            modifiedCount,
            addedCount,
            deletedCount,
            nameChanged: testsetNameChanged,
            descriptionChanged,
            originalData,
            modifiedData,
        }
    }, [
        testcaseIds,
        allEntities,
        allTestcases,
        editState.deletedRowIds,
        editState.newRows,
        testsetNameChanged,
        descriptionChanged,
    ])

    /**
     * Check if any entities in the store are dirty
     */
    const hasEntityStoreDirty = useMemo(() => {
        return Object.values(allEntities).some((stored) => stored.metadata?.isDirty)
    }, [allEntities])

    /**
     * Calculate unsaved changes - includes entity store dirty state
     */
    const hasUnsavedChanges =
        editState.hasUnsavedChanges ||
        testsetNameChanged ||
        descriptionChanged ||
        hasEntityStoreDirty

    /**
     * Build metadata object
     */
    const metadata: TestsetMetadata | null = testsetId
        ? {
              testsetId,
              testsetName: fetchedTestsetName,
              revisionVersion,
              description: fetchedDescription,
              commitMessage: revision?.message,
              author: revision?.author,
              createdAt: revision?.created_at,
              updatedAt: revision?.updated_at,
          }
        : null

    return {
        // Data
        testcases: filteredTestcases,
        testcaseIds, // IDs for entity atom access
        columns: editState.columns,
        isLoading:
            revisionQuery.isLoading || testsetNameQuery.isLoading || testcasesQuery.isLoading,
        error: (revisionQuery.error ||
            testsetNameQuery.error ||
            testcasesQuery.error) as Error | null,

        // Metadata
        metadata,
        testsetName,
        setTestsetName: setLocalTestsetName,
        testsetNameChanged,
        description,
        setDescription: setLocalDescription,
        descriptionChanged,

        // Stats
        totalCount,

        // Mutations
        updateTestcase,
        deleteTestcases,
        addTestcase,
        appendTestcases,
        addColumn: editActions.addColumn,
        renameColumn,
        deleteColumn: editActions.deleteColumn,

        // Save
        saveTestset,
        isSaving,
        hasUnsavedChanges,
        clearChanges,
        getChangesSummary,

        // Search/Filter
        searchTerm,
        setSearchTerm,
        filteredTestcases,

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
        refetch: revisionQuery.refetch,
    }
}
