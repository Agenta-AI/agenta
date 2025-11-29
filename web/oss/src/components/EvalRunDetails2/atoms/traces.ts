import {atom} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
import type {
    TraceData,
    TraceNode,
    TraceTree,
} from "@/oss/lib/hooks/useEvaluationRunScenarioSteps/types"
import {uuidToTraceId} from "@/oss/lib/traces/helpers"
import {transformTracesResponseToTree} from "@/oss/services/tracing/lib/helpers"
import type {TraceSpanNode, TracesResponse} from "@/oss/services/tracing/types"
import {getProjectValues} from "@/oss/state/project"
import createBatchFetcher, {BatchFetcher} from "@/oss/state/utils/createBatchFetcher"

import {resolveInvocationTraceValue} from "../utils/traceValue"

import {activePreviewRunIdAtom, effectiveProjectIdAtom} from "./run"

const traceBatcherCache = new Map<string, BatchFetcher<string, TraceData | null>>()

/**
 * Invalidate the trace batcher cache.
 * Call this after running an invocation to force a fresh fetch of trace data.
 */
export const invalidateTraceBatcherCache = () => {
    traceBatcherCache.clear()
}

const resolveEffectiveRunId = (get: any, runId?: string | null) =>
    runId ?? get(activePreviewRunIdAtom) ?? undefined

const debugTraceValue = (() => {
    const enabled = process.env.NEXT_PUBLIC_EVAL_RUN_DEBUG === "true"
    const seen = new Set<string>()
    return (message: string, payload: Record<string, unknown>, options?: {onceKey?: string}) => {
        if (!enabled) return

        if (options?.onceKey) {
            if (seen.has(options.onceKey)) return
            seen.add(options.onceKey)
        }

        // console.debug("[EvalRunDetails2] Trace probe", payload)
    }
})()

const summarizeShape = (value: unknown): string => {
    if (value === null) return "null"
    if (value === undefined) return "undefined"
    if (typeof value === "string") {
        return value.length > 160 ? `string(${value.slice(0, 160)}…)` : `string(${value})`
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value)
    }
    if (Array.isArray(value)) {
        return `array(len=${value.length})`
    }
    if (typeof value === "object") {
        const keys = Object.keys(value as Record<string, unknown>)
        const preview = keys.slice(0, 10).join(", ")
        const suffix = keys.length > 10 ? "…" : ""
        return `object(keys=[${preview}${suffix}])`
    }
    return typeof value
}

const summarizeTraceData = (trace: TraceData | null | undefined): Record<string, unknown> => {
    if (!trace) {
        return {state: trace === null ? "null" : "undefined"}
    }

    const firstTree = trace.trees?.[0]
    return {
        version: trace.version,
        count: trace.count,
        treeCount: Array.isArray(trace.trees) ? trace.trees.length : undefined,
        treeId: firstTree?.tree?.id,
        nodes: Array.isArray(firstTree?.nodes) ? firstTree?.nodes.length : undefined,
        nodeShape: summarizeShape(firstTree?.nodes?.[0]),
        dataShape: summarizeShape((firstTree as any)?.data),
    }
}

const loggedRawTraces = new Set<string>()

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

export const evaluationTraceBatcherFamily = atomFamily(({runId}: {runId?: string | null} = {}) =>
    atom((get) => {
        const effectiveRunId = resolveEffectiveRunId(get, runId)
        const {projectId: globalProjectId} = getProjectValues()
        const projectId = globalProjectId ?? get(effectiveProjectIdAtom)
        if (!projectId) return null

        const cacheKey = `${projectId}:${effectiveRunId ?? "preview"}`
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

                    debugTraceValue("Trace batch request", {
                        projectId,
                        requestedIds: traceIds,
                        uniqueCount: unique.length,
                    })

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

                    debugTraceValue("Trace batch response", {
                        traceIds: unique,
                        canonicalIds: canonicalPairs.map((pair) => pair.canonical),
                        status: response.status,
                        hasTraces: Boolean(response.data?.traces),
                        version: response.data?.version,
                    })

                    const traces = response.data?.traces ?? {}
                    const version = response.data?.version
                    const result: Record<string, TraceData | null> = Object.create(null)

                    unique.forEach((originalId) => {
                        const pair = canonicalPairs.find(
                            (entry) => entry.original === originalId,
                        ) ?? {
                            original: originalId,
                            canonical: uuidToTraceId(originalId) ?? originalId.replace(/-/g, ""),
                        }
                        const entry =
                            traces?.[pair.canonical] ??
                            traces?.[originalId] ??
                            traces?.[originalId.replace(/-/g, "")] ??
                            undefined
                        const traceData = buildTraceDataFromEntry(
                            pair.canonical,
                            originalId,
                            entry,
                            version,
                        )
                        result[originalId] = traceData
                    })

                    return result
                },
            })
            traceBatcherCache.set(cacheKey, batcher)
        }

        return batcher
    }),
)

export const evaluationTraceBatcherAtom = atom((get) => get(evaluationTraceBatcherFamily()))

export const evaluationTraceQueryAtomFamily = atomFamily(
    ({traceId, runId}: {traceId: string; runId?: string | null}) =>
        atomWithQuery<TraceData | null>((get) => {
            const batcher = get(evaluationTraceBatcherFamily({runId}))
            const {projectId: globalProjectId} = getProjectValues()
            const projectId = globalProjectId ?? get(effectiveProjectIdAtom)
            const effectiveRunId = resolveEffectiveRunId(get, runId)

            return {
                queryKey: ["preview", "evaluation-trace", effectiveRunId, projectId, traceId],
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

export const traceValueAtomFamily = atomFamily(
    (args: {traceId: string; path: string; valueKey?: string; runId?: string | null}) =>
        selectAtom(
            evaluationTraceQueryAtomFamily({traceId: args.traceId, runId: args.runId}),
            (queryState) => {
                const resolved = resolveInvocationTraceValue(
                    queryState.data,
                    args.path,
                    args.valueKey,
                )

                debugTraceValue(
                    "Trace value selection",
                    {
                        traceId: args.traceId,
                        path: args.path,
                        valueKey: args.valueKey,
                        queryState: {
                            isLoading: queryState.isLoading,
                            isFetching: queryState.isFetching,
                            error: queryState.error ? String(queryState.error) : undefined,
                        },
                        traceData: summarizeTraceData(queryState.data),
                        resolvedShape: summarizeShape(resolved),
                    },
                    {
                        onceKey: `${args.traceId}:${args.path}:${
                            args.valueKey ?? ""
                        }:${queryState.isLoading ? "loading" : "ready"}`,
                    },
                )

                if (
                    process.env.NEXT_PUBLIC_EVAL_RUN_DEBUG === "true" &&
                    queryState.data &&
                    !queryState.isLoading
                ) {
                    const rawKey = `${args.traceId}:${args.path}:${args.valueKey ?? ""}`
                    if (!loggedRawTraces.has(rawKey)) {
                        loggedRawTraces.add(rawKey)

                        const spans = Object.entries(
                            (queryState.data as any)?.tree?.data?.spans ?? {},
                        ).map(([spanId, spanData]: [string, any]) => ({
                            spanId,
                            dataKeys: spanData?.data ? Object.keys(spanData.data) : undefined,
                            attributesKeys: spanData?.data?.attributes
                                ? Object.keys(spanData.data.attributes)
                                : undefined,
                            agKeys: spanData?.data?.attributes?.ag
                                ? Object.keys(spanData.data.attributes.ag)
                                : undefined,
                            outputsPreview: summarizeShape(
                                spanData?.data?.attributes?.ag?.data?.outputs,
                            ),
                        }))

                        // console.debug("[EvalRunDetails2] Trace value raw", {
                        //     traceId: args.traceId,
                        //     path: args.path,
                        //     valueKey: args.valueKey,
                        //     treeSummary: summarizeTraceData(queryState.data),
                        //     spans,
                        // })
                    }
                }

                return resolved
            },
            Object.is,
        ),
)

export const traceQueryMetaAtomFamily = atomFamily(
    ({traceId, runId}: {traceId: string; runId?: string | null}) =>
        selectAtom(
            evaluationTraceQueryAtomFamily({traceId, runId}),
            (queryState) => ({
                isLoading: queryState.isLoading,
                isFetching: queryState.isFetching,
                error: queryState.error,
            }),
            (a, b) =>
                a.isLoading === b.isLoading && a.isFetching === b.isFetching && a.error === b.error,
        ),
)
