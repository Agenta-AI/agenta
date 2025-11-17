import {atom} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {uuidToTraceId, uuidToSpanId} from "@/oss/lib/hooks/useAnnotations/assets/helpers"
import {transformApiData} from "@/oss/lib/hooks/useAnnotations/assets/transformer"
import type {AnnotationDto} from "@/oss/lib/hooks/useAnnotations/types"
import {getProjectValues} from "@/oss/state/project"
import createBatchFetcher, {BatchFetcher} from "@/oss/state/utils/createBatchFetcher"
import {workspaceMembersAtom} from "@/oss/state/workspace/atoms/selectors"

import {activeEvaluationRunIdAtom} from "./previewRun"

const annotationBatcherCache = new Map<string, BatchFetcher<string, AnnotationDto | null>>()

const normalizeTraceKey = (traceId: string) => {
    const hex = uuidToTraceId(traceId)
    if (hex) return hex
    return traceId.replace(/-/g, "")
}

export const evaluationAnnotationBatcherAtom = atom((get) => {
    const runId = get(activeEvaluationRunIdAtom)
    const members = get(workspaceMembersAtom)
    const {projectId} = getProjectValues()
    if (!projectId) return null

    const membersCacheKey = members.map((member) => member.user?.id ?? "").join("|")
    const cacheKey = `${projectId}:${runId ?? "preview"}:${membersCacheKey}`

    let batcher = annotationBatcherCache.get(cacheKey)
    if (!batcher) {
        annotationBatcherCache.clear()
        batcher = createBatchFetcher<string, AnnotationDto | null>({
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

                    const annotationMap = new Map<string, AnnotationDto>()
                    rawAnnotations.forEach((raw: any) => {
                        const transformed = transformApiData({data: raw, members})
                        const traceKey =
                            transformed?.links?.invocation?.trace_id ?? transformed?.trace_id
                        if (!traceKey) return
                        annotationMap.set(traceKey, transformed)
                    })

                    const result: Record<string, AnnotationDto | null> = {}
                    unique.forEach((traceId) => {
                        const normalizedKey = normalizeTraceKey(traceId)
                        result[traceId] = annotationMap.get(normalizedKey) ?? null
                    })

                    return result
                } catch (error) {
                    console.error("[evaluationAnnotationBatcher] fetch error", error)
                    throw error
                }
            },
        })
        annotationBatcherCache.set(cacheKey, batcher)
    }

    return batcher
})

export const evaluationAnnotationQueryAtomFamily = atomFamily((traceId: string) =>
    atomWithQuery<AnnotationDto | null>((get) => {
        const batcher = get(evaluationAnnotationBatcherAtom)
        const {projectId} = getProjectValues()
        const runId = get(activeEvaluationRunIdAtom)

        return {
            queryKey: ["preview", "evaluation-annotation", runId, projectId, traceId],
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
                return value ?? null
            },
        }
    }),
)
