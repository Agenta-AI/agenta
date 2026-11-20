/**
 * TriggerManagementSection
 *
 * The agent config panel's "Triggers" section. Lists the CURRENT agent's persisted
 * triggers — provider event subscriptions and recurring schedules — as rows, and lets
 * the user add/manage them through the existing propless, atom-driven trigger drawers
 * (`@agenta/entity-ui/gatewayTrigger`). It reuses the same hooks and "⋯" menu the
 * workspace settings sections use; nothing about trigger CRUD is rebuilt here. In the
 * playground, running/paused is irrelevant, so rows expose a "Run now" action (status
 * shown as a passive dot); pause/resume stays in the schedule drawer.
 *
 * Two pieces of real work live here:
 *  1. Scoping — the list hooks return every project trigger, so we filter to the agent
 *     bound by `data.references`, matching any reference id against the current agent's
 *     app / variant / revision ids (resolved from the workflow molecule by revisionId).
 *  2. Default-bind — opening a create drawer from this section pre-binds the new trigger
 *     to the current agent via `defaultReferences` (see the trigger drawer atoms).
 */
import {useCallback, type ReactNode} from "react"

import {
    getScheduleMessagePreview,
    isEntityActive,
    triggerScheduleDrawerAtom,
    triggerSubscriptionDrawerAtom,
    useTriggerSchedule,
    useTriggerSubscription,
    type TriggerSchedule,
    type TriggerSubscription,
} from "@agenta/entities/gatewayTrigger"
import {createT, useT} from "@agenta/i18n"
import triggersCatalog from "@agenta/i18n/catalogs/entityUi.triggers"
import {simulatedAgentRunAtomFamily} from "@agenta/shared/state"
import {message} from "@agenta/ui"
import {DropdownMenuItem, DropdownMenuSeparator} from "@agenta/ui/ui"
import {
    ArrowsClockwise,
    ClockCounterClockwise,
    Pause,
    PencilSimpleLine,
    Play,
    Trash,
    XCircle,
} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

import {AppTriggerProviderGroups} from "./triggerManagement/AppTriggerProviderGroups"
import {ScheduleTriggerRow} from "./triggerManagement/ScheduleTriggerRow"
import {useAgentTriggers} from "./triggerManagement/useAgentTriggers"

const tNow = createT(triggersCatalog)

export {AddTriggerDropdown} from "./triggerManagement/AddTriggerDropdown"
export {useAgentTriggers} from "./triggerManagement/useAgentTriggers"

/** Which automation a row action names: a schedule or an event subscription, by id. */
export interface TriggerOwnerRef {
    kind: "subscription" | "schedule"
    id: string
}

export interface TriggerManagementSectionProps {
    /** The open agent's revision id (the drill-in entityId). */
    entityId: string | null
    /** Read-only mode (e.g. a non-editable revision). */
    disabled?: boolean
    /**
     * Where a row's "Run history" goes: the host opens the run history view. Absent, the rows
     * offer no "Run history".
     */
    onOpenRunHistory?: (owner: TriggerOwnerRef) => void
    /**
     * The unified create/edit automation drawer, mounted once by this section. This package
     * cannot import it directly (that package depends on this one), so the host passes it in.
     */
    automationDrawer: ReactNode
}

export function TriggerManagementSection({
    entityId,
    disabled,
    onOpenRunHistory,
    automationDrawer,
}: TriggerManagementSectionProps) {
    const t = useT(triggersCatalog)
    const {scopedSubscriptions, scopedSchedules} = useAgentTriggers(entityId)

    const {
        remove: removeSubscription,
        refresh: refreshSubscription,
        revoke: revokeSubscription,
    } = useTriggerSubscription()
    const {remove: removeSchedule, setActive: setScheduleActive} = useTriggerSchedule()

    const openSubscriptionDrawer = useSetAtom(triggerSubscriptionDrawerAtom)
    const openScheduleDrawer = useSetAtom(triggerScheduleDrawerAtom)
    const setPendingRun = useSetAtom(simulatedAgentRunAtomFamily(entityId ?? ""))

    // A schedule (cron) has no external event to replay — simulate it with its own
    // configured inputs, exactly like the schedule drawer's "Run in playground".
    const simulateSchedule = useCallback(
        (record: TriggerSchedule) => {
            if (!entityId) {
                message.info(tNow("entityUi.triggers.openInPlaygroundFirst"))
                return
            }
            const msg = getScheduleMessagePreview(record.data?.inputs_fields)
            const label = record.name?.trim() || "Scheduled run"
            const cron = record.data?.schedule
            const text = msg.trim()
                ? msg
                : `[Scheduled run · ${label}${cron ? ` (${cron})` : ""}]\n\`\`\`json\n${JSON.stringify(
                      record.data?.inputs_fields ?? {},
                      null,
                      2,
                  )}\n\`\`\``
            setPendingRun({text, nonce: Date.now(), newSession: true})
            message.success(tNow("entityUi.triggers.startingRun"))
        },
        [entityId, setPendingRun],
    )

    // ---- subscription actions ----
    // The menu body is composed JSX (the `@agenta/ui` DropdownMenu has no items array).
    // No per-item stopPropagation: the menu portals out of the row, so item clicks never
    // bubble back to the row's onClick.
    const subscriptionMenu = useCallback(
        (record: TriggerSubscription): ReactNode => (
            <>
                {onOpenRunHistory ? (
                    <DropdownMenuItem
                        onSelect={() => {
                            if (record.id) onOpenRunHistory({kind: "subscription", id: record.id})
                        }}
                    >
                        <ClockCounterClockwise size={16} />
                        {tNow("entityUi.triggers.runHistory")}
                    </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                    disabled={disabled}
                    onSelect={() => {
                        if (record.id)
                            openSubscriptionDrawer({
                                subscriptionId: record.id,
                                playgroundEntityId: entityId ?? undefined,
                            })
                    }}
                >
                    <PencilSimpleLine size={16} />
                    {tNow("entityUi.triggers.edit")}
                </DropdownMenuItem>
                <DropdownMenuItem
                    disabled={disabled}
                    onSelect={async () => {
                        if (!record.id) return
                        try {
                            await refreshSubscription(record.id)
                            message.success(tNow("entityUi.triggers.subscriptionRefreshed"))
                        } catch {
                            message.error(tNow("entityUi.triggers.subscriptionRefreshFailed"))
                        }
                    }}
                >
                    <ArrowsClockwise size={16} />
                    {tNow("entityUi.triggers.refresh")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    disabled={disabled}
                    onSelect={async () => {
                        if (!record.id) return
                        try {
                            await revokeSubscription(record.id)
                            message.success(tNow("entityUi.triggers.subscriptionRevoked"))
                        } catch {
                            message.error(tNow("entityUi.triggers.subscriptionRevokeFailed"))
                        }
                    }}
                >
                    <XCircle size={16} />
                    {tNow("entityUi.triggers.revoke")}
                </DropdownMenuItem>
                <DropdownMenuItem
                    variant="destructive"
                    disabled={disabled}
                    onSelect={async () => {
                        if (!record.id) return
                        try {
                            await removeSubscription(record.id)
                            message.success(tNow("entityUi.triggers.subscriptionDeleted"))
                        } catch {
                            message.error(tNow("entityUi.triggers.subscriptionDeleteFailed"))
                        }
                    }}
                >
                    <Trash size={16} />
                    {tNow("entityUi.triggers.delete")}
                </DropdownMenuItem>
            </>
        ),
        [
            entityId,
            onOpenRunHistory,
            openSubscriptionDrawer,
            refreshSubscription,
            revokeSubscription,
            removeSubscription,
            disabled,
        ],
    )

    // ---- schedule actions ----
    const toggleSchedule = useCallback(
        async (record: TriggerSchedule, next: boolean) => {
            if (!record.id) return
            try {
                await setScheduleActive(record.id, next)
                message.success(
                    next
                        ? tNow("entityUi.triggers.scheduleResumed")
                        : tNow("entityUi.triggers.schedulePaused"),
                )
            } catch {
                message.error(tNow("entityUi.triggers.scheduleUpdateFailed"))
            }
        },
        [setScheduleActive],
    )

    const scheduleMenu = useCallback(
        (record: TriggerSchedule): ReactNode => (
            <>
                <DropdownMenuItem
                    disabled={disabled || !record.id}
                    onSelect={() => simulateSchedule(record)}
                >
                    <Play size={16} />
                    {tNow("entityUi.triggers.runNow")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {onOpenRunHistory ? (
                    <DropdownMenuItem
                        onSelect={() => {
                            if (record.id) onOpenRunHistory({kind: "schedule", id: record.id})
                        }}
                    >
                        <ClockCounterClockwise size={16} />
                        {tNow("entityUi.triggers.runHistory")}
                    </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                    disabled={disabled}
                    onSelect={() => {
                        if (record.id)
                            openScheduleDrawer({
                                scheduleId: record.id,
                                playgroundEntityId: entityId ?? undefined,
                            })
                    }}
                >
                    <PencilSimpleLine size={16} />
                    {tNow("entityUi.triggers.edit")}
                </DropdownMenuItem>
                {isEntityActive(record) ? (
                    <DropdownMenuItem
                        disabled={disabled || !record.id}
                        onSelect={() => toggleSchedule(record, false)}
                    >
                        <Pause size={16} />
                        {tNow("entityUi.triggers.deactivate")}
                    </DropdownMenuItem>
                ) : (
                    <DropdownMenuItem
                        disabled={disabled || !record.id}
                        onSelect={() => toggleSchedule(record, true)}
                    >
                        <Play size={16} />
                        {tNow("entityUi.triggers.activate")}
                    </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    variant="destructive"
                    disabled={disabled}
                    onSelect={async () => {
                        if (!record.id) return
                        try {
                            await removeSchedule(record.id)
                            message.success(tNow("entityUi.triggers.scheduleDeleted"))
                        } catch {
                            message.error(tNow("entityUi.triggers.scheduleDeleteFailed"))
                        }
                    }}
                >
                    <Trash size={16} />
                    {tNow("entityUi.triggers.delete")}
                </DropdownMenuItem>
            </>
        ),
        [
            onOpenRunHistory,
            openScheduleDrawer,
            removeSchedule,
            simulateSchedule,
            toggleSchedule,
            entityId,
            disabled,
        ],
    )

    return (
        <div className="flex flex-col gap-2 py-3">
            {/* One list, not a Subscriptions section beside a Schedules section: both are
                automations, the region header above already names them, and two accordions for
                what is usually one or two rows spent more height on their own headers than on
                their contents. Event-backed ones stay grouped by the app they arrive from,
                because that grouping IS how a reader finds them. */}
            {scopedSubscriptions.length > 0 ? (
                <AppTriggerProviderGroups
                    scopedSubscriptions={scopedSubscriptions}
                    entityId={entityId}
                    disabled={disabled}
                    subscriptionMenu={subscriptionMenu}
                />
            ) : null}

            {scopedSchedules.length > 0 ? (
                <div className="flex flex-col gap-2">
                    {scopedSchedules.map((record) => (
                        <ScheduleTriggerRow
                            key={`schedule-${record.id}`}
                            record={record}
                            disabled={disabled}
                            onOpen={() =>
                                record.id &&
                                openScheduleDrawer({
                                    scheduleId: record.id,
                                    playgroundEntityId: entityId ?? undefined,
                                })
                            }
                            menu={scheduleMenu(record)}
                        />
                    ))}
                </div>
            ) : null}

            {scopedSubscriptions.length === 0 && scopedSchedules.length === 0 && !disabled ? (
                // One quiet line; the header's "+" is the way to add one.
                <span className="text-xs text-colorTextTertiary">
                    {t("entityUi.triggers.noAutomations")}
                </span>
            ) : null}

            {/* Propless, atom-driven drawers — mounted once; they manage their own
                visibility. App browsing + connecting now happens inside the subscription
                drawer (no separate catalog drawer in the playground). When a
                subscription/schedule is created here it default-binds to this agent. */}
            {automationDrawer}
        </div>
    )
}
