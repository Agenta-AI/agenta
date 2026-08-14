import {atom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {queryClient} from "@/oss/lib/api/queryClient"
import {
    createMcpEndpoint,
    deleteMcpEndpoint,
    editMcpEndpoint,
    listMcpEndpoints,
} from "@/oss/services/mcpEndpoints/api"
import {MCPEndpointCreate, MCPEndpointEdit} from "@/oss/services/mcpEndpoints/types"
import {projectIdAtom} from "@/oss/state/project"

export const mcpEndpointsAtom = atomWithQuery((get) => {
    const projectId = get(projectIdAtom)

    return {
        queryKey: ["mcp-endpoints", projectId],
        queryFn: async () => {
            const response = await listMcpEndpoints(projectId ?? undefined)
            return response.endpoints
        },
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        enabled: !!projectId,
    }
})

const invalidateMcpEndpoints = () => queryClient.invalidateQueries({queryKey: ["mcp-endpoints"]})

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
