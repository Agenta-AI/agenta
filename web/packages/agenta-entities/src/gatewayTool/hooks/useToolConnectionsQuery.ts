import {useAtomValue} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {queryToolConnections} from "../api"
import type {ToolConnectionsResponse} from "../core/types"

export const toolConnectionsQueryAtom = atomWithQuery<ToolConnectionsResponse>(() => ({
    queryKey: ["tools", "connections"],
    queryFn: () => queryToolConnections(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
}))

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
