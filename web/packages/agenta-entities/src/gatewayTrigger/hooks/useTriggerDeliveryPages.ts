import {useCallback, useMemo} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithInfiniteQuery} from "jotai-tanstack-query"

import {queryTriggerDeliveries} from "../api"
import type {
    TriggerDelivery,
    TriggerDeliveriesResponse,
    TriggerDeliveryWindowing,
} from "../core/types"

interface DeliveriesOwner {
    kind: "subscription" | "schedule"
    id: string
}

/** Runs per page of the run history. */
export const TRIGGER_DELIVERIES_PAGE_SIZE = 50

const ownerKey = (owner: DeliveriesOwner) => `${owner.kind}:${owner.id}`

/**
 * The windowing that reads the page after `page`, or undefined when `page` was the last one.
 *
 * The server orders deliveries by `created_at`, newest first, so the cursor is the last row's
 * time (`newest`) plus its id (`next`) to break ties. A page shorter than the limit is the last.
 */
export function nextDeliveriesWindowing(
    page: TriggerDeliveriesResponse,
    limit: number,
): TriggerDeliveryWindowing | undefined {
    const rows = page.deliveries
    if (rows.length < limit) return undefined
    const last = rows[rows.length - 1]
    if (!last?.id || !last.created_at) return undefined
    return {limit, order: "descending", newest: last.created_at, next: last.id}
}

/** One automation's runs, a page at a time, newest first. */
export const triggerDeliveryPagesAtomFamily = atomFamily(
    (owner: DeliveriesOwner) =>
        atomWithInfiniteQuery<TriggerDeliveriesResponse>((get) => {
            const projectId = get(projectIdAtom)
            return {
                queryKey: ["triggers", "deliveries", "pages", projectId, owner.kind, owner.id],
                queryFn: ({pageParam}) =>
                    queryTriggerDeliveries(
                        owner.kind === "subscription"
                            ? {subscription_id: owner.id}
                            : {schedule_id: owner.id},
                        (pageParam as TriggerDeliveryWindowing | undefined) ?? {
                            limit: TRIGGER_DELIVERIES_PAGE_SIZE,
                            order: "descending",
                        },
                    ),
                initialPageParam: undefined as TriggerDeliveryWindowing | undefined,
                getNextPageParam: (lastPage) =>
                    nextDeliveriesWindowing(lastPage, TRIGGER_DELIVERIES_PAGE_SIZE),
                staleTime: 15_000,
                refetchOnWindowFocus: false,
                enabled: Boolean(projectId && owner.id),
            }
        }),
    (a, b) => ownerKey(a) === ownerKey(b),
)

/** The run history's read: the pages loaded so far and a way to load the next one. */
export const useTriggerDeliveryPages = (owner?: DeliveriesOwner) => {
    const query = useAtomValue(
        triggerDeliveryPagesAtomFamily(owner ?? {kind: "subscription", id: ""}),
    )
    const deliveries = useMemo<TriggerDelivery[]>(
        () => query.data?.pages.flatMap((page) => page.deliveries) ?? [],
        [query.data?.pages],
    )
    const {hasNextPage, isFetchingNextPage, fetchNextPage} = query
    const loadMore = useCallback(() => {
        if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
    }, [fetchNextPage, hasNextPage, isFetchingNextPage])

    return {
        deliveries,
        isLoading: owner?.id ? query.isPending : false,
        error: query.error,
        refetch: query.refetch,
        hasMore: Boolean(hasNextPage),
        loadingMore: isFetchingNextPage,
        loadMore,
    }
}
