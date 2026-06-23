/**
 * Workflow Store
 *
 * Jotai atoms for workflow entity state management.
 * Uses atomFamily pattern for per-entity state with TanStack Query integration.
 *
 * Unlike the evaluator store which hardcodes `is_evaluator: true` for queries,
 * the workflow store does NOT inject any default flags — consumers control
 * filtering via the query parameters.
 *
 * @packageDocumentation
 */

import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {createBatchFetcher, stripEmptyCollectionsDeep} from "@agenta/shared/utils"
import isEqual from "fast-deep-equal"
import {atom, type Getter} from "jotai"
import {getDefaultStore} from "jotai/vanilla"
import {atomFamily} from "jotai-family"
import {atomWithQuery, queryClientAtom} from "jotai-tanstack-query"

import {nestEvaluatorConfiguration, nestEvaluatorSchema} from "../../runnable/evaluatorTransforms"
import {syncPromptInputKeysInParameters} from "../../runnable/utils"
import type {StoreOptions, ListQueryState} from "../../shared"
import {generateLocalId, isLocalDraftId, isPlaceholderId} from "../../shared"
import type {
    InspectWorkflowResponse,
    InterfaceSchemasResponse,
    AppOpenApiSchemas,
    SimpleApplicationFetchResponse,
    AgentBuildKitOverlay,
} from "../api"
import {
    AGENT_BUILD_KIT_WORKFLOW_SLUG,
    extractDefaultsFromSchema,
    fetchWorkflowRevisionsByIdsBatch,
    inspectWorkflow,
    fetchAgentBuildKitOverlay,
    fetchSimpleApplication,
    fetchWorkflowAppOpenApiSchema,
    fetchAgTypeSchema,
    fetchWorkflowsBatch,
    queryWorkflows,
    queryWorkflowVariants,
    queryWorkflowRevisionsByWorkflow,
    queryWorkflowRevisions,
} from "../api"
import type {
    Workflow,
    WorkflowVariant,
    WorkflowVariantsResponse,
    WorkflowRevisionsResponse,
} from "../core"
import {buildWorkflowUri, parseWorkflowKeyFromUri} from "../core/schema"

import {evaluatorTemplateByKeyAtomFamily} from "./evaluatorTemplateAtoms"
import {
    resolveServiceTypeFromUrl,
    buildServiceUrlFromUri,
    isManagedServiceUrl,
    deriveWorkflowTypeFromRevision,
    withLatestAgentFlags,
} from "./helpers"

// ============================================================================
// HELPERS
// ============================================================================

function getStore(options?: StoreOptions) {
    return options?.store ?? getDefaultStore()
}

type QueryClient = import("@tanstack/react-query").QueryClient

interface WorkflowRevisionRequest {
    projectId: string
    revisionId: string
}

interface WorkflowLatestRevisionRequest {
    projectId: string
    workflowId: string
    queryClient?: QueryClient
}

const toUnixMs = (value: string | null | undefined): number => {
    if (!value) return 0
    const timestamp = new Date(value).getTime()
    return Number.isFinite(timestamp) ? timestamp : 0
}

const workflowRecencyScore = (workflow: Workflow | null | undefined): number => {
    if (!workflow) return 0
    return (
        toUnixMs(workflow.created_at) ||
        toUnixMs(workflow.updated_at) ||
        Number(workflow.version ?? 0)
    )
}

const pickMostRecentWorkflowRevision = (
    revisions: (Workflow | null | undefined)[],
): Workflow | null => {
    let latest: Workflow | null = null
    let latestScore = -1

    for (const revision of revisions) {
        if (!revision) continue
        // Skip v0 revisions (auto-created initial revisions with no useful data)
        if ((revision.version ?? 0) === 0) continue
        const score = workflowRecencyScore(revision)
        if (!latest || score > latestScore) {
            latest = revision
            latestScore = score
        }
    }

    return latest
}

function primeWorkflowRevisionDetailCache(
    queryClient: QueryClient,
    projectId: string,
    workflow: Workflow | null | undefined,
): void {
    if (!workflow?.id) return
    queryClient.setQueryData(["workflows", "revision", workflow.id, projectId], workflow)
}

/**
 * Imperative wrapper for `primeWorkflowRevisionDetailCache` callable from
 * commit/create handlers. Seeds the per-revision detail cache with the
 * server response so subsequent `workflowQueryAtomFamily` reads resolve
 * instantly without a network round-trip — critical for the post-commit
 * navigation flow where the playground page mounts immediately after
 * router.push and must not fall back to the workflow's v0 seed revision
 * while the GET endpoint catches up.
 */
export function primeWorkflowRevisionDetailCacheImperative(
    workflow: Workflow | null | undefined,
    options?: StoreOptions,
): void {
    if (!workflow?.id) return
    const store = getStore(options)
    const projectId = store.get(workflowProjectIdAtom)
    if (!projectId) return
    try {
        const qc = store.get(queryClientAtom)
        primeWorkflowRevisionDetailCache(qc, projectId, workflow)
    } catch {
        // queryClientAtom may not be initialized yet (rare)
    }
}

function findWorkflowRevisionInDetailCache(
    queryClient: QueryClient,
    projectId: string,
    revisionId: string,
): Workflow | undefined {
    return queryClient.getQueryData<Workflow>(["workflows", "revision", revisionId, projectId])
}

function findWorkflowRevisionInListCaches(
    queryClient: QueryClient,
    projectId: string,
    revisionId: string,
): Workflow | undefined {
    const revisionQueries = queryClient.getQueriesData<WorkflowRevisionsResponse>({
        predicate: (query) => {
            const key = query.queryKey
            return (
                key[0] === "workflows" &&
                (key[1] === "revisionsByWorkflow" || key[1] === "revisions") &&
                key[3] === projectId
            )
        },
    })

    for (const [_queryKey, data] of revisionQueries) {
        const revisions = data?.workflow_revisions
        if (!Array.isArray(revisions)) continue
        const found = revisions.find((revision) => revision.id === revisionId)
        if (found) return found
    }

    const latestQueries = queryClient.getQueriesData<Workflow | null>({
        predicate: (query) => {
            const key = query.queryKey
            return key[0] === "workflows" && key[1] === "latestRevision" && key[3] === projectId
        },
    })

    for (const [_queryKey, data] of latestQueries) {
        if (data?.id === revisionId) return data
    }

    return undefined
}

function findWorkflowRevisionInCache(
    queryClient: QueryClient,
    projectId: string,
    revisionId: string,
): Workflow | undefined {
    return (
        findWorkflowRevisionInDetailCache(queryClient, projectId, revisionId) ??
        findWorkflowRevisionInListCaches(queryClient, projectId, revisionId)
    )
}

function findLatestWorkflowRevisionInCache(
    queryClient: QueryClient,
    projectId: string,
    workflowId: string,
): Workflow | undefined {
    const direct = queryClient.getQueryData<Workflow>([
        "workflows",
        "latestRevision",
        workflowId,
        projectId,
    ])
    if (direct) return direct

    const revisionsByWorkflow = queryClient.getQueryData<WorkflowRevisionsResponse>([
        "workflows",
        "revisionsByWorkflow",
        workflowId,
        projectId,
    ])
    const revisions = revisionsByWorkflow?.workflow_revisions ?? []
    if (revisions.length === 0) return undefined

    const latestByRecency = pickMostRecentWorkflowRevision(revisions)
    return latestByRecency ?? undefined
}

const workflowRevisionBatchFetcher = createBatchFetcher<WorkflowRevisionRequest, Workflow | null>({
    maxBatchSize: 50,
    flushDelay: 10,
    serializeKey: (req) => `${req.projectId}:${req.revisionId}`,
    batchFn: async (requests, serializedKeys) => {
        const results = new Map<string, Workflow | null>()
        serializedKeys.forEach((key) => results.set(key, null))

        // Exactly one project is in scope at a time in the web app.
        const projectId = requests[0]?.projectId
        if (!projectId) return results
        if (requests.some((req) => req.projectId !== projectId)) {
            throw new Error("workflowRevisionBatchFetcher: requests span multiple projects")
        }

        const revisionIds = [...new Set(requests.map((req) => req.revisionId).filter(Boolean))]
        if (revisionIds.length === 0) return results

        const revisionMap = await fetchWorkflowRevisionsByIdsBatch(projectId, revisionIds)
        requests.forEach((req, index) => {
            results.set(serializedKeys[index], revisionMap.get(req.revisionId) ?? null)
        })

        return results
    },
})

const workflowLatestRevisionBatchFetcher = createBatchFetcher<
    WorkflowLatestRevisionRequest,
    Workflow | null
>({
    maxBatchSize: 50,
    flushDelay: 10,
    serializeKey: (req) => `${req.projectId}:${req.workflowId}`,
    batchFn: async (requests, serializedKeys) => {
        const results = new Map<string, Workflow | null>()
        serializedKeys.forEach((key) => results.set(key, null))

        // Exactly one project is in scope at a time in the web app.
        const projectId = requests[0]?.projectId
        if (!projectId) return results
        if (requests.some((req) => req.projectId !== projectId)) {
            throw new Error("workflowLatestRevisionBatchFetcher: requests span multiple projects")
        }

        const pending: {workflowId: string; key: string}[] = []
        const queryClients = new Set<QueryClient>()

        requests.forEach((req, index) => {
            const key = serializedKeys[index]
            if (!req.workflowId) return

            if (req.queryClient) {
                const cached = findLatestWorkflowRevisionInCache(
                    req.queryClient,
                    projectId,
                    req.workflowId,
                )
                if (cached) {
                    results.set(key, cached)
                    return
                }
                queryClients.add(req.queryClient)
            }

            pending.push({workflowId: req.workflowId, key})
        })

        if (pending.length === 0) return results

        try {
            const revisionMap = await fetchWorkflowsBatch(
                projectId,
                pending.map((entry) => entry.workflowId),
            )
            pending.forEach(({workflowId, key}) => {
                const revision = revisionMap.get(workflowId) ?? null
                results.set(key, revision)

                if (revision) {
                    queryClients.forEach((queryClient) => {
                        queryClient.setQueryData(
                            ["workflows", "latestRevision", workflowId, projectId],
                            revision,
                        )
                        primeWorkflowRevisionDetailCache(queryClient, projectId, revision)
                    })
                }
            })
        } catch (error) {
            console.error(
                "[workflowLatestRevisionBatchFetcher] Failed to fetch latest revisions:",
                error,
            )
        }

        return results
    },
})

// ============================================================================
// PROJECT ID ATOM
// ============================================================================

/**
 * Project ID atom.
 * Re-exports the shared projectIdAtom so workflow queries use the
 * canonical project ID without requiring manual wiring.
 */
export const workflowProjectIdAtom = projectIdAtom

// ============================================================================
// LIST QUERY
// ============================================================================

/**
 * Thin workflow reference — only fields needed for list display and filtering.
 * Full workflow data lives in the molecule (workflowEntityAtomFamily).
 *
 * Contains the superset of fields consumed by all list-level atoms:
 * - `id`, `name`, `slug` — display and lookup
 * - `flags` — filtering (is_evaluator, is_feedback, is_custom)
 * - `deleted_at` — archive filtering
 * - `description` — human evaluator list display
 * - `created_at` / `updated_at` — sort order and metadata display in some views
 */
export interface WorkflowListRef {
    id: string
    name: string | null
    slug: string | null
    description: string | null
    flags: Workflow["flags"]
    deleted_at: string | null
    created_at: string | null
    updated_at: string | null
}

/**
 * Thin list response cached in TanStack Query.
 */
interface WorkflowListRefsResponse {
    count: number
    refs: WorkflowListRef[]
}

/**
 * Strip a full Workflow down to a WorkflowListRef.
 */
export function toWorkflowListRef(w: Workflow): WorkflowListRef {
    return {
        id: w.id,
        name: w.name ?? null,
        slug: w.slug ?? null,
        description: w.description ?? null,
        flags: w.flags,
        deleted_at: w.deleted_at ?? null,
        created_at: w.created_at ?? null,
        updated_at: w.updated_at ?? null,
    }
}

/**
 * Query atom for app (non-evaluator) workflows.
 * Fetches workflows with `is_evaluator: false`.
 *
 * Caches only thin references in TanStack Query.
 * The list API already returns lean objects (no `data` field),
 * so no molecule seeding is needed — the molecule fetches full
 * entity data on demand when something subscribes.
 */
export const appWorkflowsListQueryAtom = atomWithQuery((get) => {
    const projectId = get(workflowProjectIdAtom)
    return {
        queryKey: ["workflows", "apps", "list", projectId],
        queryFn: async (): Promise<WorkflowListRefsResponse> => {
            if (!projectId) return {count: 0, refs: []}
            const response = await queryWorkflows({projectId, flags: {is_evaluator: false}})
            const workflows = response.workflows ?? []

            return {
                count: response.count ?? workflows.length,
                refs: workflows.map(toWorkflowListRef),
            }
        },
        enabled: get(sessionAtom) && !!projectId,
        staleTime: 30_000,
    }
})

/**
 * Query atom family for a SINGLE workflow artifact by id.
 *
 * Resolves one workflow (app OR evaluator) via `workflow_refs`, returning the
 * artifact directly — name + role flags (`is_application`/`is_evaluator`), and
 * NOT a revision, so it's immune to the version-0 flag-merge gap. Lets callers
 * resolve "the current workflow" by id WITHOUT listing the entire evaluator
 * catalog: check the (load-bearing) apps list first, and only subscribe here
 * when the id isn't an app (i.e. an evaluator or not-found).
 */
export const workflowDetailQueryAtomFamily = atomFamily((workflowId: string | null) =>
    atomWithQuery((get) => {
        const projectId = get(workflowProjectIdAtom)
        return {
            queryKey: ["workflows", "detail", projectId, workflowId],
            queryFn: async (): Promise<Workflow | null> => {
                if (!projectId || !workflowId) return null
                // `include_archived: true` so this single query satisfies BOTH
                // consumers — `currentWorkflowContextAtom` (which filters archived
                // out via `deleted_at`) and the app-state `currentAppQueryAtom`
                // (which resolves archived apps). One shared query = one request,
                // instead of two by-id fetches differing only on this flag.
                const response = await queryWorkflows({
                    projectId,
                    workflowRefs: [{id: workflowId}],
                    includeArchived: true,
                })
                return (response.workflows?.[0] as Workflow | undefined) ?? null
            },
            enabled: get(sessionAtom) && !!projectId && !!workflowId,
            staleTime: 30_000,
        }
    }),
)

/**
 * Derived atom for app (non-evaluator) workflows list data.
 * Returns workflow-level objects directly from the query cache.
 */
export const appWorkflowsListDataAtom = atom<Workflow[]>((get) => {
    const query = get(appWorkflowsListQueryAtom)
    const refs = query.data?.refs ?? []
    return refs as Workflow[]
})

/**
 * Derived atom for non-archived app workflows.
 * Filters by deleted_at on the cached workflow-level refs.
 */
export const nonArchivedAppWorkflowsAtom = atom<Workflow[]>((get) => {
    const query = get(appWorkflowsListQueryAtom)
    const refs = query.data?.refs ?? []
    return refs.filter((ref) => !ref.deleted_at) as Workflow[]
})

const appWorkflowsWithAgentFlagsQueryAtom = atomWithQuery((get) => {
    const projectId = get(workflowProjectIdAtom)
    const appQuery = get(appWorkflowsListQueryAtom)
    const workflows = (appQuery.data?.refs ?? []) as Workflow[]
    const workflowVersionKey = workflows.map((workflow) => [workflow.id, workflow.updated_at])

    return {
        queryKey: ["workflows", "apps", "agentFlags", projectId, workflowVersionKey],
        queryFn: async (): Promise<Workflow[]> => {
            if (!projectId || workflows.length === 0) return workflows
            const latestRevisions = await fetchWorkflowsBatch(
                projectId,
                workflows.map((workflow) => workflow.id),
            )
            return withLatestAgentFlags(workflows, latestRevisions)
        },
        enabled: get(sessionAtom) && !!projectId && !appQuery.isPending,
        staleTime: 30_000,
    }
})

// ============================================================================
// VARIANT LIST QUERY (for 3-level hierarchy)
// ============================================================================

/**
 * Variants query keyed by explicit projectId. This is the canonical query;
 * the explicit key lets it run inside isolated Jotai stores (e.g. the
 * evaluation tables) where the global projectIdAtom is not hydrated.
 */
export const workflowVariantsScopedQueryAtomFamily = atomFamily(
    ({projectId, workflowId}: {projectId: string; workflowId: string}) =>
        atomWithQuery(() => ({
            queryKey: ["workflows", "variants", workflowId, projectId],
            queryFn: async (): Promise<WorkflowVariantsResponse> => {
                if (!projectId || !workflowId) return {count: 0, workflow_variants: []}
                return queryWorkflowVariants(workflowId, projectId)
            },
            enabled: !!projectId && !!workflowId,
            staleTime: 30_000,
        })),
    (a, b) => a.projectId === b.projectId && a.workflowId === b.workflowId,
)

/**
 * Query atom family for fetching variants of a workflow.
 * Used in the Workflow → Variant → Revision selection hierarchy.
 * Default-store wrapper around the scoped query above.
 */
export const workflowVariantsQueryAtomFamily = atomFamily((workflowId: string) =>
    atom((get) => {
        const projectId = get(workflowProjectIdAtom)
        if (!projectId || !workflowId || !get(sessionAtom)) {
            return {
                data: undefined as WorkflowVariantsResponse | undefined,
                isPending: Boolean(workflowId),
                isError: false,
                error: null,
            }
        }
        return get(workflowVariantsScopedQueryAtomFamily({projectId, workflowId}))
    }),
)

/**
 * Derived atom family for variant list data (convenience).
 */
export const workflowVariantsListDataAtomFamily = atomFamily((workflowId: string) =>
    atom<WorkflowVariant[]>((get) => {
        const query = get(workflowVariantsQueryAtomFamily(workflowId))
        return query.data?.workflow_variants ?? []
    }),
)

// ============================================================================
// REVISION LIST QUERY BY WORKFLOW (for 2-level hierarchy: Workflow → Revision)
// ============================================================================

/**
 * Thin revision reference — only IDs and sorting fields.
 * Full revision data lives in the molecule (workflowQueryAtomFamily).
 */
export interface WorkflowRevisionRef {
    id: string
    version: number | null
    created_at: string | null
}

/**
 * Thin reference response for revisions-by-workflow query.
 */
interface WorkflowRevisionRefsResponse {
    count: number
    refs: WorkflowRevisionRef[]
}

/**
 * Query atom family for fetching revisions by workflow ID.
 *
 * Returns **thin references only** (id, version, created_at).
 * Full revision data is primed into the per-revision detail cache
 * so the molecule can serve it without extra fetches.
 */
export const workflowRevisionsByWorkflowQueryAtomFamily = atomFamily((workflowId: string) =>
    atomWithQuery((get) => {
        const projectId = get(workflowProjectIdAtom)
        const queryClient = get(queryClientAtom)
        return {
            queryKey: ["workflows", "revisionsByWorkflow", workflowId, projectId],
            queryFn: async (): Promise<WorkflowRevisionRefsResponse> => {
                if (!projectId || !workflowId) return {count: 0, refs: []}
                const response = await queryWorkflowRevisionsByWorkflow(workflowId, projectId)

                // Prime full data into the per-revision detail cache (molecule source)
                for (const revision of response.workflow_revisions ?? []) {
                    primeWorkflowRevisionDetailCache(queryClient, projectId, revision)
                }

                // Also prime the latest revision cache
                const revisions = response.workflow_revisions ?? []
                const latestByRecency = pickMostRecentWorkflowRevision(revisions)
                if (latestByRecency) {
                    queryClient.setQueryData(
                        ["workflows", "latestRevision", workflowId, projectId],
                        latestByRecency,
                    )
                }

                // Return thin references only — full data is in the detail cache
                return {
                    count: response.count ?? revisions.length,
                    refs: revisions.map((r) => ({
                        id: r.id,
                        version: r.version ?? null,
                        created_at: r.created_at ?? null,
                    })),
                }
            },
            enabled: get(sessionAtom) && !!projectId && !!workflowId,
            staleTime: 30_000,
        }
    }),
)

/**
 * Derived atom family for revision reference list by workflow ID.
 * Sorted by recency (created_at desc, then version desc).
 *
 * Returns thin references — use `workflowMolecule.selectors.data(ref.id)`
 * to read full revision data per item.
 */
export const workflowRevisionRefsByWorkflowAtomFamily = atomFamily((workflowId: string) =>
    atom<WorkflowRevisionRef[]>((get) => {
        const query = get(workflowRevisionsByWorkflowQueryAtomFamily(workflowId))
        const refs = query.data?.refs ?? []
        return [...refs].sort((a, b) => {
            const aTime = a.created_at ? new Date(a.created_at).getTime() : 0
            const bTime = b.created_at ? new Date(b.created_at).getTime() : 0
            if (bTime !== aTime) return bTime - aTime
            return (b.version ?? 0) - (a.version ?? 0)
        })
    }),
)

/**
 * Derived atom family for resolved revision list by workflow ID.
 * Resolves thin refs through the molecule entity atom for full data.
 *
 * Use this when you need full Workflow objects (display, drawer, selection).
 * For just IDs, use `workflowRevisionRefsByWorkflowAtomFamily` instead.
 */
export const workflowRevisionsByWorkflowListDataAtomFamily = atomFamily((workflowId: string) =>
    atom<Workflow[]>((get) => {
        const refs = get(workflowRevisionRefsByWorkflowAtomFamily(workflowId))
        return refs
            .map((ref) => get(workflowBaseEntityAtomFamily(ref.id)))
            .filter((w): w is Workflow => w !== null)
    }),
)

// ============================================================================
// REVISION LIST QUERY (for 3-level hierarchy)
// ============================================================================

/**
 * Thin revision reference response for the 3-level revision query.
 */
interface WorkflowRevisionRefsByVariantResponse {
    count: number
    refs: WorkflowRevisionRef[]
}

/**
 * Query atom family for fetching revisions of a variant.
 * Used in the Workflow → Variant → Revision selection hierarchy.
 *
 * Returns **thin references only** (id, version, created_at).
 * Full revision data is primed into the per-revision detail cache
 * so the molecule can serve it without extra fetches.
 */
export const workflowRevisionsQueryAtomFamily = atomFamily((variantId: string) =>
    atomWithQuery((get) => {
        const projectId = get(workflowProjectIdAtom)
        const queryClient = get(queryClientAtom)
        return {
            queryKey: ["workflows", "revisions", variantId, projectId],
            queryFn: async (): Promise<WorkflowRevisionRefsByVariantResponse> => {
                if (!projectId || !variantId) return {count: 0, refs: []}
                const response = await queryWorkflowRevisions(variantId, projectId)

                // Prime full data into the per-revision detail cache (molecule source)
                for (const revision of response.workflow_revisions ?? []) {
                    primeWorkflowRevisionDetailCache(queryClient, projectId, revision)
                    if (revision.workflow_id) {
                        const cachedLatest = queryClient.getQueryData<Workflow>([
                            "workflows",
                            "latestRevision",
                            revision.workflow_id,
                            projectId,
                        ])
                        if (
                            !cachedLatest ||
                            workflowRecencyScore(revision) > workflowRecencyScore(cachedLatest)
                        ) {
                            queryClient.setQueryData(
                                ["workflows", "latestRevision", revision.workflow_id, projectId],
                                revision,
                            )
                        }
                    }
                }

                // Return thin references only — full data is in the detail cache
                const revisions = response.workflow_revisions ?? []
                return {
                    count: response.count ?? revisions.length,
                    refs: revisions.map((r) => ({
                        id: r.id,
                        version: r.version ?? null,
                        created_at: r.created_at ?? null,
                    })),
                }
            },
            enabled: get(sessionAtom) && !!projectId && !!variantId,
            staleTime: 30_000,
        }
    }),
)

/**
 * Derived atom family for revision reference list by variant ID.
 * Sorted by version descending (newest first).
 *
 * Returns thin references — use `workflowMolecule.selectors.data(ref.id)`
 * to read full revision data per item.
 */
export const workflowRevisionRefsByVariantAtomFamily = atomFamily((variantId: string) =>
    atom<WorkflowRevisionRef[]>((get) => {
        const query = get(workflowRevisionsQueryAtomFamily(variantId))
        const refs = query.data?.refs ?? []
        return [...refs].sort((a, b) => (b.version ?? 0) - (a.version ?? 0))
    }),
)

/**
 * Derived atom family for resolved revision list by variant ID.
 * Resolves thin refs through the molecule entity atom for full data.
 *
 * Use this when you need full Workflow objects (display, drawer, selection).
 * For just IDs, use `workflowRevisionRefsByVariantAtomFamily` instead.
 */
export const workflowRevisionsListDataAtomFamily = atomFamily((variantId: string) =>
    atom<Workflow[]>((get) => {
        const refs = get(workflowRevisionRefsByVariantAtomFamily(variantId))
        return refs
            .map((ref) => get(workflowBaseEntityAtomFamily(ref.id)))
            .filter((w): w is Workflow => w !== null)
    }),
)

// ============================================================================
// LIST QUERY STATE WRAPPERS (for selection adapters and relations)
// ============================================================================

/**
 * ListQueryState wrapper for workflow variants.
 * Wraps the TanStack Query result into the ListQueryState shape
 * required by entity selection adapters and relations.
 */
export const workflowVariantsListQueryStateAtomFamily = atomFamily((workflowId: string) =>
    atom<ListQueryState<WorkflowVariant>>((get) => {
        const query = get(workflowVariantsQueryAtomFamily(workflowId))
        return {
            data: query.data?.workflow_variants ?? [],
            isPending: query.isPending ?? false,
            isError: query.isError ?? false,
            error: query.error ?? null,
        }
    }),
)

/**
 * ListQueryState wrapper for workflow revisions (by variant).
 * Used in the 3-level selection hierarchy (Workflow → Variant → Revision).
 * Resolves thin refs through the molecule for full Workflow objects.
 * Sorted by version descending (newest first).
 */
export const workflowRevisionsListQueryStateAtomFamily = atomFamily((variantId: string) =>
    atom<ListQueryState<Workflow>>((get) => {
        const query = get(workflowRevisionsQueryAtomFamily(variantId))
        const data = get(workflowRevisionsListDataAtomFamily(variantId))
        return {
            data,
            isPending: query.isPending ?? false,
            isError: query.isError ?? false,
            error: query.error ?? null,
        }
    }),
)

/**
 * ListQueryState wrapper for app workflows list (root level).
 * Filters out archived workflows.
 */
export const appWorkflowsListQueryStateAtom = atom<ListQueryState<Workflow>>((get) => {
    const query = get(appWorkflowsListQueryAtom)
    const data = get(nonArchivedAppWorkflowsAtom)
    return {
        data,
        isPending: query.isPending ?? false,
        isError: query.isError ?? false,
        error: query.error ?? null,
    }
})

export const promptWorkflowsListQueryStateAtom = atom<ListQueryState<Workflow>>((get) => {
    const appQuery = get(appWorkflowsListQueryAtom)
    const agentFlagsQuery = get(appWorkflowsWithAgentFlagsQueryAtom)
    const data = (agentFlagsQuery.data ?? []).filter(
        (workflow) => !workflow.deleted_at && !workflow.flags?.is_agent,
    )
    return {
        data,
        isPending: (appQuery.isPending || agentFlagsQuery.isPending) ?? false,
        isError: appQuery.isError || agentFlagsQuery.isError,
        error: appQuery.error ?? agentFlagsQuery.error ?? null,
    }
})

export const agentWorkflowsListQueryStateAtom = atom<ListQueryState<Workflow>>((get) => {
    const appQuery = get(appWorkflowsListQueryAtom)
    const agentFlagsQuery = get(appWorkflowsWithAgentFlagsQueryAtom)
    const data = (agentFlagsQuery.data ?? []).filter(
        (workflow) => workflow.flags?.is_agent === true,
    )
    return {
        data,
        isPending: (appQuery.isPending || agentFlagsQuery.isPending) ?? false,
        isError: appQuery.isError || agentFlagsQuery.isError,
        error: appQuery.error ?? agentFlagsQuery.error ?? null,
    }
})

// ============================================================================
// LATEST REVISION (lightweight dedicated query)
// ============================================================================

/**
 * Query atom family for fetching the latest revision of a workflow.
 * Uses cache-aware batch fetching by workflow ID, avoiding N+1 calls when
 * multiple latest revisions are requested concurrently.
 */
export const workflowLatestRevisionQueryAtomFamily = atomFamily((workflowId: string) =>
    atomWithQuery((get) => {
        const projectId = get(workflowProjectIdAtom)
        const queryClient = get(queryClientAtom)
        const detailCached = projectId
            ? queryClient.getQueryData<Workflow>([
                  "workflows",
                  "latestRevision",
                  workflowId,
                  projectId,
              ])
            : undefined
        return {
            queryKey: ["workflows", "latestRevision", workflowId, projectId],
            queryFn: async (): Promise<Workflow | null> => {
                if (!projectId || !workflowId) return null
                try {
                    const cached = findLatestWorkflowRevisionInCache(
                        queryClient,
                        projectId,
                        workflowId,
                    )
                    if (cached) return cached

                    return await workflowLatestRevisionBatchFetcher({
                        projectId,
                        workflowId,
                        queryClient,
                    })
                } catch {
                    return null
                }
            },
            initialData: detailCached ?? undefined,
            enabled: get(sessionAtom) && !!projectId && !!workflowId && !detailCached,
            staleTime: 30_000,
        }
    }),
)

/**
 * Derived atom family for the latest revision ID of a workflow.
 *
 * Priority order:
 * 1. Dedicated latest-revision query — always correct; skips v0 auto-created
 *    revisions via `selectMostRecentWorkflowRevision`.
 * 2. Revisions-by-workflow refs (e.g. primed by the revisions table) — used
 *    only as a fast-path when the dedicated query has no data yet. Refs are
 *    sorted descending by recency and v0 is excluded to match the dedicated
 *    query's semantics.
 *
 * This avoids duplicating full revision data in memory — the molecule's
 * `workflowQueryAtomFamily(revisionId)` is the single source of truth
 * for revision content.
 */
export const workflowLatestRevisionIdAtomFamily = atomFamily((workflowId: string) =>
    atom<string | null>((get) => {
        if (!workflowId) return null

        // Prefer the dedicated latest-revision query — it correctly skips v0
        // auto-created revisions via selectMostRecentWorkflowRevision.
        const query = get(workflowLatestRevisionQueryAtomFamily(workflowId))
        if (query.data?.id) return query.data.id

        // Fall back to the revisions-by-workflow cache (e.g. primed by the
        // revisions table). The raw refs are NOT guaranteed to be ordered, so
        // sort descending by recency and skip v0 before picking the first.
        const revisionsQuery = get(workflowRevisionsByWorkflowQueryAtomFamily(workflowId))
        const refs = revisionsQuery.data?.refs
        if (refs && refs.length > 0) {
            const sorted = [...refs]
                .filter((r) => (r.version ?? 0) !== 0)
                .sort((a, b) => {
                    const aTime = a.created_at ? new Date(a.created_at).getTime() : 0
                    const bTime = b.created_at ? new Date(b.created_at).getTime() : 0
                    if (bTime !== aTime) return bTime - aTime
                    return (b.version ?? 0) - (a.version ?? 0)
                })
            return sorted[0]?.id ?? null
        }

        return null
    }),
)

// ============================================================================
// LATEST REVISION APP TYPE
// ============================================================================

/**
 * Atom family that derives the app type from the latest revision.
 *
 * Uses `workflowLatestRevisionQueryAtomFamily` to reactively fetch the
 * latest revision and derive the type from its URI/flags. Suitable for
 * list pages where the molecule isn't populated per-workflow.
 *
 * IMPORTANT: Must be read from the default Jotai store (via `getDefaultStore()`)
 * when used inside InfiniteVirtualTable cells, which render in an isolated store.
 */
export const workflowAppTypeAtomFamily = atomFamily((workflowId: string) =>
    atom<ReturnType<typeof deriveWorkflowTypeFromRevision> | null>((get) => {
        const query = get(workflowLatestRevisionQueryAtomFamily(workflowId))

        if (query.isPending || !query.data) return null

        return deriveWorkflowTypeFromRevision(query.data)
    }),
)

// ============================================================================
// ARTIFACT QUERY (workflow-level container — entity name/description)
// ============================================================================

interface WorkflowArtifactRequest {
    projectId: string
    workflowId: string
}

const workflowArtifactBatchFetcher = createBatchFetcher<WorkflowArtifactRequest, Workflow | null>({
    maxBatchSize: 50,
    flushDelay: 10,
    serializeKey: (req) => `${req.projectId}:${req.workflowId}`,
    batchFn: async (requests, serializedKeys) => {
        const results = new Map<string, Workflow | null>()
        serializedKeys.forEach((key) => results.set(key, null))

        // Exactly one project is in scope at a time in the web app.
        const projectId = requests[0]?.projectId
        if (!projectId) return results
        if (requests.some((req) => req.projectId !== projectId)) {
            throw new Error("workflowArtifactBatchFetcher: requests span multiple projects")
        }

        const workflowIds = [...new Set(requests.map((req) => req.workflowId).filter(Boolean))]
        if (workflowIds.length === 0) return results

        const response = await queryWorkflows({
            projectId,
            workflowRefs: workflowIds.map((id) => ({id})),
            includeArchived: true,
        })
        const byId = new Map((response.workflows ?? []).map((workflow) => [workflow.id, workflow]))
        requests.forEach((req, index) => {
            results.set(serializedKeys[index], byId.get(req.workflowId) ?? null)
        })

        return results
    },
})

/**
 * Artifact query keyed by explicit projectId. This is the canonical query;
 * the explicit key lets it run inside isolated Jotai stores (e.g. the
 * evaluation tables) where the global projectIdAtom is not hydrated.
 *
 * Deliberately keyed apart from the revision caches: `workflowQueryAtomFamily`
 * and the latest-revision query both resolve revisions, so the artifact would
 * otherwise compete with a revision for the same cache slot. The artifact is
 * the source of truth for the entity's display name — revision `name` carries
 * the variant name ("default"), not the entity name.
 */
export const workflowArtifactScopedQueryAtomFamily = atomFamily(
    ({projectId, workflowId}: WorkflowArtifactRequest) =>
        atomWithQuery(() => ({
            queryKey: ["workflows", "artifact", workflowId, projectId],
            queryFn: async (): Promise<Workflow | null> => {
                if (!projectId || !workflowId) return null
                return workflowArtifactBatchFetcher({projectId, workflowId})
            },
            enabled:
                !!projectId &&
                !!workflowId &&
                !isLocalDraftId(workflowId) &&
                !isPlaceholderId(workflowId),
            staleTime: 60_000,
        })),
    (a, b) => a.projectId === b.projectId && a.workflowId === b.workflowId,
)

/**
 * Default-store wrapper around the scoped artifact query: fills projectId
 * from the global atom and gates on the session.
 */
export const workflowArtifactQueryAtomFamily = atomFamily((workflowId: string) =>
    atom((get) => {
        const projectId = get(workflowProjectIdAtom)
        if (!projectId || !workflowId || !get(sessionAtom)) {
            return {
                data: null as Workflow | null,
                isPending: Boolean(workflowId),
                isError: false,
                error: null,
            }
        }
        return get(workflowArtifactScopedQueryAtomFamily({projectId, workflowId}))
    }),
)

/**
 * Prime the artifact query cache from an already-fetched workflows list
 * (e.g. a page-level `queryWorkflows` call) so artifact-name lookups
 * resolve without extra requests.
 */
export function primeWorkflowArtifactCacheImperative(
    workflows: (Workflow | null | undefined)[],
    options?: StoreOptions,
): void {
    const store = getStore(options)
    const projectId = store.get(workflowProjectIdAtom)
    if (!projectId) return
    try {
        const queryClient = store.get(queryClientAtom)
        for (const workflow of workflows) {
            if (!workflow?.id) continue
            queryClient.setQueryData(["workflows", "artifact", workflow.id, projectId], workflow)
        }
    } catch {
        // queryClientAtom may not be initialized yet (rare)
    }
}

// ============================================================================
// SINGLE ENTITY QUERY
// ============================================================================

/**
 * Query atom family for fetching a single workflow revision by its revision ID.
 * Returns the WorkflowRevision which contains `data` (uri, schemas, parameters).
 *
 * Uses `fetchWorkflowRevisionsByIdsBatch` (POST /workflows/revisions/query)
 * via the batch fetcher because the playground stores revision IDs, not workflow IDs.
 */
export const workflowQueryAtomFamily = atomFamily((revisionId: string) =>
    atomWithQuery((get) => {
        const projectId = get(workflowProjectIdAtom)
        const queryClient = get(queryClientAtom)
        const detailCached =
            projectId && revisionId
                ? findWorkflowRevisionInDetailCache(queryClient, projectId, revisionId)
                : undefined

        return {
            queryKey: ["workflows", "revision", revisionId, projectId],
            queryFn: async (): Promise<Workflow | null> => {
                if (!projectId || !revisionId) return null
                const cached = findWorkflowRevisionInCache(queryClient, projectId, revisionId)
                if (cached) return cached
                return workflowRevisionBatchFetcher({projectId, revisionId})
            },
            initialData: detailCached ?? undefined,
            enabled:
                get(sessionAtom) &&
                !!projectId &&
                !!revisionId &&
                !detailCached &&
                !isLocalDraftId(revisionId) &&
                !isPlaceholderId(revisionId),
            staleTime: 30_000,
        }
    }),
)

// ============================================================================
// INSPECT QUERY (resolve full schema — any workflow with a URI)
// ============================================================================

/**
 * Inspect query atom family.
 * After revision data loads, calls `/workflows/inspect` with the
 * revision's URI to resolve the full interface schema (including inputs).
 *
 * Fires for **any workflow with a URI** — evaluators, managed apps, builtins.
 *
 * For pre-migration builtin apps that have a `/services/{type}` URL but no
 * stored URI, the URI is derived from the URL pattern (e.g.,
 * `http://host/services/completion` → `agenta:builtin:completion:v0`).
 */
export const workflowInspectAtomFamily = atomFamily((revisionId: string) =>
    atomWithQuery((get) => {
        const projectId = get(workflowProjectIdAtom)
        const revisionQuery = get(workflowQueryAtomFamily(revisionId))
        const serverData = revisionQuery.data ?? null

        // A builtin-agent DRAFT (not yet committed, so it has no server data) still needs inspect.
        // The agent service publishes `harness_capabilities` (the provider + model catalog) per
        // SERVICE, not per committed revision — `inspectWorkflow` keys on uri + serviceUrl, never a
        // revision id. `invocationUrl` already derives the draft's builtin uri/url from the LOCAL
        // entity (which is why a draft agent can be invoked before creation); mirror that here so the
        // model picker resolves from inspect pre-creation instead of showing an empty catalog.
        // Scoped to agents: a non-agent draft keeps its server-only behavior unchanged.
        const localEntity = serverData ? null : get(workflowBaseEntityAtomFamily(revisionId))
        const localIsAgent = localEntity?.flags?.is_agent ?? false
        const localData = localIsAgent ? localEntity : null

        // Use stored URI, or derive one from builtin service URL pattern
        const storedUri = serverData?.data?.uri ?? localData?.data?.uri ?? null
        const storedUrl = serverData?.data?.url ?? localData?.data?.url ?? null
        const derivedServiceType = storedUri ? null : resolveServiceTypeFromUrl(storedUrl)
        const uri = storedUri ?? (derivedServiceType ? buildWorkflowUri(derivedServiceType) : null)
        // Service URL: prefer stored url, fall back to building from URI
        const serviceUrl = storedUrl ?? buildServiceUrlFromUri(uri)

        // Skip inspect when the revision has no service endpoint (has_url: false). A builtin-agent
        // DRAFT reports has_url: false (nothing is deployed yet), but its service URL is always
        // derivable from the builtin uri (same URL `invocationUrl` invokes), so the capability
        // catalog is still reachable — don't let the deploy-state flag gate it.
        const hasUrl =
            serverData?.flags?.has_url ??
            (localIsAgent ? true : (localData?.flags?.has_url ?? true))

        // Skip inspect when the revision already carries all schemas inline.
        // The merge step (workflowEntityAtomFamily) gives server schemas
        // precedence, so fetching inspect would be redundant.
        // Exception: an agent publishes its per-harness capabilities ONLY in the inspect
        // response `meta` (harness_capabilities), never in the stored schemas — so the agent
        // playground's model picker needs inspect even when the schemas are inline.
        const serverSchemas = serverData?.data?.schemas
        const isAgent = serverData?.flags?.is_agent ?? false
        const hasAllSchemas =
            !!serverSchemas?.inputs && !!serverSchemas?.outputs && !!serverSchemas?.parameters

        const isEnabled =
            get(sessionAtom) &&
            !!projectId &&
            !!uri &&
            !!serviceUrl &&
            hasUrl &&
            (isAgent || !hasAllSchemas)

        return {
            queryKey: ["workflows", "inspect", revisionId, uri, serviceUrl, projectId],
            queryFn: async (): Promise<InspectWorkflowResponse | null> => {
                if (!projectId || !uri || !serviceUrl) return null
                return inspectWorkflow(uri, projectId, serviceUrl)
            },
            enabled: isEnabled,
            staleTime: 60_000,
        }
    }),
)

// ============================================================================
// PLAYGROUND BUILD KIT SESSION STATE
// ============================================================================

export type AgentTemplate = Record<string, unknown>

const AGENT_BUILTIN_URI_PREFIX = "agenta:builtin:agent"

const isAgentBuiltinUri = (uri: unknown): boolean =>
    typeof uri === "string" && uri.startsWith(AGENT_BUILTIN_URI_PREFIX)

const isAgentTemplateOverlay = (
    overlay: AgentBuildKitOverlay | AgentTemplate | null | undefined,
): overlay is AgentTemplate => !!overlay && typeof overlay === "object" && !Array.isArray(overlay)

/**
 * Fetch the simple-application envelope for one app id.
 *
 * The playground build-kit overlay rides on this response's
 * `additional_context`, not on the agent-service `/inspect` response (which
 * carries no behavior-changing meta by design).
 */
export const simpleApplicationQueryAtomFamily = atomFamily((applicationId: string) =>
    atomWithQuery((get) => {
        const projectId = get(workflowProjectIdAtom)
        return {
            queryKey: ["simpleApplication", applicationId, projectId],
            queryFn: async (): Promise<SimpleApplicationFetchResponse | null> => {
                if (!projectId || !applicationId) return null
                return fetchSimpleApplication(applicationId, projectId)
            },
            enabled: get(sessionAtom) && !!projectId && !!applicationId,
            staleTime: 60_000,
            refetchOnWindowFocus: false,
        }
    }),
)

export const agentBuildKitOverlayAtom = atomWithQuery((get) => {
    const projectId = get(workflowProjectIdAtom)
    return {
        queryKey: ["agentBuildKitOverlay", AGENT_BUILD_KIT_WORKFLOW_SLUG, projectId],
        queryFn: async (): Promise<AgentBuildKitOverlay | null> => {
            if (!projectId) return null
            return fetchAgentBuildKitOverlay(projectId)
        },
        enabled: get(sessionAtom) && !!projectId,
        staleTime: Infinity,
        refetchOnWindowFocus: false,
    }
})

export const workflowAgentTemplateOverlayAtomFamily = atomFamily((revisionId: string) =>
    atom<AgentTemplate | null>((get) => {
        const revisionData = get(workflowQueryAtomFamily(revisionId)).data ?? null
        const baseEntity = get(workflowBaseEntityAtomFamily(revisionId))
        const explicitIsAgent = revisionData?.flags?.is_agent ?? baseEntity?.flags?.is_agent
        const targetUri = revisionData?.data?.uri ?? baseEntity?.data?.uri
        const isAgent = explicitIsAgent ?? isAgentBuiltinUri(targetUri)
        if (!isAgent || !get(sessionAtom)) return null

        const slugQuery = get(agentBuildKitOverlayAtom)
        if (isAgentTemplateOverlay(slugQuery.data)) {
            return slugQuery.data
        }

        const applicationId = revisionData?.workflow_id ?? baseEntity?.workflow_id ?? null
        if (!applicationId) return null
        const shouldUseFallback =
            slugQuery.isError || (slugQuery.data === null && !slugQuery.isPending)
        if (!shouldUseFallback) return null

        const appData = get(simpleApplicationQueryAtomFamily(applicationId)).data ?? null
        const overlay =
            appData?.additional_context?.playground_build_kit?.agent_template_overlay ?? null
        return isAgentTemplateOverlay(overlay) ? overlay : null
    }),
)

export const workflowBuildKitEnabledAtomFamily = atomFamily((_revisionId: string) =>
    atom<boolean>(true),
)

// ============================================================================
// AG-TYPE SCHEMA QUERY (resolves x-ag-type-ref targets into full schemas)
// ============================================================================

/**
 * Cached query atom for fetching the full dereferenced JSON Schema for an
 * `x-ag-type-ref` target (e.g. `"prompt-template"`).
 *
 * When the frontend encounters a schema property with `x-ag-type-ref` but no
 * sub-properties, it calls this to get the full schema from the backend.
 * The schema is immutable per ag-type, so `staleTime: Infinity`.
 */
export const agTypeSchemaAtomFamily = atomFamily((agType: string) =>
    atomWithQuery((_get) => ({
        queryKey: ["workflows", "schemas", "ag-types", agType],
        queryFn: async (): Promise<Record<string, unknown>> => {
            return fetchAgTypeSchema(agType)
        },
        staleTime: Infinity,
        refetchOnWindowFocus: false,
    })),
)

// ============================================================================
// APP OPENAPI SCHEMA QUERY (legacy fallback for custom apps without URI)
// ============================================================================

/**
 * OpenAPI schema query atom family — **legacy fallback only**.
 *
 * Fires only for truly custom user-hosted apps that have a `data.url`
 * but no `data.uri` AND whose URL does not match the builtin service
 * pattern (`/services/completion` or `/services/chat`).
 *
 * Builtin apps without URIs are handled by the inspect atom above
 * (which derives the URI from the URL pattern). Custom apps without
 * URIs still need OpenAPI fetching because the inspect endpoint
 * requires a URI.
 *
 * All other workflows (with URIs) use the inspect endpoint.
 */
export const workflowAppSchemaAtomFamily = atomFamily((revisionId: string) =>
    atomWithQuery((get) => {
        const projectId = get(workflowProjectIdAtom)
        const revisionQuery = get(workflowQueryAtomFamily(revisionId))
        const serverData = revisionQuery.data ?? null
        const uri = serverData?.data?.uri ?? null
        const url = serverData?.data?.url ?? null

        // Skip when the revision already carries all schemas inline.
        const serverSchemas = serverData?.data?.schemas
        const hasAllSchemas =
            !!serverSchemas?.inputs && !!serverSchemas?.outputs && !!serverSchemas?.parameters

        // Skip if URI exists (inspect handles it), if URL points to a managed
        // agenta service (inspect handles it), if no URL at all, or if
        // the revision already has all schemas populated.
        // Only custom user-hosted apps without URIs need OpenAPI fetching.
        const enabled =
            get(sessionAtom) &&
            !!projectId &&
            !!url &&
            !uri &&
            !isManagedServiceUrl(url) &&
            !hasAllSchemas

        return {
            queryKey: ["workflows", "appSchema", revisionId, url, projectId],
            queryFn: async (): Promise<AppOpenApiSchemas | null> => {
                if (!projectId || !url) return null
                return fetchWorkflowAppOpenApiSchema(url, projectId)
            },
            enabled,
            staleTime: 60_000,
        }
    }),
)

// ============================================================================
// INTERFACE SCHEMAS QUERY (builtin workflow fallback)
// ============================================================================

// NOTE: Disabled — re-enable when `/workflows/interfaces/schemas` is available.
// function isBuiltinUri(uri: string | null | undefined): boolean {
//     if (!uri) return false
//     return uri.startsWith("agenta:builtin:")
// }

/**
 * Interface schemas query atom family.
 * For builtin workflows, fetches the interface schemas from the
 * `/workflows/interfaces/schemas` endpoint.
 *
 * This is a lightweight fallback that returns static schema definitions
 * for builtin evaluators without requiring the handler to be running.
 *
 * **Only fires for builtin workflows** (URI starts with "agenta:builtin:").
 *
 * NOTE: Currently disabled — the backend endpoint is not yet implemented.
 * Re-enable `enabled` when `/workflows/interfaces/schemas` is available.
 */
export const workflowInterfaceSchemasAtomFamily = atomFamily((revisionId: string) =>
    atomWithQuery((_get) => {
        return {
            queryKey: ["workflows", "interfaceSchemas", revisionId],
            queryFn: async (): Promise<InterfaceSchemasResponse | null> => null,
            enabled: false,
            staleTime: Infinity,
        }
    }),
)

// ============================================================================
// DRAFT STATE
// ============================================================================

/**
 * Draft state per workflow (local edits before save).
 * Stores partial updates to workflow data.
 */
export const workflowDraftAtomFamily = atomFamily((_workflowId: string) =>
    atom<Partial<Workflow> | null>(null),
)

/**
 * Merged entity atom: server data + resolved schemas + local draft overlay.
 * Also checks local draft storage for browser-only clones.
 *
 * Merges in layers:
 * 1. Server revision data (from query)
 * 2. Schema resolution (unified for all workflow types):
 *    a. **Service schema** — fast path for builtin completion/chat (prefetched)
 *    b. **Inspect** — any workflow with a URI (evaluators, managed apps, builtins)
 *    c. **OpenAPI fallback** — legacy custom apps without URI
 * 3. Local draft overlay (user edits)
 *
 * Server data fields take precedence — resolved schemas only fill gaps
 * where `data.schemas.*` is null/missing.
 *
 * Local drafts already contain fully-merged data from the source revision,
 * so they skip the schema resolution stage.
 *
 * NOTE: For evaluator workflows, nesting is re-applied after draft merge
 * because presets write flat params to the draft which would overwrite
 * the nested structure from localData.
 */
/**
 * Base entity atom — server data + evaluator normalization + draft overlay.
 *
 * Does everything `workflowEntityAtomFamily` does EXCEPT subscribing to
 * inspect/OpenAPI schema resolution. This makes it safe for consumers that
 * only need parameters and metadata (isDirty, isEphemeral) without triggering
 * schema-resolution side effects.
 */
export const workflowBaseEntityAtomFamily = atomFamily((workflowId: string) =>
    atom<Workflow | null>((get) => {
        // Check local draft storage first (for browser-only clones)
        let localData = get(workflowLocalServerDataAtomFamily(workflowId))
        if (localData) {
            // Track the original FLAT schema so the post-draft re-nest can still
            // see the `x-ag-type: "hidden"` markers (the nested schema in
            // `localData.data.schemas.parameters` no longer carries them).
            let flatSchemaForReNest: Record<string, unknown> | undefined
            // Apply evaluator normalization to local drafts too
            if (localData.flags?.is_evaluator) {
                const flatParams = localData.data?.parameters as Record<string, unknown> | undefined
                let flatSchema = localData.data?.schemas?.parameters as
                    | Record<string, unknown>
                    | undefined

                // Ephemeral evaluator workflows (e.g. opened from a trace span) don't
                // carry their own parameter schema. Reactively seed it from the builtin
                // evaluator template catalog so data nesting and schema nesting both
                // run with the same schema context — otherwise `nestEvaluatorConfiguration`
                // runs schemaless and emits empty `advanced_config` sections, and
                // downstream schema readers return null for feedback_config.
                if (!flatSchema && localData.flags?.is_base && localData.data?.uri) {
                    const key = parseWorkflowKeyFromUri(localData.data.uri)
                    if (key) {
                        const template = get(evaluatorTemplateByKeyAtomFamily(key))
                        const templateSchema = template?.data?.schemas?.parameters
                        if (templateSchema && typeof templateSchema === "object") {
                            flatSchema = templateSchema as Record<string, unknown>
                        }
                    }
                }

                flatSchemaForReNest = flatSchema

                const nestedParams = flatParams
                    ? nestEvaluatorConfiguration(flatParams, flatSchema)
                    : undefined
                const nestedSchema = flatSchema ? nestEvaluatorSchema(flatSchema) : undefined

                if (nestedParams || nestedSchema) {
                    localData = {
                        ...localData,
                        data: {
                            ...localData.data,
                            ...(nestedParams ? {parameters: nestedParams} : {}),
                            ...(nestedSchema
                                ? {
                                      schemas: {
                                          ...localData.data?.schemas,
                                          parameters: nestedSchema,
                                      },
                                  }
                                : {}),
                        },
                    } as Workflow
                }
            }

            const draft = get(workflowDraftAtomFamily(workflowId))
            if (!draft) return localData
            let localMerged = {
                ...localData,
                ...draft,
                data: {
                    ...localData.data,
                    ...draft.data,
                },
            } as Workflow

            // Re-apply evaluator nesting after draft merge.
            // Presets write flat params to the draft (with hidden keys preserved
            // for round-tripping), so we re-nest using the ORIGINAL flat schema
            // to drop hidden keys from the rendered data again.
            if (localMerged.flags?.is_evaluator && draft.data?.parameters) {
                const draftParams = localMerged.data?.parameters as
                    | Record<string, unknown>
                    | undefined
                const reNestSchema =
                    flatSchemaForReNest ??
                    (localMerged.data?.schemas?.parameters as Record<string, unknown> | undefined)
                if (draftParams) {
                    localMerged = {
                        ...localMerged,
                        data: {
                            ...localMerged.data,
                            parameters: nestEvaluatorConfiguration(draftParams, reNestSchema),
                            ...(reNestSchema
                                ? {
                                      schemas: {
                                          ...localMerged.data?.schemas,
                                          parameters: nestEvaluatorSchema(reNestSchema),
                                      },
                                  }
                                : {}),
                        },
                    } as Workflow
                }
            }

            return localMerged
        }

        const query = get(workflowQueryAtomFamily(workflowId))
        const serverData = query.data ?? null
        const draft = get(workflowDraftAtomFamily(workflowId))

        if (!serverData) return draft as Workflow | null

        let merged = serverData

        // ── Evaluator normalization ──
        let flatSchemaForReNest: Record<string, unknown> | undefined
        if (merged.flags?.is_evaluator) {
            const flatParams = merged.data?.parameters as Record<string, unknown> | undefined
            const flatSchema = merged.data?.schemas?.parameters as
                | Record<string, unknown>
                | undefined

            flatSchemaForReNest = flatSchema

            const nestedParams = flatParams
                ? nestEvaluatorConfiguration(flatParams, flatSchema)
                : undefined
            const nestedSchema = flatSchema ? nestEvaluatorSchema(flatSchema) : undefined

            if (nestedParams || nestedSchema) {
                merged = {
                    ...merged,
                    data: {
                        ...merged.data,
                        ...(nestedParams ? {parameters: nestedParams} : {}),
                        ...(nestedSchema
                            ? {
                                  schemas: {
                                      ...merged.data?.schemas,
                                      parameters: nestedSchema,
                                  },
                              }
                            : {}),
                    },
                } as Workflow
            }
        }

        if (!draft) return merged

        let finalMerged = {
            ...merged,
            ...draft,
            data: {
                ...merged.data,
                ...draft.data,
            },
        } as Workflow

        // Re-apply evaluator nesting after draft merge.
        // Presets write flat params to the draft (with hidden keys preserved
        // for round-tripping), so we re-nest using the ORIGINAL flat schema
        // to drop hidden keys from the rendered data again.
        if (finalMerged.flags?.is_evaluator && draft.data?.parameters) {
            const draftParams = finalMerged.data?.parameters as Record<string, unknown> | undefined
            const reNestSchema =
                flatSchemaForReNest ??
                (finalMerged.data?.schemas?.parameters as Record<string, unknown> | undefined)
            if (draftParams) {
                finalMerged = {
                    ...finalMerged,
                    data: {
                        ...finalMerged.data,
                        parameters: nestEvaluatorConfiguration(draftParams, reNestSchema),
                        ...(reNestSchema
                            ? {
                                  schemas: {
                                      ...finalMerged.data?.schemas,
                                      parameters: nestEvaluatorSchema(reNestSchema),
                                  },
                              }
                            : {}),
                    },
                } as Workflow
            }
        }

        return finalMerged
    }),
)

export const workflowEntityAtomFamily = atomFamily((workflowId: string) =>
    atom<Workflow | null>((get) => {
        // Check local draft storage first (for browser-only clones)
        let localData = get(workflowLocalServerDataAtomFamily(workflowId))
        if (localData) {
            // Track the original FLAT schema so the post-draft re-nest can still
            // see the `x-ag-type: "hidden"` markers (the nested schema in
            // `localData.data.schemas.parameters` no longer carries them).
            let flatSchemaForReNest: Record<string, unknown> | undefined
            // Apply evaluator normalization to local drafts too
            if (localData.flags?.is_evaluator) {
                const flatParams = localData.data?.parameters as Record<string, unknown> | undefined
                let flatSchema = localData.data?.schemas?.parameters as
                    | Record<string, unknown>
                    | undefined

                // Ephemeral evaluator workflows (e.g. opened from a trace span) don't
                // carry their own parameter schema. Reactively seed it from the builtin
                // evaluator template catalog so data nesting and schema nesting both
                // run with the same schema context — otherwise `nestEvaluatorConfiguration`
                // runs schemaless and emits empty `advanced_config` sections, and
                // downstream schema readers return null for feedback_config.
                if (!flatSchema && localData.flags?.is_base && localData.data?.uri) {
                    const key = parseWorkflowKeyFromUri(localData.data.uri)
                    if (key) {
                        const template = get(evaluatorTemplateByKeyAtomFamily(key))
                        const templateSchema = template?.data?.schemas?.parameters
                        if (templateSchema && typeof templateSchema === "object") {
                            flatSchema = templateSchema as Record<string, unknown>
                        }
                    }
                }

                flatSchemaForReNest = flatSchema

                const nestedParams = flatParams
                    ? nestEvaluatorConfiguration(flatParams, flatSchema)
                    : undefined
                const nestedSchema = flatSchema ? nestEvaluatorSchema(flatSchema) : undefined

                if (nestedParams || nestedSchema) {
                    localData = {
                        ...localData,
                        data: {
                            ...localData.data,
                            ...(nestedParams ? {parameters: nestedParams} : {}),
                            ...(nestedSchema
                                ? {
                                      schemas: {
                                          ...localData.data?.schemas,
                                          parameters: nestedSchema,
                                      },
                                  }
                                : {}),
                        },
                    } as Workflow
                }
            }

            const draft = get(workflowDraftAtomFamily(workflowId))
            if (!draft) return localData
            let localMerged = {
                ...localData,
                ...draft,
                data: {
                    ...localData.data,
                    ...draft.data,
                },
            } as Workflow

            // Re-apply evaluator nesting after draft merge.
            // Presets write flat params to the draft (with hidden keys preserved
            // for round-tripping), so we re-nest using the ORIGINAL flat schema
            // to drop hidden keys from the rendered data again.
            if (localMerged.flags?.is_evaluator && draft.data?.parameters) {
                const draftParams = localMerged.data?.parameters as
                    | Record<string, unknown>
                    | undefined
                const reNestSchema =
                    flatSchemaForReNest ??
                    (localMerged.data?.schemas?.parameters as Record<string, unknown> | undefined)
                if (draftParams) {
                    localMerged = {
                        ...localMerged,
                        data: {
                            ...localMerged.data,
                            parameters: nestEvaluatorConfiguration(draftParams, reNestSchema),
                            ...(reNestSchema
                                ? {
                                      schemas: {
                                          ...localMerged.data?.schemas,
                                          parameters: nestEvaluatorSchema(reNestSchema),
                                      },
                                  }
                                : {}),
                        },
                    } as Workflow
                }
            }

            return localMerged
        }

        const query = get(workflowQueryAtomFamily(workflowId))
        const serverData = query.data ?? null
        const draft = get(workflowDraftAtomFamily(workflowId))

        if (!serverData) return draft as Workflow | null

        let merged = serverData

        // ── Schema resolution (unified) ──
        // Try sources in priority order. Each source fills missing schema
        // fields without overwriting existing server data.

        let resolvedInputs: Record<string, unknown> | null | undefined = null
        let resolvedOutputs: Record<string, unknown> | null | undefined = null
        let resolvedParameters: Record<string, unknown> | null | undefined = null
        let resolvedParams: Record<string, unknown> | null | undefined = null

        // (a) Inspect — primary source for any workflow with a URI.
        // The `WorkflowInspectResponse.revision` is a WorkflowRevision (unmodified), so the
        // resolved interface lives at `revision.data.schemas.{inputs, parameters, outputs}` and
        // the resolved parameters at `revision.data.parameters`. `outputs` is a plain schema
        // (the agent's is an object with a `messages` field), never keyed by output surface.
        const inspectQuery = get(workflowInspectAtomFamily(workflowId))
        const inspectData = inspectQuery.data ?? null
        if (inspectData) {
            const inspectRevisionData = inspectData.revision?.data
            const inspectSchemas = inspectRevisionData?.schemas
            if (inspectSchemas) {
                resolvedInputs = inspectSchemas.inputs
                resolvedOutputs = inspectSchemas.outputs
                resolvedParameters = inspectSchemas.parameters
            }
            resolvedParams =
                (inspectRevisionData?.parameters as Record<string, unknown> | undefined) ?? null
        }

        // (b) OpenAPI fallback — only for legacy custom apps without URI.
        // Only subscribe when we know inspect won't fire (no URI).
        if (!serverData.data?.uri) {
            const appSchemaQuery = get(workflowAppSchemaAtomFamily(workflowId))
            const appSchemas = appSchemaQuery.data ?? null
            if (appSchemas) {
                resolvedInputs = resolvedInputs ?? appSchemas.inputs
                resolvedOutputs = resolvedOutputs ?? appSchemas.outputs
                resolvedParameters = resolvedParameters ?? appSchemas.parameters
                // Seed initial parameter values from the openapi schema's
                // `default` values. The playground's config form iterates
                // parameter VALUES (not schema properties), so without this
                // step the form renders empty for custom URL workflows even
                // when the schema is fully defined.
                //
                // Lifecycle: these seeded values are only in the merged
                // atom (in memory). They are not persisted. On every
                // playground open before the first save, the form
                // re-renders with the openapi defaults. The first save
                // commits them as a real revision; from then on the
                // merge guard below sees stored parameters and the
                // seeding becomes a no-op, so subsequent opens read the
                // saved values directly. This mirrors how catalog
                // templates pre-fill their forms via
                // `extractDefaultsFromSchema` at create time, except for
                // custom URL apps we do it lazily on first open instead.
                if (!resolvedParams && appSchemas.parameters) {
                    const defaults = extractDefaultsFromSchema(
                        appSchemas.parameters as Record<string, unknown>,
                    )
                    if (Object.keys(defaults).length > 0) {
                        resolvedParams = defaults
                    }
                }
            }
        }

        // Merge resolved schemas into entity (server data takes precedence)
        const hasResolvedSchemas = resolvedInputs || resolvedOutputs || resolvedParameters
        // Treat an empty params object the same as "no params" so the seeded
        // defaults still apply if any future code path ever stores `{}`
        // instead of leaving parameters undefined.
        const storedParams = serverData.data?.parameters as Record<string, unknown> | undefined
        const hasStoredParams = !!storedParams && Object.keys(storedParams).length > 0
        const hasResolvedParams = resolvedParams && !hasStoredParams

        if (hasResolvedSchemas || hasResolvedParams) {
            merged = {
                ...serverData,
                data: {
                    ...serverData.data,
                    ...(hasResolvedParams
                        ? {parameters: resolvedParams as Record<string, unknown>}
                        : {}),
                    ...(hasResolvedSchemas
                        ? {
                              schemas: {
                                  ...serverData.data?.schemas,
                                  inputs:
                                      serverData.data?.schemas?.inputs ??
                                      resolvedInputs ??
                                      undefined,
                                  outputs:
                                      serverData.data?.schemas?.outputs ??
                                      resolvedOutputs ??
                                      undefined,
                                  parameters:
                                      serverData.data?.schemas?.parameters ??
                                      resolvedParameters ??
                                      undefined,
                              },
                          }
                        : {}),
                },
            } as Workflow
        }

        // ── Evaluator normalization ──
        // Transform flat evaluator parameters and schemas to the nested
        // structure that app workflows already use. This is done once at
        // the entity merge boundary so all downstream consumers
        // (selectors, UI, commit diff) see a unified shape regardless
        // of workflow type.
        //
        // The reverse transform (flattenEvaluatorConfiguration) is only
        // applied at write boundaries (commit, updateConfiguration action).
        let flatSchemaForReNest: Record<string, unknown> | undefined
        if (merged.flags?.is_evaluator) {
            const flatParams = merged.data?.parameters as Record<string, unknown> | undefined
            const flatSchema = merged.data?.schemas?.parameters as
                | Record<string, unknown>
                | undefined

            flatSchemaForReNest = flatSchema

            const nestedParams = flatParams
                ? nestEvaluatorConfiguration(flatParams, flatSchema)
                : undefined
            const nestedSchema = flatSchema ? nestEvaluatorSchema(flatSchema) : undefined

            if (nestedParams || nestedSchema) {
                merged = {
                    ...merged,
                    data: {
                        ...merged.data,
                        ...(nestedParams ? {parameters: nestedParams} : {}),
                        ...(nestedSchema
                            ? {
                                  schemas: {
                                      ...merged.data?.schemas,
                                      parameters: nestedSchema,
                                  },
                              }
                            : {}),
                    },
                } as Workflow
            }
        }

        if (!draft) return merged

        let finalMerged = {
            ...merged,
            ...draft,
            data: {
                ...merged.data,
                ...draft.data,
            },
        } as Workflow

        // Re-apply evaluator nesting after draft merge.
        // Presets write flat params to the draft (with hidden keys preserved
        // for round-tripping), so we re-nest using the ORIGINAL flat schema
        // to drop hidden keys from the rendered data again.
        if (finalMerged.flags?.is_evaluator && draft.data?.parameters) {
            const draftParams = finalMerged.data?.parameters as Record<string, unknown> | undefined
            const reNestSchema =
                flatSchemaForReNest ??
                (finalMerged.data?.schemas?.parameters as Record<string, unknown> | undefined)
            if (draftParams) {
                finalMerged = {
                    ...finalMerged,
                    data: {
                        ...finalMerged.data,
                        parameters: nestEvaluatorConfiguration(draftParams, reNestSchema),
                        ...(reNestSchema
                            ? {
                                  schemas: {
                                      ...finalMerged.data?.schemas,
                                      parameters: nestEvaluatorSchema(reNestSchema),
                                  },
                              }
                            : {}),
                    },
                } as Workflow
            }
        }

        return finalMerged
    }),
)

/**
 * Is the workflow dirty (has local edits)?
 *
 * For **regular** entities: checks if a draft overlay exists and its parameters
 * differ from the server data.
 *
 * For **local draft** entities (browser-only clones): compares the full entity
 * data (clone + any draft overlay) against the source entity's live server data
 * via `workflowServerDataSelectorFamily`. Local clones may have edits baked in
 * from the source's draft at clone time, so we can't rely on the draft atom
 * alone — the clone itself may already differ from the server.
 */
export const workflowIsDirtyAtomFamily = atomFamily((workflowId: string) =>
    atom<boolean>((get) => {
        const isLocal = isLocalDraftId(workflowId)

        // For regular entities, no draft atom means no local edits — fast exit.
        // For local drafts, edits may be baked into the clone, so skip this check.
        if (!isLocal) {
            const draft = get(workflowDraftAtomFamily(workflowId))
            if (!draft) {
                return false
            }
        }

        // Compare the full `data` object (parameters + sibling fields), normalizing params/schemas to avoid false positives.
        const entityData = get(workflowBaseEntityAtomFamily(workflowId))

        // Get the comparison baseline — for local drafts this redirects to the
        // source entity's live server data via workflowServerDataSelectorFamily.
        const serverData = get(workflowServerDataSelectorFamily(workflowId))

        if (!serverData) {
            // serverData = null means the server query is still loading for
            // non-local entities. We can't compute a diff against an unknown
            // baseline, so default to not-dirty until the query resolves.
            // For local (ephemeral / local-*) entities null serverData is
            // expected — they have no server baseline — so preserve the
            // existing "dirty if entity exists" behaviour for that path.
            return isLocal ? !!entityData : false
        }
        if (!entityData) return false

        const entityParams = entityData.data?.parameters

        // Server params may be flat for evaluator workflows, while entity params
        // are nested (normalized in workflowEntityAtomFamily). Apply the same
        // nesting to server params so comparison is like-for-like.
        const rawServerParams = serverData.data?.parameters as Record<string, unknown> | undefined
        let serverParams =
            rawServerParams && serverData.flags?.is_evaluator
                ? nestEvaluatorConfiguration(
                      rawServerParams,
                      (serverData.data?.schemas?.parameters as Record<string, unknown> | null) ??
                          null,
                  )
                : rawServerParams

        // Mirror the input_keys sync that updateWorkflowDraftAtom applies at write
        // time. The write path calls syncPromptInputKeysInParameters on outgoing
        // params, so server params (without the sync) and entity params (with the
        // sync) would always differ on `input_keys`, producing a permanent false
        // dirty state for any app that has template variables.
        if (
            serverParams &&
            !serverData.flags?.is_evaluator &&
            !serverData.flags?.is_custom &&
            !serverData.flags?.is_feedback
        ) {
            serverParams = syncPromptInputKeysInParameters(serverParams) as typeof serverParams
        }

        // Recursively sort object keys for consistent comparison
        // This handles json_schema property order differences
        const sortObjectKeys = (obj: unknown): unknown => {
            if (obj === null || obj === undefined) return obj
            if (Array.isArray(obj)) return obj.map(sortObjectKeys)
            if (typeof obj !== "object") return obj
            const sorted: Record<string, unknown> = {}
            for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
                sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key])
            }
            return sorted
        }

        // Normalize parameters for comparison
        const normalizeForComparison = (params: unknown): unknown => {
            if (!params || typeof params !== "object") return params
            const p = params as Record<string, unknown>

            // Normalize prompt_template content (trim trailing whitespace)
            let normalized = {...p}
            if (Array.isArray(p.prompt_template)) {
                normalized.prompt_template = (p.prompt_template as unknown[]).map((msg) => {
                    if (!msg || typeof msg !== "object") return msg
                    const m = msg as Record<string, unknown>
                    if (typeof m.content !== "string") return msg
                    const content = m.content
                        .split("\n")
                        .map((line: string) => line.trimEnd())
                        .join("\n")
                        .trimEnd()
                    return {...m, content}
                })
            }

            // Sort all object keys recursively (handles json_schema property order), and drop
            // present-but-empty collections so an add-then-remove (`skills: []` vs an absent key)
            // isn't a false-positive dirty. Applied to both sides, so real changes still register.
            return sortObjectKeys(stripEmptyCollectionsDeep(normalized))
        }

        // Server schemas.parameters stays flat for evaluators while the entity
        // side is nested (nestEvaluatorSchema in workflowBaseEntityAtomFamily).
        // Nest the server schema too so the whole-data diff is like-for-like.
        const rawServerSchemaParams = serverData.data?.schemas?.parameters as
            | Record<string, unknown>
            | undefined
        const serverSchemas =
            rawServerSchemaParams && serverData.flags?.is_evaluator
                ? {
                      ...serverData.data?.schemas,
                      parameters: nestEvaluatorSchema(rawServerSchemaParams),
                  }
                : serverData.data?.schemas

        // Compare the whole data object (so code/hook fields register as dirty),
        // keeping parameters and schemas normalized to avoid false positives.
        const normalizeData = (
            data: Record<string, unknown> | null | undefined,
            normalizedParams: unknown,
            normalizedSchemas: unknown,
        ): unknown => {
            const base = (data ?? {}) as Record<string, unknown>
            return sortObjectKeys({
                ...base,
                parameters: normalizeForComparison(normalizedParams),
                ...(normalizedSchemas !== undefined ? {schemas: normalizedSchemas} : {}),
            })
        }

        const normalizedEntity = normalizeData(
            entityData.data,
            entityParams,
            entityData.data?.schemas,
        )
        const normalizedServer = normalizeData(serverData.data, serverParams, serverSchemas)
        const isDirty = !isEqual(normalizedEntity, normalizedServer)

        return isDirty
    }),
)

/**
 * Whether a workflow entity is ephemeral (created from a template, not yet committed).
 * Ephemeral entities have `meta.__ephemeral: true`.
 */
export const workflowIsEphemeralAtomFamily = atomFamily((workflowId: string) =>
    atom<boolean>((get) => {
        const entity = get(workflowBaseEntityAtomFamily(workflowId))
        const meta = entity?.meta as Record<string, unknown> | null | undefined
        return Boolean(meta?.__ephemeral)
    }),
)

// ============================================================================
// MUTATIONS (Write Atoms)
// ============================================================================

/**
 * Update workflow draft state.
 * Deep-merges the `data` field so nested properties (parameters, schemas, etc.)
 * are preserved across incremental updates.
 */
export const updateWorkflowDraftAtom = atom(
    null,
    (_get, set, workflowId: string, updates: Partial<Workflow>) => {
        const current = _get(workflowDraftAtomFamily(workflowId))
        const serverData = _get(workflowServerDataSelectorFamily(workflowId))
        // Accept both workflow payload shape (`{data: {parameters}}`) and
        // legacy bridge shape (`{parameters}`) to avoid no-op edits when routing
        // crosses entity types during navigation.
        const rawUpdates = updates as Record<string, unknown>
        const topLevelParameters =
            rawUpdates.parameters === undefined
                ? undefined
                : (rawUpdates.parameters as Record<string, unknown> | null)
        const rawUpdatedData = rawUpdates.data as {parameters?: unknown} | undefined
        const nestedParameters =
            rawUpdatedData && "parameters" in rawUpdatedData
                ? (rawUpdatedData.parameters as Record<string, unknown> | null)
                : undefined
        const incomingParameters =
            topLevelParameters !== undefined ? topLevelParameters : nestedParameters

        if (incomingParameters !== undefined && !current) {
            const updateKeys = Object.keys(rawUpdates).filter(
                (key) => key !== "parameters" && key !== "data",
            )
            const dataKeys = rawUpdatedData ? Object.keys(rawUpdatedData) : []
            const isParametersOnlyUpdate =
                updateKeys.length === 0 &&
                (!rawUpdatedData || dataKeys.every((key) => key === "parameters"))

            if (isParametersOnlyUpdate) {
                // Server data hasn't loaded yet for a real (non-local) revision.
                // Creating a draft now would produce a false diff — skip and let
                // the pending-hydrations path (SUB 1) re-apply the patch once
                // the query resolves and we have an actual baseline to compare.
                if (!isLocalDraftId(workflowId) && serverData === null) {
                    return
                }
                // Compare synced versions of both params. The write path always
                // applies syncPromptInputKeysInParameters to outgoing parameters,
                // so a stale localStorage snapshot that only differs by auto-
                // computed input_keys would otherwise bypass this guard and
                // produce a perpetual false draft on every reload.
                const guardFlags = serverData?.flags
                const shouldSyncForGuard =
                    !!guardFlags &&
                    !guardFlags.is_custom &&
                    !guardFlags.is_evaluator &&
                    !guardFlags.is_feedback
                const syncForGuard = (p: Record<string, unknown> | null) =>
                    p && shouldSyncForGuard ? syncPromptInputKeysInParameters(p) : p
                if (
                    isEqual(
                        syncForGuard(incomingParameters),
                        syncForGuard(serverData?.data?.parameters ?? null),
                    )
                ) {
                    return
                }
            }
        }

        const flags = serverData?.flags ?? current?.flags
        const shouldSyncPromptInputKeys =
            !!flags && !flags.is_custom && !flags.is_evaluator && !flags.is_feedback
        const normalizedUpdates =
            incomingParameters !== undefined
                ? ({
                      ...updates,
                      data: {
                          ...((updates.data as Record<string, unknown> | undefined) ?? {}),
                          parameters: shouldSyncPromptInputKeys
                              ? syncPromptInputKeysInParameters(incomingParameters)
                              : incomingParameters,
                      },
                  } as Partial<Workflow>)
                : updates

        const {data: updatedData, ...restUpdatesWithBridgeShape} =
            normalizedUpdates as Partial<Workflow> & {
                parameters?: Record<string, unknown> | null
            }
        const {parameters: _bridgeParameters, ...restUpdates} = restUpdatesWithBridgeShape
        const mergedData =
            updatedData || current?.data
                ? {
                      ...current?.data,
                      ...updatedData,
                  }
                : undefined
        set(workflowDraftAtomFamily(workflowId), {
            ...current,
            ...restUpdates,
            ...(mergedData !== undefined ? {data: mergedData} : {}),
        })
    },
)

/**
 * Discard workflow draft (reset to server state).
 */
export const discardWorkflowDraftAtom = atom(null, (_get, set, workflowId: string) => {
    set(workflowDraftAtomFamily(workflowId), null)
})

// ============================================================================
// LOCAL DRAFTS (browser-only clones of server revisions)
// ============================================================================

/**
 * Storage for local draft data, keyed by local draft ID.
 * Stores complete Workflow objects that were cloned from server revisions.
 * These are only stored in browser memory (not persisted via API).
 */
export const workflowLocalServerDataAtomFamily = atomFamily((_localDraftId: string) =>
    atom<Workflow | null>(null),
)

/**
 * Server data selector for comparison purposes.
 *
 * For **regular** revision IDs: returns server query data (fully merged with
 * schema resolution but without draft overlay).
 *
 * For **local draft** IDs: redirects to the *source* revision's server data
 * via `workflowServerDataSelectorFamily(sourceRevisionId)`. This single
 * redirect point ensures all downstream comparison consumers (isDirty,
 * buildDraftPatch, etc.) automatically compare against the canonical source
 * without each needing individual handling.
 *
 * NOTE: Does **not** include the draft overlay — that is intentional so that
 * isDirty can compare draft vs server cleanly.
 */
export const workflowServerDataSelectorFamily = atomFamily((workflowId: string) =>
    atom<Workflow | null>((get): Workflow | null => {
        if (isLocalDraftId(workflowId)) {
            const localData = get(workflowLocalServerDataAtomFamily(workflowId))
            const sourceRevisionId = (localData as (Workflow & {_sourceRevisionId?: string}) | null)
                ?._sourceRevisionId
            if (sourceRevisionId && sourceRevisionId !== workflowId) {
                // Redirect to the source revision's server baseline.
                // This composes local-draft chains and keeps comparison logic
                // centralized in one selector path.
                const sourceServerData: Workflow | null = get(
                    workflowServerDataSelectorFamily(sourceRevisionId),
                )
                if (sourceServerData) return sourceServerData
            }

            // Ephemeral entities (created from templates, not cloned from a revision)
            // have no server baseline — return null so isDirty treats them as uncommitted.
            const meta = localData?.meta as Record<string, unknown> | null | undefined
            if (meta?.__ephemeral) {
                return null
            }

            // Fallback to the clone if source is unavailable
            return localData
        }

        const query = get(workflowQueryAtomFamily(workflowId))
        return query.data ?? null
    }),
)

/**
 * Retrieve flat (untransformed) source data for a workflow entity.
 *
 * Prefers local data (covers ephemeral/template-backed entities) and falls
 * back to the server query result (covers persisted revisions).
 *
 * The entity returned by `workflowEntityAtomFamily` has display transforms
 * applied (nested schemas/params for evaluators). Write boundaries and
 * invocation payload builders must use this flat source instead to avoid
 * persisting or sending UI-only nesting.
 */
export function getFlatSourceData(get: Getter, revisionId: string): Workflow | null {
    const localData = get(workflowLocalServerDataAtomFamily(revisionId))
    const serverData = get(workflowServerDataSelectorFamily(revisionId))
    return (localData?.data?.parameters ? localData : serverData) ?? localData ?? serverData
}

/**
 * Create a local (browser-only) draft by cloning a workflow revision.
 *
 * Reads the source revision data from the store, clones it with a new
 * local ID (prefixed "local-"), and stores the clone so it's immediately
 * available via `workflowEntityAtomFamily(localId)`.
 *
 * @param sourceRevisionId - The revision ID to clone
 * @param _appId - Unused (API compat with the unified bridge signature)
 * @returns The new local draft ID, or null on failure
 */
export function createLocalDraftFromWorkflowRevision(
    sourceRevisionId: string,
    _appId?: string,
): string | null {
    const store = getDefaultStore()

    const sourceData = store.get(workflowEntityAtomFamily(sourceRevisionId))
    if (!sourceData) {
        return null
    }

    // For non-evaluator app workflows that have a URL but no schemas yet,
    // the OpenAPI schema query hasn't resolved. Return null so hydration
    // retries once schemas are available — without schemas the config panel
    // would be empty.
    const isEvaluator = sourceData.flags?.is_evaluator ?? false
    const hasUrl = !!sourceData.data?.url
    const hasSchemas = !!(sourceData.data?.schemas?.parameters || sourceData.data?.schemas?.inputs)
    if (!isEvaluator && hasUrl && !hasSchemas) {
        return null
    }

    const localId = generateLocalId("local")

    // Clone the source data with the new local ID and mark the source
    const clonedData: Workflow = {
        ...sourceData,
        id: localId,
        _sourceRevisionId: isLocalDraftId(sourceRevisionId)
            ? ((sourceData as Workflow & {_sourceRevisionId?: string})._sourceRevisionId ??
              sourceRevisionId)
            : sourceRevisionId,
    } as Workflow & {_sourceRevisionId: string}

    // Store in the local server data atom
    store.set(workflowLocalServerDataAtomFamily(localId), clonedData)

    return localId
}

// ============================================================================
// EPHEMERAL WORKFLOWS (from trace data — local-only, flags.is_base)
// ============================================================================

/**
 * Parameters for creating an ephemeral workflow from trace data.
 *
 * `isEvaluator` + `uri` are required for evaluator spans so the ephemeral
 * entity carries the evaluator identity — downstream selectors (schema,
 * input ports, request payload) dispatch on `flags.is_evaluator` / `data.uri`.
 */
export interface CreateEphemeralWorkflowParams {
    label: string
    inputs: Record<string, unknown>
    outputs: unknown
    parameters: Record<string, unknown>
    sourceRef?: {
        type: "application" | "evaluator"
        id: string
        slug?: string
        version?: string
    }
    /** When true, entity.flags.is_evaluator is set and evaluator selectors engage. */
    isEvaluator?: boolean
    /** Workflow URI (e.g. "agenta:builtin:auto_ai_critique:v0"). Required for evaluators. */
    uri?: string
    /** Full envelope `{trace, inputs, outputs}` for evaluator spans; preserved in meta. */
    envelope?: Record<string, unknown>
}

/**
 * Detect if a trace entity uses chat mode by checking the inputs structure.
 * Chat mode: inputs contain a `messages` array with role/content objects.
 */
function detectIsChatFromInputs(inputs: Record<string, unknown>): boolean {
    if (!("messages" in inputs) || !Array.isArray(inputs.messages)) return false
    const msgs = inputs.messages as unknown[]
    return msgs.some(
        (m) =>
            m &&
            typeof m === "object" &&
            ("role" in (m as Record<string, unknown>) ||
                "content" in (m as Record<string, unknown>)),
    )
}

/**
 * Create a local-only ephemeral workflow entity from trace data.
 *
 * This replaces `createBaseRunnable()`. The entity is stored via
 * `workflowLocalServerDataAtomFamily` so it's immediately available
 * via `workflowEntityAtomFamily(id)` without any server queries.
 *
 * @returns Object with `id` (local ID) and `data` (the Workflow entity).
 */
export function createEphemeralWorkflow(params: CreateEphemeralWorkflowParams): {
    id: string
    data: Workflow
} {
    const store = getDefaultStore()
    const id = generateLocalId("local")

    const isEvaluator = params.isEvaluator === true
    // Chat detection is meaningless for evaluator envelopes (inputs are {trace, inputs, outputs}).
    const isChat = isEvaluator ? false : detectIsChatFromInputs(params.inputs)

    const workflow: Workflow = {
        id,
        name: params.label,
        slug: null,
        version: null,
        flags: {
            is_managed: false,
            is_custom: false,
            is_llm: false,
            is_hook: false,
            is_code: false,
            is_match: false,
            is_feedback: false,
            is_agent: false,
            is_skill: false,
            is_chat: isChat,
            has_url: false,
            has_script: false,
            has_handler: false,
            is_static: false,
            is_application: false,
            is_evaluator: isEvaluator,
            is_snippet: false,
            is_base: true,
        },
        data: {
            parameters: params.parameters,
            schemas: {
                inputs: null,
                outputs: null,
                parameters: null,
            },
            ...(params.uri ? {uri: params.uri} : {}),
        },
        // Store trace I/O in meta for port derivation and snapshot serialization
        meta: {
            __ephemeral: true,
            inputs: params.inputs,
            outputs: params.outputs,
            ...(params.envelope ? {envelope: params.envelope} : {}),
            ...(params.sourceRef ? {sourceRef: params.sourceRef} : {}),
        },
    } as Workflow

    store.set(workflowLocalServerDataAtomFamily(id), workflow)

    return {id, data: workflow}
}

/**
 * Release a `local-*` ephemeral entity from the local atom family.
 *
 * Discards both the local server data (the ephemeral entity itself) and
 * the draft layer (any in-progress edits). Used by drawer-create flows
 * (`app-create`, `evaluator-create`, `trace-replay`) when the user closes
 * the drawer without committing.
 *
 * Safe to call with non-local IDs — it's a no-op for those (the helper
 * checks the prefix internally).
 *
 * **Caller is responsible for gating on commit-not-in-flight.** Releasing
 * during an active commit can tear state mid-mutation. The drawer wrapper
 * owns this gate.
 */
export const discardLocalServerDataAtom = atom(null, (_get, set, localId: string) => {
    if (!localId || !localId.startsWith("local-")) return
    set(workflowLocalServerDataAtomFamily(localId), null)
    workflowLocalServerDataAtomFamily.remove(localId)
    set(workflowDraftAtomFamily(localId), null)
    workflowDraftAtomFamily.remove(localId)
})

// ============================================================================
// CACHE INVALIDATION
// ============================================================================

/**
 * Invalidate the app workflows list cache.
 * Call after create/update/archive operations on app workflows.
 */
export function invalidateWorkflowsListCache(options?: StoreOptions) {
    const store = getStore(options)
    try {
        const qc = store.get(queryClientAtom)
        qc.invalidateQueries({queryKey: ["workflows", "apps"], exact: false})
        // Artifact-level metadata (name/description) may have changed too
        qc.invalidateQueries({queryKey: ["workflows", "artifact"], exact: false})
    } catch {
        // queryClientAtom may not be initialized yet
    }
    store.set(appWorkflowsListQueryAtom)
}

/**
 * Seed the newly created app and its initial revision into the local cache so
 * the sidebar and playground can render immediately after creation.
 */
export function seedCreatedWorkflowCache(
    params: {
        appId: string
        revision: Workflow
    },
    options?: StoreOptions,
) {
    const store = getStore(options)
    const queryClient = store.get(queryClientAtom)
    const projectId = store.get(workflowProjectIdAtom)
    const appId = String(params.appId || params.revision.workflow_id || params.revision.id || "")

    if (!projectId || !appId || !params.revision?.id) return

    const revision: Workflow = {
        ...params.revision,
        workflow_id: params.revision.workflow_id ?? appId,
    }

    const appRef: WorkflowListRef = {
        id: appId,
        name: revision.name ?? null,
        slug: revision.slug ?? null,
        description: revision.description ?? null,
        flags: revision.flags,
        deleted_at: revision.deleted_at ?? null,
        created_at: revision.created_at ?? null,
        updated_at: revision.updated_at ?? null,
    }

    store.set(workflowLocalServerDataAtomFamily(revision.id), revision)
    queryClient.setQueryData(["workflows", "revision", revision.id, projectId], revision)
    queryClient.setQueryData(["workflows", "latestRevision", appId, projectId], revision)

    queryClient.setQueryData<WorkflowRevisionRefsResponse>(
        ["workflows", "revisionsByWorkflow", appId, projectId],
        (current) => {
            const refs = [...(current?.refs ?? [])]
            const nextRef: WorkflowRevisionRef = {
                id: revision.id,
                version: revision.version ?? null,
                created_at: revision.created_at ?? null,
            }

            const existingIndex = refs.findIndex((ref) => ref.id === nextRef.id)
            if (existingIndex >= 0) {
                refs[existingIndex] = nextRef
            } else {
                refs.unshift(nextRef)
            }

            return {
                count: Math.max(current?.count ?? 0, refs.length),
                refs,
            }
        },
    )

    queryClient.setQueryData<WorkflowListRefsResponse>(
        ["workflows", "apps", "list", projectId],
        (current) => {
            const refs = [...(current?.refs ?? [])]
            const existingIndex = refs.findIndex((ref) => ref.id === appRef.id)

            if (existingIndex >= 0) {
                refs[existingIndex] = {
                    ...refs[existingIndex],
                    ...appRef,
                }
            } else {
                refs.unshift(appRef)
            }

            return {
                count: Math.max(current?.count ?? 0, refs.length),
                refs,
            }
        },
    )
}

/**
 * Invalidate a single workflow's cache.
 */
export function invalidateWorkflowCache(workflowId: string, options?: StoreOptions) {
    const store = getStore(options)
    try {
        const qc = store.get(queryClientAtom)
        qc.invalidateQueries({queryKey: ["workflows", "revision", workflowId], exact: false})
        qc.invalidateQueries({queryKey: ["workflows", "artifact", workflowId], exact: false})
    } catch {
        // queryClientAtom may not be initialized yet
    }
    store.set(workflowQueryAtomFamily(workflowId))
}

/**
 * Invalidate the variants cache for a given workflow ID.
 * This forces the variant selector dropdown to refetch after a new variant is created.
 */
export function invalidateWorkflowVariantsCache(workflowId: string, options?: StoreOptions) {
    const store = getStore(options)
    try {
        const qc = store.get(queryClientAtom)
        qc.invalidateQueries({
            queryKey: ["workflows", "variants", workflowId],
            exact: false,
        })
    } catch {
        // queryClientAtom may not be initialized yet
    }
    // The query-key invalidation above refetches every active observer; the
    // wrapper atom is read-only so there is no per-atom refetch trigger.
    const projectId = store.get(workflowProjectIdAtom)
    if (projectId && workflowId) {
        store.set(workflowVariantsScopedQueryAtomFamily({projectId, workflowId}))
    }
}

/**
 * Invalidate the revisions-by-workflow cache for a given workflow ID.
 * This forces the variant/revision selector dropdown to refetch the revision list.
 */
export function invalidateWorkflowRevisionsByWorkflowCache(
    workflowId: string,
    options?: StoreOptions,
) {
    const store = getStore(options)
    try {
        const qc = store.get(queryClientAtom)
        qc.invalidateQueries({
            queryKey: ["workflows", "revisionsByWorkflow", workflowId],
            exact: false,
        })
    } catch {
        // queryClientAtom may not be initialized yet
    }
    store.set(workflowRevisionsByWorkflowQueryAtomFamily(workflowId))
}

/**
 * Invalidate the revisions-by-variant cache for a given variant ID.
 *
 * The playground's per-variant revision selector reads
 * `workflowRevisionsListQueryStateAtomFamily(variantId)`, which is backed by
 * the `["workflows", "revisions", variantId, projectId]` queryKey — distinct
 * from the workflow-scoped `revisionsByWorkflow` cache. Without this
 * invalidation, deleting a revision keeps the stale entry in the dropdown.
 */
export function invalidateWorkflowRevisionsByVariantCache(
    variantId: string,
    options?: StoreOptions,
) {
    const store = getStore(options)
    try {
        const qc = store.get(queryClientAtom)
        qc.invalidateQueries({
            queryKey: ["workflows", "revisions", variantId],
            exact: false,
        })
    } catch {
        // queryClientAtom may not be initialized yet
    }
    store.set(workflowRevisionsQueryAtomFamily(variantId))
}

/**
 * Refresh the playground's read-only views after the agent commits a new revision of itself
 * (#4920 — Application 1). A commit lands a new revision, so this invalidates both the
 * latest-revision query (the config panel + section drawers re-read the new config) and the inspect
 * query (harness-capabilities / any inspect-derived view).
 *
 * Fired on the one-way `data-committed-revision` stream signal (which the backend emits after
 * committed revisions whether the tool asked first or ran directly), not on approval — so a
 * single emit point covers both. The payload's ids aren't needed: a prefix invalidation refetches every
 * active observer, which is exactly the set the playground has mounted.
 */
export function invalidateAgentCommittedRevisionCache(options?: StoreOptions) {
    const store = getStore(options)
    try {
        const qc = store.get(queryClientAtom)
        qc.invalidateQueries({queryKey: ["workflows", "latestRevision"], exact: false})
        qc.invalidateQueries({queryKey: ["workflows", "inspect"], exact: false})
    } catch {
        // queryClientAtom may not be initialized yet
    }
}
