/**
 * Testcase Paginated Store
 *
 * Provides cursor-based pagination for testcases table using the entity controller pattern.
 * Includes support for:
 * - Client-side rows (unsaved drafts)
 * - Soft-deleted row filtering
 * - Debounced search
 *
 * @example
 * ```typescript
 * import { testcasePaginatedStore } from '@/state/entities/testcase'
 *
 * // In components with InfiniteVirtualTable
 * const {rows, loadNextPage} = useInfiniteTablePagination({
 *   store: testcasePaginatedStore.store,
 *   scopeId: `testcases-${revisionId}`,
 *   pageSize: 50,
 * })
 *
 * // Refresh after mutations
 * const refresh = useSetAtom(testcasePaginatedStore.refreshAtom)
 * refresh()
 * ```
 */

import {atom} from "jotai"

import type {BaseTableMeta} from "@/oss/components/InfiniteVirtualTable/helpers/createSimpleTableStore"
import type {
    InfiniteTableFetchResult,
    InfiniteTableRowBase,
} from "@/oss/components/InfiniteVirtualTable/types"
import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {projectIdAtom} from "@/oss/state/project"

import {createPaginatedEntityStore} from "../shared"

import {currentRevisionIdAtom} from "./queries"
import {flattenTestcase, testcasesResponseSchema} from "./schema"
import {
    deletedEntityIdsAtom,
    newEntityIdsAtom,
    testcaseDraftAtomFamily,
} from "./testcaseEntity"

// ============================================================================
// TYPES
// ============================================================================

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
 * Metadata for the testcases paginated query
 */
export interface TestcasePaginatedMeta extends BaseTableMeta {
    /** Revision ID (testset_id from URL) */
    revisionId: string | null
    /** Search term for filtering */
    searchTerm: string
}

export const PAGE_SIZE = 50

// ============================================================================
// CONTEXT ATOMS
// ============================================================================

/**
 * The current revision ID for the testcases table.
 * Re-exported from queries for backward compatibility.
 * @see currentRevisionIdAtom in queries.ts for the canonical location
 */
export const testcasesRevisionIdAtom = currentRevisionIdAtom

// ============================================================================
// FILTER ATOMS
// ============================================================================

/**
 * Search term for filtering testcases (immediate value for UI)
 * Not persisted - clears on page refresh
 */
export const testcasesSearchTermAtom = atom<string>("")

/**
 * Debounced search term (300ms delay to reduce API calls)
 */
const debouncedSearchTermBaseAtom = atom("")

// Timer ID for debouncing
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Write-only atom to set search term with debouncing
 */
export const setDebouncedSearchTermAtom = atom(null, (_get, set, searchTerm: string) => {
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

// ============================================================================
// META ATOM
// ============================================================================

/**
 * Combined metadata atom for testcases paginated query
 * Uses debounced search term to prevent excessive API calls
 */
export const testcasesPaginatedMetaAtom = atom<TestcasePaginatedMeta>((get) => {
    const projectId = get(projectIdAtom)
    const revisionId = get(testcasesRevisionIdAtom)
    const searchTerm = get(debouncedSearchTermBaseAtom)

    return {
        projectId,
        revisionId,
        searchTerm,
    }
})

// ============================================================================
// CLIENT ROWS ATOM
// ============================================================================

/**
 * Atom that provides client-created rows to the store
 * These are unsaved drafts that appear at the top of the table
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
 * Atom providing IDs of soft-deleted testcases to exclude from display
 */
const excludedTestcaseIdsAtom = atom((get) => get(deletedEntityIdsAtom))

// ============================================================================
// FETCH FUNCTION
// ============================================================================

/**
 * Fetch testcases for a revision with pagination
 */
async function fetchTestcasesPage({
    meta,
    limit,
    cursor,
}: {
    meta: TestcasePaginatedMeta
    limit: number
    offset: number
    cursor: string | null
}): Promise<InfiniteTableFetchResult<TestcaseTableRow>> {
    // Skip fetch if no project/revision or if "create" mode
    if (!meta.projectId || !meta.revisionId || meta.revisionId === "create") {
        return {
            rows: [],
            totalCount: 0,
            hasMore: false,
            nextOffset: null,
            nextCursor: null,
            nextWindowing: null,
        }
    }

    // Validate revision ID format (UUID)
    const isValidUuid = meta.revisionId.length === 36 && meta.revisionId.includes("-")
    if (!isValidUuid) {
        return {
            rows: [],
            totalCount: 0,
            hasMore: false,
            nextOffset: null,
            nextCursor: null,
            nextWindowing: null,
        }
    }

    try {
        const response = await axios.post(
            `${getAgentaApiUrl()}/preview/testcases/query`,
            {
                testset_revision_id: meta.revisionId,
                windowing: {
                    limit,
                    ...(cursor && {next: cursor}),
                },
            },
            {params: {project_id: meta.projectId}},
        )

        // Validate response with Zod
        const validated = testcasesResponseSchema.parse(response.data)

        // Flatten testcases for table display
        let rows = validated.testcases.map((tc) => {
            const flattened = flattenTestcase(tc)
            return {
                ...flattened,
                key: flattened.id,
            } as TestcaseTableRow
        })

        // Apply client-side search filtering if searchTerm exists
        if (meta.searchTerm) {
            const searchLower = meta.searchTerm.toLowerCase()
            rows = rows.filter((row) =>
                Object.values(row).some((value) =>
                    String(value || "")
                        .toLowerCase()
                        .includes(searchLower),
                ),
            )
        }

        return {
            rows,
            totalCount: meta.searchTerm ? rows.length : validated.count,
            hasMore: Boolean(validated.windowing?.next),
            nextOffset: rows.length,
            nextCursor: validated.windowing?.next || null,
            nextWindowing: null,
        }
    } catch (error) {
        console.error("[TestcasePaginatedStore] Failed to fetch testcases:", error)
        return {
            rows: [],
            totalCount: 0,
            hasMore: false,
            nextOffset: null,
            nextCursor: null,
            nextWindowing: null,
        }
    }
}

// ============================================================================
// PAGINATED STORE
// ============================================================================

/**
 * Testcase paginated store for InfiniteVirtualTable
 *
 * Provides cursor-based pagination with:
 * - Client-side rows (unsaved drafts)
 * - Soft-delete filtering
 * - Debounced search
 * - Refresh trigger for cache invalidation
 */
export const testcasePaginatedStore = createPaginatedEntityStore<
    TestcaseTableRow,
    TestcaseTableRow,
    TestcasePaginatedMeta
>({
    entityName: "testcase",
    metaAtom: testcasesPaginatedMetaAtom,
    fetchPage: fetchTestcasesPage,
    rowConfig: {
        getRowId: (row) => row.id || String(row.key),
        skeletonDefaults: {
            id: "",
            testset_id: "",
            created_at: "",
        },
    },
    clientRowsAtom: clientTestcaseRowsAtom,
    excludeRowIdsAtom: excludedTestcaseIdsAtom,
    isEnabled: (meta) => Boolean(meta?.projectId && meta?.revisionId),
})

// ============================================================================
// DERIVED ATOMS
// ============================================================================

/**
 * Atom that reads the current fetching state from the paginated store
 */
export const testcasesFetchingAtom = atom((get) => {
    const meta = get(testcasesPaginatedMetaAtom)
    if (!meta.revisionId) return false

    const scopeId = `testcases-${meta.revisionId}`
    const paginationAtom = testcasePaginatedStore.store.atoms.paginationAtom({
        scopeId,
        pageSize: PAGE_SIZE,
    })
    const pagination = get(paginationAtom)

    return pagination.isFetching
})
