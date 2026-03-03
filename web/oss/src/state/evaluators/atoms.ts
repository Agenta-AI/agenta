import {atom} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {getMetricsFromEvaluator} from "@/oss/components/SharedDrawers/AnnotateDrawer/assets/transforms"
import axios from "@/oss/lib/api/assets/axiosConfig"
import {evaluatorsAtom} from "@/oss/lib/atoms/evaluation"
import {extractEvaluatorKeyFromUri} from "@/oss/lib/evaluators/utils"
import {transformApiData} from "@/oss/lib/hooks/useAnnotations/assets/transformer"
import {
    EvaluatorDto,
    EvaluatorPreviewDto,
    EvaluatorRevisionDto,
    EvaluatorRevisionsResponseDto,
    EvaluatorsResponseDto,
} from "@/oss/lib/hooks/useEvaluators/types"
import {Evaluator, SimpleEvaluator} from "@/oss/lib/Types"
import {fetchAllEvaluatorConfigs, fetchAllEvaluators} from "@/oss/services/evaluators"
import {selectedAppIdAtom} from "@/oss/state/app"
import {selectedOrgAtom} from "@/oss/state/org"
import {userAtom} from "@/oss/state/profile"
import {projectIdAtom} from "@/oss/state/project"

import {NO_APP_KEY, NO_PROJECT_KEY} from "./constant"
import {parseQueries} from "./parse"
import {EvaluatorConfigsParams, EvaluatorsParams} from "./types"

const extractKeyFromUri = (uri: unknown): string | undefined => {
    if (typeof uri !== "string") return undefined
    return (
        extractEvaluatorKeyFromUri(uri) ||
        uri.match(/[:/](auto_[a-z0-9_]+)/i)?.[1] ||
        uri
            .split(":")
            .filter(Boolean)
            .slice(-1)[0]
            ?.replace(/-v\d+$/i, "")
    )
}

const isPlainObject = (value: unknown): value is Record<string, any> => {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

const mergePlainObjects = (primary: any, fallback: any): any => {
    if (isPlainObject(primary) && isPlainObject(fallback)) {
        const result: Record<string, any> = {...fallback}
        Object.entries(primary).forEach(([key, value]) => {
            result[key] = mergePlainObjects(value, fallback[key])
        })
        return result
    }

    if (primary === undefined || primary === null) {
        return isPlainObject(fallback) ? {...fallback} : fallback
    }

    return primary
}

const normalizeTags = (candidate: unknown): string[] => {
    if (!candidate) return []
    if (Array.isArray(candidate)) {
        return candidate
            .map((value) => (typeof value === "string" ? value.trim() : String(value)))
            .filter(Boolean)
    }
    if (typeof candidate === "object") {
        return Object.entries(candidate as Record<string, unknown>)
            .filter(([, value]) => Boolean(value))
            .map(([key]) => key.trim())
            .filter(Boolean)
    }
    if (typeof candidate === "string") {
        const trimmed = candidate.trim()
        return trimmed ? [trimmed] : []
    }
    return []
}

const mergeTags = (...sources: unknown[]): string[] => {
    const set = new Set<string>()
    sources.forEach((source) => {
        normalizeTags(source).forEach((tag) => set.add(tag))
    })
    return Array.from(set)
}

const extractRequiresLlmApiKeys = (source: unknown): boolean | undefined => {
    if (!source || typeof source !== "object") return undefined
    const direct = (source as any).requires_llm_api_keys
    if (direct !== undefined) return Boolean(direct)

    const fromFlags = (source as any).flags?.requires_llm_api_keys
    if (fromFlags !== undefined) return Boolean(fromFlags)

    const fromMeta = (source as any).meta?.requires_llm_api_keys
    if (fromMeta !== undefined) return Boolean(fromMeta)

    return undefined
}

export const evaluatorConfigsQueryAtomFamily = atomFamily(
    ({projectId: overrideProjectId, appId: overrideAppId, preview}: EvaluatorConfigsParams = {}) =>
        atomWithQuery<SimpleEvaluator[]>((get) => {
            const projectId = overrideProjectId || get(projectIdAtom)
            const appId = overrideAppId || get(selectedAppIdAtom)
            const user = get(userAtom) as {id?: string} | null

            const enabled = !preview && Boolean(projectId && user?.id)
            const projectKey = projectId || NO_PROJECT_KEY
            const appKey = appId || NO_APP_KEY

            return {
                queryKey: [
                    "evaluator-configs",
                    preview ? "preview" : "regular",
                    projectKey,
                    appKey,
                ] as const,
                queryFn: async () => fetchAllEvaluatorConfigs(appId, projectId),
                staleTime: 60_000,
                refetchOnWindowFocus: false,
                refetchOnReconnect: false,
                refetchOnMount: false,
                retry: false,
                enabled,
            }
        }),
)

export const evaluatorsQueryAtomFamily = atomFamily(
    ({projectId: overrideProjectId, preview, queriesKey}: EvaluatorsParams) =>
        atomWithQuery<Evaluator[] | EvaluatorPreviewDto[]>((get) => {
            const projectId = overrideProjectId ?? get(projectIdAtom)
            const user = get(userAtom) as {id?: string} | null
            const selectedOrg = get(selectedOrgAtom)
            const members = selectedOrg?.default_workspace?.members ?? []
            const projectKey = projectId ?? NO_PROJECT_KEY

            const enabled = Boolean(projectId && user?.id)
            const queryKey = preview
                ? (["evaluators", "preview", projectKey, queriesKey] as const)
                : (["evaluators", projectKey] as const)

            return {
                queryKey,
                queryFn: async () => {
                    if (preview) {
                        if (!projectId) return []
                        const flags = parseQueries(queriesKey)
                        const requestBody = flags
                            ? {
                                  evaluator: {flags},
                              }
                            : {}

                        const response = await axios.post<EvaluatorsResponseDto>(
                            `/preview/simple/evaluators/query?project_id=${projectId}`,
                            requestBody,
                        )
                        let evaluators = (response?.data?.evaluators ?? []).map((item) => {
                            const transformed = transformApiData<EvaluatorDto>({
                                data: item,
                                members,
                            })

                            const tags = mergeTags(item?.tags, transformed?.tags)

                            const rawKey =
                                item?.flags?.evaluator_key ??
                                item?.meta?.evaluator_key ??
                                item?.key ??
                                transformed?.key ??
                                undefined
                            const derivedKey =
                                typeof rawKey === "string" && rawKey.trim()
                                    ? rawKey.trim()
                                    : extractKeyFromUri(
                                          (item as any)?.data?.uri ||
                                              (item as any)?.data?.service?.uri,
                                      )
                            const requiresLlmApiKeys =
                                extractRequiresLlmApiKeys(item) ??
                                extractRequiresLlmApiKeys(transformed) ??
                                false

                            return {
                                ...transformed,
                                tags,
                                key: derivedKey,
                                requires_llm_api_keys: Boolean(requiresLlmApiKeys),
                                metrics: getMetricsFromEvaluator(transformed as EvaluatorDto),
                            }
                        }) as EvaluatorPreviewDto[]

                        if (evaluators.length) {
                            const revisionRefs = evaluators
                                .map((ev) => {
                                    const version =
                                        (ev as any)?.version ??
                                        (ev.meta as any)?.version ??
                                        undefined
                                    const ref = {
                                        id: ev.id,
                                        slug: ev.slug,
                                        version,
                                    }
                                    if (ref.id || ref.slug || ref.version) return ref
                                    return null
                                })
                                .filter(Boolean) as {
                                id?: string
                                slug?: string
                                version?: string
                            }[]

                            if (revisionRefs.length) {
                                try {
                                    const revisionResponse =
                                        await axios.post<EvaluatorRevisionsResponseDto>(
                                            `/preview/evaluators/revisions/query?project_id=${projectId}`,
                                            {
                                                evaluator_refs: revisionRefs,
                                            },
                                        )

                                    const revisions =
                                        revisionResponse?.data?.evaluator_revisions ?? []

                                    if (revisions.length) {
                                        const byEvaluatorId = new Map<
                                            string,
                                            EvaluatorRevisionDto
                                        >()
                                        const bySlug = new Map<string, EvaluatorRevisionDto>()
                                        const byRevisionId = new Map<string, EvaluatorRevisionDto>()

                                        revisions.forEach((revision) => {
                                            if (revision.evaluator_id) {
                                                byEvaluatorId.set(revision.evaluator_id, revision)
                                            }
                                            if (revision.slug) {
                                                bySlug.set(revision.slug, revision)
                                            }
                                            if (revision.id) {
                                                byRevisionId.set(revision.id, revision)
                                            }
                                        })

                                        evaluators = evaluators.map((ev) => {
                                            const revision =
                                                (ev.id && byEvaluatorId.get(ev.id)) ||
                                                (ev.slug && bySlug.get(ev.slug)) ||
                                                (typeof ev.meta?.evaluator_revision_id ===
                                                    "string" &&
                                                    byRevisionId.get(
                                                        ev.meta.evaluator_revision_id,
                                                    )) ||
                                                undefined

                                            if (!revision) return ev

                                            const mergedData = mergePlainObjects(
                                                ev.data,
                                                revision.data,
                                            )
                                            const mergedFlags = mergePlainObjects(
                                                ev.flags,
                                                revision.flags,
                                            )
                                            const mergedMeta = mergePlainObjects(
                                                ev.meta,
                                                revision.meta,
                                            )
                                            const mergedTags = mergeTags(ev.tags, revision.tags)

                                            const withRevision: EvaluatorPreviewDto = {
                                                ...ev,
                                                data: mergedData,
                                                flags: mergedFlags,
                                                meta: mergedMeta,
                                                tags: mergedTags,
                                                revision,
                                            }

                                            const requiresLlmApiKeys =
                                                extractRequiresLlmApiKeys(withRevision) ??
                                                extractRequiresLlmApiKeys(revision) ??
                                                extractRequiresLlmApiKeys(ev) ??
                                                false

                                            return {
                                                ...withRevision,
                                                requires_llm_api_keys: Boolean(requiresLlmApiKeys),
                                                metrics: getMetricsFromEvaluator(
                                                    withRevision as EvaluatorDto,
                                                ),
                                            }
                                        })
                                    }
                                } catch (error) {
                                    console.warn("Failed to fetch evaluator revisions", error)
                                }
                            }
                        }

                        return evaluators
                    }

                    const data = await fetchAllEvaluators()
                    return data
                },
                staleTime: 60_000,
                refetchOnWindowFocus: false,
                refetchOnReconnect: false,
                refetchOnMount: false,
                retry: false,
                enabled,
            }
        }),
)

/**
 * Derived atom that filters out archived evaluators.
 * Use this instead of filtering locally in components.
 */
export const nonArchivedEvaluatorsAtom = atom((get) => {
    const evaluators = get(evaluatorsAtom)
    return evaluators.filter((item) => (item as any).archived !== true)
})

/**
 * Query atom family that finds an evaluator by key.
 * First checks the regular evaluators list. If not found there,
 * fetches all evaluators including archived ones.
 */
export const evaluatorByKeyAtomFamily = atomFamily((evaluatorKey: string | null) =>
    atomWithQuery<Evaluator | null>((get) => {
        const projectId = get(projectIdAtom)
        const user = get(userAtom) as {id?: string} | null
        const evaluators = get(evaluatorsAtom)

        const foundInRegular = evaluatorKey
            ? evaluators.find((item) => item.key === evaluatorKey)
            : null

        // Only fetch archived if evaluator not found and initial load complete
        const needsArchivedFetch = Boolean(evaluatorKey && !foundInRegular && evaluators.length > 0)

        return {
            queryKey: ["evaluator-by-key", evaluatorKey, "include-archived"] as const,
            queryFn: async () => {
                if (!evaluatorKey) return null
                const all = await fetchAllEvaluators(true)
                return all.find((item) => item.key === evaluatorKey) ?? null
            },
            staleTime: 60_000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            refetchOnMount: false,
            retry: false,
            enabled: needsArchivedFetch && Boolean(projectId && user?.id),
            placeholderData: foundInRegular ?? undefined,
        }
    }),
)
