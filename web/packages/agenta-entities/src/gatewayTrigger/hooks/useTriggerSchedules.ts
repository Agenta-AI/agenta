import {useMemo} from "react"

import {useAtomValue} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {queryTriggerSchedules} from "../api"
import type {TriggerSchedule, TriggerSchedulesResponse} from "../core/types"

// Distinct from subscription/catalog/connection keys.
export const triggerSchedulesQueryAtom = atomWithQuery<TriggerSchedulesResponse>(() => ({
    queryKey: ["triggers", "schedules"],
    // Secondary (trigger count badge / section); yield to the render-critical playground queries.
    queryFn: () => queryTriggerSchedules(undefined, {lowPriority: true}),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
}))

export const useTriggerSchedules = () => {
    const query = useAtomValue(triggerSchedulesQueryAtom)

    // Newest first. The /schedules/query body exposes no ordering option, so this is
    // done once here in the hook rather than per-render in consumers.
    const schedules = useMemo<TriggerSchedule[]>(
        () =>
            [...(query.data?.schedules ?? [])].sort((a, b) =>
                (b.created_at ?? "").localeCompare(a.created_at ?? ""),
            ),
        [query.data?.schedules],
    )

    return {
        schedules,
        count: query.data?.count ?? 0,
        isLoading: query.isPending,
        error: query.error,
        refetch: query.refetch,
    }
}
