/**
 * EvaluationQueue Molecule
 *
 * Unified API for evaluation queue entity state management.
 * Follows the molecule pattern for consistency with other entities.
 *
 * @example
 * ```typescript
 * import { evaluationQueueMolecule } from '@agenta/entities/evaluationQueue'
 *
 * // Selectors (reactive)
 * const data = useAtomValue(evaluationQueueMolecule.selectors.data(queueId))
 * const isDirty = useAtomValue(evaluationQueueMolecule.selectors.isDirty(queueId))
 *
 * // Actions (write atoms)
 * const update = useSetAtom(evaluationQueueMolecule.actions.update)
 * update(queueId, { name: 'Updated queue' })
 *
 * // Imperative API (outside React)
 * const data = evaluationQueueMolecule.get.data(queueId)
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
import {fetchEvaluationQueue, queryEvaluationQueues} from "../api"
import type {EvaluationQueue} from "../core"

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
 * Query atom for the evaluation queues list.
 * Automatically fetches when projectId is set.
 */
export const evaluationQueuesListQueryAtom = atomWithQuery((get) => {
    const projectId = get(projectIdAtom)
    return {
        queryKey: ["evaluationQueues", "list", projectId],
        queryFn: async () => {
            if (!projectId) return {count: 0, queues: []}
            return queryEvaluationQueues({projectId})
        },
        enabled: get(sessionAtom) && !!projectId,
        staleTime: 30_000,
    }
})

/**
 * Derived atom for the evaluation queues list data.
 */
export const evaluationQueuesListDataAtom = atom<EvaluationQueue[]>((get) => {
    const query = get(evaluationQueuesListQueryAtom)
    return query.data?.queues ?? []
})

// ============================================================================
// SINGLE ENTITY QUERY
// ============================================================================

/**
 * Query atom family for fetching a single evaluation queue by ID.
 */
export const evaluationQueueQueryAtomFamily = atomFamily((queueId: string) =>
    atomWithQuery((get) => {
        const projectId = get(projectIdAtom)
        return {
            queryKey: ["evaluationQueue", queueId, projectId],
            queryFn: async (): Promise<EvaluationQueue | null> => {
                if (!projectId || !queueId) return null
                return fetchEvaluationQueue({id: queueId, projectId})
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
export const evaluationQueueDraftAtomFamily = atomFamily((_queueId: string) =>
    atom<Partial<EvaluationQueue> | null>(null),
)

/**
 * Merged entity atom: server data + local draft overlay.
 */
export const evaluationQueueEntityAtomFamily = atomFamily((queueId: string) =>
    atom<EvaluationQueue | null>((get) => {
        const query = get(evaluationQueueQueryAtomFamily(queueId))
        const serverData = query.data ?? null
        const draft = get(evaluationQueueDraftAtomFamily(queueId))

        if (!serverData) return draft as EvaluationQueue | null
        if (!draft) return serverData

        return {
            ...serverData,
            ...draft,
            data: {
                ...serverData.data,
                ...draft.data,
            },
        } as EvaluationQueue
    }),
)

/**
 * Is the queue dirty (has local edits)?
 */
export const evaluationQueueIsDirtyAtomFamily = atomFamily((queueId: string) =>
    atom<boolean>((get) => {
        const draft = get(evaluationQueueDraftAtomFamily(queueId))
        return draft !== null
    }),
)

// ============================================================================
// MUTATIONS (Write Atoms)
// ============================================================================

/**
 * Update queue draft state.
 */
export const updateEvaluationQueueDraftAtom = atom(
    null,
    (_get, set, queueId: string, updates: Partial<EvaluationQueue>) => {
        const current = _get(evaluationQueueDraftAtomFamily(queueId))
        set(evaluationQueueDraftAtomFamily(queueId), {
            ...current,
            ...updates,
        })
    },
)

/**
 * Discard queue draft (reset to server state).
 */
export const discardEvaluationQueueDraftAtom = atom(null, (_get, set, queueId: string) => {
    set(evaluationQueueDraftAtomFamily(queueId), null)
})

// ============================================================================
// CACHE INVALIDATION
// ============================================================================

/**
 * Invalidate the evaluation queues list cache.
 */
export function invalidateEvaluationQueuesListCache(options?: StoreOptions) {
    const store = getStore(options)
    const current = store.get(evaluationQueuesListQueryAtom)
    if (current?.refetch) {
        current.refetch()
    }
}

/**
 * Invalidate a single queue's cache.
 */
export function invalidateEvaluationQueueCache(queueId: string, options?: StoreOptions) {
    const store = getStore(options)
    const current = store.get(evaluationQueueQueryAtomFamily(queueId))
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
    atom<EvaluationQueue | null>((get) => get(evaluationQueueEntityAtomFamily(queueId))),
)

/**
 * Queue query state selector.
 */
const queryAtomFamily = atomFamily((queueId: string) =>
    atom((get) => {
        const query = get(evaluationQueueQueryAtomFamily(queueId))
        return {
            data: query.data ?? null,
            isPending: query.isPending,
            isError: query.isError,
            error: query.error ?? null,
        }
    }),
)

/**
 * Queue status selector.
 */
const statusAtomFamily = atomFamily((queueId: string) =>
    atom<string | null>((get) => {
        const entity = get(evaluationQueueEntityAtomFamily(queueId))
        return entity?.status ?? null
    }),
)

/**
 * Queue name selector.
 */
const nameAtomFamily = atomFamily((queueId: string) =>
    atom<string | null>((get) => {
        const entity = get(evaluationQueueEntityAtomFamily(queueId))
        return entity?.name ?? null
    }),
)

/**
 * Queue run ID selector.
 */
const runIdAtomFamily = atomFamily((queueId: string) =>
    atom<string | null>((get) => {
        const entity = get(evaluationQueueEntityAtomFamily(queueId))
        return entity?.run_id ?? null
    }),
)

/**
 * Queue flags selector.
 */
const flagsAtomFamily = atomFamily((queueId: string) =>
    atom((get) => {
        const entity = get(evaluationQueueEntityAtomFamily(queueId))
        return entity?.flags ?? null
    }),
)

// ============================================================================
// MOLECULE DEFINITION
// ============================================================================

/**
 * EvaluationQueue molecule — unified API for evaluation queue entity state.
 */
export const evaluationQueueMolecule = {
    // ========================================================================
    // SELECTORS (reactive atom families)
    // ========================================================================
    selectors: {
        /** Merged entity data (server + draft) */
        data: dataAtomFamily,
        /** Query state (loading, error) */
        query: queryAtomFamily,
        /** Is dirty (has local edits) */
        isDirty: evaluationQueueIsDirtyAtomFamily,
        /** Queue status */
        status: statusAtomFamily,
        /** Queue name */
        name: nameAtomFamily,
        /** Parent run ID */
        runId: runIdAtomFamily,
        /** Queue flags */
        flags: flagsAtomFamily,
    },

    // ========================================================================
    // ATOMS (raw store atoms)
    // ========================================================================
    atoms: {
        /** List query atom */
        listQuery: evaluationQueuesListQueryAtom,
        /** List data atom */
        listData: evaluationQueuesListDataAtom,
        /** Per-entity query */
        query: evaluationQueueQueryAtomFamily,
        /** Per-entity draft */
        draft: evaluationQueueDraftAtomFamily,
        /** Per-entity merged data */
        entity: evaluationQueueEntityAtomFamily,
        /** Per-entity dirty flag */
        isDirty: evaluationQueueIsDirtyAtomFamily,
    },

    // ========================================================================
    // ACTIONS (write atoms)
    // ========================================================================
    actions: {
        /** Update queue draft */
        update: updateEvaluationQueueDraftAtom,
        /** Discard queue draft */
        discard: discardEvaluationQueueDraftAtom,
    },

    // ========================================================================
    // GET (imperative read API)
    // ========================================================================
    get: {
        data: (queueId: string, options?: StoreOptions) =>
            getStore(options).get(evaluationQueueEntityAtomFamily(queueId)),
        isDirty: (queueId: string, options?: StoreOptions) =>
            getStore(options).get(evaluationQueueIsDirtyAtomFamily(queueId)),
        status: (queueId: string, options?: StoreOptions) =>
            getStore(options).get(statusAtomFamily(queueId)),
        name: (queueId: string, options?: StoreOptions) =>
            getStore(options).get(nameAtomFamily(queueId)),
        runId: (queueId: string, options?: StoreOptions) =>
            getStore(options).get(runIdAtomFamily(queueId)),
    },

    // ========================================================================
    // SET (imperative write API)
    // ========================================================================
    set: {
        update: (queueId: string, updates: Partial<EvaluationQueue>, options?: StoreOptions) =>
            getStore(options).set(updateEvaluationQueueDraftAtom, queueId, updates),
        discard: (queueId: string, options?: StoreOptions) =>
            getStore(options).set(discardEvaluationQueueDraftAtom, queueId),
    },

    // ========================================================================
    // CACHE (invalidation utilities)
    // ========================================================================
    cache: {
        invalidateList: invalidateEvaluationQueuesListCache,
        invalidateDetail: invalidateEvaluationQueueCache,
    },
}

export type EvaluationQueueMolecule = typeof evaluationQueueMolecule
