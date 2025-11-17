import {atom} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {uuidToTraceId} from "@/oss/lib/helpers/traceUtils"
import type {
    TraceData,
    TraceNode,
    TraceTree,
} from "@/oss/lib/hooks/useEvaluationRunScenarioSteps/types"
import {transformTracesResponseToTree} from "@/oss/services/tracing/lib/helpers"
import type {TraceSpanNode, TracesResponse} from "@/oss/services/tracing/types"
import {getProjectValues} from "@/oss/state/project"
import createBatchFetcher, {BatchFetcher} from "@/oss/state/utils/createBatchFetcher"

import {activeEvaluationRunIdAtom} from "./previewRun"

const traceBatcherCache = new Map<string, BatchFetcher<string, TraceData | null>>()

const toStringOrEmpty = (value: unknown): string => {
    if (value === undefined || value === null) return ""
    return String(value)
}

const convertSpanNodeToTraceNode = (
    span: TraceSpanNode,
    traceId: string,
    flat: TraceNode[],
    parentId?: string,
): TraceNode => {
    const attributes = (span.attributes ?? {}) as Record<string, any>
    const node: TraceNode = {
        trace_id: span.trace_id ?? traceId,
        span_id: span.span_id ?? span.span_name ?? "",
        lifecycle: {
            created_at: toStringOrEmpty((span as any)?.created_at),
        },
        root: {
            id: traceId,
        },
        tree: {
            id: traceId,
        },
        node: {
            id: span.span_id ?? span.span_name ?? "",
            name: span.span_name ?? span.span_id ?? "",
            type: span.span_type ?? span.trace_type ?? "",
        },
        parent: parentId ? {id: parentId} : undefined,
        time: {
            start: toStringOrEmpty(span.start_time),
            end: toStringOrEmpty(span.end_time),
        },
        status: {
            code: span.status_code ?? "",
        },
        data: {
            attributes,
            events: span.events ?? [],
            links: span.links ?? [],
            hashes: span.hashes ?? [],
            references: span.references ?? [],
        },
        metrics: {},
        refs: {},
        otel: {
            kind: span.span_kind ?? "",
            attributes,
        },
    }

    const children = Array.isArray(span.children) ? (span.children as TraceSpanNode[]) : []
    if (children.length) {
        const childMap: Record<string, TraceNode> = {}
        const childList: TraceNode[] = []
        children.forEach((child, index) => {
            const childNode = convertSpanNodeToTraceNode(child, traceId, flat, node.span_id)
            childList.push(childNode)
            const key = childNode.node.id || childNode.span_id || `${node.span_id}-${index}`
            childMap[key] = childNode
        })
        node.nodes = childMap
        ;(node as any).children = childList
    }

    flat.push(node)
    return node
}

const buildTraceDataFromEntry = (
    traceId: string,
    originalTraceId: string,
    traceEntry: {spans: Record<string, any>} | undefined,
    version?: string,
): TraceData | null => {
    if (!traceEntry || !traceEntry.spans || !Object.keys(traceEntry.spans).length) {
        return null
    }

    const scopedResponse: TracesResponse = {
        version,
        count: Object.keys(traceEntry.spans ?? {}).length,
        traces: {
            [traceId]: traceEntry,
        },
    }

    const spanNodes = transformTracesResponseToTree(scopedResponse)
    if (!spanNodes.length) return null

    const flat: TraceNode[] = []
    spanNodes.forEach((span) => {
        const inferredTraceId =
            span.trace_id ?? traceId ?? (span.span_id ? `${span.span_id}-trace` : "trace")
        convertSpanNodeToTraceNode(span, inferredTraceId, flat)
    })

    const treeEntry: TraceTree = {
        tree: {id: originalTraceId},
        nodes: flat,
    }
    ;(treeEntry as any).data = traceEntry

    const traceData: TraceData = {
        version: String(version ?? ""),
        count: flat.length,
        trees: [treeEntry],
    }
    ;(traceData as any).tree = treeEntry

    return traceData
}

export const evaluationTraceBatcherAtom = atom((get) => {
    const {projectId} = getProjectValues()
    const runId = get(activeEvaluationRunIdAtom)
    if (!projectId) return null

    const cacheKey = `${projectId}:${runId ?? "preview"}`
    let batcher = traceBatcherCache.get(cacheKey)
    if (!batcher) {
        traceBatcherCache.clear()
        batcher = createBatchFetcher<string, TraceData | null>({
            serializeKey: (key) => key,
            batchFn: async (traceIds) => {
                const unique = Array.from(new Set(traceIds.filter(Boolean)))
                if (!unique.length) {
                    return {}
                }

                const canonicalPairs = unique.map((id) => ({
                    original: id,
                    canonical: uuidToTraceId(id) ?? id.replace(/-/g, ""),
                }))

                const response = await axios.post(
                    `/preview/tracing/spans/query`,
                    {
                        focus: "trace",
                        format: "agenta",
                        filter: {
                            conditions: [
                                {
                                    field: "trace_id",
                                    operator: "in",
                                    value: canonicalPairs.map((pair) => pair.canonical),
                                },
                            ],
                        },
                    },
                    {
                        params: {
                            project_id: projectId,
                        },
                    },
                )

                const traces = response.data?.traces ?? {}
                const version = response.data?.version
                const result: Record<string, TraceData | null> = Object.create(null)

                unique.forEach((originalId) => {
                    const pair = canonicalPairs.find((entry) => entry.original === originalId) ?? {
                        original: originalId,
                        canonical: uuidToTraceId(originalId) ?? originalId.replace(/-/g, ""),
                    }
                    const entry =
                        traces?.[pair.canonical] ??
                        traces?.[originalId] ??
                        traces?.[originalId.replace(/-/g, "")] ??
                        undefined
                    result[originalId] = buildTraceDataFromEntry(
                        pair.canonical,
                        originalId,
                        entry,
                        version,
                    )
                })

                return result
            },
        })
        traceBatcherCache.set(cacheKey, batcher)
    }

    return batcher
})

export const evaluationTraceQueryAtomFamily = atomFamily((traceId: string) =>
    atomWithQuery<TraceData | null>((get) => {
        const batcher = get(evaluationTraceBatcherAtom)
        const {projectId} = getProjectValues()
        const runId = get(activeEvaluationRunIdAtom)

        return {
            queryKey: ["preview", "evaluation-trace", runId, projectId, traceId],
            enabled: Boolean(projectId && batcher && traceId),
            staleTime: 30_000,
            gcTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            queryFn: async () => {
                if (!batcher) {
                    throw new Error("Trace batcher is not initialised")
                }
                const value = await batcher(traceId)
                return value ?? null
            },
        }
    }),
)
