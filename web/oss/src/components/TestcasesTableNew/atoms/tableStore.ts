import {atom} from "jotai"
import {atomWithStorage} from "jotai/vanilla/utils"

import {
    createSimpleTableStore,
    type BaseTableMeta,
    type InfiniteTableRowBase,
} from "@/oss/components/InfiniteVirtualTable"
import type {InfiniteTableFetchResult} from "@/oss/components/InfiniteVirtualTable/types"
import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {cleanupOnRevisionChangeAtom} from "@/oss/state/entities/testcase/atomCleanup"
import {
    clearPendingAddedColumnsAtom,
    clearPendingDeletedColumnsAtom,
    clearPendingRenamesAtom,
    resetColumnsAtom,
} from "@/oss/state/entities/testcase/columnState"
import {testsetIdAtom as _testsetIdAtom} from "@/oss/state/entities/testcase/queries"
import {flattenTestcase, testcasesResponseSchema} from "@/oss/state/entities/testcase/schema"
import {
    deletedEntityIdsAtom,
    newEntityIdsAtom,
    setTestcaseIdsAtom,
    testcaseDraftAtomFamily,
} from "@/oss/state/entities/testcase/testcaseEntity"
import {projectIdAtom} from "@/oss/state/project"

import {testcasesRevisionIdAtom} from "./revisionContext"

// Re-export for backward compatibility
export {testcasesRevisionIdAtom} from "./revisionContext"

/**
 * API response from /preview/testsets/{testset_id}
 */
export interface TestcaseRevisionResponse {
    id: string // revision ID
    testset_id: string
    parent_testset_id?: string | null
    version?: number
    testcases: {
        id: string
        testset_id: string
        created_at: string
        data: Record<string, unknown>
    }[]
}

/**
 * Testcase row in the table
 */
export interface TestcaseTableRow extends InfiniteTableRowBase {
    id?: string
    testset_id?: string
    created_at?: string
    [key: string]: unknown
}

/**
 * Metadata for the testcases table
 */
export interface TestcaseTableMeta extends BaseTableMeta {
    /** Revision ID (testset_id from URL) */
    revisionId: string | null
    /** Search term for filtering */
    searchTerm: string
}

// Atom for search term (persisted in session storage)
// This is the immediate value that reflects user input
export const testcasesSearchTermAtom = atomWithStorage<string>("testcases-search-term", "")

// Debounced search term (300ms delay to reduce API calls)
// Internal atom that updates after debounce period
const debouncedSearchTermBaseAtom = atom("")

// Timer ID for debouncing (module-level to persist between atom reads)
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Write-only atom to set search term with debouncing
 * Updates UI immediately but delays API fetch by 300ms
 */
export const setDebouncedSearchTermAtom = atom(null, (get, set, searchTerm: string) => {
    // Update immediate value for UI responsiveness
    set(testcasesSearchTermAtom, searchTerm)

    // Clear existing timer
    if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer)
    }

    // Set new timer to update debounced value after 300ms
    searchDebounceTimer = setTimeout(() => {
        set(debouncedSearchTermBaseAtom, searchTerm)
        searchDebounceTimer = null
    }, 300)
})

// Atom to trigger a refresh
export const testcasesRefreshTriggerAtom = atom(0)

// Atom for full testcases metadata (read-only derived)
// Uses debounced search term to prevent excessive API calls
export const testcasesTableMetaAtom = atom<TestcaseTableMeta>((get) => {
    const projectId = get(projectIdAtom)
    const revisionId = get(testcasesRevisionIdAtom)
    const searchTerm = get(debouncedSearchTermBaseAtom) // Use debounced value for API calls
    const _refreshTrigger = get(testcasesRefreshTriggerAtom)

    return {
        projectId,
        revisionId,
        searchTerm,
        _refreshTrigger,
    }
})

const PAGE_SIZE = 50

/**
 * Fetch testcases for a revision
 */
async function fetchTestcasesForTable(
    projectId: string,
    revisionId: string,
    cursor: string | null,
    limit: number,
): Promise<InfiniteTableFetchResult<TestcaseTableRow>> {
    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/testcases/query`,
        {
            testset_revision_id: revisionId,
            windowing: {
                limit,
                ...(cursor && {next: cursor}),
            },
        },
        {params: {project_id: projectId}},
    )

    // Validate response with Zod
    const validated = testcasesResponseSchema.parse(response.data)

    // Flatten testcases for table display
    const rows = validated.testcases.map((tc) => {
        const flattened = flattenTestcase(tc)
        return {
            ...flattened,
            key: flattened.id,
        } as TestcaseTableRow
    })

    return {
        rows,
        totalCount: validated.count,
        hasMore: Boolean(validated.windowing?.next),
        nextOffset: rows.length,
        nextCursor: validated.windowing?.next || null,
        nextWindowing: null,
    }
}

// ============================================================================
// CLIENT ROWS ATOM
// Provides client-side rows (unsaved drafts) to the IVT store
// ============================================================================

/**
 * Atom that provides client-created rows to the IVT store
 * Converts entity IDs to table row format
 */
const clientTestcaseRowsAtom = atom<TestcaseTableRow[]>((get) => {
    const newEntityIds = get(newEntityIdsAtom)

    if (newEntityIds.length === 0) {
        return []
    }

    // Create row objects for new entities (only if draft exists)
    const newRows: TestcaseTableRow[] = []
    for (const id of newEntityIds) {
        const draft = get(testcaseDraftAtomFamily(id))
        // Only include rows that have a draft - skip if draft was cleared
        if (draft) {
            newRows.push({
                ...draft,
                key: id,
                __isSkeleton: false,
                __isNew: true,
            } as TestcaseTableRow)
        }
    }

    // Reverse so newest rows appear first
    return newRows.reverse()
})

/**
 * Wrapper atom to defer access to deletedEntityIdsAtom
 * This avoids circular dependency issues during module initialization
 */
const excludedTestcaseIdsAtom = atom((get) => get(deletedEntityIdsAtom))

// Create the dataset store with client rows support
const {datasetStore} = createSimpleTableStore<
    TestcaseTableRow,
    TestcaseTableRow,
    TestcaseTableMeta
>({
    key: "testcases-table",
    metaAtom: testcasesTableMetaAtom,
    rowHelpers: {
        entityName: "testcase",
        skeletonDefaults: {
            id: "",
            testset_id: "",
            created_at: "",
        } as Omit<TestcaseTableRow, "key" | "__isSkeleton">,
        getRowId: (row) => row.id || row.key.toString(),
    },
    // Provide client rows atom for IVT to merge with server rows
    clientRowsAtom: clientTestcaseRowsAtom,
    // Provide deleted IDs atom to filter out soft-deleted rows
    excludeRowIdsAtom: excludedTestcaseIdsAtom,
    fetchData: async ({meta, limit, cursor}) => {
        if (!meta.projectId || !meta.revisionId) {
            return {
                rows: [],
                totalCount: 0,
                hasMore: false,
                nextOffset: null,
                nextCursor: null,
                nextWindowing: null,
            }
        }

        const result = await fetchTestcasesForTable(
            meta.projectId,
            meta.revisionId,
            cursor,
            limit || PAGE_SIZE,
        )

        // Apply client-side search filtering if searchTerm exists
        if (meta.searchTerm) {
            const searchLower = meta.searchTerm.toLowerCase()
            const filteredRows = result.rows.filter((row) =>
                Object.values(row).some((value) =>
                    String(value || "")
                        .toLowerCase()
                        .includes(searchLower),
                ),
            )
            return {
                ...result,
                rows: filteredRows,
                totalCount: filteredRows.length,
            }
        }

        return result
    },
    isEnabled: (meta) => Boolean(meta?.projectId && meta?.revisionId),
})

export const testcasesDatasetStore = datasetStore

// ============================================================================
// ROWS TO ENTITY IDS SYNC ATOM
// Watches datasetStore rows and hydrates testcaseIdsAtom when data arrives
// ============================================================================

/**
 * Derived atom that extracts SERVER IDs from the datasetStore's rows
 * This runs AFTER the query settles and data is in the cache
 * Excludes client-created rows (new rows) - those are tracked in newEntityIdsAtom
 */
export const testcaseRowIdsAtom = atom((get) => {
    const meta = get(testcasesTableMetaAtom)
    if (!meta.revisionId) return []

    const scopeId = `testcases-${meta.revisionId}`
    const rowsAtom = datasetStore.atoms.rowsAtom({scopeId, pageSize: PAGE_SIZE})
    const rows = get(rowsAtom)

    // Filter out skeleton rows, new rows (client-created), and extract IDs
    // New rows have __isNew flag or IDs starting with "new-"
    const ids = rows
        .filter((row) => {
            if (row.__isSkeleton) return false
            if (row.__isNew) return false
            if (!row.id) return false
            if (typeof row.id === "string" && row.id.startsWith("new-")) return false
            return true
        })
        .map((row) => row.id as string)

    return ids
})

/**
 * Effect atom that syncs row IDs to testcaseIdsAtom
 * Call this from a useEffect or atomEffect to keep entity atoms in sync
 */
export const syncRowIdsToEntityAtom = atom(null, (get, set) => {
    const ids = get(testcaseRowIdsAtom)
    if (ids.length > 0) {
        set(setTestcaseIdsAtom, ids)
    }
})

// ============================================================================
// REVISION CHANGE EFFECT ATOM
// Consolidates all side effects when revision changes
// ============================================================================

/**
 * Track previous revision ID for detecting changes
 */
const previousRevisionIdAtom = atom<string | null>(null)

/**
 * Effect atom that runs all side effects when revision changes
 * - Sets the revision ID (single source of truth)
 * - Cleanup old testcase atoms (memory management)
 * - Reset column state and pending column changes
 *
 * Note: v0 initialization is handled separately in useTestcasesTable
 *
 * Use with atomEffect or call from a single useEffect in the component
 */
export const revisionChangeEffectAtom = atom(null, (get, set, newRevisionId: string | null) => {
    const previousRevisionId = get(previousRevisionIdAtom)

    // Always set the revision ID (this is the entry point from URL)
    set(testcasesRevisionIdAtom, newRevisionId)

    // Skip side effects if revision hasn't changed
    if (previousRevisionId === newRevisionId) return

    // Update tracked revision
    set(previousRevisionIdAtom, newRevisionId)

    // 1. Cleanup old testcase atoms (prevents memory leaks)
    set(cleanupOnRevisionChangeAtom, newRevisionId)

    // 2. Reset column state
    set(resetColumnsAtom)

    // 3. Clear pending column changes from previous revision
    set(clearPendingRenamesAtom)
    set(clearPendingDeletedColumnsAtom)
    set(clearPendingAddedColumnsAtom)
})
