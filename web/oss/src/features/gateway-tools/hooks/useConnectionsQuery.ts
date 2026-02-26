import {useAtomValue} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {queryConnections} from "@/oss/services/tools/api"
import type {ConnectionItem} from "@/oss/services/tools/api/types"

export const connectionsQueryAtom = atomWithQuery<{
    count: number
    connections: ConnectionItem[]
}>(() => ({
    queryKey: ["tools", "connections"],
    queryFn: () => queryConnections(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
}))

export const useConnectionsQuery = () => {
    const query = useAtomValue(connectionsQueryAtom)

    return {
        connections: query.data?.connections ?? [],
        count: query.data?.count ?? 0,
        isLoading: query.isPending,
        error: query.error,
        refetch: query.refetch,
    }
}
