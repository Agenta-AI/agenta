import {
    isEntityActive,
    type TriggerSchedule,
    type TriggerScheduleData,
    type TriggerScheduleEdit,
    type TriggerSubscription,
    type TriggerSubscriptionData,
    type TriggerSubscriptionEdit,
} from "@agenta/entities/gatewayTrigger"

import type {Automation} from "./automationModel"

/**
 * One edit payload builder for both trigger kinds.
 *
 * Both endpoints take a full PUT, so every field the row already carries has to be sent back or
 * the save silently clears it. The detail screen only ever changes three things, so the patch is
 * narrow and everything else is copied off `automation.raw`.
 */

export interface AutomationPatch {
    name?: string
    /** Schedules only — the 5-field UTC cron expression. */
    cron?: string
    /** The whole `data.inputs_fields` object, as the message composer wrote it. */
    inputsFields?: Record<string, unknown>
}

export type AutomationEditBody = TriggerScheduleEdit | TriggerSubscriptionEdit

export function buildAutomationEdit(
    automation: Automation,
    patch: AutomationPatch,
): AutomationEditBody {
    return automation.kind === "schedule"
        ? scheduleEdit(automation.raw as TriggerSchedule, patch)
        : subscriptionEdit(automation.raw as TriggerSubscription, patch)
}

function scheduleEdit(schedule: TriggerSchedule, patch: AutomationPatch): TriggerScheduleEdit {
    const data: TriggerScheduleData = {
        ...schedule.data,
        ...(patch.cron === undefined ? {} : {schedule: patch.cron}),
        ...(patch.inputsFields === undefined ? {} : {inputs_fields: patch.inputsFields}),
    }
    return {
        id: schedule.id ?? "",
        name: patch.name ?? schedule.name ?? null,
        description: schedule.description ?? null,
        tags: schedule.tags ?? null,
        meta: schedule.meta ?? null,
        data,
        flags: {...(schedule.flags ?? {}), is_active: isEntityActive(schedule)},
    }
}

function subscriptionEdit(
    subscription: TriggerSubscription,
    patch: AutomationPatch,
): TriggerSubscriptionEdit {
    const data: TriggerSubscriptionData = {
        ...subscription.data,
        ...(patch.inputsFields === undefined ? {} : {inputs_fields: patch.inputsFields}),
    }
    return {
        id: subscription.id ?? "",
        name: patch.name ?? subscription.name ?? null,
        description: subscription.description ?? null,
        tags: subscription.tags ?? null,
        meta: subscription.meta ?? null,
        connection_id: subscription.connection_id,
        data,
        flags: {
            ...(subscription.flags ?? {}),
            is_active: isEntityActive(subscription),
            // Required by the PUT body and never edited here — carried through as stored.
            is_valid: subscription.flags?.is_valid ?? true,
        },
    }
}
