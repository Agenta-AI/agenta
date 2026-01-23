/**
 * Testcase Paginated Store
 *
 * Provides paginated fetching for testcases with InfiniteVirtualTable integration.
 */

import {projectIdAtom} from "@agenta/shared"
import {
    createPaginatedEntityStore,
    type InfiniteTableFetchResult,
    type PaginatedEntityStore,
} from "@agenta/ui"
import {atom, type Atom, type PrimitiveAtom} from "jotai"

import {isNewTestsetId} from "../../testset/core"
import {fetchTestcasesPage} from "../api"
import type {FlattenedTestcase} from "../core"

import {testcaseMolecule} from "./molecule"
import {
    currentRevisionIdAtom,
    deletedEntityIdsAtom,
    newEntityIdsAtom,
    testcaseDraftAtomFamily,
} from "./store"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Row type for testcase table (extends FlattenedTestcase with table-specific fields)
 */
export interface TestcaseTableRow extends FlattenedTestcase {
    key: string
    __isSkeleton?: boolean
    __isNew?: boolean
    [key: string]: unknown
}

/**
 * Meta for testcase paginated queries
 */
export interface TestcasePaginatedMeta {
    projectId: string | null
    revisionId: string | null
    searchTerm?: string
}

// ============================================================================
// FILTER ATOMS
// ============================================================================

/**
 * Current revision ID for testcases queries
 */
export const testcasesRevisionIdAtom = atom<string | null>(null) as PrimitiveAtom<string | null>

/**
 * Search term for filtering testcases (immediate value for UI)
 */
export const testcasesSearchTermAtom = atom<string>("")

/**
 * Debounced search term (for actual queries)
 */
const debouncedSearchTermAtom = atom<string>("")

// Debounce timer reference
let debounceTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Write atom that sets search term with debounce
 */
export const setDebouncedSearchTermAtom = atom(null, (get, set, value: string) => {
    // Update immediate value for UI
    set(testcasesSearchTermAtom, value)

    // Debounce the actual query update
    if (debounceTimer) {
        clearTimeout(debounceTimer)
    }

    debounceTimer = setTimeout(() => {
        set(debouncedSearchTermAtom, value)
        debounceTimer = null
    }, 300)
})

// ============================================================================
// META ATOM
// ============================================================================

/**
 * Combined meta atom for paginated store
 */
export const testcasesPaginatedMetaAtom: Atom<TestcasePaginatedMeta> = atom((get) => ({
    projectId: get(projectIdAtom),
    revisionId: get(testcasesRevisionIdAtom),
    searchTerm: get(debouncedSearchTermAtom),
}))

// ============================================================================
// PAGINATED STORE
// ============================================================================

/**
 * Skeleton row defaults for loading state
 */
const skeletonDefaults: Partial<TestcaseTableRow> = {
    id: "",
    key: "",
    __isSkeleton: true,
}

/**
 * Stable empty array reference to avoid triggering re-renders
 * when there are no client rows (prevents infinite update loops)
 */
const EMPTY_CLIENT_ROWS: TestcaseTableRow[] = []

/**
 * Client rows atom - provides locally created testcases that haven't been saved yet.
 * These rows are prepended to server rows in the table.
 *
 * Note: Only minimal row data is stored here (key, id, flags).
 * Cell data is accessed via testcaseEntityAtomFamily(id) -> testcaseDraftAtomFamily(id),
 * so there's no need to duplicate the full entity data in the row.
 */
const clientRowsAtom: Atom<TestcaseTableRow[]> = atom((get) => {
    const newIds = get(newEntityIdsAtom)

    // Return stable empty reference when no new IDs exist
    // This prevents infinite re-render loops from array reference changes
    if (newIds.length === 0) {
        return EMPTY_CLIENT_ROWS
    }

    // Only create row entries for IDs that have draft data
    const rows = newIds
        .filter((id) => get(testcaseDraftAtomFamily(id)) !== null)
        .map((id) => ({
            id,
            key: id,
            __isNew: true,
            __isSkeleton: false,
        }))

    // Return stable empty reference if all IDs were filtered out
    return rows.length === 0 ? EMPTY_CLIENT_ROWS : rows
})

/**
 * Exclude row IDs atom - provides IDs of soft-deleted rows to exclude from display.
 */
const excludeRowIdsAtom: Atom<Set<string>> = atom((get) => get(deletedEntityIdsAtom))

/**
 * Fetch testcases page for the paginated store
 */
async function fetchTestcasesWindow({
    meta,
    limit,
    cursor,
}: {
    meta: TestcasePaginatedMeta
    limit: number
    cursor?: string | null
}): Promise<InfiniteTableFetchResult<FlattenedTestcase>> {
    const {projectId, revisionId} = meta

    // Skip fetch for empty, null, or new testset IDs (new, new-*, local-*)
    if (!projectId || !revisionId || isNewTestsetId(revisionId)) {
        return {
            rows: [],
            totalCount: 0,
            hasMore: false,
            nextCursor: null,
            nextOffset: null,
            nextWindowing: null,
        }
    }

    try {
        const result = await fetchTestcasesPage({
            revisionId,
            projectId,
            limit,
            cursor: cursor || undefined,
        })

        return {
            rows: result.testcases,
            totalCount: result.count,
            hasMore: result.hasMore,
            nextCursor: result.nextCursor,
            nextOffset: null,
            nextWindowing: null,
        }
    } catch (error) {
        console.error("[testcasePaginatedStore] Error fetching testcases:", error)
        return {
            rows: [],
            totalCount: 0,
            hasMore: false,
            nextCursor: null,
            nextOffset: null,
            nextWindowing: null,
        }
    }
}

/**
 * Testcase paginated store for InfiniteVirtualTable
 */
export const testcasePaginatedStore: PaginatedEntityStore<
    TestcaseTableRow,
    FlattenedTestcase,
    TestcasePaginatedMeta
> = createPaginatedEntityStore<TestcaseTableRow, FlattenedTestcase, TestcasePaginatedMeta>({
    entityName: "testcase",
    metaAtom: testcasesPaginatedMetaAtom,
    fetchPage: fetchTestcasesWindow,
    rowConfig: {
        getRowId: (row) => row.id,
        skeletonDefaults,
    },
    transformRow: (apiRow): TestcaseTableRow => ({
        ...apiRow,
        key: apiRow.id,
    }),
    isEnabled: (meta) => Boolean(meta?.projectId && meta?.revisionId),
    // Client rows: locally created testcases that haven't been saved yet
    clientRowsAtom,
    // Exclude soft-deleted rows from display
    excludeRowIdsAtom,
})

// ============================================================================
// FILTERS NAMESPACE
// ============================================================================

/**
 * Filter atoms namespace for testcases
 */
export const testcaseFilters = {
    revisionId: testcasesRevisionIdAtom,
    searchTerm: testcasesSearchTermAtom,
    setSearchTerm: setDebouncedSearchTermAtom,
}

// ============================================================================
// INITIALIZATION ATOMS
// ============================================================================

/**
 * Parameters for initializeEmptyRevisionAtom
 */
export interface InitializeEmptyRevisionParams {
    /** Revision ID (optional, falls back to currentRevisionIdAtom) */
    revisionId?: string
    /**
     * Total count of server testcases from paginated store.
     * This is required for existing testsets to properly detect if server has data.
     * For new testsets (isNewTestset=true), this can be omitted.
     */
    serverTotalCount?: number
    /**
     * Whether this is a new testset (not yet saved to server).
     * New testsets don't have server data, so we only check local entities.
     */
    isNewTestset?: boolean
}

/**
 * Initialize empty revision state for "create from scratch" flow.
 *
 * Adds an initial testcase with default properties when:
 * 1. There are no server testcases (serverTotalCount === 0 or isNewTestset)
 * 2. There are no local testcases (newEntityIdsAtom is empty)
 *
 * The mental model is: create testcases with properties, not columns.
 * Columns are derived from testcase properties.
 *
 * IMPORTANT: For existing testsets, you MUST pass serverTotalCount from the paginated store.
 * The testcaseIdsAtom is not reliable for this check because it's not populated by
 * the paginated store's TanStack Query cache.
 */
export const initializeEmptyRevisionAtom = atom(
    null,
    (get, set, params?: string | InitializeEmptyRevisionParams) => {
        // Support both old string-only signature and new params object
        const normalizedParams: InitializeEmptyRevisionParams =
            typeof params === "string" ? {revisionId: params} : (params ?? {})

        const {
            revisionId: revisionIdParam,
            serverTotalCount,
            isNewTestset = false,
        } = normalizedParams

        // Use provided revisionId or fall back to atom
        const revisionId = revisionIdParam ?? get(currentRevisionIdAtom)
        if (!revisionId) return

        const newIds = get(newEntityIdsAtom)

        // Check server data based on the provided count (for existing testsets)
        // or skip the check entirely (for new testsets which have no server data)
        const hasServerData = isNewTestset ? false : (serverTotalCount ?? 0) > 0

        // Only initialize if truly empty (no server data, no local data)
        if (hasServerData || newIds.length > 0) {
            return
        }

        // Create an initial testcase with default properties
        // Columns are derived from testcase properties - this is the correct mental model
        // Note: testcase schema expects properties inside `data` field
        const initialTestcase = {
            data: {
                input: "",
                correct_answer: "",
            },
        }

        // Add the initial testcase via the unified action
        set(testcaseMolecule.actions.add, initialTestcase)
    },
)
