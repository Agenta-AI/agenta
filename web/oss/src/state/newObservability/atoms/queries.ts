import deepEqual from "fast-deep-equal"
import {atom} from "jotai"
import {selectAtom, atomFamily} from "jotai/utils"
import {eagerAtom} from "jotai-eager"
import {atomWithInfiniteQuery, atomWithQuery} from "jotai-tanstack-query"

import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import {formatLatency, formatCurrency, formatTokenUsage} from "@/oss/lib/helpers/formatters"
import {getNodeById} from "@/oss/lib/helpers/observability_helpers"
import {
    attachAnnotationsToTraces,
    groupAnnotationsByReferenceId,
} from "@/oss/lib/hooks/useAnnotations/assets/helpers"
import {transformApiData} from "@/oss/lib/hooks/useAnnotations/assets/transformer"
import type {AnnotationDto} from "@/oss/lib/hooks/useAnnotations/types"
import {queryAllAnnotations} from "@/oss/services/annotations/api"
import type {_AgentaRootsResponse} from "@/oss/services/observability/types"
import {fetchAllPreviewTraces} from "@/oss/services/tracing/api"
import {
    isSpansResponse,
    isTracesResponse,
    transformTracesResponseToTree,
    transformTracingResponse,
} from "@/oss/services/tracing/lib/helpers"
import {TraceSpanNode} from "@/oss/services/tracing/types"
import {selectedAppIdAtom} from "@/oss/state/app/selectors/app"
import {getOrgValues} from "@/oss/state/org"
import {projectIdAtom} from "@/oss/state/project"

import {sessionExistsAtom} from "../../session"

import {
    sortAtom,
    filtersAtom,
    traceTabsAtom,
    selectedTraceIdAtom,
    selectedNodeAtom,
    limitAtom,
} from "./controls"

// Traces query ----------------------------------------------------------------
export const tracesQueryAtom = atomWithInfiniteQuery((get) => {
    const appId = get(selectedAppIdAtom)
    const sort = get(sortAtom)
    const filters = get(filtersAtom)
    const traceTabs = get(traceTabsAtom)
    const projectId = get(projectIdAtom)
    const limit = get(limitAtom)

    const params: Record<string, any> = {
        size: limit,
        focus: traceTabs === "chat" ? "span" : traceTabs,
    }

    // ---- helpers for numeric coercion from UI ----
    const toNum = (v: any) => {
        const n = Number(v)
        return Number.isFinite(n) ? n : undefined
    }
    const toNumArray = (v: any): number[] => {
        if (Array.isArray(v)) return v.map(toNum).filter((x): x is number => x !== undefined)
        if (typeof v === "string") {
            const s = v.trim()
            if (!s) return []
            if (s.startsWith("[") && s.endsWith("]")) {
                try {
                    const parsed = JSON.parse(s)
                    if (Array.isArray(parsed))
                        return parsed.map(toNum).filter((x): x is number => x !== undefined)
                } catch {}
            }
            return s
                .split(/[\s,;]+/g)
                .map(toNum)
                .filter((x): x is number => x !== undefined)
        }
        const n = toNum(v)
        return n === undefined ? [] : [n]
    }
    const toBetweenPair = (v: any): number[] => {
        const arr = toNumArray(v).slice(0, 2)
        return arr.length === 2 ? arr : []
    }
    const isListOp = (op?: string) => op === "in" || op === "not_in"
    const isBetween = (op?: string) => op === "btwn"

    if (filters.length > 0) {
        const sanitized = filters.map(({field, key, operator, value}) => {
            // Pack references into array of objects using chosen key
            if (field === "references") {
                const refKey = key || "id"
                const arrayValue = Array.isArray(value)
                    ? value.map((v: any) => (typeof v === "object" ? v : {[refKey]: v}))
                    : [{[refKey]: value}]
                return {field, operator, value: arrayValue}
            }

            // Attributes.* : numeric metrics; coerce by operator
            if (field?.startsWith("attributes.")) {
                const attributeKey = field.slice("attributes.".length)

                let outValue: any = value
                if (isBetween(operator)) {
                    outValue = toBetweenPair(value) // [min, max]
                } else if (isListOp(operator)) {
                    outValue = toNumArray(value) // [n, n, ...]
                } else {
                    const n = toNum(value) // single number
                    outValue = n === undefined ? undefined : n
                }

                return {field: "attributes", key: attributeKey, operator, value: outValue}
            }

            if (field === "status_code" && value === "STATUS_CODE_OK") {
                return {field, operator: "is_not", value: "STATUS_CODE_ERROR"}
            }

            // passthrough for everything else
            return {field, operator, value}
        })

        params.filter = JSON.stringify({conditions: sanitized})
    }

    if (sort?.type === "standard" && sort.sorted) {
        params.oldest = sort.sorted
    } else if (
        sort?.type === "custom" &&
        (sort.customRange?.startTime || sort.customRange?.endTime)
    ) {
        const {startTime, endTime} = sort.customRange
        if (startTime) params.oldest = startTime
        if (endTime) params.newest = endTime
    }

    const sessionExists = get(sessionExistsAtom)

    return {
        queryKey: ["traces", projectId, appId, params],
        initialPageParam: {newest: params.newest as string | undefined},

        queryFn: async ({pageParam}: {pageParam?: {newest?: string}}) => {
            const windowParams = {...params}
            if (pageParam?.newest) windowParams.newest = pageParam.newest

            const data = await fetchAllPreviewTraces(windowParams, appId as string)

            const transformed: TraceSpanNode[] = []

            if (isTracesResponse(data)) {
                transformed.push(...transformTracingResponse(transformTracesResponseToTree(data)))
            } else if (isSpansResponse(data)) {
                transformed.push(...transformTracingResponse(data.spans))
            }

            const getTs = (n: any) =>
                n?.start_time ?? n?.startTime ?? n?.timestamp ?? n?.ts ?? n?.created_at ?? null
            const times = transformed
                .map(getTs)
                .map((value) => {
                    if (typeof value === "number") return value
                    const parsed = typeof value === "string" ? Date.parse(value) : NaN
                    return Number.isNaN(parsed) ? null : parsed
                })
                .filter((value): value is number => value !== null)

            let nextCursor: string | undefined
            if (times.length) {
                const minVal = times.reduce((min, cur) => (cur < min ? cur : min))
                const cursorDate = new Date(minVal)
                const lowerBound =
                    params.oldest && typeof params.oldest === "string"
                        ? Date.parse(params.oldest)
                        : undefined

                if (!Number.isNaN(cursorDate.getTime())) {
                    if (lowerBound !== undefined && minVal <= lowerBound) {
                        nextCursor = undefined
                    } else {
                        nextCursor = cursorDate.toISOString()
                    }
                }
            }

            return {
                traces: transformed,
                traceCount: (data as any)?.count ?? 0,
                nextCursor,
            }
        },
        enabled: sessionExists && Boolean(appId || projectId),
        getNextPageParam: (lastPage, _pages) =>
            (lastPage as any).traces.length === limit && (lastPage as any).nextCursor
                ? {newest: (lastPage as any).nextCursor as string}
                : undefined,
        refetchOnWindowFocus: false,
    }
})

// Base traces atom -------------------------------------------------------------
export const tracesAtom = selectAtom(
    tracesQueryAtom,
    (query) => {
        const pages = query.data?.pages ?? []
        if (!pages.length) return []

        const seen = new Set<string>()
        const deduped: TraceSpanNode[] = []

        pages.forEach((page) => {
            page.traces.forEach((trace: TraceSpanNode) => {
                const key = trace.span_id || trace.key
                if (!key || seen.has(key)) return
                seen.add(key)
                deduped.push(trace)
            })
        })

        return deduped
    },
    deepEqual,
)

export const traceCountAtom = selectAtom(
    tracesQueryAtom,
    (query) => query.data?.pages?.[0]?.traceCount ?? 0,
)

// Annotation links -------------------------------------------------------------
const collectInvocationLinks = (nodes: TraceSpanNode[] = []) => {
    const links: {trace_id: string; span_id: string}[] = []
    const seen = new Set<string>()

    const visit = (node?: TraceSpanNode) => {
        if (!node) return

        const ids = node.invocationIds
        if (ids?.trace_id && ids?.span_id) {
            const key = `${ids.trace_id}:${ids.span_id}`
            if (!seen.has(key)) {
                seen.add(key)
                links.push(ids)
            }
        }

        node.children?.forEach((child) => visit(child as TraceSpanNode))
    }

    nodes.forEach((node) => visit(node))
    return links
}

export const annotationLinksAtom = eagerAtom((get) =>
    collectInvocationLinks(get(tracesAtom) as TraceSpanNode[]),
)

// Annotations query ------------------------------------------------------------
export const annotationsQueryAtom = atomWithQuery((get) => {
    const links = get(annotationLinksAtom)
    const {selectedOrg} = getOrgValues()
    const members = selectedOrg?.default_workspace?.members || []

    return {
        queryKey: ["annotations", links],
        queryFn: async () => {
            if (Array.isArray(links) && !links.length) return [] as AnnotationDto[]
            const res = await queryAllAnnotations({annotation: {links}})
            return (
                res.annotations?.map((a) => transformApiData<AnnotationDto>({data: a, members})) ||
                []
            )
        },
        enabled: Array.isArray(links) && links.length > 0,
        refetchOnWindowFocus: false,
    }
})

export const annotationsAtom = selectAtom(annotationsQueryAtom, (q) => q.data ?? [], deepEqual)

// Combined traces with annotations --------------------------------------------
export const tracesWithAnnotationsAtom = eagerAtom<TraceSpanNode[]>((get) =>
    attachAnnotationsToTraces(
        get(tracesAtom) as TraceSpanNode[],
        get(annotationsAtom) as AnnotationDto[],
    ),
)

// Loading state ----------------------------------------------------------------
export const observabilityLoadingAtom = eagerAtom((get) => {
    const tracesQuery = get(tracesQueryAtom)
    const annotationsLoading = get(annotationsQueryAtom).isLoading
    if (tracesQuery.isFetchingNextPage) return false
    return tracesQuery.isLoading || annotationsLoading
})

// Derived selection helpers ----------------------------------------------------
export const activeTraceIndexAtom = eagerAtom((get) => {
    const traces = get(tracesWithAnnotationsAtom)
    const selectedId = get(selectedTraceIdAtom)
    const tab = get(traceTabsAtom)
    return traces.findIndex((item) =>
        tab === "span" ? item.span_id === selectedId : item.trace_id === selectedId,
    )
})

export const activeTraceAtom = eagerAtom((get) => {
    const traces = get(tracesWithAnnotationsAtom)
    const idx = get(activeTraceIndexAtom)
    return idx >= 0 ? traces[idx] : null
})

export const selectedItemAtom = eagerAtom((get) => {
    const traces = get(tracesWithAnnotationsAtom)
    const selected = get(selectedNodeAtom)
    if (!traces.length || !selected) return null
    return getNodeById(traces, selected) || null
})

// Annotation helpers ----------------------------------------------------------
export const annotationEvaluatorSlugsAtom = selectAtom(
    annotationsAtom,
    (anns: AnnotationDto[]) =>
        Array.from(
            new Set(anns.map((a) => a.references?.evaluator?.slug).filter(Boolean)),
        ) as string[],
    deepEqual,
)

export const traceAnnotationInfoAtomFamily = atomFamily((key: string) =>
    atom((get) => {
        const [traceId = "", spanId = ""] = key.split(":")
        const anns = get(annotationsAtom) as AnnotationDto[]
        const matching = anns.filter(
            (annotation) =>
                annotation.links?.invocation?.trace_id === traceId &&
                annotation.links?.invocation?.span_id === spanId,
        )
        return {
            annotations: matching,
            aggregatedEvaluatorMetrics: groupAnnotationsByReferenceId(matching),
        }
    }, deepEqual),
)

// Formatting helpers ----------------------------------------------------------
export const nodeDisplayNameAtomFamily = atomFamily((name: string) =>
    atom(() => {
        const truncated = name.length >= 15
        return {
            text: truncated ? `${name.slice(0, 15)}...` : name,
            full: name,
            truncated,
        }
    }),
)

export const formattedTimestampAtomFamily = atomFamily((ts?: string) =>
    atom(() => formatDay({date: ts, outputFormat: "HH:mm:ss DD MMM YYYY"})),
)

export const formattedDurationAtomFamily = atomFamily((ms?: number) =>
    atom(() => formatLatency(ms ? ms / 1000 : null)),
)

export const formattedCostAtomFamily = atomFamily((cost?: number) =>
    atom(() => formatCurrency(cost)),
)

export const formattedUsageAtomFamily = atomFamily((tokens?: number) =>
    atom(() => formatTokenUsage(tokens)),
)
