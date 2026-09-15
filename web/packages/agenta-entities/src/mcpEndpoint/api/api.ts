// This domain uses the shared Axios client the host configures.
import {axios, getAgentaApiUrl} from "@agenta/shared/api"

import type {McpToolSummary} from "../core/connectJourney"
import {
    jsonRpcErrorMessage,
    jsonRpcResult,
    MCP_ACCEPT,
    MCP_PROTOCOL_VERSION,
    MCP_PROTOCOL_VERSION_HEADER,
    McpProtocolError,
    readToolPage,
} from "../core/mcpRpc"
import {gatewayRefusalMessage} from "../core/refusal"
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
 * A page cap on `tools/list`, so a server that keeps handing back a cursor cannot hold the
 * dialog open forever. Well past any real catalogue; it is a stop, not a budget.
 */
const MAX_TOOL_PAGES = 20

/** The reason a data-plane call failed, in the words of whoever refused it. */
const relayFailure = (error: unknown, method: string): McpProtocolError => {
    if (error instanceof McpProtocolError) return error
    const body = (error as {response?: {data?: unknown}} | null | undefined)?.response?.data
    const stated = gatewayRefusalMessage(error) ?? jsonRpcErrorMessage(body)
    return new McpProtocolError(stated ?? `The server did not answer ${method}.`)
}

/**
 * The tools one connected server exposes.
 *
 * There is no control-plane route for this, so it goes through the JSON-RPC data plane the
 * agents use. That plane reads `X-AG-Credentials` and ignores `Authorization`, so a
 * gateway-audience credential is minted first.
 *
 * The handshake is the full one the specification requires, and the same one
 * `services/runner/src/extensions/pi-mcp.ts` speaks: `initialize`, then the
 * `notifications/initialized` that completes it, and only then `tools/list`. A server that
 * enforces the notification answers a client that skips it with a protocol error rather
 * than a catalogue. The negotiated version rides on every later call, a stateful server's
 * session id is carried back, and the pages a cursor announces are followed.
 *
 * Nothing here converts a failure into an empty list: a server with no tools and a
 * conversation that broke are different answers, and only the first is safe to show as a
 * connected server with nothing to restrict.
 */
export const listMcpTools = async (slug: string, projectId?: string): Promise<McpToolSummary[]> => {
    const params = projectId ? {project_id: projectId} : undefined
    const minted = await axios.post(`${getAgentaApiUrl()}/gateways/credentials`, {}, {params})
    const credentials = minted.data?.credentials
    if (!credentials) throw new McpProtocolError("Could not authorize the tool list request.")

    const url = `${getAgentaApiUrl()}${BASE.replace("/endpoints", "")}/custom/${slug}`
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: MCP_ACCEPT,
        "X-AG-Credentials": credentials,
    }

    let nextId = 1
    const call = async (method: string, body: Record<string, unknown>) => {
        try {
            return await axios.post(url, body, {headers, params})
        } catch (error) {
            throw relayFailure(error, method)
        }
    }

    const handshake = await call("initialize", {
        jsonrpc: "2.0",
        id: nextId++,
        method: "initialize",
        params: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: {name: "agenta-web", version: "1"},
        },
    })
    const negotiated = jsonRpcResult(handshake.data, "initialize").protocolVersion
    const sessionId = handshake.headers?.["mcp-session-id"]
    if (sessionId) headers["mcp-session-id"] = String(sessionId)
    headers[MCP_PROTOCOL_VERSION_HEADER] =
        typeof negotiated === "string" && negotiated ? negotiated : MCP_PROTOCOL_VERSION

    // Best effort, as in the runner's client: a notification carries no id and a server that
    // ignores it is conforming, so only a server that needed it can be worse off for a failure
    // here — and that server is about to say so on `tools/list`.
    try {
        await axios.post(
            url,
            {jsonrpc: "2.0", method: "notifications/initialized", params: {}},
            {headers, params},
        )
    } catch {
        // Deliberately ignored: `initialize` already proved the connection.
    }

    const tools: McpToolSummary[] = []
    let cursor: string | null = null
    for (let page = 0; page < MAX_TOOL_PAGES; page += 1) {
        const listed = await call("tools/list", {
            jsonrpc: "2.0",
            id: nextId++,
            method: "tools/list",
            params: cursor ? {cursor} : {},
        })
        const read = readToolPage(jsonRpcResult(listed.data, "tools/list"))
        tools.push(...read.tools)
        if (!read.nextCursor || read.nextCursor === cursor) break
        cursor = read.nextCursor
    }
    return tools
}
