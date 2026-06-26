import {useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {fetchToolActionDetail} from "../api"
import type {ToolCatalogActionResponse} from "../core/types"

const DEFAULT_PROVIDER = "composio"

export const toolActionDetailQueryFamily = atomFamily(
    ({integrationKey, actionKey}: {integrationKey: string; actionKey: string}) =>
        atomWithQuery<ToolCatalogActionResponse>(() => ({
            queryKey: [
                "tools",
                "catalog",
                "actionDetail",
                DEFAULT_PROVIDER,
                integrationKey,
                actionKey,
            ],
            queryFn: () => fetchToolActionDetail(DEFAULT_PROVIDER, integrationKey, actionKey),
            staleTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            enabled: !!integrationKey && !!actionKey,
        })),
    (a, b) => a.integrationKey === b.integrationKey && a.actionKey === b.actionKey,
)

export const useToolActionDetail = (integrationKey: string, actionKey: string) => {
    const query = useAtomValue(toolActionDetailQueryFamily({integrationKey, actionKey}))

    return {
        action: query.data?.action ?? null,
        isLoading: query.isPending,
        error: query.error,
    }
}
