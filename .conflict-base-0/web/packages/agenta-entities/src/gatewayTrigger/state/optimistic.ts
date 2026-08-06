/**
 * Optimistic `flags.is_active` updates for trigger schedules and subscriptions.
 *
 * Play/pause should feel instant: we flip `flags.is_active` in the TanStack
 * Query caches up front, call the start/stop route, and roll back on failure.
 * Each helper returns a `rollback` closure that restores the prior cache state.
 */

import {queryClient} from "@agenta/shared/api"

import type {
    TriggerSchedule,
    TriggerSchedulesResponse,
    TriggerScheduleResponse,
    TriggerSubscription,
    TriggerSubscriptionsResponse,
    TriggerSubscriptionResponse,
} from "../core/types"

interface Entity {
    id?: string | null
    flags?: Record<string, unknown> | null
}

function withActiveFlag<T extends Entity>(entity: T, active: boolean): T {
    return {...entity, flags: {...(entity.flags ?? {}), is_active: active}}
}

// --- Schedules ---

export function applyScheduleActiveOptimistic(scheduleId: string, active: boolean): () => void {
    const listKey = ["triggers", "schedules"]
    const detailKey = ["triggers", "schedules", "detail", scheduleId]

    const prevList = queryClient.getQueryData<TriggerSchedulesResponse>(listKey)
    const prevDetail = queryClient.getQueryData<TriggerScheduleResponse>(detailKey)

    if (prevList) {
        queryClient.setQueryData<TriggerSchedulesResponse>(listKey, {
            ...prevList,
            schedules: prevList.schedules.map((s: TriggerSchedule) =>
                s.id === scheduleId ? withActiveFlag(s, active) : s,
            ),
        })
    }
    if (prevDetail?.schedule) {
        queryClient.setQueryData<TriggerScheduleResponse>(detailKey, {
            ...prevDetail,
            schedule: withActiveFlag(prevDetail.schedule, active),
        })
    }

    return () => {
        if (prevList) queryClient.setQueryData(listKey, prevList)
        if (prevDetail) queryClient.setQueryData(detailKey, prevDetail)
    }
}

// --- Subscriptions ---

export function applySubscriptionActiveOptimistic(
    subscriptionId: string,
    active: boolean,
): () => void {
    const listKey = ["triggers", "subscriptions"]
    const detailKey = ["triggers", "subscriptions", "detail", subscriptionId]

    const prevList = queryClient.getQueryData<TriggerSubscriptionsResponse>(listKey)
    const prevDetail = queryClient.getQueryData<TriggerSubscriptionResponse>(detailKey)

    if (prevList) {
        queryClient.setQueryData<TriggerSubscriptionsResponse>(listKey, {
            ...prevList,
            subscriptions: prevList.subscriptions.map((s: TriggerSubscription) =>
                s.id === subscriptionId ? withActiveFlag(s, active) : s,
            ),
        })
    }
    if (prevDetail?.subscription) {
        queryClient.setQueryData<TriggerSubscriptionResponse>(detailKey, {
            ...prevDetail,
            subscription: withActiveFlag(prevDetail.subscription, active),
        })
    }

    return () => {
        if (prevList) queryClient.setQueryData(listKey, prevList)
        if (prevDetail) queryClient.setQueryData(detailKey, prevDetail)
    }
}
