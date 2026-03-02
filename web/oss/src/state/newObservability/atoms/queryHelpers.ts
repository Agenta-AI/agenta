import {
    normalizeReferenceValue,
    parseReferenceKey,
} from "@/oss/components/pages/observability/assets/filters/referenceUtils"
import {fetchAllPreviewTraces} from "@/oss/services/tracing/api"
import {
    isSpansResponse,
    isTracesResponse,
    transformTracesResponseToTree,
    transformTracingResponse,
} from "@/oss/services/tracing/lib/helpers"
import {TraceSpanNode} from "@/oss/services/tracing/types"

export interface Condition {
    field: string
    operator: string
    value?: any
    key?: string
}

export const buildAnnotationConditions = (value: any, operator: string): Condition[] => {
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

export const buildTraceQueryParams = (
    filters: any[],
    sort: any,
    traceTabs: string,
    limit?: number,
) => {
    const params: Record<string, any> = {
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

export const extractLinkedIds = (data: any) => {
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

export const extractEarliestTimestamp = (data: any): string | undefined => {
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

export const executeTraceQuery = async ({
    params,
    pageParam,
    appId,
    isHasAnnotationSelected,
    hasAnnotationConditions,
    hasAnnotationOperator,
}: {
    params: Record<string, any>
    pageParam?: {newest?: string}
    appId: string
    isHasAnnotationSelected: number
    hasAnnotationConditions: Condition[]
    hasAnnotationOperator?: string
}) => {
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

        const data1 = await fetchAllPreviewTraces(firstParams, appId)

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
            }
        }

        if (shouldExcludeAnnotations && traceIds.length === 0 && spanIds.length === 0) {
            if (pageParam?.newest) windowParams.newest = pageParam.newest
            data = await fetchAllPreviewTraces(windowParams, appId)
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

            const secondParams: Record<string, any> = {...params}
            delete secondParams.newest
            delete secondParams.oldest
            if (!shouldExcludeAnnotations) {
                secondParams.size = Math.max(traceIds.length, spanIds.length)
            }
            secondParams.filter = mergeConditions(originalFilter, extraConditions)

            data = await fetchAllPreviewTraces(secondParams, appId)
        }
    } else {
        // normal flow
        if (pageParam?.newest) windowParams.newest = pageParam.newest
        data = await fetchAllPreviewTraces(windowParams, appId)
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
}
