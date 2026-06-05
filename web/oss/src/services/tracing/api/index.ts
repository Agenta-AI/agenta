import dayjs from "dayjs"
import utc from "dayjs/plugin/utc"

import {SortResult} from "@/oss/components/Filters/Sort"
import {ensureAppId, fetchJson, getBaseUrl} from "@/oss/lib/api/assets/fetchClient"
import {getProjectValues} from "@/oss/state/project"

import {calculateIntervalFromDuration, tracingToGeneration} from "../lib/helpers"
import {GenerationDashboardData, TracingDashboardData} from "../types"

dayjs.extend(utc)

// AGE-3788: fetchAllPreviewTraces / fetchAllPreviewTracesWithMeta / fetchPreviewTrace
// / deletePreviewTrace / fetchSessions moved to the Fern client under
// `@agenta/entities/trace` (Phases 1-5). Only the analytics dashboard below
// remains here, pending the Phase 6 migration (gated on the MetricSpec contract).

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

    const base = getBaseUrl()
    const projectId = propsProjectId || stateProjectId
    const applicationId = ensureAppId(appId || undefined)

    if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError")
    }

    const url = new URL(`${base}/tracing/spans/analytics`)
    if (projectId) url.searchParams.set("project_id", projectId)
    if (applicationId) url.searchParams.set("application_id", applicationId)

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

    const payload: Record<string, any> = {
        focus: "trace",
        interval,
        oldest: startTime,
        newest: endTime,
        ...(conditions.length ? {filter: {conditions}} : {}),
    }

    const response = await fetchJson(url, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(payload),
        signal,
    })

    const valTracing = response as TracingDashboardData
    return tracingToGeneration(valTracing, rangeString) as GenerationDashboardData
}
