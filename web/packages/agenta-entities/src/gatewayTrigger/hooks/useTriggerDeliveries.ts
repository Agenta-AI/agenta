import {useMemo} from "react"

import {idleReadyAtom, projectIdAtom} from "@agenta/shared/state"
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

/**
 * Every delivery the PROJECT produced inside a rolling window — not one automation's.
 *
 * The endpoint is project-scoped and only narrows to an owner when one is given, so the same
 * call that feeds a run history feeds a project-wide count. Bounded two ways because the answer
 * is a headline number and must not be an unbounded download: `oldest` cuts the window
 * server-side, and `DELIVERY_WINDOW_LIMIT` caps the page. Rows come back newest-first, so a full
 * page means the OLDEST rows in the window were dropped — the caller is told (`truncated`) and
 * reports its counts as a floor rather than a total.
 *
 * Keyed by the window length. The cutoff itself is computed per fetch, not per render: putting a
 * moving `Date.now()` in the query key would mint a new cache entry on every render.
 */
export const DELIVERY_WINDOW_LIMIT = 500

export const projectTriggerDeliveriesAtomFamily = atomFamily((windowDays: number) =>
    atomWithQuery<TriggerDeliveriesResponse>((get) => {
        const projectId = get(projectIdAtom)
        return {
            queryKey: ["triggers", "deliveries", "project", projectId, windowDays],
            queryFn: () =>
                queryTriggerDeliveries(undefined, {
                    oldest: new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString(),
                    order: "descending",
                    limit: DELIVERY_WINDOW_LIMIT,
                }),
            staleTime: 60_000,
            refetchOnWindowFocus: false,
            enabled: Boolean(projectId) && get(idleReadyAtom),
        }
    }),
)

export const useProjectTriggerDeliveries = (windowDays: number) => {
    const query = useAtomValue(projectTriggerDeliveriesAtomFamily(windowDays))

    const deliveries = useMemo<TriggerDelivery[]>(
        () => query.data?.deliveries ?? [],
        [query.data?.deliveries],
    )

    return {
        deliveries,
        /** The window held more than one page — every count off these rows is a lower bound. */
        truncated: deliveries.length >= DELIVERY_WINDOW_LIMIT,
        isLoading: query.isPending,
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
