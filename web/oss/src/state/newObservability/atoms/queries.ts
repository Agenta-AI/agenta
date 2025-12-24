import deepEqual from "fast-deep-equal"
import {atom} from "jotai"
import {eagerAtom} from "jotai-eager"
import {atomWithInfiniteQuery, atomWithQuery} from "jotai-tanstack-query"
import {atomFamily, selectAtom} from "jotai/utils"

import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import {formatCurrency, formatLatency, formatTokenUsage} from "@/oss/lib/helpers/formatters"
import {
    attachAnnotationsToTraces,
    groupAnnotationsByReferenceId,
} from "@/oss/lib/hooks/useAnnotations/assets/helpers"
import {transformApiData} from "@/oss/lib/hooks/useAnnotations/assets/transformer"
import type {AnnotationDto} from "@/oss/lib/hooks/useAnnotations/types"
import {getNodeById} from "@/oss/lib/traces/observability_helpers"
import {queryAllAnnotations} from "@/oss/services/annotations/api"
import {TraceSpanNode} from "@/oss/services/tracing/types"
import {selectedAppIdAtom} from "@/oss/state/app/selectors/app"
import {getOrgValues} from "@/oss/state/org"
import {projectIdAtom} from "@/oss/state/project"

import {sessionExistsAtom} from "../../session"

import {
    filtersAtomFamily,
    limitAtomFamily,
    selectedNodeAtom,
    selectedTraceIdAtom,
    sortAtomFamily,
    traceTabsAtom,
    traceTabsAtomFamily,
    userFiltersAtomFamily,
} from "./controls"
import {buildTraceQueryParams, executeTraceQuery, mergeConditions} from "./queryHelpers"

// Traces query ----------------------------------------------------------------
export const tracesQueryAtom = atomWithInfiniteQuery((get) => {
    const appId = get(selectedAppIdAtom)
    const sort = get(sortAtomFamily("traces"))
    const filters = get(filtersAtomFamily("traces"))
    const traceTabs = get(traceTabsAtomFamily("traces"))
    const projectId = get(projectIdAtom)
    const limit = get(limitAtomFamily("traces"))

    const {params, hasAnnotationConditions, hasAnnotationOperator, isHasAnnotationSelected} =
        buildTraceQueryParams(filters, sort, traceTabs, limit)

    const sessionExists = get(sessionExistsAtom)

    return {
        queryKey: ["traces", projectId, appId, params],
        initialPageParam: {
            newest: typeof params.newest === "string" ? params.newest : undefined,
        },

        queryFn: async ({pageParam}) =>
            executeTraceQuery({
                params,
                pageParam: pageParam as {newest?: string} | undefined,
                appId: appId as string,
                isHasAnnotationSelected,
                hasAnnotationConditions,
                hasAnnotationOperator,
            }),
        enabled: sessionExists && Boolean(appId || projectId),

        getNextPageParam: (lastPage, _pages) => {
            const page = lastPage as any
            const pageSize = page.annotationPageSize ?? page.traces.length
            return pageSize === limit && page.nextCursor
                ? {newest: page.nextCursor as string}
                : undefined
        },

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
        const matching = anns.filter((annotation) => {
            if (!annotation.links || typeof annotation.links !== "object") {
                return false
            }

            return Object.values(annotation.links).some(
                (link) => link?.trace_id === traceId && link?.span_id === spanId,
            )
        })
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

// Session queries -------------------------------------------------------------
export const sessionsQueryAtom = atomWithInfiniteQuery((get) => {
    const appId = get(selectedAppIdAtom)

    const projectId = get(projectIdAtom)

    const sort = get(sortAtomFamily("sessions"))
    // const filters = get(userFiltersAtomFamily("sessions"))
    const windowing: {oldest?: string; newest?: string} = {}

    if (sort?.type === "standard" && sort.sorted) {
        windowing.oldest = sort.sorted
    } else if (
        sort?.type === "custom" &&
        (sort.customRange?.startTime || sort.customRange?.endTime)
    ) {
        const {startTime, endTime} = sort.customRange
        if (startTime) windowing.oldest = startTime
        if (endTime) windowing.newest = endTime
    }

    const limit = get(limitAtomFamily("sessions"))
    const sessionExists = get(sessionExistsAtom)

    return {
        queryKey: ["sessions", projectId, appId, windowing, limit],
        initialPageParam: {newest: undefined as string | undefined},

        queryFn: async ({pageParam}: {pageParam?: {newest?: string}}) => {
            const {fetchSessions} = await import("@/oss/services/tracing/api")

            const response: any = await fetchSessions({
                appId: (appId as string) || undefined,
                windowing: {...windowing, limit, newest: pageParam?.newest},
                filter: undefined,
            })

            return {
                session_ids: response.session_ids || [],
                count: response.count || 0,
                nextCursor: response.next_cursor as string | undefined,
            }
        },
        enabled: sessionExists && Boolean(appId || projectId),

        getNextPageParam: (lastPage: any) => {
            return lastPage.session_ids.length === limit && lastPage.nextCursor
                ? {newest: lastPage.nextCursor}
                : undefined
        },

        refetchOnWindowFocus: false,
    }
})

export const sessionIdsAtom = selectAtom(
    sessionsQueryAtom,
    (query) => {
        const pages = query.data?.pages ?? []
        const sessionIds = pages.flatMap((page: any) => page.session_ids || [])
        return Array.from(new Set(sessionIds))
    },
    deepEqual,
)

export const sessionCountAtom = selectAtom(
    sessionsQueryAtom,
    (query) => (query.data?.pages?.[0] as any)?.count ?? 0,
)

export const filteredSessionIdsAtom = atom((get) => {
    const sessionIds = get(sessionIdsAtom)
    const sessionsSpans = get(sessionsSpansAtom)
    return sessionIds.filter((id) => (sessionsSpans[id]?.length ?? 0) > 0)
})

// Session Spans ---------------------------------------------------------------
export const sessionsSpansQueryAtom = atomWithInfiniteQuery((get) => {
    const appId = get(selectedAppIdAtom)
    const sort = get(sortAtomFamily("sessions"))
    const filters = get(userFiltersAtomFamily("sessions"))
    const traceTabs = get(traceTabsAtomFamily("sessions"))
    const projectId = get(projectIdAtom)
    const limit = get(limitAtomFamily("sessions"))
    const sessionIds = get(sessionIdsAtom)

    const {params, hasAnnotationConditions, hasAnnotationOperator, isHasAnnotationSelected} =
        buildTraceQueryParams(filters, undefined, traceTabs, undefined)

    const sessionExists = get(sessionExistsAtom)

    return {
        queryKey: ["session_spans", projectId, appId, params, JSON.stringify(sessionIds)],
        initialPageParam: {
            newest: typeof params.newest === "string" ? params.newest : undefined,
        },

        queryFn: async ({pageParam}) => {
            if (!sessionIds.length) {
                return {
                    traces: [],
                    traceCount: 0,
                    nextCursor: undefined,
                    annotationPageSize: 0,
                }
            }

            const promises = sessionIds.map(async (sessionId) => {
                // Clone params and inject session ID filter for this request
                const specificParams = JSON.parse(JSON.stringify(params))
                specificParams.filter = mergeConditions(specificParams.filter, [
                    {
                        field: "attributes",
                        key: "ag.session.id",
                        operator: "is",
                        value: sessionId,
                    },
                ])

                return executeTraceQuery({
                    params: specificParams,
                    pageParam: pageParam as {newest?: string} | undefined,
                    appId: appId as string,
                    isHasAnnotationSelected,
                    hasAnnotationConditions,
                    hasAnnotationOperator,
                })
            })

            const results = await Promise.all(promises)

            // Merge results
            const mergedTraces: TraceSpanNode[] = []
            let maxCount = 0

            results.forEach((res) => {
                mergedTraces.push(...res.traces)
                maxCount += res.traceCount // Sum or max? Depending on how we use it. Usually count is total.
            })

            return {
                traces: mergedTraces,
                traceCount: maxCount,
                nextCursor: undefined, // Pagination for multi-session not supported in this view
                annotationPageSize: 0,
            }
        },
        enabled: sessionExists && Boolean(appId || projectId) && sessionIds.length > 0,

        getNextPageParam: (lastPage, _pages) => {
            const page = lastPage as any
            const pageSize = page.annotationPageSize ?? page.traces.length
            return pageSize === limit && page.nextCursor
                ? {newest: page.nextCursor as string}
                : undefined
        },

        refetchOnWindowFocus: false,
    }
})

export const sessionsSpansAtom = selectAtom(
    sessionsSpansQueryAtom,
    (query) => {
        const pages = query.data?.pages ?? []
        if (!pages.length) return {} as Record<string, TraceSpanNode[]>

        const seen = new Set<string>()
        const grouped: Record<string, TraceSpanNode[]> = {}

        pages.forEach((page) => {
            page.traces.forEach((trace: TraceSpanNode) => {
                const key = trace.span_id || trace.key
                if (!key || seen.has(key)) return
                seen.add(key)
                console.log("trace", trace)
                const sessionId = (trace.attributes as any)?.ag?.session?.id as string

                if (sessionId) {
                    if (!grouped[sessionId]) grouped[sessionId] = []
                    grouped[sessionId].push(trace)
                }
            })
        })

        return grouped
    },
    deepEqual,
)

// --- Granular Session Stats Atoms ---

const sessionTracesAtomFamily = atomFamily((sessionId: string) =>
    atom((get) => {
        const spansMap = get(sessionsSpansAtom)
        return spansMap[sessionId] || []
    }),
)

export const sessionTraceCountAtomFamily = atomFamily((sessionId: string) =>
    atom((get) => {
        const traces = get(sessionTracesAtomFamily(sessionId))
        return traces.length
    }),
)

// Sorted traces are required for time-based metrics (Start/End/Duration)
// We memoize this to avoid re-sorting for every time-related cell
const sessionSortedTracesAtomFamily = atomFamily((sessionId: string) =>
    atom((get) => {
        const traces = get(sessionTracesAtomFamily(sessionId))
        if (!traces.length) return []
        return [...traces].sort(
            (a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime(),
        )
    }),
)

export const sessionTimeRangeAtomFamily = atomFamily((sessionId: string) =>
    atom((get) => {
        const sorted = get(sessionSortedTracesAtomFamily(sessionId))
        if (!sorted.length) return {startTime: undefined, endTime: undefined}
        return {
            startTime: sorted[0].created_at,
            endTime: sorted[sorted.length - 1].created_at,
        }
    }),
)

export const sessionDurationAtomFamily = atomFamily((sessionId: string) =>
    atom((get) => {
        const {startTime, endTime} = get(sessionTimeRangeAtomFamily(sessionId))
        if (!startTime || !endTime) return 0
        const duration = new Date(endTime).getTime() - new Date(startTime).getTime()
        return duration > 0 ? duration : 0
    }),
)

export const sessionLatencyAtomFamily = atomFamily((sessionId: string) =>
    atom((get) => {
        const traces = get(sessionTracesAtomFamily(sessionId))
        return traces.reduce((acc, trace) => {
            if (trace.end_time && trace.start_time) {
                const lat =
                    new Date(trace.end_time).getTime() - new Date(trace.start_time).getTime()
                return acc + (lat > 0 ? lat : 0)
            }
            return acc
        }, 0)
    }),
)

export const sessionUsageAtomFamily = atomFamily((sessionId: string) =>
    atom((get) => {
        const traces = get(sessionTracesAtomFamily(sessionId))
        return traces.reduce((acc, trace) => {
            const attrs = trace.attributes || {}
            const tokens =
                (attrs["ag.usage.total_tokens"] as number) || (attrs["total_tokens"] as number) || 0
            return acc + (Number(tokens) || 0)
        }, 0)
    }),
)

export const sessionCostAtomFamily = atomFamily((sessionId: string) =>
    atom((get) => {
        const traces = get(sessionTracesAtomFamily(sessionId))
        return traces.reduce((acc, trace) => {
            const attrs = trace.attributes || {}
            const cost = (attrs["ag.cost"] as number) || (attrs["cost"] as number) || 0
            return acc + (Number(cost) || 0)
        }, 0)
    }),
)

export const sessionFirstInputAtomFamily = atomFamily((sessionId: string) =>
    atom((get) => {
        const sorted = get(sessionSortedTracesAtomFamily(sessionId))
        if (!sorted.length) return undefined
        const firstTrace = sorted[0]
        console.log("firstTrace", firstTrace)
        return (firstTrace.attributes as any)?.ag?.data?.inputs
    }),
)

export const sessionLastOutputAtomFamily = atomFamily((sessionId: string) =>
    atom((get) => {
        const sorted = get(sessionSortedTracesAtomFamily(sessionId))
        if (!sorted.length) return undefined
        const lastTrace = sorted[sorted.length - 1]

        if (lastTrace.status_code === "STATUS_CODE_ERROR") {
            return lastTrace.status_message
        }
        return (lastTrace.attributes as any)?.ag?.data?.outputs
    }),
)

// Combined loading state for session context
// Checks strict loading state of sessions list and session spans
export const sessionsLoadingAtom = atom((get) => {
    const sessionsQuery = get(sessionsQueryAtom)
    const isSessionsLoading = sessionsQuery.isLoading && !sessionsQuery.isFetchingNextPage

    const spansQuery = get(sessionsSpansQueryAtom)
    const isSpansLoading = spansQuery.isLoading && !spansQuery.isFetchingNextPage

    return isSessionsLoading || isSpansLoading
})
