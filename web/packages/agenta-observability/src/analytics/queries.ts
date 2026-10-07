import {
    fetchAllPreviewTraces,
    fetchSpansAnalytics,
    type AnalyticsMetricSpec,
    type MetricsBucket,
    type TraceSpan,
} from "@agenta/entities/trace"

import type {AnalyticsFilters, AnalyticsWindow} from "./types"

export const PATH = {
    cost: "attributes.ag.metrics.costs.cumulative.total",
    input: "attributes.ag.metrics.tokens.cumulative.prompt",
    output: "attributes.ag.metrics.tokens.cumulative.completion",
    cacheRead: "attributes.ag.metrics.tokens.cumulative.cache_read",
    cacheWrite: "attributes.ag.metrics.tokens.cumulative.cache_creation",
    tokens: "attributes.ag.metrics.tokens.cumulative.total",
    trace: "attributes.ag.type.trace",
    // A run references its agent under `application` or, on older runs, `workflow`.
    agentApp: "attributes.ag.references.application.id",
    agentWorkflow: "attributes.ag.references.workflow.id",
    model: "attributes.ag.data.parameters.agent.llm.model",
    provider: "attributes.ag.data.parameters.agent.llm.provider",
    tool: "attributes.ag.meta.tool.name",
} as const

const MODEL_KEY = "ag.data.parameters.agent.llm.model"
const COST_KEY = "ag.metrics.costs.cumulative.total"
const PROVIDER_KEY = "ag.data.parameters.agent.llm.provider"

export type Condition = Record<string, unknown>

const num = (path: string): AnalyticsMetricSpec => ({type: "numeric/continuous", path})
const cat = (path: string): AnalyticsMetricSpec => ({type: "categorical/single", path})

const FAILED: Condition = {field: "status_code", operator: "is", value: "STATUS_CODE_ERROR"}
// A run is an invocation trace; annotation traces (evaluator feedback) are not runs.
const INVOCATION: Condition = {field: "trace_type", operator: "is", value: "invocation"}
// The API validates span types against its lowercase enum; anything else fails the query.
const spanType = (value: "tool" | "workflow"): Condition => ({
    field: "span_type",
    operator: "is",
    value,
})
// `in` on an attribute key silently matches nothing, so a multi-value pick is an OR of `is`.
const anyOf = (key: string, values: string[]): Condition => ({
    operator: "or",
    conditions: values.map((value) => ({field: "attributes", key, operator: "is", value})),
})

interface QueryDef {
    focus: "trace" | "span"
    /** Run-level queries honour the page filters; call-level span queries cannot (no agent ref). */
    runLevel: boolean
    where: Condition[]
    specs: AnalyticsMetricSpec[]
}

const RUN_TOTALS = [
    num(PATH.cost),
    num(PATH.input),
    num(PATH.output),
    num(PATH.cacheRead),
    num(PATH.cacheWrite),
    num(PATH.tokens),
    cat(PATH.trace),
]

const ANALYTICS_QUERIES = {
    overview: {focus: "trace", runLevel: true, where: [], specs: RUN_TOTALS},
    failed: {focus: "trace", runLevel: true, where: [FAILED], specs: [cat(PATH.trace)]},
    agents: {
        focus: "trace",
        runLevel: true,
        where: [],
        specs: [cat(PATH.agentApp), cat(PATH.agentWorkflow)],
    },
    agentsFailed: {
        focus: "trace",
        runLevel: true,
        where: [FAILED],
        specs: [cat(PATH.agentApp), cat(PATH.agentWorkflow)],
    },
    models: {focus: "trace", runLevel: true, where: [], specs: [cat(PATH.model)]},
    modelsFailed: {focus: "trace", runLevel: true, where: [FAILED], specs: [cat(PATH.model)]},
    providers: {focus: "trace", runLevel: true, where: [], specs: [cat(PATH.provider)]},
    providersFailed: {
        focus: "trace",
        runLevel: true,
        where: [FAILED],
        specs: [cat(PATH.provider)],
    },
    tools: {focus: "span", runLevel: false, where: [spanType("tool")], specs: [cat(PATH.tool)]},
} satisfies Record<string, QueryDef>

export type AnalyticsQueryName = keyof typeof ANALYTICS_QUERIES

/** Narrows a query to one key: an agent, a configured model, or its provider. */
export interface AnalyticsFocus {
    dim: "agent" | "model" | "provider"
    key: string
}

export const filterConditions = (filters: AnalyticsFilters): Condition[] => {
    const out: Condition[] = []
    if (filters.agent.length)
        out.push({
            field: "references",
            operator: "in",
            value: filters.agent.map((id) => ({id})),
        })
    if (filters.model.length) out.push(anyOf(MODEL_KEY, filters.model))
    return out
}

const FOCUS_KEY = {model: MODEL_KEY, provider: PROVIDER_KEY}

const focusCondition = (focus: AnalyticsFocus): Condition =>
    focus.dim === "agent"
        ? {field: "references", operator: "in", value: [{id: focus.key}]}
        : anyOf(FOCUS_KEY[focus.dim], [focus.key])

export interface AnalyticsQueryParams {
    projectId: string
    name: AnalyticsQueryName
    window: AnalyticsWindow
    filters: AnalyticsFilters
    focus?: AnalyticsFocus | null
    /** A second narrowing, e.g. the agent a drawer drilled into while splitting by model. */
    scope?: AnalyticsFocus | null
    signal?: AbortSignal
}

export const fetchAnalyticsBuckets = async ({
    projectId,
    name,
    window,
    filters,
    focus,
    scope,
    signal,
}: AnalyticsQueryParams): Promise<MetricsBucket[]> => {
    const def: QueryDef = ANALYTICS_QUERIES[name]
    const conditions = [
        ...def.where,
        ...(def.runLevel ? [INVOCATION, ...filterConditions(filters)] : []),
        ...[focus, scope].filter((f): f is AnalyticsFocus => Boolean(f)).map(focusCondition),
    ]
    const res = await fetchSpansAnalytics({
        projectId,
        focus: def.focus,
        // The API has no weeks that end at `newest`; a weekly window fetches days and sums them.
        interval: Math.min(window.interval, 24 * 60),
        oldest: new Date(window.oldest).toISOString(),
        newest: new Date(window.newest).toISOString(),
        filter: conditions.length ? {conditions} : undefined,
        specs: def.specs,
        strict: true,
        abortSignal: signal,
    })
    return res?.buckets ?? []
}

export interface AnalyticsRunsParams {
    projectId: string
    window: AnalyticsWindow
    filters: AnalyticsFilters
    focus?: AnalyticsFocus | null
    failedOnly?: boolean
    /** Only runs costing at least this much. */
    minCost?: number | null
    limit: number
}

const throwIfNull = <T>(value: T | null, label: string): T => {
    if (value === null) throw new Error(`${label} failed`)
    return value
}

const spansOf = (res: Awaited<ReturnType<typeof fetchAllPreviewTraces>>): TraceSpan[] =>
    res && "spans" in res ? (res.spans as TraceSpan[]) : []

/** Root spans (one per run), newest first. Every root is a `workflow` span. */
export const fetchAnalyticsRunSpans = async ({
    projectId,
    window,
    filters,
    focus,
    failedOnly,
    minCost,
    limit,
}: AnalyticsRunsParams): Promise<TraceSpan[]> => {
    const conditions = [
        spanType("workflow"),
        INVOCATION,
        ...filterConditions(filters),
        ...(focus ? [focusCondition(focus)] : []),
        ...(failedOnly ? [FAILED] : []),
        ...(minCost != null
            ? [{field: "attributes", key: COST_KEY, operator: "gte", value: minCost}]
            : []),
    ]
    const res = await fetchAllPreviewTraces(
        {
            focus: "span",
            size: limit,
            order: "descending",
            oldest: new Date(window.oldest).toISOString(),
            newest: new Date(window.newest).toISOString(),
            filter: {conditions},
        },
        "",
        projectId,
    )
    return spansOf(throwIfNull(res, "[analytics runs]"))
}

/** Tool spans for a set of runs, to count calls and failures per run. */
export const fetchAnalyticsToolSpans = async (
    projectId: string,
    traceIds: string[],
    window: AnalyticsWindow,
): Promise<TraceSpan[]> => {
    if (!traceIds.length) return []
    const res = await fetchAllPreviewTraces(
        {
            focus: "span",
            size: 1000,
            oldest: new Date(window.oldest).toISOString(),
            newest: new Date(window.newest).toISOString(),
            filter: {
                conditions: [
                    spanType("tool"),
                    {field: "trace_id", operator: "in", value: traceIds},
                ],
            },
        },
        "",
        projectId,
    )
    return spansOf(throwIfNull(res, "[analytics tool spans]"))
}
