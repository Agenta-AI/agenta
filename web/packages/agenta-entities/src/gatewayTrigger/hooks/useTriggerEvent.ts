import {useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {fetchTriggerEvent} from "../api"
import type {TriggerCatalogEventResponse} from "../core/types"

const DEFAULT_PROVIDER = "composio"

export const triggerEventDetailQueryFamily = atomFamily(
    ({integrationKey, eventKey}: {integrationKey: string; eventKey: string}) =>
        atomWithQuery<TriggerCatalogEventResponse>(() => ({
            queryKey: [
                "triggers",
                "catalog",
                "eventDetail",
                DEFAULT_PROVIDER,
                integrationKey,
                eventKey,
            ],
            queryFn: () => fetchTriggerEvent(DEFAULT_PROVIDER, integrationKey, eventKey),
            staleTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            enabled: !!integrationKey && !!eventKey,
        })),
    (a, b) => a.integrationKey === b.integrationKey && a.eventKey === b.eventKey,
)

export const useTriggerEvent = (integrationKey: string, eventKey: string) => {
    const query = useAtomValue(triggerEventDetailQueryFamily({integrationKey, eventKey}))

    return {
        event: query.data?.event ?? null,
        // `isPending` is true for a *disabled* query (no event selected yet), so
        // gate on actual in-flight fetching to avoid a perpetual spinner.
        isLoading: query.isFetching,
        error: query.error,
    }
}
