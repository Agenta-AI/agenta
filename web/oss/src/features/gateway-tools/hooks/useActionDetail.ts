import {useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {fetchActionDetail} from "@/oss/services/tools/api"
import type {ActionDetailItem} from "@/oss/services/tools/api/types"

const DEFAULT_PROVIDER = "composio"

export const actionDetailQueryFamily = atomFamily(
    ({integrationKey, actionKey}: {integrationKey: string; actionKey: string}) =>
        atomWithQuery<{action: ActionDetailItem | null}>(() => ({
            queryKey: [
                "tools",
                "catalog",
                "actionDetail",
                DEFAULT_PROVIDER,
                integrationKey,
                actionKey,
            ],
            queryFn: () => fetchActionDetail(DEFAULT_PROVIDER, integrationKey, actionKey),
            staleTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            enabled: !!integrationKey && !!actionKey,
        })),
    (a, b) => a.integrationKey === b.integrationKey && a.actionKey === b.actionKey,
)

export const useActionDetail = (integrationKey: string, actionKey: string) => {
    const query = useAtomValue(actionDetailQueryFamily({integrationKey, actionKey}))

    return {
        action: query.data?.action ?? null,
        isLoading: query.isPending,
        error: query.error,
    }
}
