import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {getProjectValues} from "@/oss/state/project"

import type {
    QueryCreateRequest,
    QueryEditRequest,
    QueryQueryRequest,
    QueryResponse,
    QueriesResponse,
} from "./types"

const base = () => `${getAgentaApiUrl()}/preview/queries`

export async function createQuery(payload: QueryCreateRequest): Promise<QueryResponse> {
    const {projectId} = getProjectValues()
    const {data} = await axios.post(`${base()}/?project_id=${projectId}`, payload)
    return data as QueryResponse
}

export async function fetchQuery(queryId: string): Promise<QueryResponse> {
    const {projectId} = getProjectValues()
    const {data} = await axios.get(`${base()}/${queryId}?project_id=${projectId}`)
    return data as QueryResponse
}

export async function editQuery(
    queryId: string,
    payload: QueryEditRequest,
): Promise<QueryResponse> {
    const {projectId} = getProjectValues()
    const {data} = await axios.put(`${base()}/${queryId}?project_id=${projectId}`, payload)
    return data as QueryResponse
}

export async function archiveQuery(queryId: string): Promise<QueryResponse> {
    const {projectId} = getProjectValues()
    const {data} = await axios.post(`${base()}/${queryId}/archive?project_id=${projectId}`)
    return data as QueryResponse
}

export async function unarchiveQuery(queryId: string): Promise<QueryResponse> {
    const {projectId} = getProjectValues()
    const {data} = await axios.post(`${base()}/${queryId}/unarchive?project_id=${projectId}`)
    return data as QueryResponse
}

export async function queryQueries(payload: QueryQueryRequest = {}): Promise<QueriesResponse> {
    const {projectId} = getProjectValues()
    const {data} = await axios.post(`${base()}/query?project_id=${projectId}`, payload)
    return data as QueriesResponse
}
