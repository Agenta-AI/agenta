// This domain uses the shared Axios client the host configures.
import {axios, getAgentaApiUrl} from "@agenta/shared/api"

import type {McpToolSummary} from "../core/connectJourney"
import type {
    MCPConnectResponse,
    MCPEndpointCreate,
    MCPEndpointProbeResponse,
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
 * Ask what a URL is, before any endpoint exists.
 *
 * Read-only: it creates nothing, and it takes no credential, because there is no endpoint
 * to carry one and a credential must never be sent to an origin nobody has chosen yet.
 */
export const probeMcpUrl = async (
    url: string,
    projectId?: string,
): Promise<MCPEndpointProbeResponse> => {
    const response = await axios.post(
        `${getAgentaApiUrl()}${BASE}/probe`,
        {url},
        {params: projectId ? {project_id: projectId} : undefined},
    )
    return response.data
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

/**
 * The project's own MCP connections.
 *
 * `GET /endpoints/` mixes synthesized builtin and provider rows, which carry no id, into the
 * list. This route answers from stored rows only, which is what a list called "MCP servers"
 * means and what every caller here already filtered down to.
 */
export const queryMcpEndpoints = async (projectId?: string): Promise<MCPEndpointsResponse> => {
    const response = await axios.post(
        `${getAgentaApiUrl()}${BASE}/query`,
        {},
        {params: projectId ? {project_id: projectId} : undefined},
    )
    return response.data
}

/**
 * The tools one connected server exposes.
 *
 * There is no control-plane route for this, so it goes through the JSON-RPC data plane the
 * agents use. That plane reads `X-AG-Credentials` and ignores `Authorization`, so a
 * gateway-audience credential is minted first. Two calls, because `tools/list` is only
 * meaningful after the handshake, and a stateful server answers the first with a session id
 * the second has to carry.
 */
export const listMcpTools = async (slug: string, projectId?: string): Promise<McpToolSummary[]> => {
    const params = projectId ? {project_id: projectId} : undefined
    const minted = await axios.post(`${getAgentaApiUrl()}/gateways/credentials`, {}, {params})
    const credentials = minted.data?.credentials
    if (!credentials) throw new Error("Could not authorize the tool list request.")

    const url = `${getAgentaApiUrl()}${BASE.replace("/endpoints", "")}/custom/${slug}`
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-AG-Credentials": credentials,
    }

    const handshake = await axios.post(
        url,
        {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
                protocolVersion: "2025-06-18",
                capabilities: {},
                clientInfo: {name: "agenta-web", version: "1"},
            },
        },
        {headers, params},
    )
    const sessionId = handshake.headers?.["mcp-session-id"]
    if (sessionId) headers["mcp-session-id"] = String(sessionId)

    const listed = await axios.post(
        url,
        {jsonrpc: "2.0", id: 2, method: "tools/list", params: {}},
        {headers, params},
    )
    const tools = listed.data?.result?.tools
    if (!Array.isArray(tools)) return []
    return tools
        .filter((tool): tool is {name: string; description?: string} => !!tool?.name)
        .map((tool) => ({name: tool.name, description: tool.description}))
}
