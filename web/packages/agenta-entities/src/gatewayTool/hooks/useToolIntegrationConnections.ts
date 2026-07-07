import {useMemo} from "react"

import {useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {queryToolConnections} from "../api"
import type {ToolConnection, ToolConnectionsResponse} from "../core/types"

const DEFAULT_PROVIDER = "composio"

export const toolIntegrationConnectionsAtomFamily = atomFamily((integrationKey: string) =>
    atomWithQuery<ToolConnectionsResponse>(() => ({
        queryKey: ["tools", "connections", DEFAULT_PROVIDER, integrationKey],
        queryFn: () =>
            queryToolConnections({
                provider_key: DEFAULT_PROVIDER,
                integration_key: integrationKey,
            }),
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        enabled: !!integrationKey,
    })),
)

export const useToolIntegrationConnections = (integrationKey: string) => {
    const query = useAtomValue(toolIntegrationConnectionsAtomFamily(integrationKey))

    const connections = useMemo<ToolConnection[]>(
        () => query.data?.connections ?? [],
        [query.data?.connections],
    )

    return {
        connections,
        count: query.data?.count ?? 0,
        isLoading: query.isPending,
        error: query.error,
    }
}
