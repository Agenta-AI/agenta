import {atomFamily, selectAtom} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
import createBatchFetcher from "@/oss/state/utils/createBatchFetcher"

import type {
    QueryFilteringPayload,
    QueryWindowingPayload,
} from "../../../services/onlineEvaluations/api"

import {effectiveProjectIdAtom} from "./run"
import type {EvaluationRunQueryResult} from "./table/run"
import {evaluationRunQueryAtomFamily} from "./table/run"

const QUERY_REFERENCE_KEYS = {
    query: ["query", "query_ref", "queryRef"],
    queryRevision: [
        "query_revision",
        "query_revision_ref",
        "queryRevision",
        "queryRevisionRef",
        "query_revision_reference",
    ],
    queryVariant: ["query_variant", "queryVariant", "query_variant_ref", "queryVariantRef"],
} as const

const toOptionalString = (value: unknown): string | undefined => {
    if (value === null || value === undefined) return undefined
    const str = String(value).trim()
    return str ? str : undefined
}

const toOptionalNumber = (value: unknown): number | null | undefined => {
    if (value === null || value === undefined) return undefined
    if (typeof value === "number") {
        return Number.isNaN(value) ? undefined : value
    }
    if (typeof value === "string") {
        const parsed = Number(value)
        if (!Number.isNaN(parsed)) return parsed
    }
    return undefined
}

type ReferenceLike = Record<string, unknown> | null | undefined

const pickReference = (refs: Record<string, any>, keys: readonly string[]): ReferenceLike => {
    for (const key of keys) {
        const value = refs?.[key]
        if (value) {
            return value as ReferenceLike
        }
    }
    return undefined
}

export interface EvaluationQueryReference {
    queryId?: string
    querySlug?: string
    queryRevisionId?: string
    queryRevisionSlug?: string
    queryRevisionVersion?: number | null
    queryVariantId?: string
    queryVariantSlug?: string
}

const EMPTY_REFERENCE: EvaluationQueryReference = {}

const normalizeQueryReference = (runQuery: EvaluationRunQueryResult | undefined) => {
    if (!runQuery?.runIndex) {
        return EMPTY_REFERENCE
    }

    let queryRef: ReferenceLike
    let queryRevisionRef: ReferenceLike
    let queryVariantRef: ReferenceLike

    for (const meta of Object.values(runQuery.runIndex.steps)) {
        const refs = meta?.refs ?? {}
        if (!queryRef) queryRef = pickReference(refs, QUERY_REFERENCE_KEYS.query)
        if (!queryRevisionRef)
            queryRevisionRef = pickReference(refs, QUERY_REFERENCE_KEYS.queryRevision)
        if (!queryVariantRef)
            queryVariantRef = pickReference(refs, QUERY_REFERENCE_KEYS.queryVariant)
        if (queryRef && queryRevisionRef && queryVariantRef) {
            break
        }
    }

    const normalized: EvaluationQueryReference = {}

    if (queryRef && typeof queryRef === "object") {
        normalized.queryId = toOptionalString(queryRef.id)
        normalized.querySlug = toOptionalString(queryRef.slug)
    }

    if (queryVariantRef && typeof queryVariantRef === "object") {
        normalized.queryVariantId = toOptionalString(queryVariantRef.id)
        normalized.queryVariantSlug = toOptionalString(queryVariantRef.slug)
    }

    if (queryRevisionRef && typeof queryRevisionRef === "object") {
        normalized.queryRevisionId = toOptionalString(queryRevisionRef.id)
        normalized.queryRevisionSlug = toOptionalString(queryRevisionRef.slug)
        const versionValue =
            queryRevisionRef.version ??
            queryRevisionRef.revision ??
            queryRevisionRef.revision_id ??
            queryRevisionRef.revisionId
        const versionNumber = toOptionalNumber(versionValue)
        if (versionNumber !== undefined) {
            normalized.queryRevisionVersion = versionNumber
        } else if (versionValue === null) {
            normalized.queryRevisionVersion = null
        }
    }

    return normalized
}

const areReferencesEqual = (a: EvaluationQueryReference, b: EvaluationQueryReference): boolean => {
    return (
        a.queryId === b.queryId &&
        a.querySlug === b.querySlug &&
        a.queryRevisionId === b.queryRevisionId &&
        a.queryRevisionSlug === b.queryRevisionSlug &&
        a.queryVariantId === b.queryVariantId &&
        a.queryVariantSlug === b.queryVariantSlug &&
        a.queryRevisionVersion === b.queryRevisionVersion
    )
}

export const evaluationQueryReferenceAtomFamily = atomFamily((runId: string | null) =>
    selectAtom(
        evaluationRunQueryAtomFamily(runId),
        (query) => normalizeQueryReference(query.data),
        areReferencesEqual,
    ),
)

export interface EvaluationQueryRevisionSnapshot {
    id?: string
    slug?: string
    variantId?: string
    version?: number | string | null
    filtering?: QueryFilteringPayload
    windowing?: QueryWindowingPayload
    data?: Record<string, unknown> | null
}

export interface EvaluationQueryConfigurationResult {
    reference: EvaluationQueryReference
    revision: EvaluationQueryRevisionSnapshot | null
}

const normalizeQueryRevisionSnapshot = (
    rawRevision: any,
): EvaluationQueryRevisionSnapshot | null => {
    if (!rawRevision || typeof rawRevision !== "object") {
        return null
    }

    const versionValue =
        rawRevision?.version ?? rawRevision?.revision ?? rawRevision?.revision_id ?? null

    return {
        id: toOptionalString(rawRevision?.id),
        slug: toOptionalString(rawRevision?.slug),
        variantId: toOptionalString(rawRevision?.variant_id ?? rawRevision?.query_variant_id),
        version:
            typeof versionValue === "number" || typeof versionValue === "string"
                ? versionValue
                : versionValue === null
                  ? null
                  : undefined,
        filtering:
            rawRevision?.data && typeof rawRevision.data === "object"
                ? rawRevision.data?.filtering
                : undefined,
        windowing:
            rawRevision?.data && typeof rawRevision.data === "object"
                ? rawRevision.data?.windowing
                : undefined,
        data: rawRevision?.data && typeof rawRevision.data === "object" ? rawRevision.data : null,
    }
}

const hasLookupValue = (reference: EvaluationQueryReference) =>
    Boolean(
        reference.queryRevisionId ||
            reference.queryRevisionSlug ||
            reference.queryVariantId ||
            reference.queryVariantSlug ||
            reference.queryId ||
            reference.querySlug,
    )

type ReferenceDescriptor =
    | {
          type: "revision"
          id: string | null
          slug: string | null
      }
    | {
          type: "variant"
          id: string | null
          slug: string | null
          version: number | string | null | undefined
      }
    | {
          type: "query"
          id: string | null
          slug: string | null
      }

const buildReferenceDescriptor = (
    reference: EvaluationQueryReference,
): ReferenceDescriptor | null => {
    if (reference.queryRevisionId || reference.queryRevisionSlug) {
        return {
            type: "revision",
            id: reference.queryRevisionId ?? null,
            slug: reference.queryRevisionSlug ?? null,
        }
    }

    if (reference.queryVariantId || reference.queryVariantSlug) {
        return {
            type: "variant",
            id: reference.queryVariantId ?? null,
            slug: reference.queryVariantSlug ?? null,
            version: reference.queryRevisionVersion,
        }
    }

    if (reference.queryId || reference.querySlug) {
        return {
            type: "query",
            id: reference.queryId ?? null,
            slug: reference.querySlug ?? null,
        }
    }

    return null
}

const descriptorKey = (descriptor: ReferenceDescriptor) => {
    const parts = [descriptor.type]
    if (descriptor.id) parts.push(`id:${descriptor.id}`)
    if (descriptor.slug) parts.push(`slug:${descriptor.slug}`)
    if ("version" in descriptor && descriptor.version !== undefined) {
        parts.push(`version:${descriptor.version === null ? "null" : descriptor.version}`)
    }
    return parts.join("|")
}

interface ReferencePayload {
    id?: string | null
    slug?: string | null
    version?: number | string | null
}

const toReferencePayload = (descriptor: ReferenceDescriptor): ReferencePayload | null => {
    const payload: ReferencePayload = {}
    if (descriptor.id) payload.id = descriptor.id
    if (descriptor.slug) payload.slug = descriptor.slug
    if ("version" in descriptor && descriptor.version !== undefined) {
        payload.version = descriptor.version
    }

    return Object.keys(payload).length ? payload : null
}

const toVersionKey = (key: string, version: number | string | null | undefined) => {
    if (version === undefined || version === null) return null
    return `${key}::${String(version)}`
}

interface QueryRevisionBatchRequest {
    projectId: string
    runId: string
    reference: EvaluationQueryReference
}

const evaluationQueryRevisionBatchFetcher = createBatchFetcher<
    QueryRevisionBatchRequest,
    EvaluationQueryConfigurationResult | null,
    Map<string, EvaluationQueryConfigurationResult | null>
>({
    serializeKey: ({projectId, runId}) => `${projectId ?? "none"}::${runId ?? "none"}`,
    batchFn: async (requests, serializedKeys) => {
        const results = new Map<string, EvaluationQueryConfigurationResult | null>()
        const grouped = new Map<
            string,
            Map<
                string,
                {
                    descriptor: ReferenceDescriptor
                    items: {serializedKey: string; reference: EvaluationQueryReference}[]
                }
            >
        >()

        requests.forEach((request, index) => {
            const serializedKey = serializedKeys[index]
            const {projectId, reference} = request

            if (!projectId) {
                results.set(serializedKey, {reference, revision: null})
                return
            }

            const descriptor = buildReferenceDescriptor(reference)
            if (!descriptor) {
                results.set(serializedKey, {reference, revision: null})
                return
            }

            let projectGroup = grouped.get(projectId)
            if (!projectGroup) {
                projectGroup = new Map()
                grouped.set(projectId, projectGroup)
            }

            const key = descriptorKey(descriptor)
            let entry = projectGroup.get(key)
            if (!entry) {
                entry = {descriptor, items: []}
                projectGroup.set(key, entry)
            }
            entry.items.push({serializedKey, reference})
        })

        await Promise.all(
            Array.from(grouped.entries()).map(async ([projectId, descriptorMap]) => {
                const descriptors = Array.from(descriptorMap.values())
                if (!descriptors.length) return

                const revisionRefs: ReferencePayload[] = []
                const variantRefs: ReferencePayload[] = []
                const queryRefs: ReferencePayload[] = []

                const seenRevision = new Set<string>()
                const seenVariant = new Set<string>()
                const seenQuery = new Set<string>()

                descriptors.forEach(({descriptor}) => {
                    const payload = toReferencePayload(descriptor)
                    if (!payload) return

                    const signature = [
                        payload.id ? `id:${payload.id}` : "",
                        payload.slug ? `slug:${payload.slug}` : "",
                        "version" in payload && payload.version !== undefined
                            ? `version:${payload.version === null ? "null" : payload.version}`
                            : "",
                    ]
                        .filter(Boolean)
                        .join("|")

                    if (descriptor.type === "revision") {
                        if (!seenRevision.has(signature)) {
                            seenRevision.add(signature)
                            revisionRefs.push(payload)
                        }
                    } else if (descriptor.type === "variant") {
                        if (!seenVariant.has(signature)) {
                            seenVariant.add(signature)
                            variantRefs.push(payload)
                        }
                    } else if (descriptor.type === "query") {
                        if (!seenQuery.has(signature)) {
                            seenQuery.add(signature)
                            queryRefs.push(payload)
                        }
                    }
                })

                if (!revisionRefs.length && !variantRefs.length && !queryRefs.length) {
                    descriptors.forEach(({items}) => {
                        items.forEach(({serializedKey, reference}) => {
                            results.set(serializedKey, {reference, revision: null})
                        })
                    })
                    return
                }

                try {
                    const body: Record<string, any> = {
                        include_archived: true,
                        windowing: {
                            order: "descending",
                            limit: Math.max(
                                (revisionRefs.length + variantRefs.length + queryRefs.length) * 4,
                                descriptors.length || 1,
                            ),
                        },
                    }

                    if (revisionRefs.length) body.query_revision_refs = revisionRefs
                    if (variantRefs.length) body.query_variant_refs = variantRefs
                    if (queryRefs.length) body.query_refs = queryRefs

                    const response = await axios.post("/preview/queries/revisions/query", body, {
                        params: {project_id: projectId},
                    })

                    const payload = response?.data ?? {}
                    const list = Array.isArray(payload?.query_revisions)
                        ? payload.query_revisions
                        : Array.isArray(payload)
                          ? payload
                          : []

                    const byRevisionId = new Map<string, EvaluationQueryRevisionSnapshot>()
                    const byRevisionSlug = new Map<string, EvaluationQueryRevisionSnapshot>()
                    const byVariantId = new Map<string, EvaluationQueryRevisionSnapshot>()
                    const byVariantSlug = new Map<string, EvaluationQueryRevisionSnapshot>()
                    const byVariantVersionId = new Map<string, EvaluationQueryRevisionSnapshot>()
                    const byVariantVersionSlug = new Map<string, EvaluationQueryRevisionSnapshot>()
                    const byQueryId = new Map<string, EvaluationQueryRevisionSnapshot>()
                    const byQuerySlug = new Map<string, EvaluationQueryRevisionSnapshot>()

                    list.forEach((rawRevision: any) => {
                        const snapshot = normalizeQueryRevisionSnapshot(rawRevision)
                        if (!snapshot) return

                        const revisionId = toOptionalString(rawRevision?.id)
                        if (revisionId && !byRevisionId.has(revisionId)) {
                            byRevisionId.set(revisionId, snapshot)
                        }

                        const revisionSlug = toOptionalString(rawRevision?.slug)
                        if (revisionSlug && !byRevisionSlug.has(revisionSlug)) {
                            byRevisionSlug.set(revisionSlug, snapshot)
                        }

                        const variantId = toOptionalString(
                            rawRevision?.variant_id ?? rawRevision?.query_variant_id,
                        )
                        const variantSlug = toOptionalString(
                            rawRevision?.variant_slug ?? rawRevision?.query_variant_slug,
                        )

                        const revisionVersion =
                            snapshot.version !== undefined && snapshot.version !== null
                                ? String(snapshot.version)
                                : null

                        if (variantId) {
                            const versionKey = toVersionKey(variantId, revisionVersion)
                            if (!byVariantId.has(variantId)) {
                                byVariantId.set(variantId, snapshot)
                            }
                            if (versionKey && !byVariantVersionId.has(versionKey)) {
                                byVariantVersionId.set(versionKey, snapshot)
                            }
                        }

                        if (variantSlug) {
                            const versionKey = toVersionKey(variantSlug, revisionVersion)
                            if (!byVariantSlug.has(variantSlug)) {
                                byVariantSlug.set(variantSlug, snapshot)
                            }
                            if (versionKey && !byVariantVersionSlug.has(versionKey)) {
                                byVariantVersionSlug.set(versionKey, snapshot)
                            }
                        }

                        const queryId = toOptionalString(
                            rawRevision?.artifact_id ?? rawRevision?.query_id,
                        )
                        if (queryId && !byQueryId.has(queryId)) {
                            byQueryId.set(queryId, snapshot)
                        }

                        const querySlug = toOptionalString(
                            rawRevision?.artifact_slug ?? rawRevision?.query_slug,
                        )
                        if (querySlug && !byQuerySlug.has(querySlug)) {
                            byQuerySlug.set(querySlug, snapshot)
                        }
                    })

                    descriptors.forEach(({descriptor, items}) => {
                        let matched: EvaluationQueryRevisionSnapshot | null = null

                        if (descriptor.type === "revision") {
                            if (descriptor.id) {
                                matched = byRevisionId.get(descriptor.id) ?? null
                            }
                            if (!matched && descriptor.slug) {
                                matched = byRevisionSlug.get(descriptor.slug) ?? null
                            }
                        } else if (descriptor.type === "variant") {
                            const versionValue =
                                descriptor.version !== undefined && descriptor.version !== null
                                    ? String(descriptor.version)
                                    : null
                            if (descriptor.id) {
                                if (versionValue) {
                                    const key = toVersionKey(descriptor.id, versionValue)
                                    matched = (key && byVariantVersionId.get(key)) ?? null
                                }
                                if (!matched) {
                                    matched = byVariantId.get(descriptor.id) ?? null
                                }
                            }
                            if (!matched && descriptor.slug) {
                                if (versionValue) {
                                    const key = toVersionKey(descriptor.slug, versionValue)
                                    matched = (key && byVariantVersionSlug.get(key)) ?? null
                                }
                                if (!matched) {
                                    matched = byVariantSlug.get(descriptor.slug) ?? null
                                }
                            }
                        } else if (descriptor.type === "query") {
                            if (descriptor.id) {
                                matched = byQueryId.get(descriptor.id) ?? null
                            }
                            if (!matched && descriptor.slug) {
                                matched = byQuerySlug.get(descriptor.slug) ?? null
                            }
                        }

                        items.forEach(({serializedKey, reference}) => {
                            results.set(serializedKey, {
                                reference,
                                revision: matched ?? null,
                            })
                        })
                    })
                } catch (error) {
                    console.warn("[EvalRunDetails2] failed to batch fetch query revisions", {
                        projectId,
                        error,
                    })
                    descriptors.forEach(({items}) => {
                        items.forEach(({serializedKey, reference}) => {
                            results.set(serializedKey, {reference, revision: null})
                        })
                    })
                }
            }),
        )

        return results
    },
    resolveResult: (map, request, serializedKey) => {
        const lookup = map as Map<string, EvaluationQueryConfigurationResult | null>
        if (lookup.has(serializedKey)) {
            const value = lookup.get(serializedKey)
            if (value) return value
        }
        return {reference: request.reference, revision: null}
    },
})

const buildReferenceKey = (reference: EvaluationQueryReference) => [
    reference.queryRevisionId ?? null,
    reference.queryRevisionSlug ?? null,
    reference.queryVariantId ?? null,
    reference.queryVariantSlug ?? null,
    reference.queryId ?? null,
    reference.querySlug ?? null,
    reference.queryRevisionVersion ?? null,
]

export const evaluationQueryRevisionAtomFamily = atomFamily((runId: string | null) =>
    atomWithQuery<EvaluationQueryConfigurationResult>((get) => {
        const projectId = get(effectiveProjectIdAtom)
        const reference = runId ? get(evaluationQueryReferenceAtomFamily(runId)) : EMPTY_REFERENCE
        const enabled = Boolean(projectId && runId && hasLookupValue(reference))

        return {
            queryKey: [
                "preview",
                "evaluation",
                "query-revision",
                projectId ?? null,
                runId ?? null,
                ...buildReferenceKey(reference),
            ],
            enabled,
            staleTime: 60_000,
            gcTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            queryFn: async () => {
                if (!projectId || !runId || !enabled) {
                    return {reference, revision: null}
                }

                return evaluationQueryRevisionBatchFetcher({
                    projectId,
                    runId,
                    reference,
                })
            },
        }
    }),
)

export const queryReferenceLookupAtomFamily = atomFamily(
    (reference: EvaluationQueryReference | null | undefined) =>
        atomWithQuery<EvaluationQueryConfigurationResult>((get) => {
            const projectId = get(effectiveProjectIdAtom)
            const normalized = reference ?? EMPTY_REFERENCE
            const enabled = Boolean(projectId && hasLookupValue(normalized))

            return {
                queryKey: [
                    "preview",
                    "query-reference",
                    projectId ?? null,
                    ...buildReferenceKey(normalized),
                ],
                enabled,
                staleTime: 60_000,
                gcTime: 5 * 60 * 1000,
                refetchOnWindowFocus: false,
                refetchOnReconnect: false,
                queryFn: async () => {
                    if (!projectId || !enabled) {
                        return {reference: normalized, revision: null}
                    }
                    return evaluationQueryRevisionBatchFetcher({
                        projectId,
                        runId: null,
                        reference: normalized,
                    })
                },
            }
        }),
)
