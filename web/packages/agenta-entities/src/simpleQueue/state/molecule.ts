/**
 * SimpleQueue Molecule
 *
 * Unified API for simple queue entity state management.
 * Follows the molecule pattern for consistency with other entities.
 *
 * @example
 * ```typescript
 * import { simpleQueueMolecule } from '@agenta/entities/simpleQueue'
 *
 * // Selectors (reactive)
 * const data = useAtomValue(simpleQueueMolecule.selectors.data(queueId))
 * const isDirty = useAtomValue(simpleQueueMolecule.selectors.isDirty(queueId))
 * const kind = useAtomValue(simpleQueueMolecule.selectors.kind(queueId))
 *
 * // Actions (write atoms)
 * const update = useSetAtom(simpleQueueMolecule.actions.update)
 * update(queueId, { name: 'New name' })
 *
 * // Imperative API (outside React)
 * const data = simpleQueueMolecule.get.data(queueId)
 * simpleQueueMolecule.set.update(queueId, { name: 'New name' })
 * ```
 *
 * @packageDocumentation
 */

import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import type {StoreOptions} from "../../shared"
import {
    createSimpleQueue,
    type CreateSimpleQueuePayload,
    fetchSimpleQueue,
    querySimpleQueues,
    querySimpleQueueScenarios,
    addSimpleQueueTraces,
    addSimpleQueueTestcases,
} from "../api"
import type {SimpleQueue, SimpleQueueKind, EvaluationStatus, EvaluationScenario} from "../core"

import {simpleQueuePaginatedStore} from "./paginatedStore"

// ============================================================================
// HELPERS
// ============================================================================

function getStore(options?: StoreOptions) {
    return options?.store ?? getDefaultStore()
}

// ============================================================================
// LIST QUERY
// ============================================================================

/**
 * Query atom for the simple queues list.
 * Automatically fetches when projectId is set.
 */
export const simpleQueuesListQueryAtom = atomWithQuery((get) => {
    const projectId = get(projectIdAtom)
    return {
        queryKey: ["simpleQueues", "list", projectId],
        queryFn: async () => {
            if (!projectId) return {count: 0, queues: []}
            return querySimpleQueues({projectId})
        },
        enabled: get(sessionAtom) && !!projectId,
        staleTime: 30_000,
        retry: false,
    }
})

/**
 * Derived atom for the simple queues list data.
 */
export const simpleQueuesListDataAtom = atom<SimpleQueue[]>((get) => {
    const query = get(simpleQueuesListQueryAtom)
    return query.data?.queues ?? []
})

// ============================================================================
// SINGLE ENTITY QUERY
// ============================================================================

/**
 * Query atom family for fetching a single simple queue by ID.
 */
export const simpleQueueQueryAtomFamily = atomFamily((queueId: string) =>
    atomWithQuery((get) => {
        const projectId = get(projectIdAtom)
        return {
            queryKey: ["simpleQueue", queueId, projectId],
            queryFn: async (): Promise<SimpleQueue | null> => {
                if (!projectId || !queueId) return null
                return fetchSimpleQueue({id: queueId, projectId})
            },
            enabled: get(sessionAtom) && !!projectId && !!queueId,
            staleTime: 30_000,
        }
    }),
)

// ============================================================================
// DRAFT STATE
// ============================================================================

/**
 * Draft state per queue (local edits before save).
 */
export const simpleQueueDraftAtomFamily = atomFamily((_queueId: string) =>
    atom<Partial<SimpleQueue> | null>(null),
)

/**
 * Merged entity atom: server data + local draft overlay.
 */
export const simpleQueueEntityAtomFamily = atomFamily((queueId: string) =>
    atom<SimpleQueue | null>((get) => {
        const query = get(simpleQueueQueryAtomFamily(queueId))
        const serverData = query.data ?? null
        const draft = get(simpleQueueDraftAtomFamily(queueId))

        if (!serverData) return draft as SimpleQueue | null
        if (!draft) return serverData

        return {
            ...serverData,
            ...draft,
            data: {
                ...serverData.data,
                ...draft.data,
            },
        } as SimpleQueue
    }),
)

/**
 * Is the queue dirty (has local edits)?
 */
export const simpleQueueIsDirtyAtomFamily = atomFamily((queueId: string) =>
    atom<boolean>((get) => {
        const draft = get(simpleQueueDraftAtomFamily(queueId))
        return draft !== null
    }),
)

// ============================================================================
// MUTATIONS (Write Atoms)
// ============================================================================

/**
 * Update queue draft state.
 */
export const updateSimpleQueueDraftAtom = atom(
    null,
    (_get, set, queueId: string, updates: Partial<SimpleQueue>) => {
        const current = _get(simpleQueueDraftAtomFamily(queueId))
        set(simpleQueueDraftAtomFamily(queueId), {
            ...current,
            ...updates,
        })
    },
)

/**
 * Discard queue draft (reset to server state).
 */
export const discardSimpleQueueDraftAtom = atom(null, (_get, set, queueId: string) => {
    set(simpleQueueDraftAtomFamily(queueId), null)
})

/**
 * Create a new simple queue on the server.
 * Invalidates list + paginated store on success.
 *
 * @returns The created SimpleQueue, or null on failure.
 */
export const createSimpleQueueAtom = atom(
    null,
    async (get, set, payload: CreateSimpleQueuePayload): Promise<SimpleQueue | null> => {
        const projectId = get(projectIdAtom)
        if (!projectId) return null

        const queue = await createSimpleQueue(projectId, payload)
        if (queue) {
            invalidateSimpleQueuesListCache()
            set(simpleQueuePaginatedStore.refreshAtom)
        }
        return queue
    },
)

/**
 * Add trace IDs to an existing simple queue.
 * Invalidates the queue's detail cache + paginated store on success.
 *
 * @returns The queue ID on success, or null on failure.
 */
export const addTracesToQueueAtom = atom(
    null,
    async (get, set, queueId: string, traceIds: string[]): Promise<string | null> => {
        const projectId = get(projectIdAtom)
        if (!projectId) return null

        const result = await addSimpleQueueTraces(projectId, queueId, traceIds)
        if (result.queue_id) {
            invalidateSimpleQueueCache(queueId)
            invalidateSimpleQueuesListCache()
            set(simpleQueuePaginatedStore.refreshAtom)
        }
        return result.queue_id ?? null
    },
)

/**
 * Add testcase IDs to an existing simple queue.
 * Invalidates the queue's detail cache + paginated store on success.
 *
 * @returns The queue ID on success, or null on failure.
 */
export const addTestcasesToQueueAtom = atom(
    null,
    async (get, set, queueId: string, testcaseIds: string[]): Promise<string | null> => {
        const projectId = get(projectIdAtom)
        if (!projectId) return null

        const result = await addSimpleQueueTestcases(projectId, queueId, testcaseIds)
        if (result.queue_id) {
            invalidateSimpleQueueCache(queueId)
            invalidateSimpleQueuesListCache()
            set(simpleQueuePaginatedStore.refreshAtom)
        }
        return result.queue_id ?? null
    },
)

// ============================================================================
// CACHE INVALIDATION
// ============================================================================

/**
 * Invalidate the simple queues list cache.
 */
export function invalidateSimpleQueuesListCache(options?: StoreOptions) {
    const store = getStore(options)
    const current = store.get(simpleQueuesListQueryAtom)
    if (current?.refetch) {
        current.refetch()
    }
}

/**
 * Invalidate a single queue's cache.
 */
export function invalidateSimpleQueueCache(queueId: string, options?: StoreOptions) {
    const store = getStore(options)
    const current = store.get(simpleQueueQueryAtomFamily(queueId))
    if (current?.refetch) {
        current.refetch()
    }
}

// ============================================================================
// DERIVED SELECTORS
// ============================================================================

/**
 * Queue data selector (merged server + draft).
 */
const dataAtomFamily = atomFamily((queueId: string) =>
    atom<SimpleQueue | null>((get) => get(simpleQueueEntityAtomFamily(queueId))),
)

/**
 * Queue query state selector.
 */
const queryAtomFamily = atomFamily((queueId: string) =>
    atom((get) => {
        const query = get(simpleQueueQueryAtomFamily(queueId))
        return {
            data: query.data ?? null,
            isPending: query.isPending,
            isError: query.isError,
            error: query.error ?? null,
        }
    }),
)

/**
 * Queue kind selector (traces | testcases).
 */
const kindAtomFamily = atomFamily((queueId: string) =>
    atom<SimpleQueueKind | null>((get) => {
        const entity = get(simpleQueueEntityAtomFamily(queueId))
        return entity?.data?.kind ?? null
    }),
)

/**
 * Queue status selector.
 */
const statusAtomFamily = atomFamily((queueId: string) =>
    atom<EvaluationStatus | null>((get) => {
        const entity = get(simpleQueueEntityAtomFamily(queueId))
        return (entity?.status as EvaluationStatus | null) ?? null
    }),
)

/**
 * Queue name selector.
 */
const nameAtomFamily = atomFamily((queueId: string) =>
    atom<string | null>((get) => {
        const entity = get(simpleQueueEntityAtomFamily(queueId))
        return entity?.name ?? null
    }),
)

/**
 * Queue run ID selector.
 */
const runIdAtomFamily = atomFamily((queueId: string) =>
    atom<string | null>((get) => {
        const entity = get(simpleQueueEntityAtomFamily(queueId))
        return entity?.run_id ?? null
    }),
)

// ============================================================================
// SCENARIO PROGRESS (query-backed selectors)
// ============================================================================

/**
 * Scenario progress shape returned by the progress selectors.
 */
export interface QueueScenarioProgress {
    total: number
    completed: number
}

/**
 * Query atom family that fetches all scenarios for a queue (without pagination)
 * to derive progress counts. Uses a long staleTime since progress doesn't change
 * rapidly and avoids excessive API calls when many queue rows render.
 */
const scenarioProgressQueryAtomFamily = atomFamily((queueId: string) =>
    atomWithQuery(() => ({
        queryKey: ["simpleQueue", "scenarioProgress", queueId],
        queryFn: async (): Promise<EvaluationScenario[]> => {
            const projectId = getStore().get(projectIdAtom)
            if (!projectId || !queueId) return []
            const response = await querySimpleQueueScenarios({
                queueId,
                projectId,
            })
            return response.scenarios
        },
        enabled: !!queueId,
        staleTime: 60_000,
        retry: (failureCount: number, error: Error) => {
            if (error?.message === "projectId not yet available" && failureCount < 5) {
                return true
            }
            return false
        },
        retryDelay: (attempt: number) => Math.min(200 * 2 ** attempt, 2000),
    })),
)

/**
 * Total scenario count for a queue.
 */
const totalScenarioCountAtomFamily = atomFamily((queueId: string) =>
    atom<number | null>((get) => {
        const query = get(scenarioProgressQueryAtomFamily(queueId))
        if (query.isPending) return null
        return query.data?.length ?? 0
    }),
)

/**
 * Completed (status === "success") scenario count for a queue.
 */
const completedScenarioCountAtomFamily = atomFamily((queueId: string) =>
    atom<number | null>((get) => {
        const query = get(scenarioProgressQueryAtomFamily(queueId))
        if (query.isPending) return null
        return query.data?.filter((s) => s.status === "success").length ?? 0
    }),
)

/**
 * Combined scenario progress for a queue.
 */
const scenarioProgressAtomFamily = atomFamily((queueId: string) =>
    atom<QueueScenarioProgress | null>((get) => {
        const total = get(totalScenarioCountAtomFamily(queueId))
        const completed = get(completedScenarioCountAtomFamily(queueId))
        if (total === null || completed === null) return null
        return {total, completed}
    }),
)

/**
 * Full scenarios array for a queue.
 * Reads from the same query used for progress counting.
 */
const scenariosAtomFamily = atomFamily((queueId: string) =>
    atom<EvaluationScenario[]>((get) => {
        const query = get(scenarioProgressQueryAtomFamily(queueId))
        return query.data ?? []
    }),
)

/**
 * Scenarios query state for loading/error indicators.
 */
const scenariosQueryAtomFamily = scenarioProgressQueryAtomFamily

/**
 * Invalidate a queue's scenario progress cache.
 */
export function invalidateScenarioProgressCache(queueId: string, options?: StoreOptions) {
    const store = getStore(options)
    const current = store.get(scenarioProgressQueryAtomFamily(queueId))
    if (current?.refetch) {
        current.refetch()
    }
}

// ============================================================================
// MOLECULE DEFINITION
// ============================================================================

/**
 * SimpleQueue molecule — unified API for simple queue entity state.
 */
export const simpleQueueMolecule = {
    // ========================================================================
    // SELECTORS (reactive atom families)
    // ========================================================================
    selectors: {
        /** Merged entity data (server + draft) */
        data: dataAtomFamily,
        /** Query state (loading, error) */
        query: queryAtomFamily,
        /** Is dirty (has local edits) */
        isDirty: simpleQueueIsDirtyAtomFamily,
        /** Queue kind (traces | testcases) */
        kind: kindAtomFamily,
        /** Queue status */
        status: statusAtomFamily,
        /** Queue name */
        name: nameAtomFamily,
        /** Parent run ID */
        runId: runIdAtomFamily,
        /** Total scenario count (null while loading) */
        totalScenarioCount: totalScenarioCountAtomFamily,
        /** Completed scenario count (null while loading) */
        completedScenarioCount: completedScenarioCountAtomFamily,
        /** Combined scenario progress (null while loading) */
        scenarioProgress: scenarioProgressAtomFamily,
        /** Full scenarios array */
        scenarios: scenariosAtomFamily,
        /** Scenarios query state (loading, error) */
        scenariosQuery: scenariosQueryAtomFamily,
    },

    // ========================================================================
    // ATOMS (raw store atoms)
    // ========================================================================
    atoms: {
        /** List query atom */
        listQuery: simpleQueuesListQueryAtom,
        /** List data atom */
        listData: simpleQueuesListDataAtom,
        /** Per-entity query */
        query: simpleQueueQueryAtomFamily,
        /** Per-entity draft */
        draft: simpleQueueDraftAtomFamily,
        /** Per-entity merged data */
        entity: simpleQueueEntityAtomFamily,
        /** Per-entity dirty flag */
        isDirty: simpleQueueIsDirtyAtomFamily,
    },

    // ========================================================================
    // ACTIONS (write atoms)
    // ========================================================================
    actions: {
        /** Update queue draft */
        update: updateSimpleQueueDraftAtom,
        /** Discard queue draft */
        discard: discardSimpleQueueDraftAtom,
        /** Create a new queue (server mutation) */
        createQueue: createSimpleQueueAtom,
        /** Add traces to a queue (server mutation) */
        addTraces: addTracesToQueueAtom,
        /** Add testcases to a queue (server mutation) */
        addTestcases: addTestcasesToQueueAtom,
    },

    // ========================================================================
    // GET (imperative read API)
    // ========================================================================
    get: {
        data: (queueId: string, options?: StoreOptions) =>
            getStore(options).get(simpleQueueEntityAtomFamily(queueId)),
        isDirty: (queueId: string, options?: StoreOptions) =>
            getStore(options).get(simpleQueueIsDirtyAtomFamily(queueId)),
        kind: (queueId: string, options?: StoreOptions) =>
            getStore(options).get(kindAtomFamily(queueId)),
        status: (queueId: string, options?: StoreOptions) =>
            getStore(options).get(statusAtomFamily(queueId)),
        name: (queueId: string, options?: StoreOptions) =>
            getStore(options).get(nameAtomFamily(queueId)),
        runId: (queueId: string, options?: StoreOptions) =>
            getStore(options).get(runIdAtomFamily(queueId)),
        totalScenarioCount: (queueId: string, options?: StoreOptions) =>
            getStore(options).get(totalScenarioCountAtomFamily(queueId)),
        completedScenarioCount: (queueId: string, options?: StoreOptions) =>
            getStore(options).get(completedScenarioCountAtomFamily(queueId)),
        scenarioProgress: (queueId: string, options?: StoreOptions) =>
            getStore(options).get(scenarioProgressAtomFamily(queueId)),
        scenarios: (queueId: string, options?: StoreOptions) =>
            getStore(options).get(scenariosAtomFamily(queueId)),
    },

    // ========================================================================
    // SET (imperative write API)
    // ========================================================================
    set: {
        update: (queueId: string, updates: Partial<SimpleQueue>, options?: StoreOptions) =>
            getStore(options).set(updateSimpleQueueDraftAtom, queueId, updates),
        discard: (queueId: string, options?: StoreOptions) =>
            getStore(options).set(discardSimpleQueueDraftAtom, queueId),
        createQueue: (payload: CreateSimpleQueuePayload, options?: StoreOptions) =>
            getStore(options).set(createSimpleQueueAtom, payload),
        addTraces: (queueId: string, traceIds: string[], options?: StoreOptions) =>
            getStore(options).set(addTracesToQueueAtom, queueId, traceIds),
        addTestcases: (queueId: string, testcaseIds: string[], options?: StoreOptions) =>
            getStore(options).set(addTestcasesToQueueAtom, queueId, testcaseIds),
    },

    // ========================================================================
    // CACHE (invalidation utilities)
    // ========================================================================
    cache: {
        invalidateList: invalidateSimpleQueuesListCache,
        invalidateDetail: invalidateSimpleQueueCache,
        invalidateProgress: invalidateScenarioProgressCache,
    },
}

export type SimpleQueueMolecule = typeof simpleQueueMolecule
