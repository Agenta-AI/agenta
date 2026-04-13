import {
    appEnvironmentsQueryAtomFamily,
    type AppEnvironmentDeployment,
} from "@agenta/entities/environment"
import {testsetQueryAtomFamily, type Testset} from "@agenta/entities/testset"
import {
    fetchWorkflow,
    fetchWorkflowRevisionById,
    resolveOutputSchemaProperties,
    workflowMolecule,
    workflowsListQueryStateAtom,
} from "@agenta/entities/workflow"
import {createBatchFetcher} from "@agenta/shared/utils"
import {atom} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {snakeToCamelCaseKeys} from "@/oss/lib/helpers/casing"
import {canonicalizeMetricKey} from "@/oss/lib/metricUtils"

// ─────────────────────────────────────────────────────────────────────────────
// Shared query-result shape for consumers that expect {data, isPending, ...}
// ─────────────────────────────────────────────────────────────────────────────

interface QueryResultShape<T> {
    data: T | null
    isPending: boolean
    isFetching: boolean
    isLoading: boolean
    isError: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// App Reference (backed by workflow entity)
// ─────────────────────────────────────────────────────────────────────────────

export interface AppReference {
    id: string
    name?: string | null
    slug?: string | null
}

/**
 * Reactively derives app reference from the workflows list.
 * The workflows list query contains app-level names (not variant names).
 * When the list hasn't loaded yet, isPending is true.
 */
export const appReferenceAtomFamily = atomFamily(
    ({projectId, appId}: {projectId: string | null; appId: string | null | undefined}) =>
        atom<QueryResultShape<AppReference>>((get) => {
            if (!projectId || !appId) {
                return {
                    data: null,
                    isPending: false,
                    isFetching: false,
                    isLoading: false,
                    isError: false,
                }
            }

            // Read the all-workflows union (app + evaluator) reactively
            const listState = get(workflowsListQueryStateAtom)
            const listMatch = listState.data.find((w) => w.id === appId)

            if (listMatch) {
                return {
                    data: {
                        id: listMatch.id,
                        name: listMatch.name ?? null,
                        slug: listMatch.slug ?? null,
                    },
                    isPending: false,
                    isFetching: false,
                    isLoading: false,
                    isError: false,
                }
            }

            // Lists loaded but app not found — it may be archived/deleted
            if (!listState.isPending) {
                return {
                    data: {id: appId, name: null, slug: null},
                    isPending: false,
                    isFetching: false,
                    isLoading: false,
                    isError: false,
                }
            }

            // Lists still loading
            return {
                data: null,
                isPending: true,
                isFetching: true,
                isLoading: true,
                isError: false,
            }
        }),
    (a, b) => a.projectId === b.projectId && a.appId === b.appId,
)

// ─────────────────────────────────────────────────────────────────────────────
// Testset Reference (backed by testset entity)
// ─────────────────────────────────────────────────────────────────────────────

export interface TestsetReference {
    id: string
    name?: string | null
    revisionId?: string | null
    revisionVersion?: number | null
}

/**
 * Reactively derives testset reference from the testset entity query.
 * The testsetQueryAtomFamily is batched internally by the entities package.
 */
export const previewTestsetReferenceAtomFamily = atomFamily(
    ({projectId, testsetId}: {projectId: string | null; testsetId: string | null | undefined}) =>
        atom<QueryResultShape<TestsetReference>>((get) => {
            if (!projectId || !testsetId) {
                return {
                    data: null,
                    isPending: false,
                    isFetching: false,
                    isLoading: false,
                    isError: false,
                }
            }

            const query = get(testsetQueryAtomFamily(testsetId)) as {
                data?: Testset | null
                isPending?: boolean
                isFetching?: boolean
                isLoading?: boolean
                isError?: boolean
                status?: string
            }
            const testset = query?.data

            if (testset) {
                return {
                    data: {
                        id: testset.id,
                        name: testset.name ?? null,
                    },
                    isPending: false,
                    isFetching: false,
                    isLoading: false,
                    isError: false,
                }
            }

            return {
                data: null,
                isPending: query?.isPending ?? true,
                isFetching: query?.isFetching ?? true,
                isLoading: query?.isLoading ?? true,
                isError: query?.isError ?? false,
            }
        }),
    (a, b) => a.projectId === b.projectId && a.testsetId === b.testsetId,
)

// ─────────────────────────────────────────────────────────────────────────────
// Variant Reference (backed by workflow molecule)
// ─────────────────────────────────────────────────────────────────────────────

export interface VariantReference {
    id: string
    name?: string | null
    slug?: string | null
    revision?: number | string | null
}

/**
 * Reactively derives variant/revision reference from the workflow molecule.
 * The variantId here is typically a revision ID — the molecule resolves it
 * to the full entity data including name, slug, and version.
 */
export const variantReferenceAtomFamily = atomFamily(
    ({projectId, variantId}: {projectId: string | null; variantId: string | null | undefined}) =>
        atom<QueryResultShape<VariantReference>>((get) => {
            if (!projectId || !variantId) {
                return {
                    data: null,
                    isPending: false,
                    isFetching: false,
                    isLoading: false,
                    isError: false,
                }
            }

            const query = get(workflowMolecule.selectors.query(variantId))
            const data = query?.data

            if (data) {
                return {
                    data: {
                        id: data.id ?? variantId,
                        name: data.name ?? data.slug ?? null,
                        slug: data.slug ?? null,
                        revision: data.version ?? null,
                    },
                    isPending: false,
                    isFetching: false,
                    isLoading: false,
                    isError: false,
                }
            }

            if (query?.isPending) {
                return {
                    data: null,
                    isPending: true,
                    isFetching: true,
                    isLoading: true,
                    isError: false,
                }
            }

            // Query resolved but no data — entity may be archived/deleted
            return {
                data: {id: variantId, name: null, slug: null, revision: null},
                isPending: false,
                isFetching: false,
                isLoading: false,
                isError: query?.isError ?? false,
            }
        }),
    (a, b) => a.projectId === b.projectId && a.variantId === b.variantId,
)

// ─────────────────────────────────────────────────────────────────────────────
// Evaluator Reference (backed by workflow entity)
// ─────────────────────────────────────────────────────────────────────────────

export interface EvaluatorReferenceMetric {
    canonicalPath: string
    label?: string | null
    outputType?: string | null
}

export interface EvaluatorReference {
    id?: string | null
    slug?: string | null
    name?: string | null
    metrics?: EvaluatorReferenceMetric[]
}

const extractMetricsFromWorkflow = (workflow: any): EvaluatorReferenceMetric[] => {
    const outputs = resolveOutputSchemaProperties(workflow?.data) ?? {}
    return Object.entries(outputs).map(([rawKey, schema]: [string, any]) => {
        const label =
            (typeof schema?.title === "string" && schema.title.trim().length
                ? schema.title.trim()
                : null) ?? rawKey
        const outputType = typeof schema?.type === "string" ? schema.type.toLowerCase() : null
        return {
            canonicalPath: canonicalizeMetricKey(rawKey),
            label,
            outputType,
        }
    })
}

/**
 * Self-contained query for fetching a workflow revision by ID.
 * Uses the provided projectId directly — no dependency on shared
 * projectIdAtom/sessionAtom, so it works in scoped Jotai stores
 * (e.g., the evaluations page).
 */
export const evaluatorWorkflowQueryAtomFamily = atomFamily(
    ({projectId, revisionId}: {projectId: string; revisionId: string}) =>
        atomWithQuery(() => ({
            queryKey: ["evaluator-reference", "workflow", projectId, revisionId],
            queryFn: async () => {
                try {
                    // Try as revision ID first
                    const revision = await fetchWorkflowRevisionById(revisionId, projectId)
                    if (revision?.data) return revision

                    // No data — the ID is likely an artifact/workflow ID.
                    // Fetch the latest revision which carries full data.
                    const artifactId = revision?.workflow_id ?? revisionId
                    return await fetchWorkflow({id: artifactId, projectId})
                } catch {
                    // Revision endpoint failed — try as artifact ID directly
                    try {
                        return await fetchWorkflow({id: revisionId, projectId})
                    } catch {
                        return null
                    }
                }
            },
            enabled: !!projectId && !!revisionId,
            staleTime: 5 * 60_000,
            refetchOnWindowFocus: false,
        })),
)

/**
 * Resolves evaluator reference (name, slug, metrics) from the workflow
 * entity system. Uses a self-contained query that works in any Jotai
 * store — no dependency on shared projectIdAtom/sessionAtom.
 */
export const evaluatorReferenceAtomFamily = atomFamily(
    ({projectId, slug, id}: {projectId: string | null; slug?: string | null; id?: string | null}) =>
        atom<QueryResultShape<EvaluatorReference>>((get) => {
            if (!projectId || (!slug && !id)) {
                return {
                    data: null,
                    isPending: false,
                    isFetching: false,
                    isLoading: false,
                    isError: false,
                }
            }

            if (id) {
                const query = get(evaluatorWorkflowQueryAtomFamily({projectId, revisionId: id}))
                if (query.isPending || query.isFetching) {
                    return {
                        data: null,
                        isPending: true,
                        isFetching: true,
                        isLoading: true,
                        isError: false,
                    }
                }
                const workflow = query.data
                if (workflow) {
                    return {
                        data: {
                            id: workflow.workflow_id ?? workflow.id ?? id,
                            slug: workflow.slug ?? slug ?? null,
                            name: workflow.name ?? workflow.slug ?? slug ?? id ?? null,
                            metrics: extractMetricsFromWorkflow(workflow),
                        },
                        isPending: false,
                        isFetching: false,
                        isLoading: false,
                        isError: false,
                    }
                }
            }

            // Nothing found — return minimal reference
            return {
                data: {
                    id: id ?? null,
                    slug: slug ?? null,
                    name: slug ?? id ?? null,
                    metrics: [],
                },
                isPending: false,
                isFetching: false,
                isLoading: false,
                isError: false,
            }
        }),
)

// ─────────────────────────────────────────────────────────────────────────────
// Environment Reference (backed by entity appEnvironments)
// ─────────────────────────────────────────────────────────────────────────────

export interface EnvironmentReference {
    id?: string | null
    slug?: string | null
    name?: string | null
    appId?: string | null
    deployedAppVariantId?: string | null
    deployedVariantName?: string | null
    deployedAppVariantRevisionId?: string | null
    revision?: string | number | null
}

/**
 * Finds an environment deployment by ID or slug from the entity-backed
 * appEnvironmentsQueryAtomFamily. No separate API call needed — the
 * environments list is already fetched and cached by the entity system.
 */
const toEnvironmentReference = (
    env: AppEnvironmentDeployment,
    appId: string | null,
): EnvironmentReference => ({
    id: null, // Entity deployment doesn't expose environment ID
    slug: env.name,
    name: env.name,
    appId: appId ?? null,
    deployedAppVariantId: env.deployedVariantId ?? null,
    deployedVariantName: env.deployedVariantName ?? null,
    deployedAppVariantRevisionId: env.deployedRevisionId ?? null,
    revision: env.revision ?? null,
})

export const environmentReferenceAtomFamily = atomFamily(
    ({
        projectId,
        applicationId,
        environmentId,
        environmentSlug,
    }: {
        projectId: string | null
        applicationId?: string | null
        environmentId?: string | null
        environmentSlug?: string | null
    }) =>
        atom<QueryResultShape<EnvironmentReference>>((get) => {
            if (!projectId || (!environmentId && !environmentSlug)) {
                return {
                    data: null,
                    isPending: false,
                    isFetching: false,
                    isLoading: false,
                    isError: false,
                }
            }

            if (!applicationId) {
                return {
                    data: {
                        id: environmentId ?? null,
                        slug: environmentSlug ?? null,
                        name: environmentSlug ?? environmentId ?? null,
                        appId: null,
                        deployedAppVariantId: null,
                        deployedVariantName: null,
                        deployedAppVariantRevisionId: null,
                        revision: null,
                    },
                    isPending: false,
                    isFetching: false,
                    isLoading: false,
                    isError: false,
                }
            }

            const envQuery = get(appEnvironmentsQueryAtomFamily(applicationId))
            const envs: AppEnvironmentDeployment[] = envQuery?.data ?? []

            // Match by slug/name (entity environments don't expose UUIDs)
            const match = envs.find(
                (env) =>
                    (environmentSlug &&
                        (env.name === environmentSlug ||
                            env.name?.toLowerCase() === environmentSlug.toLowerCase())) ||
                    (environmentId && env.name === environmentId),
            )

            if (match) {
                return {
                    data: toEnvironmentReference(match, applicationId),
                    isPending: false,
                    isFetching: false,
                    isLoading: false,
                    isError: false,
                }
            }

            if (envQuery?.isPending) {
                return {
                    data: null,
                    isPending: true,
                    isFetching: true,
                    isLoading: true,
                    isError: false,
                }
            }

            // Loaded but not found — return fallback
            return {
                data: {
                    id: environmentId ?? null,
                    slug: environmentSlug ?? null,
                    name: environmentSlug ?? environmentId ?? null,
                    appId: applicationId ?? null,
                    deployedAppVariantId: null,
                    deployedVariantName: null,
                    deployedAppVariantRevisionId: null,
                    revision: null,
                },
                isPending: false,
                isFetching: false,
                isLoading: false,
                isError: false,
            }
        }),
    (a, b) =>
        a.projectId === b.projectId &&
        a.applicationId === b.applicationId &&
        a.environmentId === b.environmentId &&
        a.environmentSlug === b.environmentSlug,
)

// ─────────────────────────────────────────────────────────────────────────────
// Query Reference (kept as custom — no entity equivalent yet)
// ─────────────────────────────────────────────────────────────────────────────

export interface QueryReference {
    id?: string | null
    slug?: string | null
    name?: string | null
}

interface QueryReferenceRequest {
    projectId: string
    queryId?: string | null
    querySlug?: string | null
}

const queryReferenceBatchFetcher = createBatchFetcher<
    QueryReferenceRequest,
    QueryReference | null,
    Map<string, QueryReference | null>
>({
    serializeKey: ({projectId, queryId, querySlug}) =>
        [projectId ?? "none", queryId ?? "none", querySlug ?? "none"].join(":"),
    batchFn: async (requests: QueryReferenceRequest[], serializedKeys: string[]) => {
        const results = new Map<string, QueryReference | null>()
        const grouped = new Map<
            string,
            {
                projectId: string
                entries: {
                    key: string
                    queryId?: string | null
                    querySlug?: string | null
                }[]
            }
        >()

        requests.forEach((request, index) => {
            const serializedKey = serializedKeys[index]
            const {projectId, queryId, querySlug} = request
            if (!projectId || (!queryId && !querySlug)) {
                results.set(serializedKey, null)
                return
            }
            const existing = grouped.get(projectId)
            if (existing) {
                existing.entries.push({key: serializedKey, queryId, querySlug})
            } else {
                grouped.set(projectId, {
                    projectId,
                    entries: [{key: serializedKey, queryId, querySlug}],
                })
            }
        })

        await Promise.all(
            Array.from(grouped.values()).map(async ({projectId, entries}) => {
                const dedupRefs = Array.from(
                    new Map(
                        entries
                            .map(({queryId, querySlug}) => {
                                if (!queryId && !querySlug) return null
                                const key = `${queryId ?? ""}:${querySlug ?? ""}`
                                return [key, {id: queryId, slug: querySlug}] as const
                            })
                            .filter((item): item is NonNullable<typeof item> => item !== null),
                    ).values(),
                )

                if (!dedupRefs.length) {
                    entries.forEach(({key}) => results.set(key, null))
                    return
                }

                try {
                    const response = await axios.post(
                        "/preview/queries/query",
                        {
                            query_refs: dedupRefs.map((ref) => ({
                                id: ref.id,
                                slug: ref.slug,
                            })),
                        },
                        {params: {project_id: projectId}, _ignoreError: true} as any,
                    )

                    const queries: any[] = Array.isArray(response?.data?.queries)
                        ? response.data.queries
                        : []

                    const lookup = queries.map((raw) => snakeToCamelCaseKeys(raw))
                    const byId = new Map<string, QueryReference>()
                    const bySlug = new Map<string, QueryReference>()

                    lookup.forEach((query) => {
                        const ref: QueryReference = {
                            id: query?.id ?? null,
                            slug: query?.slug ?? null,
                            name: query?.name ?? query?.slug ?? null,
                        }
                        if (ref.id) byId.set(ref.id, ref)
                        if (ref.slug) bySlug.set(ref.slug, ref)
                    })

                    entries.forEach(({key, queryId, querySlug}) => {
                        let matched: QueryReference | null = null
                        if (queryId) matched = byId.get(queryId) ?? null
                        if (!matched && querySlug) matched = bySlug.get(querySlug) ?? null
                        results.set(key, matched ?? {id: queryId, slug: querySlug, name: null})
                    })
                } catch (error) {
                    console.warn("[References] failed to batch fetch query references", {
                        projectId,
                        error,
                    })
                    entries.forEach(({key, queryId, querySlug}) => {
                        results.set(key, {id: queryId, slug: querySlug, name: null})
                    })
                }
            }),
        )

        return results
    },
    resolveResult: (response, request, serializedKey) => {
        if (response.has(serializedKey)) {
            return response.get(serializedKey) ?? null
        }
        return {
            id: request.queryId ?? null,
            slug: request.querySlug ?? null,
            name: null,
        }
    },
})

export const queryReferenceAtomFamily = atomFamily(
    ({
        projectId,
        queryId,
        querySlug,
    }: {
        projectId: string | null
        queryId?: string | null
        querySlug?: string | null
    }) =>
        atomWithQuery<QueryReference | null>(() => {
            return {
                queryKey: [
                    "references",
                    "query-ref",
                    projectId ?? "none",
                    queryId ?? "none",
                    querySlug ?? "none",
                ],
                enabled: Boolean(projectId && (queryId || querySlug)),
                staleTime: 60_000,
                gcTime: 5 * 60 * 1000,
                refetchOnWindowFocus: false,
                refetchOnReconnect: false,
                queryFn: async () => {
                    if (!projectId || (!queryId && !querySlug)) return null
                    return queryReferenceBatchFetcher({projectId, queryId, querySlug})
                },
            }
        }),
    (a, b) => a.projectId === b.projectId && a.queryId === b.queryId && a.querySlug === b.querySlug,
)
