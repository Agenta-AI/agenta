import {useCallback, useState} from "react"

import {queryClient} from "@agenta/shared/api"
import {useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {
    createTriggerSchedule,
    deleteTriggerSchedule,
    editTriggerSchedule,
    fetchTriggerSchedule,
    startTriggerSchedule,
    stopTriggerSchedule,
} from "../api"
import type {
    TriggerSchedule,
    TriggerScheduleCreate,
    TriggerScheduleEdit,
    TriggerScheduleResponse,
} from "../core/types"
import {applyScheduleActiveOptimistic} from "../state/optimistic"

const invalidateSchedules = () => {
    queryClient.invalidateQueries({queryKey: ["triggers", "schedules"]})
}

// Single schedule (used to source the full PUT body before editing).
export const triggerScheduleQueryAtomFamily = atomFamily((scheduleId: string) =>
    atomWithQuery<TriggerScheduleResponse>(() => ({
        queryKey: ["triggers", "schedules", "detail", scheduleId],
        queryFn: () => fetchTriggerSchedule(scheduleId),
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        enabled: !!scheduleId,
    })),
)

export const useTriggerSchedule = (scheduleId?: string) => {
    const query = useAtomValue(triggerScheduleQueryAtomFamily(scheduleId ?? ""))
    const [isMutating, setIsMutating] = useState(false)

    const run = useCallback(
        async (fn: () => Promise<TriggerScheduleResponse>): Promise<TriggerSchedule | null> => {
            setIsMutating(true)
            try {
                const res = await fn()
                invalidateSchedules()
                return res.schedule ?? null
            } finally {
                setIsMutating(false)
            }
        },
        [],
    )

    const create = useCallback(
        (schedule: TriggerScheduleCreate) => run(() => createTriggerSchedule(schedule)),
        [run],
    )

    const edit = useCallback(
        (schedule: TriggerScheduleEdit) => run(() => editTriggerSchedule(schedule)),
        [run],
    )

    const remove = useCallback(async (id: string) => {
        setIsMutating(true)
        try {
            await deleteTriggerSchedule(id)
            invalidateSchedules()
        } finally {
            setIsMutating(false)
        }
    }, [])

    // Optimistically flip `flags.is_active` in the list cache, then call the
    // start/stop route; on failure the cache is rolled back and refetched.
    const setActive = useCallback(async (id: string, active: boolean): Promise<void> => {
        const rollback = applyScheduleActiveOptimistic(id, active)
        try {
            await (active ? startTriggerSchedule(id) : stopTriggerSchedule(id))
            invalidateSchedules()
        } catch (error) {
            rollback()
            invalidateSchedules()
            throw error
        }
    }, [])

    return {
        schedule: scheduleId ? (query.data?.schedule ?? null) : null,
        isLoading: scheduleId ? query.isPending : false,
        error: query.error,
        isMutating,
        create,
        edit,
        remove,
        setActive,
    }
}
