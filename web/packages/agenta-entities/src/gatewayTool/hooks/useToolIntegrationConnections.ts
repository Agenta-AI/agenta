import {useMemo} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {queryToolConnections} from "../api"
import type {ToolConnection, ToolConnectionsResponse} from "../core/types"

const DEFAULT_PROVIDER = "composio"

export const toolIntegrationConnectionsAtomFamily = atomFamily((integrationKey: string) =>
    atomWithQuery<ToolConnectionsResponse>((get) => ({
        queryKey: ["tools", "connections", DEFAULT_PROVIDER, integrationKey, get(projectIdAtom)],
        queryFn: () =>
            queryToolConnections({
                provider_key: DEFAULT_PROVIDER,
                integration_key: integrationKey,
            }),
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        enabled: !!integrationKey && !!get(projectIdAtom),
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
