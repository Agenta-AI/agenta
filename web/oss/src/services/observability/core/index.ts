import {fetchJson, getBaseUrl, ensureProjectId, ensureAppId} from "@/oss/lib/api/assets/fetchClient"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export const fetchAllTraces = async (params = {}, appId: string) => {
    const base = getBaseUrl()
    const projectId = ensureProjectId()
    const applicationId = ensureAppId(appId)

    const url = new URL(`${base}/observability/v1/traces`)
    if (projectId) url.searchParams.set("project_id", projectId)
    if (applicationId) url.searchParams.set("application_id", applicationId)
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
            url.searchParams.set(key, String(value))
        }
    })

    return fetchJson(url)
}

export const deleteTrace = async (nodeId: string) => {
    const base = getBaseUrl()
    const projectId = ensureProjectId()

    const url = new URL(`${base}/observability/v1/traces`)
    if (projectId) url.searchParams.set("project_id", projectId)
    url.searchParams.set("node_id", nodeId)

    return fetchJson(url, {method: "DELETE"})
}
