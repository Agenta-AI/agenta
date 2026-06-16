/**
 * Query Registry Paginated Store
 *
 * Project-scoped list of SimpleQueries (flattened query + head-revision data).
 * Each row carries its filtering, variant_id, and revision_id inline, so the
 * table needs no per-row revision fetch — the head data comes from the list.
 *
 * Pagination: SimpleQueriesResponse does not echo a windowing cursor, so we use
 * keyset-by-id (descending) — the next cursor is the last row's id when the page
 * is full. TODO(verify): confirm the backend honors `windowing.next` for the
 * simple-queries list against a project with > limit queries.
 */

import {querySimpleQueries, type SimpleQuery} from "@agenta/entities/query"
import {createPaginatedEntityStore} from "@agenta/entities/shared"
import type {InfiniteTableFetchResult} from "@agenta/entities/shared"
import {projectIdAtom} from "@agenta/shared/state"
import {atom, getDefaultStore} from "jotai"

import {emptyFetchResult} from "@/oss/state/entities/shared"

import {querySearchTermAtom, type QueryRegistryStatus} from "./queryRegistryFilterAtoms"

// ============================================================================
// TABLE ROW TYPE
// ============================================================================

export interface QueryRegistryRow {
    key: string
    __isSkeleton?: boolean
    queryId: string
    variantId: string | null
    revisionId: string | null
    name: string
    slug: string | null
    /** Head revision's filtering tree — source for the filter-summary cell. */
    filtering: unknown
    /** Head revision's windowing (sampling rate / time bounds) — preserved on edit. */
    windowing: unknown
    createdAt: string | null
    createdById: string | null
    /** Revision version label, shown as a badge on expanded history rows. */
    version?: string | null
    /** Git-style commit message for this revision (head row = head revision's). */
    message?: string | null
    /** True for a lazily-loaded revision (child) row in the version-history expand. */
    __isRevisionChild?: boolean
    /** True when a revision (child) row is archived — shown tagged + restorable. */
    __isArchivedRevision?: boolean
    /** Placeholder row shown while a query's revisions are being fetched. */
    __isRevisionLoader?: boolean
    /** Injected revision-history rows (antd tree children). */
    children?: QueryRegistryRow[]
    [k: string]: unknown
}

// ============================================================================
// QUERY META
// ============================================================================

interface QueryRegistryMeta {
    projectId: string | null
    searchTerm?: string
    status: QueryRegistryStatus
}

// One meta atom per mode — `status` is baked in rather than read from a shared
// atom, so the active and archived routes drive independent stores (mirrors the
// Evaluators `getEvaluatorsTableState(mode)` factory and avoids a stale first
// fetch when landing directly on the archived route).
const queryRegistryMetaAtomByStatus = (status: QueryRegistryStatus) =>
    atom<QueryRegistryMeta>((get) => ({
        projectId: get(projectIdAtom),
        searchTerm: get(querySearchTermAtom) || undefined,
        status,
    }))

const skeletonDefaults: Partial<QueryRegistryRow> = {
    queryId: "",
    variantId: null,
    revisionId: null,
    name: "",
    slug: null,
    filtering: null,
    windowing: null,
    createdAt: null,
    createdById: null,
    key: "",
}

const toRow = (query: SimpleQuery): QueryRegistryRow => ({
    key: query.id ?? query.revision_id ?? "",
    queryId: query.id ?? "",
    variantId: query.variant_id ?? null,
    revisionId: query.revision_id ?? null,
    name: query.name ?? query.slug ?? query.id ?? "Untitled query",
    slug: query.slug ?? null,
    filtering: query.data?.filtering ?? null,
    windowing: query.data?.windowing ?? null,
    createdAt: query.created_at ?? null,
    createdById: query.created_by_id ?? null,
})

// ============================================================================
// PAGINATED STORE (per-mode factory)
// ============================================================================

const createQueryRegistryStore = (status: QueryRegistryStatus) =>
    createPaginatedEntityStore<QueryRegistryRow, SimpleQuery, QueryRegistryMeta>({
        entityName: status === "archived" ? "query-registry-archived" : "query-registry",
        metaAtom: queryRegistryMetaAtomByStatus(status),
        fetchPage: async ({
            meta,
            limit,
            cursor,
        }: {
            meta: QueryRegistryMeta
            limit?: number
            cursor?: string | null
        }): Promise<InfiniteTableFetchResult<SimpleQuery>> => {
            if (!meta.projectId) {
                return emptyFetchResult<SimpleQuery>()
            }

            const isArchived = meta.status === "archived"

            const response = await querySimpleQueries({
                projectId: meta.projectId,
                includeArchived: isArchived,
                windowing: {
                    next: cursor ?? undefined,
                    limit: limit ?? undefined,
                    order: "descending",
                },
            })

            const raw = response.queries ?? []
            let queries = raw

            // `include_archived` returns active + archived; split by the soft-delete
            // marker so each tab shows only its own rows.
            queries = queries.filter((query) =>
                isArchived ? Boolean(query.deleted_at) : !query.deleted_at,
            )

            // SimpleQueryQuery has no name filter — search is client-side on the page.
            if (meta.searchTerm) {
                const term = meta.searchTerm.toLowerCase()
                queries = queries.filter((query) =>
                    (query.name ?? query.slug ?? "").toLowerCase().includes(term),
                )
            }

            // Keyset cursor walks the full backend list, so derive it from the raw
            // (pre-filter) page — otherwise client-side filtering would skip rows.
            const full = typeof limit === "number" && raw.length >= limit
            const lastId = raw.length > 0 ? (raw[raw.length - 1]?.id ?? null) : null

            return {
                rows: queries,
                totalCount: response.count ?? null,
                hasMore: full && Boolean(lastId),
                nextCursor: full ? lastId : null,
                nextOffset: null,
                nextWindowing: null,
            }
        },
        rowConfig: {
            getRowId: (row) => row.id ?? row.revision_id ?? "",
            skeletonDefaults,
        },
        transformRow: toRow,
        isEnabled: (meta) => Boolean(meta?.projectId),
        listCountsConfig: {
            totalCountMode: "unknown",
        },
    })

// Lazily-built, cached store per mode. The table reads the store for its current
// mode; both are invalidated together after a create/edit/archive/restore.
const _stores = new Map<QueryRegistryStatus, ReturnType<typeof createQueryRegistryStore>>()

export function getQueryRegistryTableState(status: QueryRegistryStatus) {
    let store = _stores.get(status)
    if (!store) {
        store = createQueryRegistryStore(status)
        _stores.set(status, store)
    }
    return store
}

/**
 * Bumped on every registry invalidation. The table's batched revision-history
 * cache (parent version badges + child rows) is React state, not part of the
 * paginated store, so it watches this signal to refetch after a commit/restore.
 */
export const queryRegistryRevisionsRefreshAtom = atom(0)

export function invalidateQueryRegistryStore() {
    _stores.forEach((store) => store.invalidate())
    const store = getDefaultStore()
    store.set(queryRegistryRevisionsRefreshAtom, (v) => v + 1)
}
