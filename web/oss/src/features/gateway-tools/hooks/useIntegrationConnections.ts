import {useMemo} from "react"

import {useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {queryConnections} from "@/oss/services/tools/api"
import type {ConnectionItem, ConnectionsQueryResponse} from "@/oss/services/tools/api/types"

const DEFAULT_PROVIDER = "composio"

export const integrationConnectionsAtomFamily = atomFamily((integrationKey: string) =>
    atomWithQuery<ConnectionsQueryResponse>(() => ({
        queryKey: ["tools", "connections", DEFAULT_PROVIDER, integrationKey],
        queryFn: () =>
            queryConnections({
                provider_key: DEFAULT_PROVIDER,
                integration_key: integrationKey,
            }),
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        enabled: !!integrationKey,
    })),
)

export const useIntegrationConnections = (integrationKey: string) => {
    const query = useAtomValue(integrationConnectionsAtomFamily(integrationKey))

    const connections = useMemo<ConnectionItem[]>(
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
