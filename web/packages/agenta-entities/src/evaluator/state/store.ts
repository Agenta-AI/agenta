/**
 * Evaluator Store
 *
 * Jotai atoms for evaluator entity state management.
 * Uses atomFamily pattern for per-entity state with TanStack Query integration.
 *
 * @packageDocumentation
 */

import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {createBatchFetcher} from "@agenta/shared/utils"
import {atom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"
import {atomFamily} from "jotai-family"
import {atomWithQuery, queryClientAtom} from "jotai-tanstack-query"

import type {StoreOptions} from "../../shared"
import {
    fetchEvaluatorsBatch,
    fetchEvaluatorRevisionById,
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

type QueryClient = import("@tanstack/react-query").QueryClient

interface EvaluatorLatestRevisionRequest {
    projectId: string
    workflowId: string
    queryClient?: QueryClient
}

function primeEvaluatorRevisionDetailCache(
    queryClient: QueryClient,
    projectId: string,
    evaluator: Evaluator | null | undefined,
): void {
    if (!evaluator?.id) return
    queryClient.setQueryData(["evaluatorRevision", evaluator.id, projectId], evaluator)
}

function findLatestEvaluatorRevisionInCache(
    queryClient: QueryClient,
    projectId: string,
    workflowId: string,
): Evaluator | undefined {
    const direct = queryClient.getQueryData<Evaluator>([
        "evaluators",
        "revision",
        workflowId,
        projectId,
    ])
    if (direct) return direct

    const revisionsByWorkflow = queryClient.getQueryData<EvaluatorRevisionsResponse>([
        "evaluators",
        "revisionsByWorkflow",
        workflowId,
        projectId,
    ])
    const revisions = revisionsByWorkflow?.workflow_revisions ?? []
    if (revisions.length === 0) return undefined

    let latest: Evaluator | null = null
    for (const revision of revisions) {
        if (!latest || (revision.version ?? 0) > (latest.version ?? 0)) {
            latest = revision
        }
    }

    return latest ?? undefined
}

const evaluatorLatestRevisionBatchFetcher = createBatchFetcher<
    EvaluatorLatestRevisionRequest,
    Evaluator | null
>({
    maxBatchSize: 50,
    flushDelay: 10,
    serializeKey: (req) => `${req.projectId}:${req.workflowId}`,
    batchFn: async (requests, serializedKeys) => {
        const results = new Map<string, Evaluator | null>()
        const byProject = new Map<
            string,
            {workflowIds: string[]; keys: string[]; queryClients: Set<QueryClient>}
        >()

        requests.forEach((req, index) => {
            const key = serializedKeys[index]
            if (!req.projectId || !req.workflowId) {
                results.set(key, null)
                return
            }

            if (req.queryClient) {
                const cached = findLatestEvaluatorRevisionInCache(
                    req.queryClient,
                    req.projectId,
                    req.workflowId,
                )
                if (cached) {
                    results.set(key, cached)
                    return
                }
            }

            const existing = byProject.get(req.projectId)
            if (existing) {
                existing.workflowIds.push(req.workflowId)
                existing.keys.push(key)
                if (req.queryClient) existing.queryClients.add(req.queryClient)
            } else {
                byProject.set(req.projectId, {
                    workflowIds: [req.workflowId],
                    keys: [key],
                    queryClients: new Set(req.queryClient ? [req.queryClient] : []),
                })
            }
        })

        await Promise.all(
            Array.from(byProject.entries()).map(async ([projectId, group]) => {
                try {
                    const revisionMap = await fetchEvaluatorsBatch(projectId, group.workflowIds)
                    group.workflowIds.forEach((workflowId, index) => {
                        const key = group.keys[index]
                        const revision = revisionMap.get(workflowId) ?? null
                        results.set(key, revision)

                        if (revision) {
                            group.queryClients.forEach((queryClient) => {
                                queryClient.setQueryData(
                                    ["evaluators", "revision", workflowId, projectId],
                                    revision,
                                )
                                primeEvaluatorRevisionDetailCache(queryClient, projectId, revision)
                            })
                        }
                    })
                } catch (error) {
                    console.error(
                        "[evaluatorLatestRevisionBatchFetcher] Failed to fetch latest revisions:",
                        group.workflowIds,
                        error,
                    )
                    group.keys.forEach((key) => {
                        results.set(key, null)
                    })
                }
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
        const queryClient = get(queryClientAtom)
        return {
            queryKey: ["evaluators", "revisionsByWorkflow", workflowId, projectId],
            queryFn: async (): Promise<EvaluatorRevisionsResponse> => {
                if (!projectId || !workflowId) return {count: 0, workflow_revisions: []}
                const response = await queryEvaluatorRevisionsByWorkflow(workflowId, projectId)

                for (const revision of response.workflow_revisions ?? []) {
                    primeEvaluatorRevisionDetailCache(queryClient, projectId, revision)
                }

                let latest: Evaluator | null = null
                for (const revision of response.workflow_revisions ?? []) {
                    if (!latest || (revision.version ?? 0) > (latest.version ?? 0)) {
                        latest = revision
                    }
                }
                if (latest) {
                    queryClient.setQueryData(
                        ["evaluators", "revision", workflowId, projectId],
                        latest,
                    )
                }

                return response
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
        const queryClient = get(queryClientAtom)
        return {
            queryKey: ["evaluators", "revisions", variantId, projectId],
            queryFn: async (): Promise<EvaluatorRevisionsResponse> => {
                if (!projectId || !variantId) return {count: 0, workflow_revisions: []}
                const response = await queryEvaluatorRevisions(variantId, projectId)

                for (const revision of response.workflow_revisions ?? []) {
                    primeEvaluatorRevisionDetailCache(queryClient, projectId, revision)
                    if (revision.workflow_id) {
                        const cachedLatest = queryClient.getQueryData<Evaluator>([
                            "evaluators",
                            "revision",
                            revision.workflow_id,
                            projectId,
                        ])
                        if (
                            !cachedLatest ||
                            (revision.version ?? 0) > (cachedLatest.version ?? 0)
                        ) {
                            queryClient.setQueryData(
                                ["evaluators", "revision", revision.workflow_id, projectId],
                                revision,
                            )
                        }
                    }
                }

                return response
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
// SINGLE REVISION QUERY
// ============================================================================

/**
 * Query atom family for fetching a single evaluator revision by revision ID.
 * Used when consumers already store revision IDs and only need revision-level
 * metadata such as the display name.
 */
export const evaluatorRevisionQueryAtomFamily = atomFamily((revisionId: string) =>
    atomWithQuery((get) => {
        const projectId = get(evaluatorProjectIdAtom)
        const queryClient = get(queryClientAtom)
        const detailCached = projectId
            ? queryClient.getQueryData<Evaluator>(["evaluatorRevision", revisionId, projectId])
            : undefined

        return {
            queryKey: ["evaluatorRevision", revisionId, projectId],
            queryFn: async (): Promise<Evaluator | null> => {
                if (!projectId || !revisionId) return null
                if (detailCached) return detailCached

                const revision = await fetchEvaluatorRevisionById(revisionId, projectId)
                primeEvaluatorRevisionDetailCache(queryClient, projectId, revision)
                return revision
            },
            initialData: detailCached ?? undefined,
            enabled: get(sessionAtom) && !!projectId && !!revisionId && !detailCached,
            staleTime: 30_000,
        }
    }),
)

// ============================================================================
// SINGLE ENTITY QUERY
// ============================================================================

/**
 * Query atom family for fetching a single evaluator's latest revision by workflow ID.
 * Returns the WorkflowRevision which contains `data` (uri, schemas, parameters).
 *
 * IMPORTANT: `atomWithQuery` in jotai-tanstack-query v0.11.0 does NOT
 * re-evaluate its getter when Jotai atom dependencies change after the
 * initial subscription. So we read `projectIdAtom` imperatively in `queryFn`
 * and throw when it's not available so TanStack Query retries.
 */
export const evaluatorQueryAtomFamily = atomFamily((evaluatorId: string) =>
    atomWithQuery((get) => {
        const queryClient = get(queryClientAtom)

        return {
            queryKey: ["evaluators", "revision", evaluatorId],
            queryFn: async (): Promise<Evaluator | null> => {
                const projectId = getStore().get(evaluatorProjectIdAtom)
                if (!evaluatorId) return null
                if (!projectId) {
                    throw new Error("projectId not yet available")
                }

                const detailCached = queryClient.getQueryData<Evaluator>([
                    "evaluators",
                    "revision",
                    evaluatorId,
                    projectId,
                ])
                if (detailCached) return detailCached

                const cached = findLatestEvaluatorRevisionInCache(
                    queryClient,
                    projectId,
                    evaluatorId,
                )
                if (cached) return cached

                return evaluatorLatestRevisionBatchFetcher({
                    projectId,
                    workflowId: evaluatorId,
                    queryClient,
                })
            },
            enabled: !!evaluatorId,
            retry: (failureCount: number, error: Error) => {
                if (error?.message === "projectId not yet available" && failureCount < 5) {
                    return true
                }
                return false
            },
            retryDelay: (attempt: number) => Math.min(200 * 2 ** attempt, 2000),
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
