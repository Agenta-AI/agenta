import type {
    DeliveriesDrawerState,
    ScheduleDrawerState,
    SubscriptionDrawerState,
} from "@agenta/entities/gatewayTrigger"
import type {SessionRowVm} from "@agenta/sessions/row"
import {
    isSessionAutomationAction,
    OPEN_SESSION_AUTOMATION_ACTION,
    sessionAutomationMenuEntries,
    VIEW_SESSION_DELIVERY_ACTION,
} from "@agenta/sessions-ui"

export interface SessionAutomationDrawerOpeners {
    openSchedule: (state: ScheduleDrawerState) => void
    openSubscription: (state: SubscriptionDrawerState) => void
    openDelivery: (state: DeliveriesDrawerState) => void
}

export function createSessionAutomationActions(
    canViewTriggers: boolean,
    openers: SessionAutomationDrawerOpeners,
) {
    return {
        menuItems: (row: SessionRowVm) => sessionAutomationMenuEntries(row, canViewTriggers),
        onSelect: (row: SessionRowVm, key: string): boolean => {
            if (!canViewTriggers || !isSessionAutomationAction(key)) return false

            if (key === OPEN_SESSION_AUTOMATION_ACTION && row.automation?.id) {
                if (row.automation.kind === "schedule") {
                    openers.openSchedule({scheduleId: row.automation.id})
                } else {
                    openers.openSubscription({subscriptionId: row.automation.id})
                }
                return true
            }
            if (key === VIEW_SESSION_DELIVERY_ACTION && row.deliveryId) {
                openers.openDelivery({mode: "exact-delivery", deliveryId: row.deliveryId})
                return true
            }
            return false
        },
    }
}
