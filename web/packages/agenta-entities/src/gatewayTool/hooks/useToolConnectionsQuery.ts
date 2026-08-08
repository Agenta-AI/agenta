import {idleReadyAtom, projectIdAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {queryToolConnections} from "../api"
import type {ToolConnectionsResponse} from "../core/types"

export const toolConnectionsQueryAtom = atomWithQuery<ToolConnectionsResponse>((get) => {
    // Connections are project-scoped; keying on the project refetches on project switch.
    const projectId = get(projectIdAtom)
    return {
        queryKey: ["tools", "connections", projectId],
        // Secondary (tool selector); yield to the render-critical playground queries on load.
        queryFn: () => queryToolConnections({lowPriority: true}),
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Renders a collapsed-section count; stay out of the cold-load burst entirely.
        enabled: get(idleReadyAtom) && !!projectId,
    }
})

export const useToolConnectionsQuery = () => {
    const query = useAtomValue(toolConnectionsQueryAtom)

    return {
        connections: query.data?.connections ?? [],
        count: query.data?.count ?? 0,
        isLoading: query.isPending,
        error: query.error,
        refetch: query.refetch,
    }
}
