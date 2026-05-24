import {
    fetchIntegrations,
    type ToolCatalogIntegration,
    type ToolCatalogIntegrationDetails,
    type ToolCatalogIntegrationsResponse,
} from "@agenta/entities/gatewayTool"
import {useAtomValue} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

const DEFAULT_PROVIDER = "composio"

type CatalogIntegrationItem = ToolCatalogIntegration | ToolCatalogIntegrationDetails

export const integrationsQueryAtom = atomWithQuery<ToolCatalogIntegrationsResponse>(() => ({
    queryKey: ["tools", "integrations", DEFAULT_PROVIDER],
    queryFn: () => fetchIntegrations(DEFAULT_PROVIDER),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
}))

export const useToolsIntegrations = () => {
    const query = useAtomValue(integrationsQueryAtom)
    const integrations: CatalogIntegrationItem[] = query.data?.integrations ?? []

    return {
        integrations,
        isLoading: query.isPending,
        error: query.error,
        refetch: query.refetch,
    }
}
