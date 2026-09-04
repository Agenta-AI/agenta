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

/** Slots the automation verbs above a menu's destructive divider; appends when there is none. */
export function mergeSessionMenuEntries(
    sessionItems: SessionMenuEntry[],
    automationItems: SessionMenuEntry[],
): SessionMenuEntry[] {
    if (!automationItems.length) return sessionItems
    const dividerIndex = sessionItems.findIndex((item) => "type" in item)
    if (dividerIndex < 0) return [...sessionItems, ...automationItems]
    return [
        ...sessionItems.slice(0, dividerIndex),
        ...automationItems,
        ...sessionItems.slice(dividerIndex),
    ]
}
