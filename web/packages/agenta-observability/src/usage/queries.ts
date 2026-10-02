import {
    fetchAllPreviewTraces,
    fetchSpansAnalytics,
    type AnalyticsMetricSpec,
    type MetricsBucket,
    type TraceSpan,
} from "@agenta/entities/trace"

import type {UsageDimension, UsageFilters, UsageWindow} from "./types"

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
    callModel: "attributes.ag.meta.request.model",
    callCost: "attributes.ag.metrics.costs.incremental.total",
    callTokens: "attributes.ag.metrics.tokens.incremental.total",
    tool: "attributes.ag.meta.tool.name",
} as const

const MODEL_KEY = "ag.data.parameters.agent.llm.model"
const CALL_MODEL_KEY = "ag.meta.request.model"
const SUBSCRIPTION_KEY = "ag.data.parameters.agent.llm.connection.mode"

export type Condition = Record<string, unknown>

const num = (path: string): AnalyticsMetricSpec => ({type: "numeric/continuous", path})
const cat = (path: string): AnalyticsMetricSpec => ({type: "categorical/single", path})

// The API validates span types against its lowercase enum; anything else fails the query.
const FAILED: Condition = {field: "status_code", operator: "is", value: "STATUS_CODE_ERROR"}
const spanType = (value: "chat" | "tool" | "workflow"): Condition => ({
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

export const USAGE_QUERIES = {
    overview: {focus: "trace", runLevel: true, where: [], specs: RUN_TOTALS},
    failed: {focus: "trace", runLevel: true, where: [FAILED], specs: [cat(PATH.trace)]},
    subscription: {
        focus: "trace",
        runLevel: true,
        where: [
            {field: "attributes", key: SUBSCRIPTION_KEY, operator: "is", value: "self_managed"},
        ],
        specs: [num(PATH.cost)],
    },
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
    calls: {
        focus: "span",
        runLevel: false,
        where: [spanType("chat")],
        specs: [cat(PATH.callModel), num(PATH.callCost), num(PATH.callTokens)],
    },
    tools: {focus: "span", runLevel: false, where: [spanType("tool")], specs: [cat(PATH.tool)]},
    toolsFailed: {
        focus: "span",
        runLevel: false,
        where: [spanType("tool"), FAILED],
        specs: [cat(PATH.tool)],
    },
} satisfies Record<string, QueryDef>

export type UsageQueryName = keyof typeof USAGE_QUERIES

/** Narrows a query to one breakdown key: an agent, a configured model, or a called model. */
export interface UsageFocus {
    dim: "agent" | "model" | "callModel"
    key: string
}

export const filterConditions = (filters: UsageFilters): Condition[] => {
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

export const focusCondition = (focus: UsageFocus): Condition =>
    focus.dim === "agent"
        ? {field: "references", operator: "in", value: [{id: focus.key}]}
        : anyOf(focus.dim === "model" ? MODEL_KEY : CALL_MODEL_KEY, [focus.key])

export const isRunLevel = (name: UsageQueryName) => USAGE_QUERIES[name].runLevel

export interface UsageQueryParams {
    projectId: string
    name: UsageQueryName
    window: UsageWindow
    filters: UsageFilters
    focus?: UsageFocus | null
    /** A second narrowing, e.g. the agent a drawer drilled into while splitting by model. */
    scope?: UsageFocus | null
    signal?: AbortSignal
}

export const fetchUsageBuckets = async ({
    projectId,
    name,
    window,
    filters,
    focus,
    scope,
    signal,
}: UsageQueryParams): Promise<MetricsBucket[]> => {
    const def: QueryDef = USAGE_QUERIES[name]
    const conditions = [
        ...def.where,
        ...(def.runLevel ? filterConditions(filters) : []),
        ...[focus, scope].filter((f): f is UsageFocus => Boolean(f)).map(focusCondition),
    ]
    const res = await fetchSpansAnalytics({
        projectId,
        focus: def.focus,
        interval: window.interval,
        oldest: new Date(window.oldest).toISOString(),
        newest: new Date(window.newest).toISOString(),
        filter: conditions.length ? {conditions} : undefined,
        specs: def.specs,
        strict: true,
        abortSignal: signal,
    })
    return res?.buckets ?? []
}

export interface UsageRunsParams {
    projectId: string
    window: UsageWindow
    filters: UsageFilters
    focus?: UsageFocus | null
    failedOnly?: boolean
    limit: number
}

const throwIfNull = <T>(value: T | null, label: string): T => {
    if (value === null) throw new Error(`${label} failed`)
    return value
}

const spansOf = (res: Awaited<ReturnType<typeof fetchAllPreviewTraces>>): TraceSpan[] =>
    res && "spans" in res ? (res.spans as TraceSpan[]) : []

/** Root spans (one per run), newest first. Every root is a `workflow` span. */
export const fetchUsageRunSpans = async ({
    projectId,
    window,
    filters,
    focus,
    failedOnly,
    limit,
}: UsageRunsParams): Promise<TraceSpan[]> => {
    const conditions = [
        spanType("workflow"),
        ...filterConditions(filters),
        ...(focus ? [focusCondition(focus)] : []),
        ...(failedOnly ? [FAILED] : []),
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
    return spansOf(throwIfNull(res, "[usage runs]"))
}

/** Tool spans for a set of runs, to count calls and failures per run. */
export const fetchUsageToolSpans = async (
    projectId: string,
    traceIds: string[],
): Promise<TraceSpan[]> => {
    if (!traceIds.length) return []
    const res = await fetchAllPreviewTraces(
        {
            focus: "span",
            size: 1000,
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
    return spansOf(throwIfNull(res, "[usage tool spans]"))
}

export const DIMENSION_QUERIES: Record<
    UsageDimension,
    {runs: UsageQueryName; failed: UsageQueryName}
> = {
    agent: {runs: "agents", failed: "agentsFailed"},
    model: {runs: "models", failed: "modelsFailed"},
    tool: {runs: "tools", failed: "toolsFailed"},
}
