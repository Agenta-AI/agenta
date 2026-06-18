import {useMemo} from "react"

import {useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {queryTriggerSubscriptions} from "../api"
import type {TriggerSubscription, TriggerSubscriptionsResponse} from "../core/types"

// Distinct from the catalog/connection keys (["triggers", "catalog"|"connections"]).
export const triggerSubscriptionsQueryAtom = atomWithQuery<TriggerSubscriptionsResponse>(() => ({
    queryKey: ["triggers", "subscriptions"],
    queryFn: () => queryTriggerSubscriptions(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
}))

export const useTriggerSubscriptions = () => {
    const query = useAtomValue(triggerSubscriptionsQueryAtom)

    const subscriptions = useMemo<TriggerSubscription[]>(
        () => query.data?.subscriptions ?? [],
        [query.data?.subscriptions],
    )

    return {
        subscriptions,
        count: query.data?.count ?? 0,
        isLoading: query.isPending,
        error: query.error,
        refetch: query.refetch,
    }
}

// Subscriptions scoped to a single connection.
export const triggerConnectionSubscriptionsAtomFamily = atomFamily((connectionId: string) =>
    atomWithQuery<TriggerSubscriptionsResponse>(() => ({
        queryKey: ["triggers", "subscriptions", "connection", connectionId],
        queryFn: () => queryTriggerSubscriptions({connection_id: connectionId}),
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        enabled: !!connectionId,
    })),
)

export const useTriggerConnectionSubscriptions = (connectionId: string) => {
    const query = useAtomValue(triggerConnectionSubscriptionsAtomFamily(connectionId))

    const subscriptions = useMemo<TriggerSubscription[]>(
        () => query.data?.subscriptions ?? [],
        [query.data?.subscriptions],
    )

    return {
        subscriptions,
        count: query.data?.count ?? 0,
        isLoading: query.isPending,
        error: query.error,
    }
}
