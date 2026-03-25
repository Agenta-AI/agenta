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
import {atomWithQuery, queryClientAtom} from "jotai-tanstack-query"

import type {StoreOptions} from "../../shared"
import {
    createSimpleQueue,
    type CreateSimpleQueuePayload,
    deleteSimpleQueue,
    deleteSimpleQueues,
    fetchSimpleQueue,
    querySimpleQueues,
    querySimpleQueueScenarios,
    addSimpleQueueTraces,
    addSimpleQueueTestcases,
} from "../api"
import type {SimpleQueue, SimpleQueueKind, EvaluationStatus, EvaluationScenario} from "../core"

import {simpleQueuePaginatedStore} from "./paginatedStore"
import {taskQueueIdAtom} from "./tasksPaginatedStore"

// ============================================================================
// HELPERS
// ============================================================================

function getStore(options?: StoreOptions) {
    return options?.store ?? getDefaultStore()
}

const SCENARIO_REFRESH_WINDOW_MS = 15_000
const SCENARIO_REFETCH_INTERVAL_MS = 1_500

const TERMINAL_SCENARIO_STATUSES = new Set([
    "success",
    "error",
    "failure",
    "failed",
    "errors",
    "cancelled",
])

function deriveQueueStatusFromScenarios(
    scenarios: {status?: string | null}[],
    fallbackStatus: EvaluationStatus | null,
): EvaluationStatus | null {
    if (scenarios.length === 0) return fallbackStatus

    const statuses = scenarios.map((scenario) => scenario.status?.toLowerCase() ?? "")

    const allTerminal = statuses.every((status) => TERMINAL_SCENARIO_STATUSES.has(status))
    if (allTerminal) {
        const hasErrors = statuses.some((status) =>
            ["error", "failure", "failed", "errors"].includes(status),
        )
        if (hasErrors) return "errors"

        const allCancelled = statuses.every((status) => status === "cancelled")
        if (allCancelled) return "cancelled"

        return "success"
    }

    if (statuses.some((status) => status === "running")) {
        return "running"
    }

    if (statuses.some((status) => status === "queued")) {
        return "queued"
    }

    if (
        statuses.some((status) =>
            ["success", "error", "failure", "failed", "errors", "cancelled"].includes(status),
        )
    ) {
        return "running"
    }

    if (statuses.every((status) => status === "pending" || status === "")) {
        return "pending"
    }

    return fallbackStatus
}

// ============================================================================
// LIST QUERY
// ============================================================================

/**
 * Query atom for the simple queues list.
 * Automatically fetches when projectId is set.
 */
export const simpleQueuesListQueryAtom = atomWithQuery((get) => {
    const isSessionReady = get(sessionAtom)
    return {
        queryKey: ["simpleQueues", "list"],
        queryFn: async () => {
            const projectId = getStore().get(projectIdAtom)
            if (!projectId) {
                throw new Error("projectId not yet available")
            }
            return querySimpleQueues({projectId})
        },
        enabled: isSessionReady,
        retry: (failureCount: number, error: Error) => {
            if (error?.message === "projectId not yet available" && failureCount < 5) {
                return true
            }
            return false
        },
        retryDelay: (attempt: number) => Math.min(200 * 2 ** attempt, 2000),
        staleTime: 30_000,
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
 *
 * IMPORTANT: `atomWithQuery` in jotai-tanstack-query v0.11.0 does NOT
 * re-evaluate its getter when Jotai atom dependencies change after the
 * initial subscription. So we cannot rely on reactive `get(projectIdAtom)`.
 * Instead, `queryFn` reads `projectIdAtom` imperatively from the default
 * store at fetch time, and throws when it's not yet available so that
 * TanStack Query's `retry` mechanism re-attempts once projectId is set.
 */
export const simpleQueueQueryAtomFamily = atomFamily((queueId: string) =>
    atomWithQuery(() => ({
        queryKey: ["simpleQueue", queueId],
        queryFn: async (): Promise<SimpleQueue | null> => {
            const projectId = getStore().get(projectIdAtom)
            if (!queueId) return null
            if (!projectId) {
                throw new Error("projectId not yet available")
            }
            return fetchSimpleQueue({id: queueId, projectId})
        },
        enabled: !!queueId,
        retry: (failureCount: number, error: Error) => {
            if (error?.message === "projectId not yet available" && failureCount < 5) {
                return true
            }
            return false
        },
        retryDelay: (attempt: number) => Math.min(200 * 2 ** attempt, 2000),
        staleTime: 30_000,
    })),
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
 * Per-queue refresh window for scenario polling after async mutations.
 *
 * Adding traces/testcases returns before the background worker finishes
 * creating scenarios. This keeps the scenarios query polling briefly so the
 * queue page can pick up the newly created rows without a manual refresh.
 */
const scenarioRefreshUntilAtomFamily = atomFamily((_queueId: string) => atom<number>(0))

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
 * Delete a simple queue on the server.
 * Clears detail/progress caches and refreshes list-backed UI on success.
 *
 * @returns The deleted queue ID on success, or null on failure.
 */
export const deleteSimpleQueueAtom = atom(
    null,
    async (get, set, queueId: string): Promise<string | null> => {
        const projectId = get(projectIdAtom)
        if (!projectId || !queueId) return null

        const queryClient = get(queryClientAtom)
        const result = await deleteSimpleQueue(projectId, queueId)
        if (result.queue_id) {
            set(simpleQueueDraftAtomFamily(queueId), null)

            if (get(taskQueueIdAtom) === queueId) {
                set(taskQueueIdAtom, null)
            }

            queryClient.removeQueries({queryKey: ["simpleQueue", queueId], exact: false})
            queryClient.removeQueries({
                queryKey: ["simpleQueue", "scenarioProgress", queueId],
                exact: false,
            })
            await queryClient.invalidateQueries({queryKey: ["simpleQueues", "list"], exact: false})

            set(simpleQueuePaginatedStore.refreshAtom)
        }

        return result.queue_id ?? null
    },
)

/**
 * Delete multiple simple queues on the server.
 * Clears detail/progress caches and refreshes list-backed UI on success.
 *
 * @returns The deleted queue IDs on success.
 */
export const deleteSimpleQueuesAtom = atom(
    null,
    async (get, set, queueIds: string[]): Promise<string[]> => {
        const projectId = get(projectIdAtom)
        const normalizedQueueIds = Array.from(new Set(queueIds.filter(Boolean)))
        if (!projectId || normalizedQueueIds.length === 0) return []

        const queryClient = get(queryClientAtom)
        const result = await deleteSimpleQueues(projectId, normalizedQueueIds)
        const deletedQueueIds = result.queue_ids ?? []

        if (deletedQueueIds.length > 0) {
            deletedQueueIds.forEach((queueId) => {
                set(simpleQueueDraftAtomFamily(queueId), null)
                queryClient.removeQueries({queryKey: ["simpleQueue", queueId], exact: false})
                queryClient.removeQueries({
                    queryKey: ["simpleQueue", "scenarioProgress", queueId],
                    exact: false,
                })
            })

            const selectedTaskQueueId = get(taskQueueIdAtom)
            if (selectedTaskQueueId && deletedQueueIds.includes(selectedTaskQueueId)) {
                set(taskQueueIdAtom, null)
            }

            await queryClient.invalidateQueries({queryKey: ["simpleQueues", "list"], exact: false})
            set(simpleQueuePaginatedStore.refreshAtom)
        }

        return deletedQueueIds
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
            set(scenarioRefreshUntilAtomFamily(queueId), Date.now() + SCENARIO_REFRESH_WINDOW_MS)
            invalidateSimpleQueueCache(queueId)
            invalidateScenarioProgressCache(queueId)
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
            set(scenarioRefreshUntilAtomFamily(queueId), Date.now() + SCENARIO_REFRESH_WINDOW_MS)
            invalidateSimpleQueueCache(queueId)
            invalidateScenarioProgressCache(queueId)
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
 *
 * Uses the TanStack QueryClient directly instead of `store.get(atomFamily).refetch()`
 * to avoid prematurely creating the Jotai atom/observer state without a React
 * subscription. Doing `store.get()` on an `atomWithQuery` atom initialises the
 * observer and caches the initial `{isPending: true}` result but never mounts
 * `onMount` (no subscriber). If `.refetch()` then resolves, the observer's
 * tracked result updates but the Jotai `resultAtom` stays stale. When a
 * component later subscribes, the observer sees no diff and never notifies,
 * leaving the atom stuck at `{isPending: true}` forever.
 */
export function invalidateSimpleQueueCache(queueId: string, options?: StoreOptions) {
    const store = getStore(options)
    const queryClient = store.get(queryClientAtom)
    queryClient.invalidateQueries({queryKey: ["simpleQueue", queueId], exact: true})
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
            if (!queueId) return []
            if (!projectId) {
                throw new Error("projectId not yet available")
            }
            const response = await querySimpleQueueScenarios({
                queueId,
                projectId,
            })
            return response.scenarios
        },
        enabled: !!queueId,
        staleTime:
            getStore().get(scenarioRefreshUntilAtomFamily(queueId)) > Date.now() ? 0 : 60_000,
        refetchInterval: () =>
            getStore().get(scenarioRefreshUntilAtomFamily(queueId)) > Date.now()
                ? SCENARIO_REFETCH_INTERVAL_MS
                : false,
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
 * Queue status selector derived from scenario state.
 *
 * Falls back to the persisted queue status while the scenario query is still
 * loading or if it errors, but does not rely on imperative queue status syncs.
 */
const statusAtomFamily = atomFamily((queueId: string) =>
    atom<EvaluationStatus | null>((get) => {
        const entity = get(simpleQueueEntityAtomFamily(queueId))
        const fallbackStatus = (entity?.status as EvaluationStatus | null) ?? null
        const query = get(scenarioProgressQueryAtomFamily(queueId))

        if (query.isPending || query.isError) {
            return fallbackStatus
        }

        return deriveQueueStatusFromScenarios(query.data ?? [], fallbackStatus)
    }),
)

/**
 * Invalidate a queue's scenario progress cache.
 *
 * Uses QueryClient directly — see `invalidateSimpleQueueCache` for rationale.
 */
export function invalidateScenarioProgressCache(queueId: string, options?: StoreOptions) {
    const store = getStore(options)
    const queryClient = store.get(queryClientAtom)
    queryClient.invalidateQueries({
        queryKey: ["simpleQueue", "scenarioProgress", queueId],
        exact: true,
    })
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
        /** Delete a queue (server mutation) */
        deleteQueue: deleteSimpleQueueAtom,
        /** Delete multiple queues (server mutation) */
        deleteQueues: deleteSimpleQueuesAtom,
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
        deleteQueue: (queueId: string, options?: StoreOptions) =>
            getStore(options).set(deleteSimpleQueueAtom, queueId),
        deleteQueues: (queueIds: string[], options?: StoreOptions) =>
            getStore(options).set(deleteSimpleQueuesAtom, queueIds),
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
