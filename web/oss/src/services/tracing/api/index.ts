import {getBaseUrl, fetchJson, ensureProjectId, ensureAppId} from "@/oss/lib/api/assets/fetchClient"

export const fetchAllPreviewTraces = async (params: Record<string, any> = {}, appId: string) => {
    const base = getBaseUrl()
    const projectId = ensureProjectId()
    const applicationId = ensureAppId(appId)

    const url = new URL(`${base}/preview/tracing/spans/`)
    if (projectId) url.searchParams.set("project_id", projectId)
    if (applicationId) url.searchParams.set("application_id", applicationId)

    Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null) return
        if (key === "size") {
            url.searchParams.set("limit", String(value))
        } else {
            const encoded = typeof value === "object" ? JSON.stringify(value) : String(value)
            url.searchParams.set(key, encoded)
        }
    })

    return fetchJson(url)
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
