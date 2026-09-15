// This domain uses the shared Axios client the host configures.
import {axios, getAgentaApiUrl} from "@agenta/shared/api"

import type {
    MCPConnectResponse,
    MCPEndpointCreate,
    MCPEndpointEdit,
    MCPEndpointResponse,
    MCPEndpointsResponse,
} from "../core/types"

const BASE = "/gateways/mcps/endpoints"

export const listMcpEndpoints = async (projectId?: string): Promise<MCPEndpointsResponse> => {
    const response = await axios.get(`${getAgentaApiUrl()}${BASE}/`, {
        params: projectId ? {project_id: projectId} : undefined,
    })
    return response.data
}

export const createMcpEndpoint = async (
    endpoint: MCPEndpointCreate,
    projectId?: string,
): Promise<MCPEndpointResponse> => {
    const response = await axios.post(
        `${getAgentaApiUrl()}${BASE}/`,
        {endpoint},
        {params: projectId ? {project_id: projectId} : undefined},
    )
    return response.data
}

export const editMcpEndpoint = async (
    endpoint: MCPEndpointEdit,
    projectId?: string,
): Promise<MCPEndpointResponse> => {
    const response = await axios.put(
        `${getAgentaApiUrl()}${BASE}/${endpoint.id}`,
        {endpoint},
        {params: projectId ? {project_id: projectId} : undefined},
    )
    return response.data
}

export const deleteMcpEndpoint = async (endpointId: string, projectId?: string): Promise<void> => {
    await axios.delete(`${getAgentaApiUrl()}${BASE}/${endpointId}`, {
        params: projectId ? {project_id: projectId} : undefined,
    })
}

/**
 * Revoke this endpoint's OAuth grant, keeping the endpoint.
 *
 * Deleting the row is not the same act: the row carries the identity agent configs
 * reference, so disconnecting must leave `id`, `slug`, `name`, URL and policy in place and
 * take only the credential. Idempotent, so a second click is safe. The endpoint comes back
 * with no `secret_id` (the response omits nulls), which `getMcpConnectionState` reads as
 * `needs_auth`.
 */
export const disconnectMcpEndpoint = async (
    endpointId: string,
    projectId?: string,
): Promise<MCPEndpointResponse> => {
    const response = await axios.delete(`${getAgentaApiUrl()}${BASE}/${endpointId}/connect`, {
        params: projectId ? {project_id: projectId} : undefined,
    })
    return response.data
}

// Omit scopes to discover the authorization-server scope checklist.
export const discoverMcpConnect = async (
    endpointId: string,
    projectId?: string,
): Promise<MCPConnectResponse> => {
    const response = await axios.post(
        `${getAgentaApiUrl()}${BASE}/${endpointId}/connect`,
        {},
        {params: projectId ? {project_id: projectId} : undefined},
    )
    return response.data
}

// Step 2: begin — `scopes` present (possibly empty) returns the redirect.
export const beginMcpConnect = async (
    endpointId: string,
    scopes: string[],
    projectId?: string,
): Promise<MCPConnectResponse> => {
    const response = await axios.post(
        `${getAgentaApiUrl()}${BASE}/${endpointId}/connect`,
        {scopes},
        {params: projectId ? {project_id: projectId} : undefined},
    )
    return response.data
}
