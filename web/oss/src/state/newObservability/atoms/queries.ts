import deepEqual from "fast-deep-equal"
import {atom} from "jotai"
import {selectAtom, atomFamily} from "jotai/utils"
import {eagerAtom} from "jotai-eager"
import {atomWithInfiniteQuery, atomWithQuery} from "jotai-tanstack-query"

import {
    normalizeReferenceValue,
    parseReferenceKey,
} from "@/oss/components/pages/observability/assets/filters/referenceUtils"
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
import {getOrganizationValues} from "@/oss/state/organization"
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

    interface Condition {
        field: string
        operator: string
        value?: any
        key?: string
    }

    const isHasAnnotationSelected = filters.findIndex((f) => f.field === "has_annotation")
    const hasAnnotationOperator =
        isHasAnnotationSelected === -1 ? undefined : filters[isHasAnnotationSelected]?.operator
    let hasAnnotationConditions: Condition[] = []

    const buildAnnotationConditions = (value: any, operator: string): Condition[] => {
        const v = Array.isArray(value) ? value[0] : value || {}
        const out: Condition[] = []

        const evaluatorSlug = v.evaluator
        const feedback = v.feedback

        if (evaluatorSlug) {
            out.push({
                field: "references",
                operator,
                value: [{slug: evaluatorSlug, "attributes.key": "evaluator"}],
            })
        }

        if (feedback) {
            out.push({
                field: "attributes",
                key: `ag.data.outputs.${feedback.field}`,
                operator: feedback.operator,
                value: feedback.value,
            })
        }

        return out
    }

    if (filters.length > 0) {
        const sanitized = filters.flatMap(({field, key, operator, value}) => {
            if (field === "has_annotation") {
                hasAnnotationConditions = [
                    ...hasAnnotationConditions,
                    ...buildAnnotationConditions(value, operator),
                ]
                return []
            }

            if (field === "references") {
                const {category, property} = parseReferenceKey(key, value)
                const arrayValue = normalizeReferenceValue(value, property, category)
                return {field, operator, value: arrayValue}
            }

            if (field === "custom" || field === "input_keys" || field === "output_keys") {
                const attributeKey = key?.slice("attributes.".length)
                return {field: "attributes", key: attributeKey, operator, value}
            }

            if (field?.startsWith("attributes.")) {
                const attributeKey = field.slice("attributes.".length)

                return {field: "attributes", key: attributeKey, operator, value}
            }

            if (field === "status_code" && value === "STATUS_CODE_OK") {
                if (operator === "is") {
                    return {field, operator: "is_not", value: "STATUS_CODE_ERROR"}
                }

                if (operator === "is_not") {
                    return {field, operator: "is", value: "STATUS_CODE_ERROR"}
                }
            }

            if (field.includes("annotation")) {
                return buildAnnotationConditions(value, operator)
            }

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

    const toFilterString = (conditions?: Condition[]) =>
        conditions && conditions.length ? JSON.stringify({conditions}) : undefined

    const parseFilterJSON = (filterStr?: string): Condition[] => {
        if (!filterStr) return []
        try {
            const obj = JSON.parse(filterStr)
            return Array.isArray(obj?.conditions) ? obj.conditions : []
        } catch {
            return []
        }
    }

    const buildFiltersForHasAnnotation = (
        windowParams: Record<string, any>,
        annotationConditions: Condition[],
        operator?: string,
    ) => {
        const originalConditions = parseFilterJSON(windowParams.filter)

        const annotationConditionsForStep1 =
            operator === "not_in"
                ? annotationConditions.map((condition) =>
                      condition.field === "references" ? {...condition, operator: "in"} : condition,
                  )
                : annotationConditions

        const annotationOnlyFilter = toFilterString([
            {field: "trace_type", operator: "is", value: "annotation"},
            ...annotationConditionsForStep1,
        ])
        const originalFilter = toFilterString(originalConditions)
        return {originalFilter, annotationOnlyFilter}
    }

    const extractLinkedIds = (data: any) => {
        const traceIds = new Set<string>()
        const spanIds = new Set<string>()

        // shape 1: { traces: { [id]: { spans: { [id]: { links }}}}}
        if (data?.traces && typeof data.traces === "object") {
            for (const trace of Object.values<any>(data.traces)) {
                if (!trace?.spans) continue
                for (const span of Object.values<any>(trace.spans)) {
                    const links = Array.isArray(span?.links)
                        ? span.links
                        : span?.links && typeof span.links === "object"
                          ? Object.values(span.links)
                          : []
                    for (const l of links) {
                        if (l?.trace_id) traceIds.add(String(l.trace_id))
                        if (l?.span_id) spanIds.add(String(l.span_id))
                    }
                }
            }
        }

        // shape 2: { spans: { [id]: {...} } } or { spans: Span[] }
        const spansContainer = data?.spans
        const spansIterable = Array.isArray(spansContainer)
            ? spansContainer
            : spansContainer && typeof spansContainer === "object"
              ? Object.values(spansContainer)
              : []
        for (const span of spansIterable) {
            const links = Array.isArray(span?.links)
                ? span.links
                : span?.links && typeof span.links === "object"
                  ? Object.values(span.links)
                  : []
            for (const l of links) {
                if (l?.trace_id) traceIds.add(String(l.trace_id))
                if (l?.span_id) spanIds.add(String(l.span_id))
            }
        }

        return {traceIds: [...traceIds], spanIds: [...spanIds]}
    }

    const extractEarliestTimestamp = (data: any): string | undefined => {
        const getTs = (n: any) =>
            n?.start_time ?? n?.startTime ?? n?.timestamp ?? n?.ts ?? n?.created_at ?? null

        const spans = data?.spans
        const list = Array.isArray(spans)
            ? spans
            : spans && typeof spans === "object"
              ? Object.values(spans)
              : []

        const times = list
            .map(getTs)
            .map((v) => (typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) : NaN))
            .filter((n) => Number.isFinite(n)) as number[]

        if (!times.length) return undefined
        const minVal = times.reduce((a, b) => (a < b ? a : b))
        const d = new Date(minVal)
        return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
    }

    const mergeConditions = (baseFilterJSON: string | undefined, extra: Condition[]) => {
        const base = parseFilterJSON(baseFilterJSON)
        const cleaned = extra.filter(
            (c) => c.operator !== "in" || (Array.isArray(c.value) && c.value.length > 0),
        )
        const keyOf = (c: Condition) =>
            `${c.field}|${c.operator}|${c.key ?? ""}|${JSON.stringify(c.value)}`
        const seen = new Set(base.map(keyOf))
        const merged = [...base]
        for (const c of cleaned) if (!seen.has(keyOf(c))) merged.push(c)
        return toFilterString(merged)
    }

    const sessionExists = get(sessionExistsAtom)

    return {
        queryKey: ["traces", projectId, appId, params],
        initialPageParam: {newest: params.newest as string | undefined},

        queryFn: async ({pageParam}: {pageParam?: {newest?: string}}) => {
            const windowParams = {...params}
            let data: any = []
            let annotationPageSize: number | undefined
            let nextCursorFromStep1: string | undefined

            if (isHasAnnotationSelected !== -1) {
                const {originalFilter, annotationOnlyFilter} = buildFiltersForHasAnnotation(
                    windowParams,
                    hasAnnotationConditions,
                    hasAnnotationOperator,
                )

                // STEP 1: paginated annotations only
                const firstParams = {...windowParams}
                firstParams.focus = "span"
                firstParams.filter = annotationOnlyFilter
                if (pageParam?.newest) firstParams.newest = pageParam.newest

                const data1 = await fetchAllPreviewTraces(firstParams, appId as string)

                // page size for pagination decision
                const countEntries = (container: unknown) => {
                    if (!container) return 0
                    if (Array.isArray(container)) return container.length
                    if (typeof container === "object") return Object.keys(container).length
                    return 0
                }
                const spansPageSize = countEntries((data1 as any)?.spans)
                const tracesPageSize = countEntries((data1 as any)?.traces)
                annotationPageSize = spansPageSize || tracesPageSize

                // cursor from step 1 only
                nextCursorFromStep1 = extractEarliestTimestamp(data1)
                if (nextCursorFromStep1 && typeof params.oldest === "string") {
                    const lb = Date.parse(params.oldest)
                    const nc = Date.parse(nextCursorFromStep1)
                    if (!Number.isNaN(lb) && !Number.isNaN(nc) && nc <= lb)
                        nextCursorFromStep1 = undefined
                }

                // IDs from step 1
                const {traceIds, spanIds} = extractLinkedIds(data1)

                const shouldExcludeAnnotations = hasAnnotationOperator === "not_in"

                if (!shouldExcludeAnnotations && (traceIds.length === 0 || spanIds.length === 0)) {
                    return {
                        traces: [],
                        traceCount: 0,
                        nextCursor: nextCursorFromStep1,
                        annotationPageSize,
                    }
                }

                if (shouldExcludeAnnotations && traceIds.length === 0 && spanIds.length === 0) {
                    if (pageParam?.newest) windowParams.newest = pageParam.newest
                    data = await fetchAllPreviewTraces(windowParams, appId as string)
                } else {
                    // STEP 2: not paginated, fetch matches with inclusion/exclusion conditions
                    const extraConditions: Condition[] = shouldExcludeAnnotations
                        ? [
                              ...(traceIds.length
                                  ? [{field: "trace_id", operator: "not_in", value: traceIds}]
                                  : []),
                              ...(spanIds.length
                                  ? [{field: "span_id", operator: "not_in", value: spanIds}]
                                  : []),
                          ]
                        : [
                              {field: "trace_id", operator: "in", value: traceIds},
                              {field: "span_id", operator: "in", value: spanIds},
                          ]

                    const secondParams: Record<string, any> = {...params}
                    delete secondParams.newest
                    delete secondParams.oldest
                    if (!shouldExcludeAnnotations) {
                        secondParams.size = Math.max(traceIds.length, spanIds.length)
                    }
                    secondParams.filter = mergeConditions(originalFilter, extraConditions)

                    data = await fetchAllPreviewTraces(secondParams, appId as string)
                }
            } else {
                // normal flow
                if (pageParam?.newest) windowParams.newest = pageParam.newest
                data = await fetchAllPreviewTraces(windowParams, appId as string)
            }

            // transform to tree
            const transformed: TraceSpanNode[] = []
            if (isTracesResponse(data)) {
                transformed.push(...transformTracingResponse(transformTracesResponseToTree(data)))
            } else if (isSpansResponse(data)) {
                transformed.push(...transformTracingResponse(data.spans))
            }

            // cursor
            let nextCursor: string | undefined = nextCursorFromStep1
            if (isHasAnnotationSelected === -1) {
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
            }

            return {
                traces: transformed,
                traceCount: (data as any)?.count ?? 0,
                nextCursor,
                annotationPageSize,
            }
        },
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
    const {selectedOrganization} = getOrganizationValues()
    const members = selectedOrganization?.default_workspace?.members || []

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
