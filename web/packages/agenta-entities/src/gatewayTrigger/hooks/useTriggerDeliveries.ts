import {useMemo} from "react"

import {useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {queryTriggerDeliveries} from "../api"
import type {TriggerDelivery, TriggerDeliveriesResponse} from "../core/types"

// Deliveries scoped to one subscription. Distinct from subscription keys.
export const triggerDeliveriesAtomFamily = atomFamily((subscriptionId: string) =>
    atomWithQuery<TriggerDeliveriesResponse>(() => ({
        queryKey: ["triggers", "deliveries", subscriptionId],
        queryFn: () => queryTriggerDeliveries({subscription_id: subscriptionId}),
        staleTime: 15_000,
        refetchOnWindowFocus: false,
        enabled: !!subscriptionId,
    })),
)

export const useTriggerDeliveries = (subscriptionId?: string) => {
    const query = useAtomValue(triggerDeliveriesAtomFamily(subscriptionId ?? ""))

    const deliveries = useMemo<TriggerDelivery[]>(
        () => query.data?.deliveries ?? [],
        [query.data?.deliveries],
    )

    return {
        deliveries,
        count: query.data?.count ?? 0,
        isLoading: subscriptionId ? query.isPending : false,
        error: query.error,
        refetch: query.refetch,
    }
}
