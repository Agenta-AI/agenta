import {useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {fetchIntegrationDetail} from "../api"
import type {ToolCatalogIntegrationResponse} from "../core/types"

const DEFAULT_PROVIDER = "composio"

export const integrationDetailQueryFamily = atomFamily((integrationKey: string) =>
    atomWithQuery<ToolCatalogIntegrationResponse>(() => ({
        queryKey: ["tools", "catalog", "integrationDetail", DEFAULT_PROVIDER, integrationKey],
        queryFn: () => fetchIntegrationDetail(DEFAULT_PROVIDER, integrationKey),
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        enabled: !!integrationKey,
    })),
)

export const useIntegrationDetail = (integrationKey: string) => {
    const query = useAtomValue(integrationDetailQueryFamily(integrationKey))

    return {
        integration: query.data?.integration ?? null,
        isLoading: query.isPending,
        error: query.error,
    }
}
