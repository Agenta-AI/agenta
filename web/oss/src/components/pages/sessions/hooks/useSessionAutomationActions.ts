import {useMemo} from "react"

import {
    triggerDeliveriesDrawerAtom,
    triggerScheduleDrawerAtom,
    triggerSubscriptionDrawerAtom,
} from "@agenta/entities/gatewayTrigger"
import {createSessionAutomationActions} from "@agenta/sessions-ui"
import {useSetAtom} from "jotai"

import {useProjectPermissions} from "@/oss/hooks/useProjectPermissions"

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
