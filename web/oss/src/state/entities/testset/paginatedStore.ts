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

import {atom, getDefaultStore} from "jotai"
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
 * API response row from /testsets/query
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
    deleted_at?: string | null
    deleted_by_id?: string | null
    tags?: string[]
    meta?: Record<string, unknown>
}

/**
 * Table row with key and skeleton flag
 */
export interface TestsetTableRow extends TestsetApiRow, InfiniteTableRowBase {
    deletedAt?: string | null
    deletedById?: string | null
}

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

export type TestsetTableMode = "active" | "archived"

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
const archivedTestsetsSearchTermAtom = atom("")
const archivedTestsetsDateCreatedFilterAtom = atom<TestsetDateRange | null>(null)
const archivedTestsetsDateModifiedFilterAtom = atom<TestsetDateRange | null>(null)

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

const archivedTestsetsPaginatedMetaAtom = atom<TestsetPaginatedMeta>((get) => {
    const projectId = get(projectIdAtom)
    const searchTerm = get(archivedTestsetsSearchTermAtom)
    const dateCreatedFilter = get(archivedTestsetsDateCreatedFilterAtom)
    const dateModifiedFilter = get(archivedTestsetsDateModifiedFilterAtom)

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
 * Fetch testsets with server-side pagination via POST /testsets/query
 */
async function fetchTestsetsPage({
    meta,
    limit,
    cursor,
    includeArchived = false,
}: {
    meta: TestsetPaginatedMeta
    limit: number
    offset: number
    cursor: string | null
    includeArchived?: boolean
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
        include_archived: includeArchived,
    }

    // Add search query if provided
    if (meta.searchTerm && meta.searchTerm.trim()) {
        queryPayload.testset = {
            name: meta.searchTerm.trim(),
        }
    }

    try {
        const response = await axios.post(`${getAgentaApiUrl()}/testsets/query`, queryPayload, {
            params: {project_id: meta.projectId},
        })

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
            deleted_at: testset.deleted_at,
            deleted_by_id: testset.deleted_by_id,
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

async function fetchArchivedTestsets(meta: TestsetPaginatedMeta): Promise<TestsetApiRow[]> {
    const rows: TestsetApiRow[] = []
    let cursor: string | null = null

    do {
        const page = await fetchTestsetsPage({
            meta,
            limit: 100,
            offset: 0,
            cursor,
            includeArchived: true,
        })

        rows.push(...page.rows.filter((row) => Boolean(row.deleted_at)))
        cursor = page.nextCursor
    } while (cursor)

    rows.sort((a, b) => {
        const aTime = a.deleted_at ? Date.parse(a.deleted_at) : 0
        const bTime = b.deleted_at ? Date.parse(b.deleted_at) : 0
        return bTime - aTime
    })

    return rows
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

const archivedTestsetPaginatedStore = createPaginatedEntityStore<
    TestsetTableRow,
    TestsetApiRow,
    TestsetPaginatedMeta
>({
    entityName: "archived-testset",
    metaAtom: archivedTestsetsPaginatedMetaAtom,
    fetchPage: async ({meta, limit, cursor}) => {
        const archivedRows = await fetchArchivedTestsets(meta)
        const offset = cursor ? Number.parseInt(cursor, 10) || 0 : 0
        const rows = archivedRows.slice(offset, offset + limit)
        const nextOffset = offset + rows.length

        return {
            rows,
            totalCount: archivedRows.length,
            hasMore: nextOffset < archivedRows.length,
            nextOffset: null,
            nextCursor: nextOffset < archivedRows.length ? String(nextOffset) : null,
            nextWindowing: null,
        }
    },
    rowConfig: {
        getRowId: (row) => row.id,
        skeletonDefaults: {
            id: "",
            name: "",
            created_at: "",
            updated_at: "",
            deletedAt: null,
            deletedById: null,
        },
    },
    transformRow: (row) => ({
        key: row.id,
        __isSkeleton: false,
        ...row,
        deletedAt: row.deleted_at ?? null,
        deletedById: row.deleted_by_id ?? null,
    }),
    isEnabled: (meta) => Boolean(meta?.projectId),
})

export function invalidateTestsetManagementQueries() {
    const store = getDefaultStore()
    store.set(testsetPaginatedStore.refreshAtom)
    store.set(archivedTestsetPaginatedStore.refreshAtom)
}

export function getTestsetTableState(mode: TestsetTableMode = "active") {
    if (mode === "archived") {
        return {
            mode,
            searchTermAtom: archivedTestsetsSearchTermAtom,
            dateCreatedFilterAtom: archivedTestsetsDateCreatedFilterAtom,
            dateModifiedFilterAtom: archivedTestsetsDateModifiedFilterAtom,
            paginatedStore: archivedTestsetPaginatedStore,
        }
    }

    return {
        mode,
        searchTermAtom: testsetsSearchTermAtom,
        dateCreatedFilterAtom: testsetsDateCreatedFilterAtom,
        dateModifiedFilterAtom: testsetsDateModifiedFilterAtom,
        paginatedStore: testsetPaginatedStore,
    }
}
