import {useMemo} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {fetchTriggerDelivery, queryTriggerDeliveries} from "../api"
import type {
    TriggerDelivery,
    TriggerDeliveriesResponse,
    TriggerDeliveryResponse,
} from "../core/types"

// A delivery belongs to a subscription OR a schedule (XOR, DB-enforced). The
// deliveries view is reused for both; the family is keyed on the owner kind+id
// so the two never share a cache entry.
interface DeliveriesOwner {
    kind: "subscription" | "schedule"
    id: string
}

const ownerKey = (owner: DeliveriesOwner) => `${owner.kind}:${owner.id}`

const ownerFilter = (owner: DeliveriesOwner) =>
    owner.kind === "subscription" ? {subscription_id: owner.id} : {schedule_id: owner.id}

export const triggerDeliveriesAtomFamily = atomFamily(
    (owner: DeliveriesOwner) =>
        atomWithQuery<TriggerDeliveriesResponse>(() => ({
            queryKey: ["triggers", "deliveries", owner.kind, owner.id],
            queryFn: () => queryTriggerDeliveries(ownerFilter(owner)),
            staleTime: 15_000,
            refetchOnWindowFocus: false,
            enabled: !!owner.id,
        })),
    (a, b) => ownerKey(a) === ownerKey(b),
)

/** How many recent runs a list row counts; one more is read so the row can say "100+". */
export const RECENT_TRIGGER_DELIVERIES_LIMIT = 100

/** A list row's read: the newest runs, enough to count the last 30 days up to "100+". */
export const triggerRecentDeliveriesAtomFamily = atomFamily(
    (owner: DeliveriesOwner) =>
        atomWithQuery<TriggerDeliveriesResponse>((get) => {
            const projectId = get(projectIdAtom)
            return {
                queryKey: ["triggers", "deliveries", "recent", projectId, owner.kind, owner.id],
                queryFn: () =>
                    queryTriggerDeliveries(ownerFilter(owner), {
                        limit: RECENT_TRIGGER_DELIVERIES_LIMIT + 1,
                        order: "descending",
                    }),
                staleTime: 15_000,
                refetchOnWindowFocus: false,
                enabled: Boolean(projectId && owner.id),
            }
        }),
    (a, b) => ownerKey(a) === ownerKey(b),
)

export const useTriggerDeliveries = (owner?: DeliveriesOwner, {recent = false} = {}) => {
    const family = recent ? triggerRecentDeliveriesAtomFamily : triggerDeliveriesAtomFamily
    const query = useAtomValue(family(owner ?? {kind: "subscription", id: ""}))

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

export const triggerDeliveryQueryAtomFamily = atomFamily((deliveryId: string) =>
    atomWithQuery<TriggerDeliveryResponse>((get) => {
        const projectId = get(projectIdAtom)
        return {
            queryKey: ["triggers", "delivery", projectId, deliveryId],
            queryFn: () => fetchTriggerDelivery({projectId: projectId ?? "", deliveryId}),
            staleTime: 0,
            retry: false,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            enabled: Boolean(projectId && deliveryId),
        }
    }),
)

export const useTriggerDelivery = (deliveryId: string) => {
    const query = useAtomValue(triggerDeliveryQueryAtomFamily(deliveryId))
    return {
        delivery: query.data?.delivery ?? null,
        isLoading: deliveryId ? query.isPending : false,
        error: query.error,
        refetch: query.refetch,
    }
}
