import {useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {integrationDetailQueryFamily} from "@/oss/features/gateway-tools/hooks/useIntegrationDetail"
import {fetchActions, queryConnections} from "@/oss/services/tools/api"
import type {ActionsListResponse, ConnectionsQueryResponse} from "@/oss/services/tools/api/types"

const DEFAULT_PROVIDER = "composio"

export const integrationActionsQueryFamily = atomFamily((integrationKey: string) =>
    atomWithQuery<ActionsListResponse>(() => ({
        queryKey: ["tools", "actions", DEFAULT_PROVIDER, integrationKey],
        queryFn: () => fetchActions(DEFAULT_PROVIDER, integrationKey, {important: true}),
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        enabled: !!integrationKey,
    })),
)

export const integrationConnectionsQueryFamily = atomFamily((integrationKey: string) =>
    atomWithQuery<ConnectionsQueryResponse>(() => ({
        queryKey: ["tools", "integrationConnections", DEFAULT_PROVIDER, integrationKey],
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

export const useIntegrationDetail = (integrationKey: string) => {
    const detailQuery = useAtomValue(integrationDetailQueryFamily(integrationKey))
    const actionsQuery = useAtomValue(integrationActionsQueryFamily(integrationKey))
    const connectionsQuery = useAtomValue(integrationConnectionsQueryFamily(integrationKey))

    return {
        integration: detailQuery.data?.integration ?? null,
        connections: connectionsQuery.data?.connections ?? [],
        actions: actionsQuery.data?.actions ?? [],
        isLoading: detailQuery.isPending || actionsQuery.isPending || connectionsQuery.isPending,
        error: detailQuery.error || actionsQuery.error || connectionsQuery.error,
        refetchDetail: detailQuery.refetch,
    }
}
