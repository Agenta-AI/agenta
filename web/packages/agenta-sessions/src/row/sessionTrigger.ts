import type {SessionStream, SessionTriggerKind} from "@agenta/entities/session"
import {isValidUUID} from "@agenta/shared/utils"

export interface SessionAutomationVm {
    id: string
    kind: SessionTriggerKind
    name: string | null
    deliveryId: string | null
}

export function sessionAutomation(row: SessionStream): SessionAutomationVm | null {
    if (!row.trigger || !isValidUUID(row.trigger.id)) return null

    return {
        id: row.trigger.id,
        kind: row.trigger.kind,
        name: row.trigger.name?.trim() || null,
        deliveryId: sessionDeliveryId(row),
    }
}

export function sessionDeliveryId(row: SessionStream): string | null {
    return row.delivery && isValidUUID(row.delivery.id) ? row.delivery.id : null
}

export function isAutomationSession(row: SessionStream): boolean {
    return row.origin === "trigger"
}

export function sessionAutomationKindLabel(kind: SessionTriggerKind): string {
    return kind === "schedule" ? "Schedule" : "Event subscription"
}

export function sessionAutomationTitle(automation: SessionAutomationVm): string {
    if (automation.name) return automation.name
    return automation.kind === "schedule" ? "Missing schedule" : "Missing event subscription"
}
