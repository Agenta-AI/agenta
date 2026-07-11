import {useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {fetchToolActionDetail} from "../api"
import type {ToolCatalogActionResponse} from "../core/types"

const DEFAULT_PROVIDER = "composio"

/** The backend 404s an unknown action — retrying won't change that. */
export const isActionNotFoundError = (error: unknown): boolean =>
    (error as {statusCode?: number} | null)?.statusCode === 404

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
            // Low priority: the tool-list availability probes fire on playground load and must
            // yield to render-critical queries; drawer opens usually hit this cache anyway.
            queryFn: () =>
                fetchToolActionDetail(DEFAULT_PROVIDER, integrationKey, actionKey, {
                    lowPriority: true,
                }),
            staleTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            enabled: !!integrationKey && !!actionKey,
            retry: (failureCount, error) => !isActionNotFoundError(error) && failureCount < 3,
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
