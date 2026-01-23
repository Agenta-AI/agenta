/**
 * Testset Paginated Store
 *
 * Provides paginated fetching for testsets with InfiniteVirtualTable integration.
 */

import {projectIdAtom, axios, getAgentaApiUrl} from "@agenta/shared"
import {
    createPaginatedEntityStore,
    type InfiniteTableFetchResult,
    type PaginatedEntityStore,
} from "@agenta/ui"
import {atom} from "jotai"
import type {Atom} from "jotai"
import {atomWithStorage} from "jotai/utils"

import type {TestsetApiRow, TestsetTableRow, TestsetDateRange, TestsetQueryMeta} from "../core"

// ============================================================================
// FILTER ATOMS
// ============================================================================

/**
 * Search term for filtering testsets
 */
export const testsetsSearchTermAtom = atom<string>("")

/**
 * Export format preference (persisted)
 */
export const testsetsExportFormatAtom = atomWithStorage<"csv" | "json">(
    "agenta:testsets:export-format",
    "csv",
)

/**
 * Date created filter
 */
export const testsetsDateCreatedAtom = atom<TestsetDateRange | null>(null)

/**
 * Date modified filter
 */
export const testsetsDateModifiedAtom = atom<TestsetDateRange | null>(null)

// ============================================================================
// META ATOM
// ============================================================================

/**
 * Meta atom providing query parameters for paginated testsets
 */
export const testsetsPaginatedMetaAtom: Atom<TestsetQueryMeta> = atom((get) => ({
    projectId: get(projectIdAtom),
    searchTerm: get(testsetsSearchTermAtom) || undefined,
    dateCreated: get(testsetsDateCreatedAtom) ?? undefined,
    dateModified: get(testsetsDateModifiedAtom) ?? undefined,
}))

// ============================================================================
// FETCH FUNCTION
// ============================================================================

interface FetchTestsetsWindowParams {
    projectId: string
    limit: number
    cursor?: string | null
    searchTerm?: string
    dateCreated?: TestsetDateRange
    dateModified?: TestsetDateRange
}

interface FetchTestsetsWindowResponse {
    rows: TestsetApiRow[]
    totalCount: number
    nextCursor: string | null
    hasMore: boolean
}

/**
 * Fetch testsets window from API using the preview/testsets/query endpoint
 */
async function fetchTestsetsWindow(
    params: FetchTestsetsWindowParams,
): Promise<FetchTestsetsWindowResponse> {
    const {projectId, limit, cursor, searchTerm, dateCreated, dateModified} = params

    // Build the windowing payload for cursor-based pagination
    interface WindowingPayload {
        windowing?: {
            limit?: number
            next?: string
            newest?: string
            oldest?: string
        }
    }

    const payload: WindowingPayload = {}

    // Add windowing params
    if (limit || cursor || dateCreated || dateModified) {
        payload.windowing = {}

        if (limit) {
            payload.windowing.limit = limit
        }

        if (cursor) {
            payload.windowing.next = cursor
        }

        // Date filters
        if (dateCreated?.start) {
            payload.windowing.newest = dateCreated.start
        }
        if (dateCreated?.end) {
            payload.windowing.oldest = dateCreated.end
        }
    }

    try {
        // Use POST to /preview/testsets/query with project_id as query param
        let url = `${getAgentaApiUrl()}/preview/testsets/query?project_id=${projectId}`

        // Add search term as query param if provided
        if (searchTerm) {
            url = `${url}&search=${encodeURIComponent(searchTerm)}`
        }

        const response = await axios.post(url, payload)

        const data = response.data
        const testsets = data.testsets ?? []

        // Parse cursor from windowing.next (API response format)
        const nextCursor = data.windowing?.next ?? null

        return {
            rows: testsets.map((testset: TestsetApiRow) => ({
                ...testset,
                key: testset.id,
            })),
            totalCount: data.count ?? testsets.length,
            nextCursor,
            hasMore: Boolean(nextCursor),
        }
    } catch (error) {
        console.error("[fetchTestsetsWindow] Error:", error)
        return {
            rows: [],
            totalCount: 0,
            nextCursor: null,
            hasMore: false,
        }
    }
}

// ============================================================================
// PAGINATED STORE
// ============================================================================

/**
 * Default values for skeleton rows during loading
 */
const skeletonDefaults: Partial<TestsetTableRow> = {
    id: "",
    name: "",
    created_at: null,
    updated_at: null,
}

/**
 * Paginated store for testsets table
 */
export const testsetPaginatedStore: PaginatedEntityStore<
    TestsetTableRow,
    TestsetApiRow,
    TestsetQueryMeta
> = createPaginatedEntityStore<TestsetTableRow, TestsetApiRow, TestsetQueryMeta>({
    entityName: "testset",
    metaAtom: testsetsPaginatedMetaAtom,
    fetchPage: async ({meta, limit, cursor}): Promise<InfiniteTableFetchResult<TestsetApiRow>> => {
        if (!meta.projectId) {
            return {
                rows: [],
                totalCount: 0,
                nextCursor: null,
                nextOffset: null,
                nextWindowing: null,
                hasMore: false,
            }
        }

        const response = await fetchTestsetsWindow({
            projectId: meta.projectId,
            limit,
            cursor,
            searchTerm: meta.searchTerm,
            dateCreated: meta.dateCreated,
            dateModified: meta.dateModified,
        })

        return {
            ...response,
            nextOffset: null,
            nextWindowing: null,
        }
    },
    rowConfig: {
        getRowId: (row) => row.id,
        skeletonDefaults,
    },
    transformRow: (apiRow): TestsetTableRow => ({
        ...apiRow,
        key: apiRow.id,
    }),
    isEnabled: (meta) => Boolean(meta?.projectId),
})

// ============================================================================
// FILTERS NAMESPACE
// ============================================================================

/**
 * Filter atoms namespace for testsets
 */
export const testsetFilters = {
    searchTerm: testsetsSearchTermAtom,
    exportFormat: testsetsExportFormatAtom,
    dateCreated: testsetsDateCreatedAtom,
    dateModified: testsetsDateModifiedAtom,
}
