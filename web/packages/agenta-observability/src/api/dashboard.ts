import {fetchSpansAnalytics} from "@agenta/entities/trace"
import {dayjs} from "@agenta/shared/utils/dateTime"
import utc from "dayjs/plugin/utc"

import {analyticsToDashboard, calculateIntervalFromDuration} from "../core/analytics"
import type {AnalyticsRange, DashboardData} from "../core/types"

dayjs.extend(utc)

export interface DashboardAnalyticsParams {
    projectId: string
    range: AnalyticsRange
    /** Scope to one app/agent; omit for the whole project. */
    appId?: string | null
    environment?: string
    variant?: string
    signal?: AbortSignal
}

/**
 * The usage/observability figures for one time window, served by
 * `POST /spans/analytics/query` through the Fern client (AGE-3788 — no raw `/tracing/*` left).
 */
export const fetchDashboardAnalytics = async ({
    projectId,
    range,
    appId,
    environment,
    variant,
    signal,
}: DashboardAnalyticsParams): Promise<DashboardData> => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

    const conditions: Record<string, unknown>[] = []

    if (appId) conditions.push({field: "references", operator: "in", value: [{id: appId}]})
    if (environment) conditions.push({field: "environment", operator: "eq", value: environment})
    if (variant) conditions.push({field: "variant", operator: "eq", value: variant})

    let startTime: string
    let endTime: string | undefined

    if (range.type === "custom" && range.customRange) {
        startTime = range.customRange.startTime || ""
        endTime = range.customRange.endTime || undefined
        if (!startTime) throw new Error("Custom range startTime is required")
    } else {
        startTime = range.sorted
        endTime = undefined // implied "now" for standard ranges
    }

    const startDayjs = dayjs(startTime)
    const endDayjs = endTime ? dayjs(endTime) : dayjs()

    if (!startDayjs.isValid()) throw new Error("Invalid startTime for tracing analytics query")
    if (endTime && !endDayjs.isValid())
        throw new Error("Invalid endTime for tracing analytics query")
    if (endDayjs.isBefore(startDayjs))
        throw new Error("endTime must be greater than or equal to startTime")

    const durationMin = Math.max(1, endDayjs.diff(startDayjs, "minute"))
    const interval = calculateIntervalFromDuration(durationMin)

    // Tick formatting only — the bucket width is `interval` above.
    let rangeString = "30_days"
    const durationHours = durationMin / 60
    if (durationHours <= 24) rangeString = "24_hours"
    else if (durationHours <= 168) rangeString = "7_days"

    const analytics = await fetchSpansAnalytics({
        projectId,
        appId: appId ?? "",
        focus: "trace",
        interval,
        oldest: startTime,
        newest: endTime,
        filter: conditions.length ? {conditions} : undefined,
        abortSignal: signal,
    })

    // `fetchSpansAnalytics` returns null on non-2xx / shape-mismatch; the dashboard treats
    // that as "no data" rather than throwing.
    return analyticsToDashboard(analytics ?? {buckets: []}, rangeString)
}
