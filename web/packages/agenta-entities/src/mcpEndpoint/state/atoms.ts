/**
 * MCP endpoint entity — Jotai atoms.
 *
 * Ported from `web/oss/src/state/mcpEndpoints/atoms.ts` so that both the Settings dashboard and
 * the agent config form read one cache. The query key is byte-identical with the one the agent
 * form's registration invalidates (`["mcp-endpoints", ...]`), so a server registered from the
 * playground shows up in Settings without a reload.
 */
import {getHostQueryClient} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {
    createMcpEndpoint,
    deleteMcpEndpoint,
    disconnectMcpEndpoint,
    editMcpEndpoint,
    queryMcpEndpoints,
} from "../api/api"
import type {MCPEndpoint, MCPEndpointCreate, MCPEndpointEdit} from "../core/types"

export const MCP_ENDPOINTS_QUERY_KEY = "mcp-endpoints"

export const mcpEndpointsQueryAtom = atomWithQuery<MCPEndpoint[]>((get) => {
    const projectId = get(projectIdAtom)

    return {
        queryKey: [MCP_ENDPOINTS_QUERY_KEY, projectId],
        queryFn: async () => {
            // The query route, not the list route: the list mixes in synthesized builtin
            // and provider rows that carry no id, and every caller filters them out again.
            const response = await queryMcpEndpoints(projectId ?? undefined)
            return response.endpoints
        },
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        enabled: !!projectId,
    }
})

// Never the `queryClient` singleton: on a host that brought its own client the write would
// silently land on a cache nobody reads.
const invalidateMcpEndpoints = () =>
    getHostQueryClient().invalidateQueries({queryKey: [MCP_ENDPOINTS_QUERY_KEY]})

// The OAuth callback is a separate browser navigation. Expose the same refresh
// operation used by mutations so the settings table immediately reflects the
// secret handle written by the callback instead of waiting for its stale timeout.
export const refreshMcpEndpointsAtom = atom(null, async () => {
    await invalidateMcpEndpoints()
})

export const createMcpEndpointAtom = atom(null, async (get, _set, endpoint: MCPEndpointCreate) => {
    const projectId = get(projectIdAtom)
    const result = await createMcpEndpoint(endpoint, projectId ?? undefined)
    await invalidateMcpEndpoints()
    return result.endpoint ?? null
})

export const editMcpEndpointAtom = atom(null, async (get, _set, endpoint: MCPEndpointEdit) => {
    const projectId = get(projectIdAtom)
    const result = await editMcpEndpoint(endpoint, projectId ?? undefined)
    await invalidateMcpEndpoints()
    return result.endpoint ?? null
})

export const deleteMcpEndpointAtom = atom(null, async (get, _set, endpointId: string) => {
    const projectId = get(projectIdAtom)
    await deleteMcpEndpoint(endpointId, projectId ?? undefined)
    await invalidateMcpEndpoints()
})

/**
 * Revoke one endpoint's grant and put the answer straight into the cache.
 *
 * Written rather than invalidated because the response is the endpoint itself, already in
 * the shape the list holds. Refetching instead would leave the row reading Authorized until
 * the round trip landed, which is the wrong thing to say about a credential that is already
 * gone. The row is replaced wholesale: the response is a full endpoint, and merging would
 * keep the `secret_id` the disconnect just removed.
 */
export const disconnectMcpEndpointAtom = atom(null, async (get, _set, endpointId: string) => {
    const projectId = get(projectIdAtom)
    const result = await disconnectMcpEndpoint(endpointId, projectId ?? undefined)
    const endpoint = result.endpoint ?? null

    const queryClient = getHostQueryClient()
    const queryKey = [MCP_ENDPOINTS_QUERY_KEY, projectId]
    const cached = queryClient.getQueryData<MCPEndpoint[]>(queryKey)

    if (endpoint && cached) {
        queryClient.setQueryData<MCPEndpoint[]>(
            queryKey,
            cached.map((row) => (row.id === endpoint.id ? endpoint : row)),
        )
    } else {
        // Nothing to write into, so fall back to the refetch the other mutations use.
        await invalidateMcpEndpoints()
    }

    return endpoint
})
