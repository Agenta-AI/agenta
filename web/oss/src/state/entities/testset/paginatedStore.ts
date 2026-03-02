/**
 * Testset Paginated Store
 *
 * Provides cursor-based pagination for testsets table using the entity controller pattern.
 * Wraps the InfiniteVirtualTable store with entity-specific types and fetch logic.
 *
 * @example
 * ```typescript
 * import { testsetPaginatedStore } from '@/state/entities/testset'
 *
 * // In components with InfiniteVirtualTable
 * const {rows, loadNextPage} = useInfiniteTablePagination({
 *   store: testsetPaginatedStore.store,
 *   scopeId: projectId,
 *   pageSize: 50,
 * })
 *
 * // Refresh after mutations
 * const refresh = useSetAtom(testsetPaginatedStore.refreshAtom)
 * refresh()
 * ```
 */

import {atom} from "jotai"
import {atomWithStorage} from "jotai/vanilla/utils"

import type {BaseTableMeta} from "@/oss/components/InfiniteVirtualTable/helpers/createSimpleTableStore"
import type {
    InfiniteTableFetchResult,
    InfiniteTableRowBase,
} from "@/oss/components/InfiniteVirtualTable/types"
import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import type {ExportFileType} from "@/oss/services/testsets/api"
import {projectIdAtom} from "@/oss/state/project"

import {createPaginatedEntityStore} from "../shared"

// ============================================================================
// TYPES
// ============================================================================

/**
 * API response row from /preview/testsets/query
 */
export interface TestsetApiRow {
    id: string
    slug?: string
    name: string
    description?: string
    created_at: string
    updated_at: string
    created_by_id?: string
    updated_by_id?: string
    tags?: string[]
    meta?: Record<string, unknown>
}

/**
 * Table row with key and skeleton flag
 */
export interface TestsetTableRow extends TestsetApiRow, InfiniteTableRowBase {}

/**
 * Date range filter for testsets
 */
export interface TestsetDateRange {
    from?: string | null
    to?: string | null
}

/**
 * Metadata for the testsets paginated query
 */
export interface TestsetPaginatedMeta extends BaseTableMeta {
    searchTerm: string
    dateCreatedFilter: TestsetDateRange | null
    dateModifiedFilter: TestsetDateRange | null
}

// ============================================================================
// FILTER ATOMS
// ============================================================================

/**
 * Persisted atom for export format preference (CSV or JSON)
 */
export const testsetsExportFormatAtom = atomWithStorage<ExportFileType>(
    "testsets-export-format",
    "csv",
)

/**
 * Search term for filtering testsets
 */
export const testsetsSearchTermAtom = atomWithStorage<string>("testsets-search-term", "")

/**
 * Date created filter
 */
export const testsetsDateCreatedFilterAtom = atom<TestsetDateRange | null>(null)

/**
 * Date modified filter
 */
export const testsetsDateModifiedFilterAtom = atom<TestsetDateRange | null>(null)

// ============================================================================
// META ATOM
// ============================================================================

/**
 * Combined metadata atom for testsets paginated query
 */
export const testsetsPaginatedMetaAtom = atom<TestsetPaginatedMeta>((get) => {
    const projectId = get(projectIdAtom)
    const searchTerm = get(testsetsSearchTermAtom)
    const dateCreatedFilter = get(testsetsDateCreatedFilterAtom)
    const dateModifiedFilter = get(testsetsDateModifiedFilterAtom)

    return {
        projectId,
        searchTerm,
        dateCreatedFilter,
        dateModifiedFilter,
    }
})

// ============================================================================
// FETCH FUNCTION
// ============================================================================

interface QueryWindowingPayload {
    limit: number
    order?: "ascending" | "descending"
    next?: string
    newest?: string
    oldest?: string
}

/**
 * Fetch testsets with server-side pagination via POST /preview/testsets/query
 */
async function fetchTestsetsPage({
    meta,
    limit,
    cursor,
}: {
    meta: TestsetPaginatedMeta
    limit: number
    offset: number
    cursor: string | null
}): Promise<InfiniteTableFetchResult<TestsetApiRow>> {
    if (!meta.projectId) {
        return {
            rows: [],
            totalCount: 0,
            hasMore: false,
            nextOffset: null,
            nextCursor: null,
            nextWindowing: null,
        }
    }

    const windowingPayload: QueryWindowingPayload = {
        limit,
        order: "descending",
    }

    if (cursor) {
        windowingPayload.next = cursor
    }

    // Build date range from filters
    const dateCreatedFilter = meta.dateCreatedFilter
    const dateModifiedFilter = meta.dateModifiedFilter

    if (dateCreatedFilter?.to || dateModifiedFilter?.to) {
        windowingPayload.newest = dateCreatedFilter?.to || dateModifiedFilter?.to || undefined
    }
    if (dateCreatedFilter?.from || dateModifiedFilter?.from) {
        windowingPayload.oldest = dateCreatedFilter?.from || dateModifiedFilter?.from || undefined
    }

    // Build query payload
    const queryPayload: Record<string, unknown> = {
        windowing: windowingPayload,
    }

    // Add search query if provided
    if (meta.searchTerm && meta.searchTerm.trim()) {
        queryPayload.testset = {
            name: meta.searchTerm.trim(),
        }
    }

    try {
        const response = await axios.post(
            `${getAgentaApiUrl()}/preview/testsets/query`,
            queryPayload,
            {
                params: {project_id: meta.projectId},
            },
        )

        const data = response.data
        const testsets = data?.testsets ?? []
        const count = data?.count ?? testsets.length
        const windowing = data?.windowing

        // Map API response to table rows
        const rows: TestsetApiRow[] = testsets.map((testset: TestsetApiRow) => ({
            id: testset.id,
            slug: testset.slug,
            name: testset.name,
            description: testset.description,
            created_at: testset.created_at,
            updated_at: testset.updated_at,
            created_by_id: testset.created_by_id,
            updated_by_id: testset.updated_by_id,
            tags: testset.tags,
            meta: testset.meta,
        }))

        const hasMore = !!windowing?.next
        const nextCursor = windowing?.next ?? null

        return {
            rows,
            totalCount: count,
            hasMore,
            nextOffset: hasMore ? rows.length : null,
            nextCursor,
            nextWindowing: nextCursor ? {next: nextCursor} : null,
        }
    } catch (error) {
        console.error("[TestsetPaginatedStore] Failed to fetch testsets:", error)
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
 * Testset paginated store for InfiniteVirtualTable
 *
 * Provides cursor-based pagination with:
 * - Search filtering
 * - Date range filtering
 * - Refresh trigger for cache invalidation
 */
export const testsetPaginatedStore = createPaginatedEntityStore<
    TestsetTableRow,
    TestsetApiRow,
    TestsetPaginatedMeta
>({
    entityName: "testset",
    metaAtom: testsetsPaginatedMetaAtom,
    fetchPage: fetchTestsetsPage,
    rowConfig: {
        getRowId: (row) => row.id,
        skeletonDefaults: {
            id: "",
            name: "",
            created_at: "",
            updated_at: "",
        },
    },
    isEnabled: (meta) => Boolean(meta?.projectId),
})
