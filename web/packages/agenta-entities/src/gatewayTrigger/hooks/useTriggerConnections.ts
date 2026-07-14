import {useMemo} from "react"

import {useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {queryTriggerConnections} from "../api"
import type {TriggerConnection, TriggerConnectionsResponse} from "../core/types"

const DEFAULT_PROVIDER = "composio"

// Full list of trigger connections (shared `gateway_connections` rows, F2).
export const triggerConnectionsQueryAtom = atomWithQuery<TriggerConnectionsResponse>(() => ({
    queryKey: ["triggers", "connections"],
    queryFn: () => queryTriggerConnections(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
}))

export const useTriggerConnectionsQuery = () => {
    const query = useAtomValue(triggerConnectionsQueryAtom)

    const connections = useMemo<TriggerConnection[]>(
        () => query.data?.connections ?? [],
        [query.data?.connections],
    )

    return {
        connections,
        count: query.data?.count ?? 0,
        isLoading: query.isPending,
        error: query.error,
        refetch: query.refetch,
    }
}

// Connections scoped to a single integration.
export const triggerIntegrationConnectionsAtomFamily = atomFamily((integrationKey: string) =>
    atomWithQuery<TriggerConnectionsResponse>(() => ({
        queryKey: ["triggers", "connections", DEFAULT_PROVIDER, integrationKey],
        queryFn: () =>
            queryTriggerConnections({
                provider_key: DEFAULT_PROVIDER,
                integration_key: integrationKey,
            }),
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        enabled: !!integrationKey,
    })),
)

export const useTriggerIntegrationConnections = (integrationKey: string) => {
    const query = useAtomValue(triggerIntegrationConnectionsAtomFamily(integrationKey))

    const connections = useMemo<TriggerConnection[]>(
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
