import {
    isEntityActive,
    type TriggerSchedule,
    type TriggerScheduleCreate,
    type TriggerScheduleData,
    type TriggerScheduleEdit,
    type TriggerSubscription,
    type TriggerSubscriptionCreate,
    type TriggerSubscriptionData,
    type TriggerSubscriptionEdit,
} from "@agenta/entities/gatewayTrigger"

import type {Automation, AutomationKind} from "./automationModel"

/** The stored agent binding, exactly as `buildTriggerReferences` shapes it. */
export type AutomationReferences = TriggerScheduleData["references"]

/** Every schedule fires on the same synthetic tick; the event key is not user-facing. */
export const SCHEDULE_EVENT_KEY = "schedule.tick"

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
    /** The agent binding, already shaped by `buildTriggerReferences`. */
    references?: AutomationReferences
    /** Event subscriptions only — the connection the picked event arrives on. */
    connectionId?: string
    /** Event subscriptions only — the provider event key. */
    eventKey?: string
    /** Event subscriptions only — the event's own filters, as the picker returned them. */
    triggerConfig?: Record<string, unknown>
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
        ...(patch.references === undefined ? {} : {references: patch.references}),
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
        ...(patch.references === undefined ? {} : {references: patch.references}),
        ...(patch.eventKey === undefined ? {} : {event_key: patch.eventKey}),
        ...(patch.triggerConfig === undefined ? {} : {trigger_config: patch.triggerConfig}),
    }
    return {
        id: subscription.id ?? "",
        name: patch.name ?? subscription.name ?? null,
        description: subscription.description ?? null,
        tags: subscription.tags ?? null,
        meta: subscription.meta ?? null,
        connection_id: patch.connectionId ?? subscription.connection_id,
        data,
        flags: {
            ...(subscription.flags ?? {}),
            is_active: isEntityActive(subscription),
            // Required by the PUT body and never edited here — carried through as stored.
            is_valid: subscription.flags?.is_valid ?? true,
        },
    }
}

/** What a draft has to supply before it can be created. */
export interface AutomationCreateDraft {
    kind: AutomationKind
    name: string
    description: string
    cron: string
    eventKey: string | null
    connectionId: string | null
    /** Event drafts only — the event's own `trigger_config` filters, as the picker returned them. */
    triggerConfig?: Record<string, unknown>
    inputsFields: Record<string, unknown>
    /** Defaults to on. A duplicate arrives OFF, so a copy never starts running unannounced. */
    isActive?: boolean
}

/**
 * The create payload, per kind.
 *
 * Deliberately shaped like `buildAutomationEdit`: the same `data` keys, the same per-kind
 * narrowing, the same rule that `flags` is stated rather than left to the backend's default. A
 * create carries no `id` and copies nothing off an existing row, so there is no stored entity to
 * spread — this is the edit builder's shape with the entity half removed.
 */
export function buildAutomationCreate(
    draft: AutomationCreateDraft,
    references: AutomationReferences,
): TriggerScheduleCreate | TriggerSubscriptionCreate {
    const header = {
        name: draft.name,
        description: draft.description || null,
    }
    const isActive = draft.isActive ?? true

    if (draft.kind === "schedule") {
        return {
            ...header,
            // A new automation arrives on (what the success message promises); a duplicate
            // arrives off, so a copy never starts running unannounced.
            flags: {is_active: isActive},
            data: {
                event_key: SCHEDULE_EVENT_KEY,
                schedule: draft.cron.trim(),
                inputs_fields: draft.inputsFields,
                references,
            },
        }
    }

    return {
        ...header,
        flags: {is_active: isActive, is_valid: true},
        // Guarded by `blockedReason`, which never lets an event draft create without both.
        connection_id: draft.connectionId ?? "",
        data: {
            event_key: draft.eventKey ?? "",
            trigger_config: draft.triggerConfig,
            inputs_fields: draft.inputsFields,
            references,
        },
    }
}
