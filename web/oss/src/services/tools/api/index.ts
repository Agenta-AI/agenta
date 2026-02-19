import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"

import type {
    ProvidersResponse,
    IntegrationsResponse,
    IntegrationDetailResponse,
    ActionsListResponse,
    ActionDetailResponse,
    ConnectionCreateRequest,
    ConnectionResponse,
    ConnectionsQueryResponse,
    ToolCallRequest,
    ToolCallResponse,
} from "./types"

// Prefix convention:
//  - fetch: GET single/list entity from server
//  - create: POST data to server
//  - delete: DELETE data from server
//  - query: POST query with filters

const BASE = () => `${getAgentaApiUrl()}/preview/tools`

// --- Catalog browse ---

export const fetchProviders = async (): Promise<ProvidersResponse> => {
    const {data} = await axios.get(`${BASE()}/catalog/providers/`)
    return data
}

export const fetchIntegrations = async (
    providerKey: string,
    params?: {search?: string; sort_by?: string; limit?: number; cursor?: string},
): Promise<IntegrationsResponse> => {
    const {data} = await axios.get(`${BASE()}/catalog/providers/${providerKey}/integrations/`, {
        params,
    })
    return data
}

export const fetchIntegrationDetail = async (
    providerKey: string,
    integrationKey: string,
): Promise<IntegrationDetailResponse> => {
    const {data} = await axios.get(
        `${BASE()}/catalog/providers/${providerKey}/integrations/${integrationKey}`,
    )
    return data
}

export const fetchActions = async (
    providerKey: string,
    integrationKey: string,
    params?: {
        query?: string
        categories?: string[]
        limit?: number
        cursor?: string
        important?: boolean
    },
): Promise<ActionsListResponse> => {
    const {data} = await axios.get(
        `${BASE()}/catalog/providers/${providerKey}/integrations/${integrationKey}/actions/`,
        {params},
    )
    return data
}

export const fetchActionDetail = async (
    providerKey: string,
    integrationKey: string,
    actionKey: string,
): Promise<ActionDetailResponse> => {
    const {data} = await axios.get(
        `${BASE()}/catalog/providers/${providerKey}/integrations/${integrationKey}/actions/${actionKey}`,
    )
    return data
}

// --- Connections ---

export const queryConnections = async (params?: {
    provider_key?: string
    integration_key?: string
}): Promise<ConnectionsQueryResponse> => {
    const {data} = await axios.post(`${BASE()}/connections/query`, null, {params})
    return data
}

export const fetchConnection = async (connectionId: string): Promise<ConnectionResponse> => {
    const {data} = await axios.get(`${BASE()}/connections/${connectionId}`)
    return data
}

export const createConnection = async (
    payload: ConnectionCreateRequest,
): Promise<ConnectionResponse> => {
    const {data} = await axios.post(`${BASE()}/connections/`, payload)
    return data
}

export const deleteToolConnection = async (connectionId: string): Promise<void> => {
    await axios.delete(`${BASE()}/connections/${connectionId}`)
}

export const refreshToolConnection = async (
    connectionId: string,
    force?: boolean,
): Promise<ConnectionResponse> => {
    const {data} = await axios.post(`${BASE()}/connections/${connectionId}/refresh`, null, {
        params: force ? {force: true} : undefined,
    })
    return data
}

export const revokeToolConnection = async (connectionId: string): Promise<ConnectionResponse> => {
    const {data} = await axios.post(`${BASE()}/connections/${connectionId}/revoke`)
    return data
}

// --- Tool execution ---

export const executeToolCall = async (payload: ToolCallRequest): Promise<ToolCallResponse> => {
    const {data} = await axios.post(`${BASE()}/call`, payload)
    return data
}
