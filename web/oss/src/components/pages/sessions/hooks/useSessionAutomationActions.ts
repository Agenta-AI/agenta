import {useMemo} from "react"

import {
    triggerDeliveriesDrawerAtom,
    triggerScheduleDrawerAtom,
    triggerSubscriptionDrawerAtom,
} from "@agenta/entities/gatewayTrigger"
import {useSetAtom} from "jotai"

import {useProjectPermissions} from "@/oss/hooks/useProjectPermissions"

import {createSessionAutomationActions} from "../assets/sessionAutomationActions"

export function useSessionAutomationActions() {
    const {hasPermission} = useProjectPermissions()
    const openSchedule = useSetAtom(triggerScheduleDrawerAtom)
    const openSubscription = useSetAtom(triggerSubscriptionDrawerAtom)
    const openDelivery = useSetAtom(triggerDeliveriesDrawerAtom)
    const canViewTriggers = hasPermission("view_triggers")

    return useMemo(
        () =>
            createSessionAutomationActions(canViewTriggers, {
                openSchedule,
                openSubscription,
                openDelivery,
            }),
        [canViewTriggers, openDelivery, openSchedule, openSubscription],
    )
}
