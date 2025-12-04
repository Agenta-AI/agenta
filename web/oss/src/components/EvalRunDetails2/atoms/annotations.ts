import {atom} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {transformApiData} from "@/oss/lib/hooks/useAnnotations/assets/transformer"
import type {AnnotationDto} from "@/oss/lib/hooks/useAnnotations/types"
import {uuidToTraceId, uuidToSpanId} from "@/oss/lib/traces/helpers"
import {getProjectValues} from "@/oss/state/project"
import createBatchFetcher, {BatchFetcher} from "@/oss/state/utils/createBatchFetcher"
import {workspaceMembersAtom} from "@/oss/state/workspace/atoms/selectors"

import {activePreviewRunIdAtom, effectiveProjectIdAtom} from "./run"

const annotationBatcherCache = new Map<string, BatchFetcher<string, AnnotationDto[] | null>>()

/**
 * Invalidate the annotation batcher cache.
 * Call this after creating/updating annotations to force a fresh fetch.
 */
export const invalidateAnnotationBatcherCache = () => {
    annotationBatcherCache.clear()
}

const normalizeTraceKey = (traceId: string) => {
    const hex = uuidToTraceId(traceId)
    if (hex) return hex
    return traceId.replace(/-/g, "")
}

const resolveEffectiveRunId = (get: any, runId?: string | null) =>
    runId ?? get(activePreviewRunIdAtom) ?? undefined

export const evaluationAnnotationBatcherFamily = atomFamily(
    ({runId}: {runId?: string | null} = {}) =>
        atom((get) => {
            const effectiveRunId = resolveEffectiveRunId(get, runId)
            const members = get(workspaceMembersAtom)
            const {projectId: globalProjectId} = getProjectValues()
            const projectId = globalProjectId ?? get(effectiveProjectIdAtom)
            if (!projectId) return null

            const membersCacheKey = members.map((member) => member.user?.id ?? "").join("|")
            const cacheKey = `${projectId}:${effectiveRunId ?? "preview"}:${membersCacheKey}`

            let batcher = annotationBatcherCache.get(cacheKey)
            if (!batcher) {
                annotationBatcherCache.clear()
                batcher = createBatchFetcher<string, AnnotationDto[] | null>({
                    // Normalize trace_id for consistent caching (UUID with dashes -> hex)
                    serializeKey: (key) => normalizeTraceKey(key),
                    batchFn: async (traceIds) => {
                        const unique = Array.from(new Set(traceIds.filter(Boolean)))
                        if (!unique.length) {
                            return {}
                        }

                        const annotationLinks = unique.map((traceId) => ({
                            trace_id: normalizeTraceKey(traceId),
                            span_id: uuidToSpanId(traceId) ?? undefined,
                        }))

                        try {
                            const response = await axios.post(
                                `/preview/annotations/query`,
                                {annotation_links: annotationLinks},
                                {
                                    params: {project_id: projectId},
                                },
                            )

                            const rawAnnotations = Array.isArray(response.data?.annotations)
                                ? response.data.annotations
                                : []

                            // Map normalized trace_id -> annotations (use Set to avoid duplicates)
                            const annotationMap = new Map<string, Set<AnnotationDto>>()
                            const addToMap = (key: string, annotation: AnnotationDto) => {
                                // Always use normalized key for consistency
                                const normalizedKey = normalizeTraceKey(key)
                                if (!annotationMap.has(normalizedKey)) {
                                    annotationMap.set(normalizedKey, new Set())
                                }
                                annotationMap.get(normalizedKey)!.add(annotation)
                            }

                            rawAnnotations.forEach((raw: any) => {
                                const transformed = transformApiData({data: raw, members})

                                // Extract trace_ids from all link entries (links have dynamic keys)
                                const links = transformed?.links ?? raw?.links ?? {}
                                Object.values(links).forEach((link: any) => {
                                    if (link?.trace_id) {
                                        addToMap(link.trace_id, transformed)
                                    }
                                })

                                // Also include the annotation's own trace_id as fallback
                                const ownTraceId = transformed?.trace_id ?? raw?.trace_id
                                if (ownTraceId) {
                                    addToMap(ownTraceId, transformed)
                                }
                            })

                            const result: Record<string, AnnotationDto[] | null> = {}
                            unique.forEach((traceId) => {
                                const normalizedKey = normalizeTraceKey(traceId)
                                const annotationSet = annotationMap.get(normalizedKey)
                                // Key by BOTH original and normalized to ensure lookup works
                                const annotations = annotationSet ? Array.from(annotationSet) : null
                                result[traceId] = annotations
                                result[normalizedKey] = annotations
                            })

                            return result
                        } catch (error) {
                            throw error
                        }
                    },
                })
                annotationBatcherCache.set(cacheKey, batcher)
            }

            return batcher
        }),
)

export const evaluationAnnotationQueryAtomFamily = atomFamily(
    ({traceId, runId}: {traceId: string; runId?: string | null}) =>
        atomWithQuery<AnnotationDto[]>((get) => {
            const batcher = get(evaluationAnnotationBatcherFamily({runId}))
            const {projectId: globalProjectId} = getProjectValues()
            const projectId = globalProjectId ?? get(effectiveProjectIdAtom)
            const effectiveRunId = resolveEffectiveRunId(get, runId)

            return {
                queryKey: ["preview", "evaluation-annotation", effectiveRunId, projectId, traceId],
                enabled: Boolean(projectId && batcher && traceId),
                staleTime: 30_000,
                gcTime: 5 * 60 * 1000,
                refetchOnWindowFocus: false,
                refetchOnReconnect: false,
                queryFn: async () => {
                    if (!batcher) {
                        throw new Error("Annotation batcher is not initialised")
                    }
                    const value = await batcher(traceId)
                    return value ?? []
                },
            }
        }),
)

export const scenarioAnnotationsQueryAtomFamily = atomFamily(
    ({traceIds, runId}: {traceIds: string[]; runId?: string | null}) =>
        atomWithQuery<AnnotationDto[]>((get) => {
            const batcher = get(evaluationAnnotationBatcherFamily({runId}))
            const {projectId: globalProjectId} = getProjectValues()
            const projectId = globalProjectId ?? get(effectiveProjectIdAtom)
            const effectiveRunId = resolveEffectiveRunId(get, runId)
            const uniqueTraceIds = Array.from(new Set(traceIds.filter(Boolean)))

            return {
                queryKey: [
                    "preview",
                    "scenario-annotations",
                    effectiveRunId,
                    projectId,
                    uniqueTraceIds.join("|"),
                ],
                enabled: Boolean(projectId && batcher && uniqueTraceIds.length),
                staleTime: 30_000,
                gcTime: 5 * 60 * 1000,
                refetchOnWindowFocus: false,
                refetchOnReconnect: false,
                queryFn: async () => {
                    if (!batcher || uniqueTraceIds.length === 0) return []
                    const results = await Promise.all(uniqueTraceIds.map((id) => batcher(id)))
                    // Flatten arrays of annotations from each trace
                    return results.flatMap((arr) => arr ?? [])
                },
            }
        }),
)
