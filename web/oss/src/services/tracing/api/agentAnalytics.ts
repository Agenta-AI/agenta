import {fetchSpansAnalytics} from "@agenta/entities/trace"
import dayjs from "dayjs"
import utc from "dayjs/plugin/utc"

import {SortResult} from "@/oss/components/Filters/Sort"

import {
    AGENT_ANALYTICS_FAILED_SPECS,
    AGENT_ANALYTICS_FILTER_OPTION_SPECS,
    AGENT_ANALYTICS_SPECS,
    analyticsToAgentWindow,
    analyticsToBreakdowns,
} from "../lib/agentAnalytics"
import {calculateIntervalFromDuration} from "../lib/helpers"
import type {AgentAnalyticsBreakdownItem, AgentAnalyticsDashboard} from "../types/agentAnalytics"

dayjs.extend(utc)

// Attribute keys under `attributes.` for the harness and configured-model filters.
const HARNESS_KEY = "ag.data.parameters.agent.harness.kind"
const MODEL_KEY = "ag.data.parameters.agent.llm.model"

interface FetchAgentAnalyticsOptions {
    projectId: string
    range: SortResult
    /** Workflow (agent) ids to narrow by; empty means the whole project. */
    agentIds?: string[]
    /** Harness kinds to narrow by; empty means every harness. */
    harnessKinds?: string[]
    /** Configured-model aliases to narrow by; empty means every model. */
    models?: string[]
    signal?: AbortSignal
}

interface FilterCondition {
    field: string
    /** Required for `attributes` filters: the dotted path under `attributes.`. */
    key?: string
    operator: string
    value: unknown
}

// Map a window length to the tick-format bucket the observability formatter uses.
const rangeStringFor = (durationMinutes: number): string => {
    const durationHours = durationMinutes / 60
    if (durationHours <= 24) return "24_hours"
    if (durationHours <= 168) return "7_days"
    return "30_days"
}

interface ResolvedWindow {
    oldest: string
    newest: string
    interval: number
    rangeString: string
}

const resolveWindow = (range: SortResult): ResolvedWindow => {
    let startTime: string
    let endTime: string | undefined
    if (range.type === "custom" && range.customRange) {
        startTime = range.customRange.startTime || ""
        endTime = range.customRange.endTime || undefined
        if (!startTime) throw new Error("Custom range startTime is required")
    } else {
        startTime = range.sorted
        endTime = undefined
    }

    const now = dayjs().utc()
    const oldest = dayjs(startTime)
    const newest = endTime ? dayjs(endTime) : now
    if (!oldest.isValid()) throw new Error("Invalid startTime for analytics query")
    if (newest.isBefore(oldest)) throw new Error("endTime must be >= startTime")

    const durationMin = Math.max(1, newest.diff(oldest, "minute"))
    return {
        oldest: oldest.toISOString(),
        newest: newest.toISOString(),
        interval: calculateIntervalFromDuration(durationMin),
        rangeString: rangeStringFor(durationMin),
    }
}

// Every query counts only invocation root spans; annotation/evaluation traces would
// otherwise inflate the figures. `trace_type` is an unprefixed first-class field.
// Harness/model narrow by root-span attributes, which the backend only matches when
// the condition is shaped `{field: "attributes", key, ...}` — a bare dotted `field`
// is silently dropped (filtering.py), so it must not be used here.
const buildConditions = ({
    agentIds = [],
    harnessKinds = [],
    models = [],
}: Pick<FetchAgentAnalyticsOptions, "agentIds" | "harnessKinds" | "models">): FilterCondition[] => {
    const conditions: FilterCondition[] = [
        {field: "trace_type", operator: "is", value: "invocation"},
    ]
    if (agentIds.length) {
        conditions.push({field: "references", operator: "in", value: agentIds.map((id) => ({id}))})
    }
    if (harnessKinds.length) {
        conditions.push({
            field: "attributes",
            key: HARNESS_KEY,
            operator: "in",
            value: harnessKinds,
        })
    }
    if (models.length) {
        conditions.push({field: "attributes", key: MODEL_KEY, operator: "in", value: models})
    }
    return conditions
}

// A single window issues two calls: unfiltered metrics and the status-filtered
// (failed-run) count. See data-contract.md.
export const fetchAgentAnalyticsDashboard = async ({
    projectId,
    range,
    agentIds = [],
    harnessKinds = [],
    models = [],
    signal,
}: FetchAgentAnalyticsOptions): Promise<AgentAnalyticsDashboard> => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

    const conditions = buildConditions({agentIds, harnessKinds, models})
    // A failed run is one whose root span `status_code` is `STATUS_CODE_ERROR`.
    // The operator must be `is` and the value the full enum literal — `eq`/`ERROR`
    // return an empty 200 and would report zero failures forever.
    const failedConditions: FilterCondition[] = [
        ...conditions,
        {field: "status_code", operator: "is", value: "STATUS_CODE_ERROR"},
    ]

    const {oldest, newest, interval, rangeString} = resolveWindow(range)

    const [unfiltered, failed] = await Promise.all([
        fetchSpansAnalytics({
            projectId,
            focus: "trace",
            interval,
            oldest,
            newest,
            filter: {conditions},
            specs: AGENT_ANALYTICS_SPECS,
            abortSignal: signal,
        }),
        fetchSpansAnalytics({
            projectId,
            focus: "trace",
            interval,
            oldest,
            newest,
            filter: {conditions: failedConditions},
            specs: AGENT_ANALYTICS_FAILED_SPECS,
            abortSignal: signal,
        }),
    ])

    const current = analyticsToAgentWindow(
        unfiltered ?? {buckets: []},
        failed ?? {buckets: []},
        rangeString,
    )

    return {current}
}

export interface AgentAnalyticsFilterOptions {
    harness: AgentAnalyticsBreakdownItem[]
    model: AgentAnalyticsBreakdownItem[]
}

interface FetchFilterOptionsOptions {
    projectId: string
    range: SortResult
    agentIds?: string[]
    signal?: AbortSignal
}

// The harness/model filter options, sourced from a breakdown that is NOT narrowed
// by the harness/model filters themselves — so selecting one value never removes
// the others from the dropdown. Still scoped by project, window, and agent.
export const fetchAgentAnalyticsFilterOptions = async ({
    projectId,
    range,
    agentIds = [],
    signal,
}: FetchFilterOptionsOptions): Promise<AgentAnalyticsFilterOptions> => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

    const conditions = buildConditions({agentIds})
    const {oldest, newest, interval} = resolveWindow(range)

    const response = await fetchSpansAnalytics({
        projectId,
        focus: "trace",
        interval,
        oldest,
        newest,
        filter: {conditions},
        specs: AGENT_ANALYTICS_FILTER_OPTION_SPECS,
        abortSignal: signal,
    })

    const {harness, model} = analyticsToBreakdowns(response)
    return {harness, model}
}
