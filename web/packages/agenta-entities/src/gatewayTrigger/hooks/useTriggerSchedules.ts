import {useMemo} from "react"

import {useAtomValue} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {queryTriggerSchedules} from "../api"
import type {TriggerSchedule, TriggerSchedulesResponse} from "../core/types"

// Distinct from subscription/catalog/connection keys.
export const triggerSchedulesQueryAtom = atomWithQuery<TriggerSchedulesResponse>(() => ({
    queryKey: ["triggers", "schedules"],
    queryFn: () => queryTriggerSchedules(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
}))

export const useTriggerSchedules = () => {
    const query = useAtomValue(triggerSchedulesQueryAtom)

    const schedules = useMemo<TriggerSchedule[]>(
        () => query.data?.schedules ?? [],
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
