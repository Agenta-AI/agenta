/**
 * Evaluator Store
 *
 * Jotai atoms for evaluator entity state management.
 * Uses atomFamily pattern for per-entity state with TanStack Query integration.
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
    fetchEvaluator,
    queryEvaluators,
    queryEvaluatorVariants,
    queryEvaluatorRevisionsByWorkflow,
    queryEvaluatorRevisions,
} from "../api"
import type {
    Evaluator,
    EvaluatorsResponse,
    EvaluatorVariant,
    EvaluatorVariantsResponse,
    EvaluatorRevisionsResponse,
} from "../core"

// ============================================================================
// HELPERS
// ============================================================================

function getStore(options?: StoreOptions) {
    return options?.store ?? getDefaultStore()
}

// ============================================================================
// PROJECT ID ATOM
// ============================================================================

/**
 * Project ID atom.
 * Re-exports the shared projectIdAtom so evaluator queries use the
 * canonical project ID without requiring manual wiring.
 */
export const evaluatorProjectIdAtom = projectIdAtom

// ============================================================================
// LIST QUERY
// ============================================================================

/**
 * Query atom for the evaluators list.
 * Automatically fetches when projectId is set.
 */
export const evaluatorsListQueryAtom = atomWithQuery((get) => {
    const projectId = get(evaluatorProjectIdAtom)
    return {
        queryKey: ["evaluators", "list", projectId],
        queryFn: async (): Promise<EvaluatorsResponse> => {
            if (!projectId) return {count: 0, workflows: []}
            return queryEvaluators({projectId})
        },
        enabled: get(sessionAtom) && !!projectId,
        staleTime: 30_000,
    }
})

/**
 * Derived atom for the evaluators list data (convenience).
 */
export const evaluatorsListDataAtom = atom<Evaluator[]>((get) => {
    const query = get(evaluatorsListQueryAtom)
    return query.data?.workflows ?? []
})

/**
 * Derived atom for non-archived evaluators.
 */
export const nonArchivedEvaluatorsAtom = atom<Evaluator[]>((get) => {
    const evaluators = get(evaluatorsListDataAtom)
    return evaluators.filter((e) => !e.deleted_at)
})

// ============================================================================
// VARIANT LIST QUERY (for 3-level hierarchy)
// ============================================================================

/**
 * Query atom family for fetching variants of an evaluator (workflow).
 * Used in the Evaluator → Variant → Revision selection hierarchy.
 */
export const evaluatorVariantsQueryAtomFamily = atomFamily((workflowId: string) =>
    atomWithQuery((get) => {
        const projectId = get(evaluatorProjectIdAtom)
        return {
            queryKey: ["evaluators", "variants", workflowId, projectId],
            queryFn: async (): Promise<EvaluatorVariantsResponse> => {
                if (!projectId || !workflowId) return {count: 0, workflow_variants: []}
                return queryEvaluatorVariants(workflowId, projectId)
            },
            enabled: get(sessionAtom) && !!projectId && !!workflowId,
            staleTime: 30_000,
        }
    }),
)

/**
 * Derived atom family for variant list data (convenience).
 */
export const evaluatorVariantsListDataAtomFamily = atomFamily((workflowId: string) =>
    atom<EvaluatorVariant[]>((get) => {
        const query = get(evaluatorVariantsQueryAtomFamily(workflowId))
        return query.data?.workflow_variants ?? []
    }),
)

// ============================================================================
// REVISION LIST QUERY BY WORKFLOW (for 2-level hierarchy: Evaluator → Revision)
// ============================================================================

/**
 * Query atom family for fetching revisions directly by workflow (evaluator) ID.
 * Skips the variant level — used for the 2-level list-popover selection.
 */
export const evaluatorRevisionsByWorkflowQueryAtomFamily = atomFamily((workflowId: string) =>
    atomWithQuery((get) => {
        const projectId = get(evaluatorProjectIdAtom)
        return {
            queryKey: ["evaluators", "revisionsByWorkflow", workflowId, projectId],
            queryFn: async (): Promise<EvaluatorRevisionsResponse> => {
                if (!projectId || !workflowId) return {count: 0, workflow_revisions: []}
                return queryEvaluatorRevisionsByWorkflow(workflowId, projectId)
            },
            enabled: get(sessionAtom) && !!projectId && !!workflowId,
            staleTime: 30_000,
        }
    }),
)

/**
 * Derived atom family for revision list data by workflow ID (convenience).
 */
export const evaluatorRevisionsByWorkflowListDataAtomFamily = atomFamily((workflowId: string) =>
    atom<Evaluator[]>((get) => {
        const query = get(evaluatorRevisionsByWorkflowQueryAtomFamily(workflowId))
        return query.data?.workflow_revisions ?? []
    }),
)

// ============================================================================
// REVISION LIST QUERY (for 3-level hierarchy)
// ============================================================================

/**
 * Query atom family for fetching revisions of a variant.
 * Used in the Evaluator → Variant → Revision selection hierarchy.
 */
export const evaluatorRevisionsQueryAtomFamily = atomFamily((variantId: string) =>
    atomWithQuery((get) => {
        const projectId = get(evaluatorProjectIdAtom)
        return {
            queryKey: ["evaluators", "revisions", variantId, projectId],
            queryFn: async (): Promise<EvaluatorRevisionsResponse> => {
                if (!projectId || !variantId) return {count: 0, workflow_revisions: []}
                return queryEvaluatorRevisions(variantId, projectId)
            },
            enabled: get(sessionAtom) && !!projectId && !!variantId,
            staleTime: 30_000,
        }
    }),
)

/**
 * Derived atom family for revision list data (convenience).
 */
export const evaluatorRevisionsListDataAtomFamily = atomFamily((variantId: string) =>
    atom<Evaluator[]>((get) => {
        const query = get(evaluatorRevisionsQueryAtomFamily(variantId))
        return query.data?.workflow_revisions ?? []
    }),
)

// ============================================================================
// SINGLE ENTITY QUERY
// ============================================================================

/**
 * Query atom family for fetching a single evaluator's latest revision by workflow ID.
 * Returns the WorkflowRevision which contains `data` (uri, schemas, parameters).
 */
export const evaluatorQueryAtomFamily = atomFamily((evaluatorId: string) =>
    atomWithQuery((get) => {
        const projectId = get(evaluatorProjectIdAtom)

        return {
            queryKey: ["evaluators", "revision", evaluatorId, projectId],
            queryFn: async (): Promise<Evaluator | null> => {
                if (!projectId || !evaluatorId) return null
                return fetchEvaluator({id: evaluatorId, projectId})
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
export const evaluatorDraftAtomFamily = atomFamily((_evaluatorId: string) =>
    atom<Partial<Evaluator> | null>(null),
)

/**
 * Merged entity atom: server data + local draft overlay.
 */
export const evaluatorEntityAtomFamily = atomFamily((evaluatorId: string) =>
    atom<Evaluator | null>((get) => {
        const query = get(evaluatorQueryAtomFamily(evaluatorId))
        const serverData = query.data ?? null
        const draft = get(evaluatorDraftAtomFamily(evaluatorId))

        if (!serverData) return draft as Evaluator | null
        if (!draft) return serverData

        return {
            ...serverData,
            ...draft,
            data: {
                ...serverData.data,
                ...draft.data,
            },
        } as Evaluator
    }),
)

/**
 * Is the evaluator dirty (has local edits)?
 */
export const evaluatorIsDirtyAtomFamily = atomFamily((evaluatorId: string) =>
    atom<boolean>((get) => {
        const draft = get(evaluatorDraftAtomFamily(evaluatorId))
        return draft !== null
    }),
)

// ============================================================================
// MUTATIONS (Write Atoms)
// ============================================================================

/**
 * Update evaluator draft state.
 */
export const updateEvaluatorDraftAtom = atom(
    null,
    (_get, set, evaluatorId: string, updates: Partial<Evaluator>) => {
        const current = _get(evaluatorDraftAtomFamily(evaluatorId))
        set(evaluatorDraftAtomFamily(evaluatorId), {
            ...current,
            ...updates,
        })
    },
)

/**
 * Discard evaluator draft (reset to server state).
 */
export const discardEvaluatorDraftAtom = atom(null, (_get, set, evaluatorId: string) => {
    set(evaluatorDraftAtomFamily(evaluatorId), null)
})

// ============================================================================
// CACHE INVALIDATION
// ============================================================================

/**
 * Invalidate the evaluators list cache.
 * Call after create/update/archive operations.
 */
export function invalidateEvaluatorsListCache(options?: StoreOptions) {
    const store = getStore(options)
    // Force refetch by resetting the query
    const queryAtom = evaluatorsListQueryAtom
    const current = store.get(queryAtom)
    if (current?.refetch) {
        current.refetch()
    }
}

/**
 * Invalidate a single evaluator's cache.
 */
export function invalidateEvaluatorCache(evaluatorId: string, options?: StoreOptions) {
    const store = getStore(options)
    const queryAtom = evaluatorQueryAtomFamily(evaluatorId)
    const current = store.get(queryAtom)
    if (current?.refetch) {
        current.refetch()
    }
}
