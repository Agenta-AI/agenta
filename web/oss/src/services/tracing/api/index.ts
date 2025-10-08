import {getBaseUrl, fetchJson, ensureProjectId, ensureAppId} from "@/oss/lib/api/assets/fetchClient"

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
