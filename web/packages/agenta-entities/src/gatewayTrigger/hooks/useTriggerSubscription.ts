import {useCallback, useState} from "react"

import {useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {
    createTriggerSubscription,
    deleteTriggerSubscription,
    editTriggerSubscription,
    fetchTriggerSubscription,
    refreshTriggerSubscription,
    revokeTriggerSubscription,
    startTriggerSubscription,
    stopTriggerSubscription,
} from "../api"
import type {
    TriggerSubscription,
    TriggerSubscriptionCreate,
    TriggerSubscriptionEdit,
    TriggerSubscriptionResponse,
} from "../core/types"
import {invalidateTriggerSubscriptions} from "../state/invalidate"
import {applySubscriptionActiveOptimistic} from "../state/optimistic"

// Single subscription (used to source the full PUT body before editing).
export const triggerSubscriptionQueryAtomFamily = atomFamily((subscriptionId: string) =>
    atomWithQuery<TriggerSubscriptionResponse>(() => ({
        queryKey: ["triggers", "subscriptions", "detail", subscriptionId],
        queryFn: () => fetchTriggerSubscription(subscriptionId),
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        enabled: !!subscriptionId,
    })),
)

export const useTriggerSubscription = (subscriptionId?: string) => {
    const query = useAtomValue(triggerSubscriptionQueryAtomFamily(subscriptionId ?? ""))
    const [isMutating, setIsMutating] = useState(false)

    const run = useCallback(
        async (
            fn: () => Promise<TriggerSubscriptionResponse>,
        ): Promise<TriggerSubscription | null> => {
            setIsMutating(true)
            try {
                const res = await fn()
                invalidateTriggerSubscriptions()
                return res.subscription ?? null
            } finally {
                setIsMutating(false)
            }
        },
        [],
    )

    const create = useCallback(
        (subscription: TriggerSubscriptionCreate) =>
            run(() => createTriggerSubscription(subscription)),
        [run],
    )

    const edit = useCallback(
        (subscription: TriggerSubscriptionEdit) => run(() => editTriggerSubscription(subscription)),
        [run],
    )

    const revoke = useCallback((id: string) => run(() => revokeTriggerSubscription(id)), [run])

    const refresh = useCallback((id: string) => run(() => refreshTriggerSubscription(id)), [run])

    const remove = useCallback(async (id: string) => {
        setIsMutating(true)
        try {
            await deleteTriggerSubscription(id)
            invalidateTriggerSubscriptions()
        } finally {
            setIsMutating(false)
        }
    }, [])

    // Optimistic play/pause: flip `flags.is_active` in the cache, call
    // start/stop, roll back on failure.
    const setActive = useCallback(async (id: string, active: boolean): Promise<void> => {
        const rollback = applySubscriptionActiveOptimistic(id, active)
        try {
            await (active ? startTriggerSubscription(id) : stopTriggerSubscription(id))
            invalidateTriggerSubscriptions()
        } catch (error) {
            rollback()
            invalidateTriggerSubscriptions()
            throw error
        }
    }, [])

    return {
        subscription: subscriptionId ? (query.data?.subscription ?? null) : null,
        isLoading: subscriptionId ? query.isPending : false,
        // Unlike isLoading, stays true while a refetch serves stale cache — edit forms need it.
        isFetching: subscriptionId ? query.isFetching : false,
        error: query.error,
        isMutating,
        create,
        edit,
        revoke,
        refresh,
        remove,
        setActive,
    }
}
