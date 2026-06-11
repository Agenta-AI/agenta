/**
 * EvaluationRun Paginated Store
 *
 * Provides paginated fetching for evaluation runs with InfiniteVirtualTable
 * integration. Uses cursor-based pagination via the backend's Windowing model.
 *
 * Modeled faithfully on `@agenta/entities/simpleQueue` `paginatedStore.ts`. Unlike
 * the queue store, there is NO post-fetch display filter — the run-list renders
 * every matching run; filtering is expressed through query params (status / kind
 * flags) and a client-side search term.
 */

import {queryEvaluationRunsList, type EvaluationRun} from "@agenta/entities/evaluationRun"
import {
    createPaginatedEntityStore,
    type InfiniteTableFetchResult,
    type WindowingState,
} from "@agenta/entities/shared"
import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"

/**
 * Sort newest-first by `created_at`. The backend pages by UUID7 `id` (insert
 * order), which normally tracks `created_at` — but they diverge when rows carry
 * an explicit `created_at` (seeded/imported data), so we sort on the timestamp
 * the table actually displays. ISO-8601 strings sort lexically = chronologically.
 *
 * (The queue store no longer needs this: its backend now windows by
 * `created_at` directly. Runs still page by `id`.)
 */
function byCreatedAtDesc(a: EvaluationRun, b: EvaluationRun): number {
    return (b.created_at ?? "").localeCompare(a.created_at ?? "")
}

// ============================================================================
// TABLE ROW TYPE
// ============================================================================

/**
 * EvaluationRun table row — EvaluationRun with required `key` for table
 * rendering. Uses type intersection (not interface extends) because Zod inferred
 * types lack an index signature required by InfiniteTableRowBase.
 */
export type EvaluationRunTableRow = EvaluationRun & {
    key: string
    __isSkeleton?: boolean
    [key: string]: unknown
}

// ============================================================================
// QUERY META
// ============================================================================

interface EvaluationRunQueryMeta {
    projectId: string | null
    /** Run "kind" lives in JSONB flags on the backend — sent as a flags filter. */
    kind?: string | null
    /** Run status filter (e.g. "running" | "closed" | ...). */
    status?: string | null
    searchTerm?: string
}

// ============================================================================
// FILTER ATOMS
// ============================================================================

/**
 * Status filter for the run list (e.g. "running" | "closed"; null for all).
 */
export const evaluationRunStatusFilterAtom = atom<string | null>(null)

/**
 * Kind filter for the run list. Runs encode "kind" inside JSONB `flags`, so this
 * is forwarded as a flags-containment filter (null for all).
 */
export const evaluationRunKindFilterAtom = atom<string | null>(null)

/**
 * Search term for filtering runs by name. Applied client-side — the backend
 * `query_runs` has no free-text filter (per the eval-filtering RFC).
 */
export const evaluationRunSearchTermAtom = atom<string>("")

// ============================================================================
// META ATOM
// ============================================================================

const evaluationRunPaginatedMetaAtom = atom<EvaluationRunQueryMeta>((get) => ({
    projectId: get(projectIdAtom),
    kind: get(evaluationRunKindFilterAtom) || undefined,
    status: get(evaluationRunStatusFilterAtom) || undefined,
    searchTerm: get(evaluationRunSearchTermAtom) || undefined,
}))

// ============================================================================
// PAGINATED STORE
// ============================================================================

const skeletonDefaults: Partial<EvaluationRunTableRow> = {
    id: "",
    name: null,
    description: null,
    status: null,
    flags: null,
    data: null,
    created_at: null,
    updated_at: null,
    key: "",
}

export const evaluationRunPaginatedStore = createPaginatedEntityStore<
    EvaluationRunTableRow,
    EvaluationRun,
    EvaluationRunQueryMeta
>({
    entityName: "evaluationRun",
    metaAtom: evaluationRunPaginatedMetaAtom,
    fetchPage: async ({meta, limit, cursor}): Promise<InfiniteTableFetchResult<EvaluationRun>> => {
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

        const response = await queryEvaluationRunsList({
            projectId: meta.projectId,
            flags: meta.kind ? {kind: meta.kind} : null,
            statuses: meta.status ? [meta.status] : null,
            windowing: windowing as unknown as Record<string, unknown>,
        })

        const term = meta.searchTerm?.trim().toLowerCase()
        const runs = term
            ? response.runs.filter((run) => (run.name ?? "").toLowerCase().includes(term))
            : response.runs

        const nextCursor =
            typeof response.windowing?.next === "string" ? response.windowing.next : null

        return {
            rows: [...runs].sort(byCreatedAtDesc),
            totalCount: null,
            hasMore: !!nextCursor,
            nextCursor,
            nextOffset: null,
            nextWindowing: null,
        }
    },
    rowConfig: {
        getRowId: (row) => row.id,
        skeletonDefaults,
    },
    transformRow: (apiRow): EvaluationRunTableRow => ({
        ...apiRow,
        key: apiRow.id,
    }),
    isEnabled: (meta) => Boolean(meta?.projectId),
    listCountsConfig: {
        totalCountMode: "unknown",
    },
})
