/**
 * SimpleQueue Tasks Paginated Store
 *
 * Provides paginated fetching for annotation tasks (evaluation scenarios)
 * within a specific queue, with InfiniteVirtualTable integration.
 * Uses cursor-based pagination via the backend's Windowing model.
 */

import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"

import {createPaginatedEntityStore} from "../../shared/paginated"
import type {InfiniteTableFetchResult, WindowingState} from "../../shared/tableTypes"
import {querySimpleQueueScenarios} from "../api"
import type {EvaluationScenario, EvaluationStatus} from "../core"

// ============================================================================
// TABLE ROW TYPE
// ============================================================================

/**
 * Task table row — EvaluationScenario enriched with queue context and table key.
 */
export type SimpleQueueTaskRow = EvaluationScenario & {
    key: string
    queueId: string
    queueName: string | null
    __isSkeleton?: boolean
    [key: string]: unknown
}

// ============================================================================
// QUERY META
// ============================================================================

interface TasksQueryMeta {
    projectId: string | null
    queueId: string | null
    userId: string | null
    status: EvaluationStatus | null
}

// ============================================================================
// FILTER ATOMS
// ============================================================================

/**
 * Selected queue ID for the tasks view.
 * When null, the IVT is disabled (user must select a queue).
 */
export const taskQueueIdAtom = atom<string | null>(null)

/**
 * Status filter for tasks (pending | success | failure | etc. | null for all).
 */
export const taskStatusFilterAtom = atom<EvaluationStatus | null>(null)

/**
 * Current user ID for filtering tasks assigned to the user.
 * Set from the page component via useEffect.
 */
export const taskUserIdAtom = atom<string | null>(null)

// ============================================================================
// META ATOM
// ============================================================================

const tasksPaginatedMetaAtom = atom<TasksQueryMeta>((get) => ({
    projectId: get(projectIdAtom),
    queueId: get(taskQueueIdAtom),
    userId: get(taskUserIdAtom),
    status: get(taskStatusFilterAtom),
}))

// ============================================================================
// PAGINATED STORE
// ============================================================================

const skeletonDefaults: Partial<SimpleQueueTaskRow> = {
    id: "",
    status: null,
    run_id: "",
    created_at: null,
    updated_at: null,
    key: "",
    queueId: "",
    queueName: null,
}

export const simpleQueueTasksPaginatedStore = createPaginatedEntityStore<
    SimpleQueueTaskRow,
    EvaluationScenario,
    TasksQueryMeta
>({
    entityName: "simpleQueueTask",
    metaAtom: tasksPaginatedMetaAtom,
    fetchPage: async ({
        meta,
        limit,
        cursor,
    }): Promise<InfiniteTableFetchResult<EvaluationScenario>> => {
        if (!meta.projectId || !meta.queueId) {
            return {
                rows: [],
                totalCount: null,
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

        const response = await querySimpleQueueScenarios({
            projectId: meta.projectId,
            queueId: meta.queueId,
            userId: meta.userId ?? undefined,
            scenario: meta.status ? {status: meta.status} : undefined,
            windowing,
        })

        return {
            rows: response.scenarios,
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
    transformRow: (apiRow): SimpleQueueTaskRow => ({
        ...apiRow,
        key: apiRow.id,
        queueId: "",
        queueName: null,
    }),
    isEnabled: (meta) => Boolean(meta?.projectId && meta?.queueId),
    listCountsConfig: {
        totalCountMode: "unknown",
    },
})
