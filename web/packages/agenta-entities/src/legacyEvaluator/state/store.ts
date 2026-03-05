/**
 * LegacyEvaluator Store
 *
 * Jotai atoms for LegacyEvaluator entity state management.
 * Uses atomFamily pattern for per-entity state with TanStack Query integration.
 *
 * Uses the SimpleEvaluator facade API which flattens the hierarchy —
 * no separate variant/revision queries needed.
 *
 * @packageDocumentation
 */

import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {createBatchFetcher} from "@agenta/shared/utils"
import {atom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import type {StoreOptions} from "../../shared"
import {queryLegacyEvaluators, fetchLegacyEvaluatorsBatch} from "../api"
import type {LegacyEvaluator, LegacyEvaluatorsResponse} from "../core"

// ============================================================================
// HELPERS
// ============================================================================

function getStore(options?: StoreOptions) {
    return options?.store ?? getDefaultStore()
}

interface LegacyEvaluatorBatchRequest {
    projectId: string
    evaluatorId: string
}

const legacyEvaluatorBatchFetcher = createBatchFetcher<
    LegacyEvaluatorBatchRequest,
    LegacyEvaluator | null
>({
    maxBatchSize: 50,
    flushDelay: 10,
    serializeKey: (req) => `${req.projectId}:${req.evaluatorId}`,
    batchFn: async (requests, serializedKeys) => {
        const results = new Map<string, LegacyEvaluator | null>()
        const byProject = new Map<string, {evaluatorIds: string[]; keys: string[]}>()

        requests.forEach((req, index) => {
            const key = serializedKeys[index]
            if (!req.projectId || !req.evaluatorId) {
                results.set(key, null)
                return
            }

            const existing = byProject.get(req.projectId)
            if (existing) {
                existing.evaluatorIds.push(req.evaluatorId)
                existing.keys.push(key)
            } else {
                byProject.set(req.projectId, {
                    evaluatorIds: [req.evaluatorId],
                    keys: [key],
                })
            }
        })

        await Promise.all(
            Array.from(byProject.entries()).map(async ([projectId, group]) => {
                const evaluatorMap = await fetchLegacyEvaluatorsBatch(projectId, group.evaluatorIds)
                group.evaluatorIds.forEach((evaluatorId, index) => {
                    const key = group.keys[index]
                    results.set(key, evaluatorMap.get(evaluatorId) ?? null)
                })
            }),
        )

        return results
    },
})

// ============================================================================
// PROJECT ID ATOM
// ============================================================================

/**
 * Project ID atom.
 * Re-exports the shared projectIdAtom so evaluator queries use the
 * canonical project ID without requiring manual wiring.
 */
export const legacyEvaluatorProjectIdAtom = projectIdAtom

// ============================================================================
// LIST QUERY
// ============================================================================

/**
 * Query atom for the evaluators list.
 * Automatically fetches when projectId is set.
 */
export const legacyEvaluatorsListQueryAtom = atomWithQuery((get) => {
    const projectId = get(legacyEvaluatorProjectIdAtom)
    return {
        queryKey: ["legacyEvaluators", "list", projectId],
        queryFn: async (): Promise<LegacyEvaluatorsResponse> => {
            if (!projectId) return {count: 0, evaluators: []}
            return queryLegacyEvaluators({projectId})
        },
        enabled: get(sessionAtom) && !!projectId,
        staleTime: 30_000,
    }
})

/**
 * Derived atom for the evaluators list data (convenience).
 */
export const legacyEvaluatorsListDataAtom = atom<LegacyEvaluator[]>((get) => {
    const query = get(legacyEvaluatorsListQueryAtom)
    return query.data?.evaluators ?? []
})

/**
 * Derived atom for non-archived, non-human evaluators.
 *
 * Filters out:
 * - Archived evaluators (have `deleted_at`)
 * - Human evaluators (`flags.is_human === true`)
 *
 * This matches the frontend convention from PR #3577 where
 * human evaluator filtering is done client-side.
 */
export const nonArchivedLegacyEvaluatorsAtom = atom<LegacyEvaluator[]>((get) => {
    const evaluators = get(legacyEvaluatorsListDataAtom)
    return evaluators.filter((e) => !e.deleted_at && e.flags?.is_human !== true)
})

// ============================================================================
// SINGLE ENTITY QUERY
// ============================================================================

/**
 * Query atom family for fetching a single evaluator by ID.
 * Uses the SimpleEvaluator endpoint which returns the entity with data already embedded.
 */
export const legacyEvaluatorQueryAtomFamily = atomFamily((evaluatorId: string) =>
    atomWithQuery((get) => {
        const projectId = get(legacyEvaluatorProjectIdAtom)

        return {
            queryKey: ["legacyEvaluators", "detail", evaluatorId, projectId],
            queryFn: async (): Promise<LegacyEvaluator | null> => {
                if (!projectId || !evaluatorId) return null

                return legacyEvaluatorBatchFetcher({projectId, evaluatorId})
            },
            enabled: get(sessionAtom) && !!projectId && !!evaluatorId,
            staleTime: 30_000,
        }
    }),
)

// ============================================================================
// DRAFT STATE
// ============================================================================

/**
 * Draft state per evaluator (local edits before save).
 * Stores partial updates to evaluator data.
 */
export const legacyEvaluatorDraftAtomFamily = atomFamily((_evaluatorId: string) =>
    atom<Partial<LegacyEvaluator> | null>(null),
)

/**
 * Merged entity atom: server data + local draft overlay.
 */
export const legacyEvaluatorEntityAtomFamily = atomFamily((evaluatorId: string) =>
    atom<LegacyEvaluator | null>((get) => {
        const query = get(legacyEvaluatorQueryAtomFamily(evaluatorId))
        const serverData = query.data ?? null
        const draft = get(legacyEvaluatorDraftAtomFamily(evaluatorId))

        if (!serverData) return draft as LegacyEvaluator | null
        if (!draft) return serverData

        return {
            ...serverData,
            ...draft,
            data: {
                ...serverData.data,
                ...draft.data,
            },
        } as LegacyEvaluator
    }),
)

/**
 * Is the evaluator dirty (has local edits)?
 */
export const legacyEvaluatorIsDirtyAtomFamily = atomFamily((evaluatorId: string) =>
    atom<boolean>((get) => {
        const draft = get(legacyEvaluatorDraftAtomFamily(evaluatorId))
        return draft !== null
    }),
)

// ============================================================================
// MUTATIONS (Write Atoms)
// ============================================================================

/**
 * Update evaluator draft state.
 */
export const updateLegacyEvaluatorDraftAtom = atom(
    null,
    (_get, set, evaluatorId: string, updates: Partial<LegacyEvaluator>) => {
        const current = _get(legacyEvaluatorDraftAtomFamily(evaluatorId))
        set(legacyEvaluatorDraftAtomFamily(evaluatorId), {
            ...current,
            ...updates,
        })
    },
)

/**
 * Discard evaluator draft (reset to server state).
 */
export const discardLegacyEvaluatorDraftAtom = atom(null, (_get, set, evaluatorId: string) => {
    set(legacyEvaluatorDraftAtomFamily(evaluatorId), null)
})

// ============================================================================
// CACHE INVALIDATION
// ============================================================================

/**
 * Invalidate the evaluators list cache.
 * Call after create/update/archive operations.
 */
export function invalidateLegacyEvaluatorsListCache(options?: StoreOptions) {
    const store = getStore(options)
    const queryAtom = legacyEvaluatorsListQueryAtom
    const current = store.get(queryAtom)
    if (current?.refetch) {
        current.refetch()
    }
}

/**
 * Invalidate a single evaluator's cache.
 */
export function invalidateLegacyEvaluatorCache(evaluatorId: string, options?: StoreOptions) {
    const store = getStore(options)
    const queryAtom = legacyEvaluatorQueryAtomFamily(evaluatorId)
    const current = store.get(queryAtom)
    if (current?.refetch) {
        current.refetch()
    }
}
