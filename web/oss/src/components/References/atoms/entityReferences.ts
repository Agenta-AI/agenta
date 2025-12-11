import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {snakeToCamelCaseKeys} from "@/oss/lib/helpers/casing"
import {canonicalizeMetricKey} from "@/oss/lib/metricUtils"
import type {ListAppsItem} from "@/oss/lib/Types"
import {appsAtom} from "@/oss/state/app"
import createBatchFetcher from "@/oss/state/utils/createBatchFetcher"

const isNonNullable = <T>(value: T): value is NonNullable<T> =>
    value !== null && value !== undefined

export interface AppReference {
    id: string
    name?: string | null
    slug?: string | null
}

interface AppReferenceRequest {
    projectId: string
    appId: string
}

const appReferenceBatchFetcher = createBatchFetcher<
    AppReferenceRequest,
    AppReference | null,
    Map<string, AppReference | null>
>({
    serializeKey: ({projectId, appId}) => `${projectId}:${appId}`,
    batchFn: async (requests: AppReferenceRequest[], serializedKeys: string[]) => {
        const results = new Map<string, AppReference | null>()
        const grouped = new Map<string, {request: AppReferenceRequest; keys: string[]}>()

        requests.forEach((request, index) => {
            const serializedKey = serializedKeys[index]
            const {projectId, appId} = request
            if (!projectId || !appId) {
                results.set(serializedKey, null)
                return
            }
            const groupKey = `${projectId}:${appId}`
            const existing = grouped.get(groupKey)
            if (existing) {
                existing.keys.push(serializedKey)
            } else {
                grouped.set(groupKey, {request, keys: [serializedKey]})
            }
        })

        await Promise.all(
            Array.from(grouped.values()).map(async ({request, keys}) => {
                const {projectId, appId} = request
                try {
                    const response = await axios.get(`/apps/${encodeURIComponent(appId)}`, {
                        params: {project_id: projectId},
                        _ignoreError: true,
                    } as any)
                    const data = response.data ?? {}
                    const reference: AppReference = {
                        id: data?.id ?? appId,
                        name: data?.name ?? data?.app_name ?? null,
                        slug: data?.slug ?? null,
                    }
                    keys.forEach((key) => results.set(key, reference))
                } catch (error) {
                    console.warn("[EvaluationRunsTablePOC] failed to batch fetch app reference", {
                        projectId,
                        appId,
                        error,
                    })
                    const fallback: AppReference = {id: appId, name: null, slug: null}
                    keys.forEach((key) => results.set(key, fallback))
                }
            }),
        )

        return results
    },
    resolveResult: (response, request, serializedKey) => {
        if (response.has(serializedKey)) {
            return response.get(serializedKey) ?? null
        }
        if (request.appId) {
            return {id: request.appId, name: null, slug: null}
        }
        return null
    },
})

export interface TestsetReference {
    id: string
    name?: string | null
}

export interface VariantConfigReference {
    revisionId: string
    variantName?: string | null
    revision?: number | string | null
}

interface PreviewTestsetReferenceRequest {
    projectId: string
    testsetId: string
}

const previewTestsetReferenceBatchFetcher = createBatchFetcher<
    PreviewTestsetReferenceRequest,
    TestsetReference | null,
    Map<string, TestsetReference | null>
>({
    serializeKey: ({projectId, testsetId}) => `${projectId}:${testsetId}`,
    batchFn: async (requests: PreviewTestsetReferenceRequest[], serializedKeys: string[]) => {
        const results = new Map<string, TestsetReference | null>()
        const grouped = new Map<
            string,
            {requests: PreviewTestsetReferenceRequest[]; keys: string[]}
        >()

        requests.forEach((request, index) => {
            const serializedKey = serializedKeys[index]
            const {projectId, testsetId} = request
            if (!projectId || !testsetId) {
                results.set(serializedKey, null)
                return
            }

            const existing = grouped.get(projectId)
            if (existing) {
                existing.requests.push(request)
                existing.keys.push(serializedKey)
            } else {
                grouped.set(projectId, {requests: [request], keys: [serializedKey]})
            }
        })

        await Promise.all(
            Array.from(grouped.entries()).map(async ([projectId, group]) => {
                const uniqueIds = Array.from(
                    new Set(group.requests.map((request) => request.testsetId).filter(Boolean)),
                )

                if (uniqueIds.length === 0) {
                    group.keys.forEach((key) => results.set(key, null))
                    return
                }

                try {
                    const response = await axios.post(
                        "/preview/testsets/query",
                        {
                            testset_refs: uniqueIds.map((id) => ({id})),
                            include_archived: true,
                            windowing: {limit: uniqueIds.length},
                        },
                        {params: {project_id: projectId}},
                    )

                    const payload = response?.data ?? {}
                    const list = Array.isArray(payload?.testsets)
                        ? payload.testsets
                        : Array.isArray(payload)
                          ? payload
                          : []

                    const lookup = new Map<string, TestsetReference>(
                        list
                            .map((item: any) => {
                                const id = item?.id ?? item?._id ?? null
                                if (!id) return null
                                return [
                                    id,
                                    {
                                        id,
                                        name: item?.name ?? null,
                                    } satisfies TestsetReference,
                                ] as const
                            })
                            .filter(isNonNullable),
                    )

                    group.requests.forEach((request, index) => {
                        const key = group.keys[index]
                        const reference = lookup.get(request.testsetId) ?? {
                            id: request.testsetId!,
                            name: null,
                        }
                        results.set(key, reference)
                    })
                } catch (error) {
                    console.warn(
                        "[EvaluationRunsTablePOC] failed to batch fetch preview testset reference",
                        {
                            projectId,
                            testsetIds: uniqueIds,
                            error,
                        },
                    )
                    group.requests.forEach((request, index) => {
                        const key = group.keys[index]
                        results.set(key, {id: request.testsetId!, name: null})
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
        if (request.testsetId) {
            return {id: request.testsetId, name: null}
        }
        return null
    },
})

interface VariantConfigRequest {
    projectId: string
    revisionId: string
}

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

interface EvaluatorReferenceRequest {
    projectId: string
    slug?: string | null
    id?: string | null
}

const variantConfigBatchFetcher = createBatchFetcher<
    VariantConfigRequest,
    VariantConfigReference | null,
    Map<string, VariantConfigReference | null>
>({
    serializeKey: ({projectId, revisionId}) => `${projectId}:${revisionId}`,
    batchFn: async (requests: VariantConfigRequest[], serializedKeys: string[]) => {
        const results = new Map<string, VariantConfigReference | null>()
        const grouped = new Map<string, {requests: VariantConfigRequest[]; keys: string[]}>()

        requests.forEach((request, index) => {
            const serializedKey = serializedKeys[index]
            const {projectId, revisionId} = request
            if (!projectId || !revisionId) {
                results.set(serializedKey, null)
                return
            }

            const existing = grouped.get(projectId)
            if (existing) {
                existing.requests.push(request)
                existing.keys.push(serializedKey)
            } else {
                grouped.set(projectId, {requests: [request], keys: [serializedKey]})
            }
        })

        await Promise.all(
            Array.from(grouped.entries()).map(async ([projectId, group]) => {
                const uniqueIds = Array.from(
                    new Set(group.requests.map((request) => request.revisionId).filter(Boolean)),
                )

                if (!uniqueIds.length) {
                    group.keys.forEach((key) => results.set(key, null))
                    return
                }

                try {
                    const response = await axios.post(
                        "/variants/configs/query",
                        {
                            variant_refs: uniqueIds.map((id) => ({id})),
                        },
                        {params: {project_id: projectId}, _ignoreError: true} as any,
                    )

                    const payload = response?.data ?? {}
                    const configs = Array.isArray(payload?.configs)
                        ? payload.configs
                        : Array.isArray(payload)
                          ? payload
                          : []

                    const normalizedConfigs = configs
                        .map((config: any) => {
                            const variantRef = config?.variant_ref ?? {}
                            const rawId = variantRef?.id ?? variantRef?._id ?? null
                            const variantName =
                                typeof variantRef?.slug === "string" ? variantRef.slug : null
                            const revisionValue =
                                variantRef?.version !== undefined ? variantRef.version : null
                            const normalizedRevisionId =
                                typeof rawId === "string"
                                    ? rawId
                                    : rawId != null
                                      ? String(rawId)
                                      : null
                            if (!normalizedRevisionId && !variantName && revisionValue == null) {
                                return null
                            }
                            return {
                                rawId: normalizedRevisionId,
                                reference: {
                                    revisionId: normalizedRevisionId ?? "",
                                    variantName,
                                    revision: revisionValue,
                                } satisfies VariantConfigReference,
                            }
                        })
                        .filter(isNonNullable)

                    const lookupByResponseId = new Map<string, VariantConfigReference>()
                    const fallbackQueue: VariantConfigReference[] = []
                    normalizedConfigs.forEach(({rawId, reference}) => {
                        if (rawId) {
                            lookupByResponseId.set(rawId, reference)
                        }
                        fallbackQueue.push(reference)
                    })

                    group.requests.forEach((request, index) => {
                        const key = group.keys[index]
                        let reference: VariantConfigReference | undefined
                        if (request.revisionId) {
                            reference = lookupByResponseId.get(request.revisionId)
                        }
                        if (!reference) {
                            reference = fallbackQueue.shift() ?? undefined
                        }
                        if (!reference) {
                            reference = {
                                revisionId: request.revisionId!,
                                variantName: null,
                                revision: null,
                            }
                        } else if (!reference.revisionId && request.revisionId) {
                            reference = {
                                ...reference,
                                revisionId: request.revisionId,
                            }
                        }
                        results.set(key, reference)
                    })
                } catch (error) {
                    console.warn("[EvaluationRunsTablePOC] failed to batch fetch variant configs", {
                        projectId,
                        revisionIds: uniqueIds,
                        error,
                    })

                    group.requests.forEach((request, index) => {
                        const key = group.keys[index]
                        results.set(key, {
                            revisionId: request.revisionId!,
                            variantName: null,
                            revision: null,
                        })
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
            revisionId: request.revisionId!,
            variantName: null,
            revision: null,
        }
    },
})

const normalizeEvaluatorRef = (value?: string | null) =>
    typeof value === "string" && value.trim().length ? value.trim() : undefined

const evaluatorReferenceBatchFetcher = createBatchFetcher<
    EvaluatorReferenceRequest,
    EvaluatorReference | null,
    Map<string, EvaluatorReference | null>
>({
    serializeKey: ({projectId, slug, id}) =>
        [projectId ?? "none", slug ?? "none", id ?? "none"].join(":"),
    batchFn: async (requests: EvaluatorReferenceRequest[], serializedKeys: string[]) => {
        const results = new Map<string, EvaluatorReference | null>()
        const grouped = new Map<
            string,
            {
                projectId: string
                entries: {
                    key: string
                    slug?: string | null
                    id?: string | null
                }[]
            }
        >()

        requests.forEach((request, index) => {
            const serializedKey = serializedKeys[index]
            const projectId = request.projectId
            const slug = normalizeEvaluatorRef(request.slug)
            const id = normalizeEvaluatorRef(request.id)
            if (!projectId || (!slug && !id)) {
                results.set(serializedKey, null)
                return
            }
            const existing = grouped.get(projectId)
            if (existing) {
                existing.entries.push({key: serializedKey, slug, id})
            } else {
                grouped.set(projectId, {
                    projectId,
                    entries: [{key: serializedKey, slug, id}],
                })
            }
        })

        const extractMetrics = (rawEvaluator: any): EvaluatorReferenceMetric[] => {
            const evaluator = snakeToCamelCaseKeys(rawEvaluator)
            const outputs =
                evaluator?.data?.schemas?.outputs?.properties ??
                evaluator?.data?.service?.format?.properties?.outputs?.properties ??
                {}
            return Object.entries(outputs).map(([rawKey, schema]: [string, any]) => {
                const label =
                    (typeof schema?.title === "string" && schema.title.trim().length
                        ? schema.title.trim()
                        : null) ?? rawKey
                const outputType =
                    typeof schema?.type === "string" ? schema.type.toLowerCase() : null
                return {
                    canonicalPath: canonicalizeMetricKey(rawKey),
                    label,
                    outputType,
                }
            })
        }

        await Promise.all(
            Array.from(grouped.values()).map(async ({projectId, entries}) => {
                const dedupRefs = Array.from(
                    new Map(
                        entries
                            .map(({slug, id}) => {
                                const normalizedSlug = slug ?? undefined
                                const normalizedId = id ?? undefined
                                if (!normalizedSlug && !normalizedId) return null
                                const key = `${normalizedId ?? ""}:${normalizedSlug ?? ""}`
                                return [
                                    key,
                                    {
                                        slug: normalizedSlug,
                                        id: normalizedId,
                                    },
                                ] as const
                            })
                            .filter(isNonNullable),
                    ).values(),
                )

                if (!dedupRefs.length) {
                    entries.forEach(({key}) => results.set(key, null))
                    return
                }

                try {
                    const response = await axios.post(
                        "/preview/simple/evaluators/query",
                        {
                            evaluator_refs: dedupRefs.map((ref) => ({
                                slug: ref.slug,
                                id: ref.id,
                            })),
                        },
                        {params: {project_id: projectId}},
                    )

                    const evaluators: any[] = Array.isArray(response?.data?.evaluators)
                        ? response.data.evaluators
                        : []

                    const lookup = evaluators.map((raw) => snakeToCamelCaseKeys(raw))

                    entries.forEach(({key, slug, id}) => {
                        const match = lookup.find(
                            (evaluator) =>
                                (slug && evaluator.slug === slug) || (id && evaluator.id === id),
                        )
                        if (!match) {
                            results.set(key, {
                                id: id ?? null,
                                slug: slug ?? null,
                                name: slug ?? id ?? null,
                                metrics: [],
                            })
                            return
                        }
                        results.set(key, {
                            id: match.id ?? id ?? null,
                            slug: match.slug ?? slug ?? null,
                            name: match.name ?? match.slug ?? match.id ?? slug ?? id ?? null,
                            metrics: extractMetrics(match),
                        })
                    })
                } catch (error) {
                    console.warn("[EvaluationRunsTablePOC] failed to batch fetch evaluator refs", {
                        projectId,
                        refs: dedupRefs,
                        error,
                    })
                    entries.forEach(({key, slug, id}) => {
                        results.set(key, {
                            id: id ?? null,
                            slug: slug ?? null,
                            name: slug ?? id ?? null,
                            metrics: [],
                        })
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
        if (request.slug || request.id) {
            return {
                id: request.id ?? null,
                slug: request.slug ?? null,
                name: request.slug ?? request.id ?? null,
                metrics: [],
            }
        }
        return null
    },
})

export const appReferenceAtomFamily = atomFamily(
    ({projectId, appId}: {projectId: string | null; appId: string | null | undefined}) =>
        atomWithQuery<AppReference | null>((get) => {
            const apps = (get(appsAtom) as ListAppsItem[]) ?? []
            const cachedApp = apps.find((item) => item.app_id === appId) ?? null
            const cachedReference: AppReference | null = cachedApp
                ? {
                      id: cachedApp.app_id,
                      name: cachedApp.app_name ?? null,
                      slug: null,
                  }
                : null

            return {
                queryKey: [
                    "evaluation-runs-table",
                    "app",
                    projectId ?? "none",
                    appId ?? "none",
                    cachedReference?.name ?? null,
                ],
                enabled: Boolean(projectId && appId),
                staleTime: 60_000,
                gcTime: 5 * 60 * 1000,
                refetchOnWindowFocus: false,
                refetchOnReconnect: false,
                placeholderData: cachedReference ?? undefined,
                queryFn: async () => {
                    if (!projectId || !appId) return null
                    if (cachedReference) return cachedReference
                    return appReferenceBatchFetcher({projectId, appId})
                },
            }
        }),
    (a, b) => a.projectId === b.projectId && a.appId === b.appId,
)

export const previewTestsetReferenceAtomFamily = atomFamily(
    ({projectId, testsetId}: {projectId: string | null; testsetId: string | null | undefined}) =>
        atomWithQuery<TestsetReference | null>(() => {
            return {
                queryKey: [
                    "evaluation-runs-table",
                    "preview-testset",
                    projectId ?? "none",
                    testsetId ?? "none",
                ],
                enabled: Boolean(projectId && testsetId),
                staleTime: 60_000,
                gcTime: 5 * 60 * 1000,
                refetchOnWindowFocus: false,
                refetchOnReconnect: false,
                queryFn: async () => {
                    if (!projectId || !testsetId) return null
                    return previewTestsetReferenceBatchFetcher({projectId, testsetId})
                },
            }
        }),
    (a, b) => a.projectId === b.projectId && a.testsetId === b.testsetId,
)

export const variantConfigAtomFamily = atomFamily(
    ({projectId, revisionId}: {projectId: string | null; revisionId: string | null | undefined}) =>
        atomWithQuery<VariantConfigReference | null>(() => {
            return {
                queryKey: [
                    "evaluation-runs-table",
                    "variant-config",
                    projectId ?? "none",
                    revisionId ?? "none",
                ],
                enabled: Boolean(projectId && revisionId),
                staleTime: 60_000,
                gcTime: 5 * 60 * 1000,
                refetchOnWindowFocus: false,
                refetchOnReconnect: false,
                queryFn: async () => {
                    if (!projectId || !revisionId) return null
                    return variantConfigBatchFetcher({projectId, revisionId})
                },
            }
        }),
    (a, b) => a.projectId === b.projectId && a.revisionId === b.revisionId,
)

export const evaluatorReferenceAtomFamily = atomFamily(
    ({projectId, slug, id}: {projectId: string | null; slug?: string | null; id?: string | null}) =>
        atomWithQuery<EvaluatorReference | null>(() => {
            return {
                queryKey: [
                    "evaluation-runs-table",
                    "evaluator-ref",
                    projectId ?? "none",
                    slug ?? "none",
                    id ?? "none",
                ],
                enabled: Boolean(projectId && (slug || id)),
                staleTime: 60_000,
                gcTime: 5 * 60 * 1000,
                refetchOnWindowFocus: false,
                refetchOnReconnect: false,
                queryFn: async () => {
                    if (!projectId || (!slug && !id)) return null
                    return evaluatorReferenceBatchFetcher({projectId, slug, id})
                },
            }
        }),
    (a, b) => a.projectId === b.projectId && a.slug === b.slug && a.id === b.id,
)

// ─────────────────────────────────────────────────────────────────────────────
// Environment Reference
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

interface EnvironmentReferenceRequest {
    projectId: string
    applicationId?: string | null
    environmentId?: string | null
    environmentSlug?: string | null
}

const environmentReferenceBatchFetcher = createBatchFetcher<
    EnvironmentReferenceRequest,
    EnvironmentReference | null,
    Map<string, EnvironmentReference | null>
>({
    serializeKey: ({projectId, applicationId, environmentId, environmentSlug}) =>
        [
            projectId ?? "none",
            applicationId ?? "none",
            environmentId ?? "none",
            environmentSlug ?? "none",
        ].join(":"),
    batchFn: async (requests, serializedKeys) => {
        const results = new Map<string, EnvironmentReference | null>()
        const grouped = new Map<
            string,
            {
                projectId: string
                appId: string
                entries: {
                    key: string
                    environmentId?: string | null
                    environmentSlug?: string | null
                }[]
            }
        >()

        requests.forEach((request, index) => {
            const serializedKey = serializedKeys[index]
            const {projectId, applicationId, environmentId, environmentSlug} = request
            if (!projectId || !applicationId || (!environmentId && !environmentSlug)) {
                results.set(serializedKey, null)
                return
            }
            const groupKey = `${projectId}:${applicationId}`
            const existing = grouped.get(groupKey)
            const entry = {key: serializedKey, environmentId, environmentSlug}
            if (existing) {
                existing.entries.push(entry)
            } else {
                grouped.set(groupKey, {
                    projectId,
                    appId: applicationId,
                    entries: [entry],
                })
            }
        })

        await Promise.all(
            Array.from(grouped.values()).map(async ({projectId, appId, entries}) => {
                try {
                    const response = await axios.get(
                        `/apps/${encodeURIComponent(appId)}/environments`,
                        {params: {project_id: projectId}, _ignoreError: true} as any,
                    )
                    const list: any[] = Array.isArray(response?.data) ? response.data : []
                    const normalized = list.map((item: any) => {
                        const slug =
                            typeof item?.slug === "string" && item.slug.trim().length
                                ? item.slug
                                : (item?.name ?? null)
                        const name =
                            typeof item?.name === "string" && item.name.trim().length
                                ? item.name
                                : slug
                        return {
                            id: item?.id ?? null,
                            slug,
                            name,
                            appId: item?.app_id ?? appId ?? null,
                            deployedAppVariantId: item?.deployed_app_variant_id ?? null,
                            deployedVariantName: item?.deployed_variant_name ?? null,
                            deployedAppVariantRevisionId:
                                item?.deployed_app_variant_revision_id ?? null,
                            revision: item?.revision ?? null,
                        } satisfies EnvironmentReference
                    })

                    entries.forEach(({key, environmentId, environmentSlug}) => {
                        const match =
                            normalized.find(
                                (env) =>
                                    (environmentId && env.id === environmentId) ||
                                    (environmentSlug &&
                                        (env.slug === environmentSlug ||
                                            env.name === environmentSlug)),
                            ) ??
                            (environmentId
                                ? normalized.find((env) => env.id === environmentId)
                                : undefined)

                        results.set(
                            key,
                            match ?? {
                                id: environmentId ?? null,
                                slug: environmentSlug ?? null,
                                name: environmentSlug ?? environmentId ?? null,
                                appId: appId ?? null,
                                deployedAppVariantId: null,
                                deployedVariantName: null,
                                deployedAppVariantRevisionId: null,
                                revision: null,
                            },
                        )
                    })
                } catch (error) {
                    console.warn("[References] failed to batch fetch environment references", {
                        projectId,
                        appId,
                        error,
                    })
                    entries.forEach(({key, environmentId, environmentSlug}) => {
                        results.set(key, {
                            id: environmentId ?? null,
                            slug: environmentSlug ?? null,
                            name: environmentSlug ?? environmentId ?? null,
                            appId,
                            deployedAppVariantId: null,
                            deployedVariantName: null,
                            deployedAppVariantRevisionId: null,
                            revision: null,
                        })
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
            id: request.environmentId ?? null,
            slug: request.environmentSlug ?? null,
            name: request.environmentSlug ?? request.environmentId ?? null,
            appId: request.applicationId ?? null,
            deployedAppVariantId: null,
            deployedVariantName: null,
            deployedAppVariantRevisionId: null,
            revision: null,
        }
    },
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
        atomWithQuery<EnvironmentReference | null>(() => {
            return {
                queryKey: [
                    "references",
                    "environment-ref",
                    projectId ?? "none",
                    applicationId ?? "none",
                    environmentId ?? "none",
                    environmentSlug ?? "none",
                ],
                enabled: Boolean(projectId && (environmentId || environmentSlug)),
                staleTime: 60_000,
                gcTime: 5 * 60 * 1000,
                refetchOnWindowFocus: false,
                refetchOnReconnect: false,
                queryFn: async () => {
                    if (!projectId || (!environmentId && !environmentSlug)) return null
                    if (!applicationId) {
                        return {
                            id: environmentId ?? null,
                            slug: environmentSlug ?? null,
                            name: environmentSlug ?? environmentId ?? null,
                            appId: null,
                            deployedAppVariantId: null,
                            deployedVariantName: null,
                            deployedAppVariantRevisionId: null,
                            revision: null,
                        } satisfies EnvironmentReference
                    }
                    return environmentReferenceBatchFetcher({
                        projectId,
                        applicationId,
                        environmentId: environmentId ?? null,
                        environmentSlug: environmentSlug ?? null,
                    })
                },
            }
        }),
    (a, b) =>
        a.projectId === b.projectId &&
        a.applicationId === b.applicationId &&
        a.environmentId === b.environmentId &&
        a.environmentSlug === b.environmentSlug,
)

// ─────────────────────────────────────────────────────────────────────────────
// Query Reference
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
