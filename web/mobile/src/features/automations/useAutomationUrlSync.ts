import {useEffect, useRef} from "react"

import {
    triggerScheduleDrawerAtom,
    triggerSubscriptionDrawerAtom,
} from "@agenta/entities/gatewayTrigger"
import {AUTOMATION_QUERY_PARAM, readQueryParam, replaceQueryParam} from "@agenta/shared/utils"
import {useAtom, useAtomValue} from "jotai"

/** Mirrors the open automation drawer in `?automation=`: read once when `ready`, written on each change. */
export const useAutomationUrlSync = ({
    enabled = true,
    ready = true,
    playgroundEntityId,
}: {
    enabled?: boolean
    /** Holds the read until the playground's agent resolves. */
    ready?: boolean
    /** Set in the playground, so a linked drawer keeps its "Run in playground" action. */
    playgroundEntityId?: string
} = {}) => {
    const [schedule, setSchedule] = useAtom(triggerScheduleDrawerAtom)
    const subscription = useAtomValue(triggerSubscriptionDrawerAtom)

    const hydratedRef = useRef(false)
    useEffect(() => {
        if (!enabled || !ready || hydratedRef.current) return
        hydratedRef.current = true
        const id = readQueryParam(AUTOMATION_QUERY_PARAM)
        // The edit drawer resolves the kind from the automation lists, so either atom opens it.
        if (id) setSchedule({scheduleId: id, playgroundEntityId})
    }, [enabled, ready, playgroundEntityId, setSchedule])

    const openId = schedule?.scheduleId ?? subscription?.subscriptionId ?? null
    const prevIdRef = useRef<string | null>(null)
    useEffect(() => {
        if (!enabled) return
        if (openId) replaceQueryParam(AUTOMATION_QUERY_PARAM, openId)
        else if (prevIdRef.current) replaceQueryParam(AUTOMATION_QUERY_PARAM, null)
        prevIdRef.current = openId
    }, [enabled, openId])
}
