import type {SessionRowVm} from "@agenta/sessions/row"

import type {SessionMenuEntry} from "./menu"

export const OPEN_SESSION_AUTOMATION_ACTION = "open-automation"
export const VIEW_SESSION_DELIVERY_ACTION = "view-delivery"

export type SessionAutomationActionKey =
    | typeof OPEN_SESSION_AUTOMATION_ACTION
    | typeof VIEW_SESSION_DELIVERY_ACTION

export function sessionAutomationMenuEntries(
    row: SessionRowVm,
    canViewTriggers: boolean,
): SessionMenuEntry[] {
    if (!canViewTriggers) return []

    const entries: SessionMenuEntry[] = []
    if (row.automation?.id) {
        entries.push({key: OPEN_SESSION_AUTOMATION_ACTION, label: "Open automation"})
    }
    if (row.deliveryId) {
        entries.push({key: VIEW_SESSION_DELIVERY_ACTION, label: "View delivery"})
    }
    return entries
}

export function isSessionAutomationAction(key: string): key is SessionAutomationActionKey {
    return key === OPEN_SESSION_AUTOMATION_ACTION || key === VIEW_SESSION_DELIVERY_ACTION
}
