import {useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {fetchToolIntegrationDetail} from "../api"
import type {ToolCatalogIntegrationResponse} from "../core/types"

const DEFAULT_PROVIDER = "composio"

export const toolIntegrationDetailQueryFamily = atomFamily((integrationKey: string) =>
    atomWithQuery<ToolCatalogIntegrationResponse>(() => ({
        queryKey: ["tools", "catalog", "integrationDetail", DEFAULT_PROVIDER, integrationKey],
        queryFn: () => fetchToolIntegrationDetail(DEFAULT_PROVIDER, integrationKey),
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        enabled: !!integrationKey,
    })),
)

export const useToolIntegrationDetail = (integrationKey: string) => {
    const query = useAtomValue(toolIntegrationDetailQueryFamily(integrationKey))

    return {
        integration: query.data?.integration ?? null,
        isLoading: query.isPending,
        error: query.error,
    }
}
