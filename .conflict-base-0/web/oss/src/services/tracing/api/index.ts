import {fetchSpansAnalytics} from "@agenta/entities/trace"
import dayjs from "dayjs"
import utc from "dayjs/plugin/utc"

import {SortResult} from "@/oss/components/Filters/Sort"
import {ensureAppId} from "@/oss/lib/api/assets/fetchClient"
import {getProjectValues} from "@/oss/state/project"

import {analyticsToGeneration, calculateIntervalFromDuration} from "../lib/helpers"
import {GenerationDashboardData} from "../types"

dayjs.extend(utc)

// AGE-3788: every tracing call in this module is now served by the Fern client
// under `@agenta/entities/trace` — list/detail/delete/sessions (Phases 1-5) and
// the analytics dashboard below (Phase 6, `fetchSpansAnalytics` ->
// POST /spans/analytics/query). No raw `/tracing/*` fetch remains.

export const fetchGenerationsDashboardData = async (
    appId: string | null | undefined,
    _options: {
        range: SortResult
        environment?: string
        variant?: string
        projectId?: string
        signal?: AbortSignal
    },
): Promise<GenerationDashboardData> => {
    const {projectId: propsProjectId, signal, ...options} = _options
    const {projectId: stateProjectId} = getProjectValues()

    const projectId = propsProjectId || stateProjectId
    const applicationId = ensureAppId(appId || undefined)

    if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError")
    }

    const conditions: any[] = []

    if (applicationId) {
        conditions.push({
            field: "references",
            operator: "in",
            value: [{id: applicationId}],
        })
    }
    if (options.environment) {
        conditions.push({
            field: "environment",
            operator: "eq",
            value: options.environment,
        })
    }
    if (options.variant) {
        conditions.push({
            field: "variant",
            operator: "eq",
            value: options.variant,
        })
    }

    let startTime: string
    let endTime: string | undefined

    if (options.range.type === "custom" && options.range.customRange) {
        startTime = options.range.customRange.startTime || ""
        endTime = options.range.customRange.endTime || undefined

        if (!startTime) {
            throw new Error("Custom range startTime is required")
        }
    } else {
        startTime = options.range.sorted
        endTime = undefined // implied "now" for standard ranges
    }

    const startDayjs = dayjs(startTime)
    const endDayjs = endTime ? dayjs(endTime) : dayjs()

    if (!startDayjs.isValid()) {
        throw new Error("Invalid startTime for tracing analytics query")
    }
    if (endTime && !endDayjs.isValid()) {
        throw new Error("Invalid endTime for tracing analytics query")
    }
    if (endDayjs.isBefore(startDayjs)) {
        throw new Error("endTime must be greater than or equal to startTime")
    }

    const durationMin = Math.max(1, endDayjs.diff(startDayjs, "minute"))
    const interval = calculateIntervalFromDuration(durationMin)

    // Determine rangeString for formatting ticks to maintain compatibility
    let rangeString = "30_days"
    const durationHours = durationMin / 60
    if (durationHours <= 24) rangeString = "24_hours"
    else if (durationHours <= 168) rangeString = "7_days"

    const analytics = await fetchSpansAnalytics({
        projectId: projectId ?? "",
        appId: applicationId,
        focus: "trace",
        interval,
        oldest: startTime,
        newest: endTime,
        filter: conditions.length ? {conditions} : undefined,
        abortSignal: signal,
    })

    // `fetchSpansAnalytics` returns null on non-2xx / shape-mismatch; the
    // dashboard treats that as "no data" rather than throwing.
    return analyticsToGeneration(analytics ?? {buckets: []}, rangeString)
}
