import {canViewSpansAtom} from "@agenta/entities/access"
import type {AnnotationDto} from "@agenta/entities/annotation/dto"
import {
    attachAnnotationsToTraces,
    groupAnnotationsByReferenceId,
} from "@agenta/entities/annotation/dto"
import {transformApiData} from "@agenta/entities/annotation/dto"
import {queryAllAnnotations} from "@agenta/entities/annotation/dto"
import {workspaceMembersAtom} from "@agenta/entities/organization"
import {getNodeById} from "@agenta/entities/trace"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {formatCurrency, formatLatency, formatTokenUsage} from "@agenta/shared/utils"
import {formatDay} from "@agenta/shared/utils/dateTime"
import deepEqual from "fast-deep-equal"
import {atom} from "jotai"
import {selectAtom} from "jotai/utils"
import {eagerAtom} from "jotai-eager"
import {atomFamily} from "jotai-family"
import {atomWithInfiniteQuery, atomWithQuery} from "jotai-tanstack-query"

import {buildTraceQueryParams, executeTraceQuery, mergeConditions} from "../api/queryHelpers"
import type {TraceSpanNode} from "../core/traceSpan"

import {
    filtersAtomFamily,
    limitAtomFamily,
    realtimeModeAtomFamily,
    selectedNodeAtom,
    selectedTraceIdAtom,
    sortAtomFamily,
    traceTabsAtom,
    traceTabsAtomFamily,
    userFiltersAtomFamily,
} from "./controls"
import {observabilityScopeAtom, observabilityWorkflowContextAtom} from "./seams"

/** Minimal runtime shape of `attributes.ag` (backend extra="allow" data). */
interface AgAttributes {
    metrics?: {
        tokens?: {cumulative?: {total?: number}; incremental?: {total?: number}}
        costs?: {cumulative?: {total?: number}; incremental?: {total?: number}}
    }
    data?: {inputs?: unknown; outputs?: unknown}
}

const agOf = (span?: TraceSpanNode) => span?.attributes?.ag as AgAttributes | undefined

// Traces query ----------------------------------------------------------------
export const tracesQueryAtom = atomWithInfiniteQuery((get) => {
    const appId = get(observabilityScopeAtom).appId
    const workflowCtx = get(observabilityWorkflowContextAtom)
    // `fetchAllPreviewTraces` writes the legacy `?application_id=` URL param
    // off this value. For app workflows that's correct (and redundant with the
    // body filter that also pins `references.application.id`). For evaluator
    // workflows it would AND with the body's `references.evaluator.id` filter
    // and return zero traces — `application.id` is a different reference slot
    // than `evaluator.id`. Drop the URL param for evaluators; the body filter
    // (from `filtersAtomFamily`'s appScope branch) already pins the scope.
    const effectiveAppId = workflowCtx.workflowKind === "evaluator" ? "" : appId
    const sort = get(sortAtomFamily("traces"))
    const filters = get(filtersAtomFamily("traces"))
    const traceTabs = get(traceTabsAtomFamily("traces"))
    const projectId = get(projectIdAtom)
    const limit = get(limitAtomFamily("traces"))

    const {params, hasAnnotationConditions, hasAnnotationOperator, isHasAnnotationSelected} =
        buildTraceQueryParams(filters, sort, traceTabs, limit)

    const sessionExists = get(sessionAtom)

    // Wait for workflow context to settle before firing the query. While
    // `workflowCtx.isResolving` is true, `effectiveAppId` falls through to
    // the app branch with the raw `appId` (which is the evaluator's id when
    // we're on `/apps/<evalId>/traces`), causing a wrong `application_id`
    // URL param to be sent. Gating on `!isResolving` skips that wasted
    // request — once ctx settles, the atom re-evaluates with the correct
    // `effectiveAppId` and queryFn fires.
    // A reader without `view_spans` gets no trace list: the API would refuse every page.
    const enabledFlag =
        sessionExists &&
        Boolean(appId || projectId) &&
        !workflowCtx.isResolving &&
        get(canViewSpansAtom)

    return {
        queryKey: ["traces", projectId, appId, params],
        initialPageParam: {
            newest: typeof params.newest === "string" ? params.newest : undefined,
        },

        queryFn: async ({pageParam}) =>
            executeTraceQuery({
                params,
                pageParam: pageParam as {newest?: string} | undefined,
                appId: effectiveAppId as string,
                projectId: projectId ?? "",
                isHasAnnotationSelected,
                hasAnnotationConditions,
                hasAnnotationOperator,
            }),
        enabled: enabledFlag,

        getNextPageParam: (lastPage, _pages) => {
            const page = lastPage as {
                annotationPageSize?: number
                traces: unknown[]
                nextCursor?: string
            }
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
    const members = get(workspaceMembersAtom)
    const projectId = get(projectIdAtom)

    return {
        // projectId scopes the request, so it must scope the cache too — otherwise a
        // project switch with the same links reuses the previous project's annotations.
        queryKey: ["annotations", projectId, links],
        queryFn: async () => {
            if (Array.isArray(links) && !links.length) return [] as AnnotationDto[]
            const res = await queryAllAnnotations({
                projectId: projectId ?? undefined,
                queries: {annotation: {links}},
            })
            return (
                res.annotations?.map((a) => transformApiData<AnnotationDto>({data: a, members})) ||
                []
            )
        },
        enabled: Array.isArray(links) && links.length > 0 && get(canViewSpansAtom),
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
export const formattedTimestampAtomFamily = atomFamily((ts?: string | number | null) =>
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

interface SessionsPage {
    session_ids: string[]
    count: number
    nextWindowing?: {newest?: string; oldest?: string}
}

// Session queries -------------------------------------------------------------
export const sessionsQueryAtom = atomWithInfiniteQuery((get) => {
    const appId = get(observabilityScopeAtom).appId

    const projectId = get(projectIdAtom)

    const sort = get(sortAtomFamily("sessions"))
    // const filters = get(userFiltersAtomFamily("sessions"))
    const baseWindowing: {oldest?: string; newest?: string; order?: string} = {}

    if (sort?.type === "standard" && sort.sorted) {
        baseWindowing.oldest = sort.sorted
    } else if (
        sort?.type === "custom" &&
        (sort.customRange?.startTime || sort.customRange?.endTime)
    ) {
        const {startTime, endTime} = sort.customRange
        if (startTime) baseWindowing.oldest = startTime
        if (endTime) baseWindowing.newest = endTime
    }

    const limit = get(limitAtomFamily("sessions"))
    const sessionExists = get(sessionAtom)
    const realtimeMode = get(realtimeModeAtomFamily("sessions"))

    return {
        queryKey: ["sessions", projectId, appId, baseWindowing, limit, realtimeMode],
        initialPageParam: {
            newest: undefined as string | undefined,
            oldest: undefined as string | undefined,
        },

        queryFn: async ({pageParam}: {pageParam?: {newest?: string; oldest?: string}}) => {
            // AGE-3788 Phase 1: sessions now go through the Fern client in
            // @agenta/entities/trace (POST /spans/sessions/query). projectId is
            // passed explicitly (the entities fn does not read it from state).
            const {fetchSessions} = await import("@agenta/entities/trace")

            const response = await fetchSessions(
                {
                    appId: (appId as string) || undefined,
                    windowing: {
                        limit,
                        // Base time window from sort (initial boundaries for first page)
                        oldest: baseWindowing.oldest,
                        newest: baseWindowing.newest,
                        // Pagination cursors override base boundaries for subsequent pages:
                        // - In DESC order: pageParam.newest moves backward, oldest stays fixed
                        // - In ASC order: pageParam.oldest moves forward, newest stays fixed
                        ...(pageParam?.oldest && {oldest: pageParam.oldest}),
                        ...(pageParam?.newest && {newest: pageParam.newest}),
                    },
                    realtime: realtimeMode,
                },
                projectId ?? "",
            )

            return {
                session_ids: response?.session_ids || [],
                count: response?.count || 0,
                nextWindowing: response?.windowing,
            }
        },
        enabled: sessionExists && Boolean(appId || projectId) && get(canViewSpansAtom),

        getNextPageParam: (lastPageRaw) => {
            // Disable pagination in realtime mode (latest activity shows fixed LIMIT items)
            if (realtimeMode) {
                return undefined
            }

            const lastPage = lastPageRaw as SessionsPage
            // Use the windowing object from response for time-based pagination
            const hasMore = lastPage.session_ids.length === limit && lastPage.nextWindowing
            if (!hasMore) return undefined

            return {
                newest: lastPage.nextWindowing?.newest,
                oldest: lastPage.nextWindowing?.oldest,
            }
        },

        refetchOnWindowFocus: false,
    }
})

export const sessionIdsAtom = selectAtom(
    sessionsQueryAtom,
    (query) => {
        const pages = query.data?.pages ?? []
        const sessionIds = pages.flatMap((page) => (page as SessionsPage).session_ids || [])
        return Array.from(new Set(sessionIds))
    },
    deepEqual,
)

export const sessionCountAtom = selectAtom(
    sessionsQueryAtom,
    (query) => (query.data?.pages?.[0] as SessionsPage | undefined)?.count ?? 0,
)

// Session Spans ---------------------------------------------------------------
// One query per session, so loading another page of sessions leaves loaded spans cached.
export const sessionSpansQueryAtomFamily = atomFamily((sessionId: string) =>
    atomWithQuery((get) => {
        const appId = get(observabilityScopeAtom).appId
        const filters = get(userFiltersAtomFamily("sessions"))
        const traceTabs = get(traceTabsAtomFamily("sessions"))
        const projectId = get(projectIdAtom)
        const sessionExists = get(sessionAtom)

        const {params, hasAnnotationConditions, hasAnnotationOperator, isHasAnnotationSelected} =
            buildTraceQueryParams(filters, undefined, traceTabs, undefined)

        return {
            queryKey: ["session_spans", projectId, appId, params, sessionId],
            queryFn: async () => {
                const sessionParams = {
                    ...params,
                    filter: mergeConditions(params.filter as string | undefined, [
                        {
                            field: "attributes",
                            key: "ag.session.id",
                            operator: "is",
                            value: sessionId,
                        },
                    ]),
                }
                // The API returns one page per call: follow its cursor to read the whole session.
                const result = await executeTraceQuery({
                    params: sessionParams,
                    pageParam: {
                        newest: typeof params.newest === "string" ? params.newest : undefined,
                    },
                    appId: appId as string,
                    projectId: projectId ?? "",
                    isHasAnnotationSelected,
                    hasAnnotationConditions,
                    hasAnnotationOperator,
                    readAllPages: true,
                })
                return result.traces as TraceSpanNode[]
            },
            enabled: sessionExists && Boolean(appId || projectId) && get(canViewSpansAtom),
            refetchOnWindowFocus: false,
        }
    }),
)

// Only a session whose spans loaded empty is hidden; pending and failed ones stay listed.
export const filteredSessionIdsAtom = atom((get) =>
    get(sessionIdsAtom).filter((id) => {
        const query = get(sessionSpansQueryAtomFamily(id))
        return query.isPending || query.isError || (query.data?.length ?? 0) > 0
    }),
)

// --- Granular Session Stats Atoms ---

const NO_TRACES: TraceSpanNode[] = []

const sessionTracesAtomFamily = atomFamily((sessionId: string) =>
    atom((get) => get(sessionSpansQueryAtomFamily(sessionId)).data ?? NO_TRACES),
)

export const sessionTraceCountAtomFamily = atomFamily((sessionId: string) =>
    atom((get) => {
        const traces = get(sessionTracesAtomFamily(sessionId))
        return traces.length
    }),
)

// Sorted traces are required for time-based metrics (Start/End/Duration) and for
// the First input / Last output cells. Sort by `start_time` (falling back to
// `created_at`) to match the Session drawer's tree ordering
// (SessionTree sorts its "Trace N" nodes by start_time). Sorting by a different
// key here made the table's first/last trace diverge from the drawer's.
const sessionSortedTracesAtomFamily = atomFamily((sessionId: string) =>
    atom((get) => {
        const traces = get(sessionTracesAtomFamily(sessionId))
        if (!traces.length) return []
        const sortKey = (t: (typeof traces)[number]) =>
            new Date(t.start_time || t.created_at || 0).getTime()
        return [...traces].sort((a, b) => sortKey(a) - sortKey(b))
    }),
)

export const sessionTimeRangeAtomFamily = atomFamily((sessionId: string) =>
    atom((get) => {
        const sorted = get(sessionSortedTracesAtomFamily(sessionId))
        if (!sorted.length) return {startTime: undefined, endTime: undefined}
        return {
            startTime: sorted[0].start_time || sorted[0].created_at,
            endTime: sorted[sorted.length - 1].end_time || sorted[sorted.length - 1].created_at,
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
            const ag = agOf(trace)
            // `??`, not `||`: a real incremental total of 0 must not fall through to the
            // cumulative one, which would double-count a span that reported no new tokens.
            const tokens =
                ag?.metrics?.tokens?.incremental?.total ??
                ag?.metrics?.tokens?.cumulative?.total ??
                (attrs["ag.usage.total_tokens"] as number) ??
                (attrs["total_tokens"] as number) ??
                0
            return acc + (Number(tokens) || 0)
        }, 0)
    }),
)

export const sessionCostAtomFamily = atomFamily((sessionId: string) =>
    atom((get) => {
        const traces = get(sessionTracesAtomFamily(sessionId))
        return traces.reduce((acc, trace) => {
            const ag = agOf(trace)
            const cost =
                ag?.metrics?.costs?.incremental?.total ?? ag?.metrics?.costs?.cumulative?.total ?? 0
            return acc + (Number(cost) || 0)
        }, 0)
    }),
)

export const sessionFirstInputAtomFamily = atomFamily((sessionId: string) =>
    atom((get) => {
        const sorted = get(sessionSortedTracesAtomFamily(sessionId))
        if (!sorted.length) return undefined
        const firstTrace = sorted[0]
        return agOf(firstTrace)?.data?.inputs
    }),
)

// A streamed agent run's ROOT workflow span returns a generator, so its `ag.data.outputs` is
// the generator object's repr (`<async_generator object ... at 0x...>`), not the reply — the
// span is already closed by the time the stream produces text. The real assistant output is on
// the nested `agent`-type span (e.g. `invoke_agent`). So prefer that span's output, falling back
// to the root's unless it's the meaningless generator repr.
const GENERATOR_REPR = /^<(?:async_)?generator object/

const traceDisplayOutput = (root: TraceSpanNode): unknown => {
    let agentOutput: unknown
    const visit = (node: TraceSpanNode) => {
        if (agentOutput !== undefined) return
        if (node.span_type === "agent") {
            const out = agOf(node)?.data?.outputs
            if (out !== undefined) agentOutput = out
        }
        node.children?.forEach((child) => visit(child as TraceSpanNode))
    }
    visit(root)
    if (agentOutput !== undefined) return agentOutput

    const rootOutput = agOf(root)?.data?.outputs
    return typeof rootOutput === "string" && GENERATOR_REPR.test(rootOutput)
        ? undefined
        : rootOutput
}

export const sessionLastOutputAtomFamily = atomFamily((sessionId: string) =>
    atom((get) => {
        const sorted = get(sessionSortedTracesAtomFamily(sessionId))
        if (!sorted.length) return undefined
        const lastTrace = sorted[sorted.length - 1]

        if (lastTrace.status_code === "STATUS_CODE_ERROR") {
            return lastTrace.status_message
        }
        return traceDisplayOutput(lastTrace)
    }),
)

// True while the sessions list or any listed session's spans are loading.
export const sessionsLoadingAtom = atom((get) => {
    const sessionsQuery = get(sessionsQueryAtom)
    if (sessionsQuery.isLoading && !sessionsQuery.isFetchingNextPage) return true
    return get(sessionIdsAtom).some((id) => get(sessionSpansQueryAtomFamily(id)).isLoading)
})
