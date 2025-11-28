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
                    serializeKey: (key) => key,
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

                            const annotationMap = new Map<string, AnnotationDto[]>()
                            const addToMap = (key: string, annotation: AnnotationDto) => {
                                const normalizedKey = normalizeTraceKey(key)
                                // Add to both original and normalized keys
                                for (const k of [key, normalizedKey]) {
                                    if (!annotationMap.has(k)) {
                                        annotationMap.set(k, [])
                                    }
                                    annotationMap.get(k)!.push(annotation)
                                }
                            }

                            rawAnnotations.forEach((raw: any) => {
                                const transformed = transformApiData({data: raw, members})

                                // Extract trace_ids from all link entries (links have dynamic keys)
                                const links = transformed?.links ?? raw?.links ?? {}
                                const linkTraceIds: string[] = []
                                Object.values(links).forEach((link: any) => {
                                    if (link?.trace_id) {
                                        linkTraceIds.push(link.trace_id)
                                    }
                                })

                                // Also include the annotation's own trace_id as fallback
                                const ownTraceId = transformed?.trace_id ?? raw?.trace_id
                                if (ownTraceId) {
                                    linkTraceIds.push(ownTraceId)
                                }

                                // Store annotation under all associated trace_ids
                                linkTraceIds.forEach((traceId) => {
                                    addToMap(traceId, transformed)
                                })

                                console.log("[ANNOTATE_DEBUG] Annotation indexed:", {
                                    evaluatorSlug: transformed?.references?.evaluator?.slug,
                                    linkTraceIds,
                                    ownTraceId,
                                })
                            })

                            const result: Record<string, AnnotationDto[] | null> = {}
                            unique.forEach((traceId) => {
                                const normalizedKey = normalizeTraceKey(traceId)
                                const annotations =
                                    annotationMap.get(normalizedKey) ??
                                    annotationMap.get(traceId) ??
                                    null
                                console.log("[ANNOTATE_DEBUG] Looking up annotations:", {
                                    inputTraceId: traceId,
                                    normalizedKey,
                                    foundCount: annotations?.length ?? 0,
                                    mapKeys: Array.from(annotationMap.keys()),
                                })
                                result[traceId] = annotations
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

export const evaluationAnnotationBatcherAtom = atom((get) =>
    get(evaluationAnnotationBatcherFamily()),
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
