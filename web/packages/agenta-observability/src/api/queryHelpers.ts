import {
    fetchAllPreviewTracesWithMeta,
    isSpansResponse,
    isTracesResponse,
    transformTracesResponseToTree,
    transformTracingResponse,
    type PreviewTracesRateLimit,
} from "@agenta/entities/trace"

import type {TraceSpanNode} from "../core/traceSpan"
import type {Filter, SortResult} from "../core/types"
import {normalizeReferenceValue, parseReferenceKey} from "../filters/referenceUtils"

interface LinkCarrier {
    links?: unknown
    spans?: unknown
}

interface SpanLink {
    trace_id?: string
    span_id?: string
}

const toLinks = (links: unknown): SpanLink[] =>
    Array.isArray(links)
        ? (links as SpanLink[])
        : links && typeof links === "object"
          ? Object.values(links as Record<string, SpanLink>)
          : []

interface TimestampCarrier {
    start_time?: string | number | null
    startTime?: string | number | null
    timestamp?: string | number | null
    ts?: string | number | null
    created_at?: string | number | null
}

export interface Condition {
    field: string
    operator: string
    value?: unknown
    key?: string
}

interface AnnotationFilterValue {
    evaluator?: string
    feedback?: {field: string; operator: string; value: unknown}
}

export const buildAnnotationConditions = (value: unknown, operator: string): Condition[] => {
    const v = (Array.isArray(value) ? value[0] : value || {}) as AnnotationFilterValue
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

export const toFilterString = (conditions?: Condition[]) =>
    conditions && conditions.length ? JSON.stringify({conditions}) : undefined

export const parseFilterJSON = (filterStr?: string): Condition[] => {
    if (!filterStr) return []
    try {
        const obj = JSON.parse(filterStr)
        return Array.isArray(obj?.conditions) ? obj.conditions : []
    } catch {
        return []
    }
}

export const mergeConditions = (baseFilterJSON: string | undefined, extra: Condition[]) => {
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

export const buildFiltersForHasAnnotation = (
    windowParams: Record<string, unknown>,
    annotationConditions: Condition[],
    operator?: string,
) => {
    const originalConditions = parseFilterJSON(windowParams.filter as string | undefined)

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

export const buildTraceQueryParams = (
    filters: Filter[],
    sort: SortResult | undefined,
    traceTabs: string,
    limit?: number,
) => {
    const params: Record<string, unknown> = {
        focus: traceTabs === "chat" ? "span" : traceTabs,
    }

    if (limit) params.size = limit

    let hasAnnotationConditions: Condition[] = []
    const isHasAnnotationSelected = filters.findIndex((f) => f.field === "has_annotation")
    const hasAnnotationOperator =
        isHasAnnotationSelected === -1 ? undefined : filters[isHasAnnotationSelected]?.operator

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

    return {params, hasAnnotationConditions, hasAnnotationOperator, isHasAnnotationSelected}
}

export const extractLinkedIds = (data: unknown) => {
    const traceIds = new Set<string>()
    const spanIds = new Set<string>()

    const payload = (data ?? {}) as {traces?: unknown; spans?: unknown}

    // shape 1: { traces: { [id]: { spans: { [id]: { links }}}}}
    if (payload.traces && typeof payload.traces === "object") {
        for (const trace of Object.values<LinkCarrier>(
            payload.traces as Record<string, LinkCarrier>,
        )) {
            if (!trace?.spans) continue
            for (const span of Object.values<LinkCarrier>(
                trace.spans as Record<string, LinkCarrier>,
            )) {
                const links = toLinks(span?.links)
                for (const l of links) {
                    if (l?.trace_id) traceIds.add(String(l.trace_id))
                    if (l?.span_id) spanIds.add(String(l.span_id))
                }
            }
        }
    }

    // shape 2: { spans: { [id]: {...} } } or { spans: Span[] }
    const spansContainer = payload.spans
    const spansIterable: LinkCarrier[] = Array.isArray(spansContainer)
        ? (spansContainer as LinkCarrier[])
        : spansContainer && typeof spansContainer === "object"
          ? Object.values(spansContainer as Record<string, LinkCarrier>)
          : []
    for (const span of spansIterable) {
        const links = toLinks(span?.links)
        for (const l of links) {
            if (l?.trace_id) traceIds.add(String(l.trace_id))
            if (l?.span_id) spanIds.add(String(l.span_id))
        }
    }

    return {traceIds: [...traceIds], spanIds: [...spanIds]}
}

export const extractEarliestTimestamp = (data: unknown): string | undefined => {
    const getTs = (n: TimestampCarrier) =>
        n?.start_time ?? n?.startTime ?? n?.timestamp ?? n?.ts ?? n?.created_at ?? null

    const spans = (data as {spans?: unknown} | null)?.spans
    const list: TimestampCarrier[] = Array.isArray(spans)
        ? (spans as TimestampCarrier[])
        : spans && typeof spans === "object"
          ? Object.values(spans as Record<string, TimestampCarrier>)
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

export const executeTraceQuery = async ({
    params,
    pageParam,
    appId,
    projectId,
    isHasAnnotationSelected,
    hasAnnotationConditions,
    hasAnnotationOperator,
    signal,
}: {
    params: Record<string, unknown>
    pageParam?: {newest?: string}
    appId: string
    projectId: string
    isHasAnnotationSelected: number
    hasAnnotationConditions: Condition[]
    hasAnnotationOperator?: string
    signal?: AbortSignal
}) => {
    const windowParams = {...params}
    let data: unknown = []
    let annotationPageSize: number | undefined
    let nextCursorFromStep1: string | undefined
    // Latest server-side rate-limit headers — propagated to the caller so the
    // export's adaptive pacing can throttle proactively. Reset each call, so
    // even a long-running scan sees fresh bucket state on every page.
    let lastRateLimit: PreviewTracesRateLimit = {remaining: null, limit: null}

    const fetchPage = async (pageParams: Record<string, unknown>) => {
        const result = await fetchAllPreviewTracesWithMeta(
            pageParams,
            appId,
            projectId ?? "",
            signal,
        )
        lastRateLimit = result.rateLimit
        return result.data
    }

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

        const data1 = await fetchPage(firstParams)

        // page size for pagination decision
        const countEntries = (container: unknown) => {
            if (!container) return 0
            if (Array.isArray(container)) return container.length
            if (typeof container === "object") return Object.keys(container).length
            return 0
        }
        const page1 = data1 as {spans?: unknown; traces?: unknown} | null
        const spansPageSize = countEntries(page1?.spans)
        const tracesPageSize = countEntries(page1?.traces)
        annotationPageSize = spansPageSize || tracesPageSize

        // cursor from step 1 only
        nextCursorFromStep1 = extractEarliestTimestamp(data1)
        if (nextCursorFromStep1 && typeof params.oldest === "string") {
            const lb = Date.parse(params.oldest)
            const nc = Date.parse(nextCursorFromStep1)
            if (!Number.isNaN(lb) && !Number.isNaN(nc) && nc <= lb) nextCursorFromStep1 = undefined
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
                rateLimit: lastRateLimit,
            }
        }

        if (shouldExcludeAnnotations && traceIds.length === 0 && spanIds.length === 0) {
            if (pageParam?.newest) windowParams.newest = pageParam.newest
            data = await fetchPage(windowParams)
        } else {
            // STEP 2: not paginated
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

            const secondParams: Record<string, unknown> = {...params}
            delete secondParams.newest
            delete secondParams.oldest
            if (!shouldExcludeAnnotations) {
                secondParams.size = Math.max(traceIds.length, spanIds.length)
            }
            secondParams.filter = mergeConditions(originalFilter, extraConditions)

            data = await fetchPage(secondParams)
        }
    } else {
        // normal flow
        if (pageParam?.newest) windowParams.newest = pageParam.newest
        data = await fetchPage(windowParams)
    }

    // transform to tree
    const transformed: TraceSpanNode[] = []
    // entities-package TraceSpanNode is the same backend span shape as the OSS type;
    // align the annotation at the boundary, no data is converted.
    if (isTracesResponse(data)) {
        transformed.push(
            ...(transformTracingResponse(
                transformTracesResponseToTree(data),
            ) as unknown as TraceSpanNode[]),
        )
    } else if (isSpansResponse(data)) {
        transformed.push(...(transformTracingResponse(data.spans) as unknown as TraceSpanNode[]))
    }

    // cursor
    let nextCursor: string | undefined = nextCursorFromStep1
    if (isHasAnnotationSelected === -1) {
        const getTs = (n: TimestampCarrier) =>
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
            // Bump by +1ms so the backend's strict-less-than filter
            // (`start_time < newest`) still includes traces at this exact
            // timestamp. Downstream dedup (the export pipeline's dedup
            // transform, the queue scan's dedup-key transform) handles any
            // resulting overlap.
            const cursorDate = new Date(minVal + 1)
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
        traceCount: (data as {count?: number} | null)?.count ?? 0,
        nextCursor,
        annotationPageSize,
        rateLimit: lastRateLimit,
    }
}
