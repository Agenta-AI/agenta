/**
 * SimpleQueue Paginated Store
 *
 * Provides paginated fetching for simple queues with InfiniteVirtualTable integration.
 * Uses cursor-based pagination via the backend's Windowing model.
 */

import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"

import {createPaginatedEntityStore} from "../../shared/paginated"
import type {InfiniteTableFetchResult, WindowingState} from "../../shared/tableTypes"
import {querySimpleQueues} from "../api"
import type {SimpleQueue, SimpleQueueKind} from "../core"

// ============================================================================
// DISPLAY FEATURE FLAGS
// ============================================================================
//
// Compile-time switches for which queues the table shows. The API returns
// every queue for the project; these decide what we actually render. Flip them
// here (no env var, no deploy config) when the product decision changes.

/**
 * When true, hide non-default queues from the table (show only `is_default`).
 * Today every web-created queue adopts its run's default queue, so non-default
 * queues are an internal detail; set false to surface them.
 */
const SHOW_ONLY_DEFAULT_QUEUES = true

/**
 * When true, show only queues sourced directly from traces or testcases (the
 * annotation-queue surface). Set false to also include source-backed queues
 * (queries/testsets), e.g. human-eval default queues.
 */
const SHOW_ONLY_DIRECT_SOURCE_QUEUES = true

const DIRECT_SOURCE_KINDS = new Set(["traces", "testcases"])

function isQueueVisible(queue: SimpleQueue): boolean {
    if (SHOW_ONLY_DEFAULT_QUEUES && !queue.flags?.is_default) {
        return false
    }
    if (SHOW_ONLY_DIRECT_SOURCE_QUEUES && !DIRECT_SOURCE_KINDS.has(queue.data?.kind ?? "")) {
        return false
    }
    return true
}

/**
 * Sort newest-first by `created_at`. The backend pages by UUID7 `id` (insert
 * order), which normally tracks `created_at` — but they diverge when rows carry
 * an explicit `created_at` (seeded/imported data), so we sort on the timestamp
 * the table actually displays. ISO-8601 strings sort lexically = chronologically.
 */
function byCreatedAtDesc(a: SimpleQueue, b: SimpleQueue): number {
    return (b.created_at ?? "").localeCompare(a.created_at ?? "")
}

// ============================================================================
// TABLE ROW TYPE
// ============================================================================

/**
 * SimpleQueue table row — SimpleQueue with required `key` for table rendering.
 * Uses type intersection (not interface extends) because Zod inferred types
 * lack an index signature required by InfiniteTableRowBase.
 */
export type SimpleQueueTableRow = SimpleQueue & {
    key: string
    __isSkeleton?: boolean
    [key: string]: unknown
}

// ============================================================================
// QUERY META
// ============================================================================

interface SimpleQueueQueryMeta {
    projectId: string | null
    kind?: SimpleQueueKind | null
    searchTerm?: string
}

// ============================================================================
// FILTER ATOMS
// ============================================================================

/**
 * Kind filter for the queues list (traces | testcases | null for all)
 */
export const simpleQueueKindFilterAtom = atom<SimpleQueueKind | null>(null)

/**
 * Search term for filtering queues by name
 */
export const simpleQueueSearchTermAtom = atom<string>("")

// ============================================================================
// META ATOM
// ============================================================================

const simpleQueuePaginatedMetaAtom = atom<SimpleQueueQueryMeta>((get) => ({
    projectId: get(projectIdAtom),
    kind: get(simpleQueueKindFilterAtom) || undefined,
    searchTerm: get(simpleQueueSearchTermAtom) || undefined,
}))

// ============================================================================
// PAGINATED STORE
// ============================================================================

const skeletonDefaults: Partial<SimpleQueueTableRow> = {
    id: "",
    name: null,
    status: null,
    data: null,
    created_at: null,
    updated_at: null,
    key: "",
}

export const simpleQueuePaginatedStore = createPaginatedEntityStore<
    SimpleQueueTableRow,
    SimpleQueue,
    SimpleQueueQueryMeta
>({
    entityName: "simpleQueue",
    metaAtom: simpleQueuePaginatedMetaAtom,
    fetchPage: async ({meta, limit, cursor}): Promise<InfiniteTableFetchResult<SimpleQueue>> => {
        if (!meta.projectId) {
            return {
                rows: [],
                totalCount: 0,
                hasMore: false,
                nextCursor: null,
                nextOffset: null,
                nextWindowing: null,
            }
        }

        const windowing: WindowingState = {
            next: cursor,
            limit,
            order: "descending",
        }

        const response = await querySimpleQueues({
            projectId: meta.projectId,
            kind: meta.kind,
            name: meta.searchTerm,
            windowing,
        })

        return {
            rows: response.queues.filter(isQueueVisible).sort(byCreatedAtDesc),
            totalCount: null,
            hasMore: !!response.windowing?.next,
            nextCursor: response.windowing?.next ?? null,
            nextOffset: null,
            nextWindowing: null,
        }
    },
    rowConfig: {
        getRowId: (row) => row.id,
        skeletonDefaults,
    },
    transformRow: (apiRow): SimpleQueueTableRow => ({
        ...apiRow,
        key: apiRow.id,
    }),
    isEnabled: (meta) => Boolean(meta?.projectId),
    listCountsConfig: {
        totalCountMode: "unknown",
    },
})
