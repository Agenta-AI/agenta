import {fetchSpansAnalytics} from "@agenta/entities/trace"
import dayjs from "dayjs"
import utc from "dayjs/plugin/utc"

import {SortResult} from "@/oss/components/Filters/Sort"

import {
    AGENT_ANALYTICS_FAILED_SPECS,
    AGENT_ANALYTICS_SPECS,
    analyticsToAgentWindow,
} from "../lib/agentAnalytics"
import {calculateIntervalFromDuration} from "../lib/helpers"
import type {AgentAnalyticsDashboard, AgentAnalyticsWindow} from "../types/agentAnalytics"

dayjs.extend(utc)

interface FetchAgentAnalyticsOptions {
    projectId: string
    range: SortResult
    /** Workflow (agent) ids to narrow by; empty means the whole project. */
    agentIds?: string[]
    signal?: AbortSignal
}

interface FilterCondition {
    field: string
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

// Current window + the equal-length window before it (change badges); each window
// runs an unfiltered and a status-filtered query, so four calls total.
// See docs/design/agent-analytics/data-contract.md.
export const fetchAgentAnalyticsDashboard = async ({
    projectId,
    range,
    agentIds = [],
    signal,
}: FetchAgentAnalyticsOptions): Promise<AgentAnalyticsDashboard> => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

    // At project scope with no agent selected, omit the reference conditions so
    // the query spans every agent; otherwise narrow by the selected workflow ids.
    const conditions: FilterCondition[] = agentIds.length
        ? [{field: "references", operator: "in", value: agentIds.map((id) => ({id}))}]
        : []
    const failedConditions: FilterCondition[] = [
        ...conditions,
        {field: "status_code", operator: "eq", value: "ERROR"},
    ]

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
    const curOldest = dayjs(startTime)
    const curNewest = endTime ? dayjs(endTime) : now
    if (!curOldest.isValid()) throw new Error("Invalid startTime for analytics query")
    if (curNewest.isBefore(curOldest)) throw new Error("endTime must be >= startTime")

    const durationMin = Math.max(1, curNewest.diff(curOldest, "minute"))
    const interval = calculateIntervalFromDuration(durationMin)
    const rangeString = rangeStringFor(durationMin)

    // Previous window: the equal-length span immediately before the current one.
    const prevNewest = curOldest
    const prevOldest = curOldest.subtract(durationMin, "minute")

    const queryWindow = async (oldest: string, newest: string): Promise<AgentAnalyticsWindow> => {
        const [unfiltered, failed] = await Promise.all([
            fetchSpansAnalytics({
                projectId,
                focus: "trace",
                interval,
                oldest,
                newest,
                filter: conditions.length ? {conditions} : undefined,
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
        return analyticsToAgentWindow(
            unfiltered ?? {buckets: []},
            failed ?? {buckets: []},
            rangeString,
        )
    }

    const [current, previous] = await Promise.all([
        queryWindow(curOldest.toISOString(), curNewest.toISOString()),
        queryWindow(prevOldest.toISOString(), prevNewest.toISOString()),
    ])

    return {current, previous: previous.totals}
}
