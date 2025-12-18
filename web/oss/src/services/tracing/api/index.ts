import {ensureAppId, ensureProjectId, fetchJson, getBaseUrl} from "@/oss/lib/api/assets/fetchClient"
import {getProjectValues} from "@/oss/state/project"

import {rangeToIntervalMinutes, tracingToGeneration} from "../lib/helpers"
import {GenerationDashboardData, TracingDashboardData} from "../types"

export const fetchAllPreviewTraces = async (params: Record<string, any> = {}, appId: string) => {
    const base = getBaseUrl()
    const projectId = ensureProjectId()
    const applicationId = ensureAppId(appId)

    // New query endpoint expects POST with JSON body
    const url = new URL(`${base}/preview/tracing/spans/query`)
    if (projectId) url.searchParams.set("project_id", projectId)
    if (applicationId) url.searchParams.set("application_id", applicationId)

    const payload: Record<string, any> = {}
    Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null) return
        if (key === "size") {
            payload.limit = Number(value)
        } else if (key === "filter" && typeof value === "string") {
            try {
                payload.filter = JSON.parse(value)
            } catch {
                payload.filter = value
            }
        } else {
            payload[key] = value
        }
    })

    return fetchJson(url, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(payload),
    })
}

export const fetchPreviewTrace = async (traceId: string) => {
    const base = getBaseUrl()
    const projectId = ensureProjectId()

    const url = new URL(`${base}/preview/tracing/traces/${traceId}`)
    if (projectId) url.searchParams.set("project_id", projectId)

    return fetchJson(url)
}

export const deletePreviewTrace = async (traceId: string) => {
    const base = getBaseUrl()
    const projectId = ensureProjectId()

    const url = new URL(`${base}/preview/tracing/traces/${traceId}`)
    if (projectId) url.searchParams.set("project_id", projectId)

    return fetchJson(url, {method: "DELETE"})
}

export const fetchSessions = async (params: {
    appId?: string
    windowing?: {
        oldest?: string
        newest?: string
    }
    cursor?: string
}) => {
    const base = getBaseUrl()
    const projectId = ensureProjectId()
    const applicationId = params.appId ? ensureAppId(params.appId) : undefined

    const url = new URL(`${base}/preview/tracing/sessions/query`)
    if (projectId) url.searchParams.set("project_id", projectId)
    if (applicationId) url.searchParams.set("application_id", applicationId)

    const payload: Record<string, any> = {}
    if (params.windowing) {
        payload.windowing = params.windowing
    }
    if (params.cursor) {
        payload.cursor = params.cursor
    }

    return fetchJson(url, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(payload),
    })
}

export const fetchGenerationsDashboardData = async (
    appId: string | null | undefined,
    _options: {
        range: string
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

    const url = new URL(`${base}/preview/tracing/spans/analytics`)
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

    const payload: Record<string, any> = {
        focus: "trace",
        interval: rangeToIntervalMinutes(options.range),
        ...(conditions.length ? {filter: {conditions}} : {}),
    }

    const response = await fetchJson(url, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(payload),
        signal,
    })

    const valTracing = response as TracingDashboardData
    return tracingToGeneration(valTracing, options.range) as GenerationDashboardData
}
