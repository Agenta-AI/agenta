import {useMemo} from "react"

import {useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {queryTriggerDeliveries} from "../api"
import type {TriggerDelivery, TriggerDeliveriesResponse} from "../core/types"

// A delivery belongs to a subscription OR a schedule (XOR, DB-enforced). The
// deliveries view is reused for both; the family is keyed on the owner kind+id
// so the two never share a cache entry.
interface DeliveriesOwner {
    kind: "subscription" | "schedule"
    id: string
}

const ownerKey = (owner: DeliveriesOwner) => `${owner.kind}:${owner.id}`

export const triggerDeliveriesAtomFamily = atomFamily(
    (owner: DeliveriesOwner) =>
        atomWithQuery<TriggerDeliveriesResponse>(() => ({
            queryKey: ["triggers", "deliveries", owner.kind, owner.id],
            queryFn: () =>
                queryTriggerDeliveries(
                    owner.kind === "subscription"
                        ? {subscription_id: owner.id}
                        : {schedule_id: owner.id},
                ),
            staleTime: 15_000,
            refetchOnWindowFocus: false,
            enabled: !!owner.id,
        })),
    (a, b) => ownerKey(a) === ownerKey(b),
)

export const useTriggerDeliveries = (owner?: DeliveriesOwner) => {
    const query = useAtomValue(triggerDeliveriesAtomFamily(owner ?? {kind: "subscription", id: ""}))

    const deliveries = useMemo<TriggerDelivery[]>(
        () => query.data?.deliveries ?? [],
        [query.data?.deliveries],
    )

    return {
        deliveries,
        count: query.data?.count ?? 0,
        isLoading: owner?.id ? query.isPending : false,
        error: query.error,
        refetch: query.refetch,
    }
}
