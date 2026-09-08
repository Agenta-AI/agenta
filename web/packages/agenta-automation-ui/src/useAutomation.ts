import {useCallback, useMemo} from "react"

import {
    useTriggerSchedule,
    useTriggerSubscription,
    type TriggerSchedule,
    type TriggerScheduleCreate,
    type TriggerScheduleEdit,
    type TriggerSubscription,
    type TriggerSubscriptionCreate,
    type TriggerSubscriptionEdit,
} from "@agenta/entities/gatewayTrigger"

import {toAutomation, type Automation, type AutomationKind} from "./automationModel"

type AutomationCreate = TriggerScheduleCreate | TriggerSubscriptionCreate
type AutomationEdit = TriggerScheduleEdit | TriggerSubscriptionEdit

/**
 * One automation, by id and kind.
 *
 * Both entity hooks are called every render (they are inert without an id) and the one matching
 * `kind` is the one that answers. The mutations are NOT reimplemented — they forward to the
 * entity hook, which already owns cache invalidation and the optimistic start/stop.
 */
export const useAutomation = (id: string | undefined, kind: AutomationKind) => {
    const scheduleHook = useTriggerSchedule(kind === "schedule" ? id : undefined)
    const subscriptionHook = useTriggerSubscription(kind === "event" ? id : undefined)

    const entity = kind === "schedule" ? scheduleHook.schedule : subscriptionHook.subscription
    const automation = useMemo<Automation | null>(
        () => (entity ? toAutomation(entity, kind) : null),
        [entity, kind],
    )

    // The two payload shapes only ever reach the hook that accepts them — the cast narrows the
    // union at the call site rather than forcing every caller through a kind-specific hook.
    const create = useCallback(
        (payload: AutomationCreate): Promise<TriggerSchedule | TriggerSubscription | null> =>
            kind === "schedule"
                ? scheduleHook.create(payload as TriggerScheduleCreate)
                : subscriptionHook.create(payload as TriggerSubscriptionCreate),
        [kind, scheduleHook, subscriptionHook],
    )

    const edit = useCallback(
        (payload: AutomationEdit): Promise<TriggerSchedule | TriggerSubscription | null> =>
            kind === "schedule"
                ? scheduleHook.edit(payload as TriggerScheduleEdit)
                : subscriptionHook.edit(payload as TriggerSubscriptionEdit),
        [kind, scheduleHook, subscriptionHook],
    )

    const remove = useCallback(
        (automationId: string) =>
            kind === "schedule"
                ? scheduleHook.remove(automationId)
                : subscriptionHook.remove(automationId),
        [kind, scheduleHook, subscriptionHook],
    )

    const setActive = useCallback(
        (automationId: string, active: boolean) =>
            kind === "schedule"
                ? scheduleHook.setActive(automationId, active)
                : subscriptionHook.setActive(automationId, active),
        [kind, scheduleHook, subscriptionHook],
    )

    return {
        automation,
        isLoading: kind === "schedule" ? scheduleHook.isLoading : subscriptionHook.isLoading,
        error: kind === "schedule" ? scheduleHook.error : subscriptionHook.error,
        create,
        edit,
        remove,
        setActive,
    }
}
