import {
    fetchIntegrations,
    type IntegrationItem,
    type IntegrationsResponse,
} from "@agenta/entities/gatewayTool"
import {useAtomValue} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

const DEFAULT_PROVIDER = "composio"

export const integrationsQueryAtom = atomWithQuery<IntegrationsResponse>(() => ({
    queryKey: ["tools", "integrations", DEFAULT_PROVIDER],
    queryFn: () => fetchIntegrations(DEFAULT_PROVIDER),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
}))

export const useToolsIntegrations = () => {
    const query = useAtomValue(integrationsQueryAtom)
    const integrations: IntegrationItem[] = query.data?.integrations ?? []

    return {
        integrations,
        isLoading: query.isPending,
        error: query.error,
        refetch: query.refetch,
    }
}
