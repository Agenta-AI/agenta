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
import {useCallback, useState, type ReactNode} from "react"

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
import automationsPanelCatalog from "@agenta/i18n/catalogs/automations.panel"
import automationsScreensCatalog from "@agenta/i18n/catalogs/automations.screens"
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
import {AutomationDeleteDialog} from "./triggerManagement/AutomationDeleteDialog"
import {ScheduleTriggerRow} from "./triggerManagement/ScheduleTriggerRow"
import {useAgentTriggers} from "./triggerManagement/useAgentTriggers"

const tNow = createT(triggersCatalog)
const tScreens = createT(automationsScreensCatalog)

export {AddAutomationPhoneAction, AddTriggerDropdown} from "./triggerManagement/AddTriggerDropdown"
export {AutomationDeleteDialog} from "./triggerManagement/AutomationDeleteDialog"
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
     * Where a row click and "Edit" go: the host opens the automation view. Absent, they open the
     * automation drawer.
     */
    onOpenAutomation?: (owner: TriggerOwnerRef) => void
    /**
     * The unified create/edit automation drawer, mounted once by this section. This package
     * cannot import it directly (that package depends on this one), so the host passes it in.
     */
    automationDrawer: ReactNode
    /**
     * The phone shape (M10): flat rows whose line wraps, a switch on each row of a person who
     * can edit, and 44 px controls. The host decides it (`useIsPhone`).
     */
    phone?: boolean
}

export function TriggerManagementSection({
    entityId,
    disabled,
    onOpenRunHistory,
    onOpenAutomation,
    automationDrawer,
    phone,
}: TriggerManagementSectionProps) {
    const t = useT(triggersCatalog, automationsPanelCatalog)
    const {scopedSubscriptions, scopedSchedules} = useAgentTriggers(entityId)

    const {
        remove: removeSubscription,
        refresh: refreshSubscription,
        revoke: revokeSubscription,
        setActive: setSubscriptionActive,
    } = useTriggerSubscription()
    const {remove: removeSchedule, setActive: setScheduleActive} = useTriggerSchedule()

    const openSubscriptionDrawer = useSetAtom(triggerSubscriptionDrawerAtom)
    const openScheduleDrawer = useSetAtom(triggerScheduleDrawerAtom)
    const setPendingRun = useSetAtom(simulatedAgentRunAtomFamily(entityId ?? ""))
    // "Delete" asks first (F06 f4); the dialog runs the delete and reports a failure. The
    // automation stays set while the dialog closes, so its name stays in the closing text.
    const [deleteOpen, setDeleteOpen] = useState(false)
    const [pendingDelete, setPendingDelete] = useState<{
        name: string
        remove: () => Promise<void>
    } | null>(null)

    // Deactivate and Activate act at once, for both kinds. No agent version is saved.
    const toggleAutomation = useCallback(
        async (
            setActive: (id: string, next: boolean) => Promise<void>,
            id: string,
            next: boolean,
        ) => {
            try {
                await setActive(id, next)
                message.success(
                    next
                        ? tScreens("automations.screens.switchedOn")
                        : tScreens("automations.screens.switchedOff"),
                )
            } catch {
                message.error(tScreens("automations.screens.changeFailed"))
            }
        },
        [],
    )

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

    // A row click and "Edit" open the automation: as a view where the host has a stack, else in
    // the automation drawer.
    const openSchedule = useCallback(
        (id: string) =>
            onOpenAutomation
                ? onOpenAutomation({kind: "schedule", id})
                : openScheduleDrawer({scheduleId: id, playgroundEntityId: entityId ?? undefined}),
        [entityId, onOpenAutomation, openScheduleDrawer],
    )
    const openSubscription = useCallback(
        (id: string) =>
            onOpenAutomation
                ? onOpenAutomation({kind: "subscription", id})
                : openSubscriptionDrawer({
                      subscriptionId: id,
                      playgroundEntityId: entityId ?? undefined,
                  }),
        [entityId, onOpenAutomation, openSubscriptionDrawer],
    )

    // ---- row menus ----
    // The menu body is composed JSX (the `@agenta/ui` DropdownMenu has no items array). No
    // per-item stopPropagation: the menu portals out of the row, so item clicks never bubble
    // back to the row's onClick. A viewer gets "Run history" only.
    const runHistoryItem = (owner: TriggerOwnerRef) =>
        onOpenRunHistory ? (
            <DropdownMenuItem onSelect={() => onOpenRunHistory(owner)}>
                <ClockCounterClockwise size={16} />
                {tNow("entityUi.triggers.runHistory")}
            </DropdownMenuItem>
        ) : null

    const toggleItem = (active: boolean, onToggle: (next: boolean) => void) =>
        active ? (
            <DropdownMenuItem onSelect={() => onToggle(false)}>
                <Pause size={16} />
                {tNow("entityUi.triggers.deactivate")}
            </DropdownMenuItem>
        ) : (
            <DropdownMenuItem onSelect={() => onToggle(true)}>
                <Play size={16} />
                {tNow("entityUi.triggers.activate")}
            </DropdownMenuItem>
        )

    const deleteItem = (name: string, remove: () => Promise<void>) => (
        <DropdownMenuItem
            variant="destructive"
            onSelect={() => {
                setPendingDelete({name, remove})
                setDeleteOpen(true)
            }}
        >
            <Trash size={16} />
            {tNow("entityUi.triggers.delete")}
        </DropdownMenuItem>
    )

    const subscriptionMenu = useCallback(
        (record: TriggerSubscription): ReactNode => {
            const id = record.id
            if (!id) return null
            if (disabled) return runHistoryItem({kind: "subscription", id})
            return (
                <>
                    {runHistoryItem({kind: "subscription", id})}
                    <DropdownMenuItem onSelect={() => openSubscription(id)}>
                        <PencilSimpleLine size={16} />
                        {tNow("entityUi.triggers.edit")}
                    </DropdownMenuItem>
                    {toggleItem(
                        isEntityActive(record),
                        (next) => void toggleAutomation(setSubscriptionActive, id, next),
                    )}
                    <DropdownMenuItem
                        onSelect={async () => {
                            try {
                                await refreshSubscription(id)
                                message.success(tNow("entityUi.triggers.subscriptionRefreshed"))
                            } catch {
                                message.error(tNow("entityUi.triggers.subscriptionRefreshFailed"))
                            }
                        }}
                    >
                        <ArrowsClockwise size={16} />
                        {tNow("entityUi.triggers.refresh")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onSelect={async () => {
                            try {
                                await revokeSubscription(id)
                                message.success(tNow("entityUi.triggers.subscriptionRevoked"))
                            } catch {
                                message.error(tNow("entityUi.triggers.subscriptionRevokeFailed"))
                            }
                        }}
                    >
                        <XCircle size={16} />
                        {tNow("entityUi.triggers.revoke")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {deleteItem(record.name ?? "", async () => {
                        await removeSubscription(id)
                        message.success(tScreens("automations.screens.deleted"))
                    })}
                </>
            )
        },
        [
            disabled,
            onOpenRunHistory,
            openSubscription,
            refreshSubscription,
            revokeSubscription,
            removeSubscription,
            setSubscriptionActive,
            toggleAutomation,
        ],
    )

    const scheduleMenu = useCallback(
        (record: TriggerSchedule): ReactNode => {
            const id = record.id
            if (!id) return null
            if (disabled) return runHistoryItem({kind: "schedule", id})
            return (
                <>
                    {/* Run now stays as today: the session's browser path (useTriggerTestRun). */}
                    <DropdownMenuItem onSelect={() => simulateSchedule(record)}>
                        <Play size={16} />
                        {tNow("entityUi.triggers.runNow")}
                    </DropdownMenuItem>
                    {runHistoryItem({kind: "schedule", id})}
                    <DropdownMenuItem onSelect={() => openSchedule(id)}>
                        <PencilSimpleLine size={16} />
                        {tNow("entityUi.triggers.edit")}
                    </DropdownMenuItem>
                    {toggleItem(
                        isEntityActive(record),
                        (next) => void toggleAutomation(setScheduleActive, id, next),
                    )}
                    <DropdownMenuSeparator />
                    {deleteItem(record.name ?? "", async () => {
                        await removeSchedule(id)
                        message.success(tScreens("automations.screens.deleted"))
                    })}
                </>
            )
        },
        [
            disabled,
            onOpenRunHistory,
            openSchedule,
            removeSchedule,
            setScheduleActive,
            simulateSchedule,
            toggleAutomation,
        ],
    )

    // Desktop: 12 px medium secondary text over cards 10 px apart (F05 f1). Phone: tertiary text
    // over flat rows with full-width dividers (M10).
    const groupHeading = (label: string) => (
        <h3
            className={
                phone
                    ? "m-0 pb-1.5 pt-4 text-[12px] font-medium text-[var(--ag-colorTextTertiary)]"
                    : "m-0 mt-1 text-[12px] font-medium text-[var(--ag-colorTextSecondary)]"
            }
        >
            {label}
        </h3>
    )
    // On a phone each row has a switch that acts like "Activate" and "Deactivate" (M10). A person
    // who cannot edit gets no switch: a read-only view shows no edit control.
    const switches = phone && !disabled
    const groupClass = `flex flex-col ${phone ? "" : "gap-2.5"}`

    return (
        <div className={`flex flex-col ${phone ? "" : "gap-2.5 pb-3 pt-2.5"}`}>
            {/* Two groups, "Scheduled triggers" first; a group with no automation does not
                show (F05 f1). App triggers stay grouped by the app they arrive from. */}
            {scopedSchedules.length > 0 ? (
                <section className={groupClass}>
                    {groupHeading(t("automations.panel.scheduledTriggers"))}
                    {scopedSchedules.map((record) => (
                        <ScheduleTriggerRow
                            key={`schedule-${record.id}`}
                            record={record}
                            disabled={disabled}
                            onOpen={() => record.id && openSchedule(record.id)}
                            menu={scheduleMenu(record)}
                            phone={phone}
                            onToggle={
                                switches && record.id
                                    ? (next) =>
                                          void toggleAutomation(
                                              setScheduleActive,
                                              record.id as string,
                                              next,
                                          )
                                    : undefined
                            }
                        />
                    ))}
                </section>
            ) : null}

            {scopedSubscriptions.length > 0 ? (
                <section className={groupClass}>
                    {groupHeading(t("automations.panel.appTriggers"))}
                    <AppTriggerProviderGroups
                        scopedSubscriptions={scopedSubscriptions}
                        entityId={entityId}
                        disabled={disabled}
                        subscriptionMenu={subscriptionMenu}
                        onOpenSubscription={openSubscription}
                        phone={phone}
                        onToggleSubscription={
                            switches
                                ? (record, next) => {
                                      if (record.id)
                                          void toggleAutomation(
                                              setSubscriptionActive,
                                              record.id,
                                              next,
                                          )
                                  }
                                : undefined
                        }
                    />
                </section>
            ) : null}

            {scopedSubscriptions.length === 0 && scopedSchedules.length === 0 ? (
                // One quiet line; the header's "Add automation" is the way to add one.
                <span className="text-xs text-colorTextTertiary">
                    {t("entityUi.triggers.noAutomations")}
                </span>
            ) : null}

            {/* Propless, atom-driven drawers, mounted once. A new automation created here is
                bound to this agent. */}
            {automationDrawer}
            <AutomationDeleteDialog
                open={deleteOpen}
                name={pendingDelete?.name ?? ""}
                onDelete={async () => {
                    await pendingDelete?.remove()
                }}
                onClose={() => setDeleteOpen(false)}
            />
        </div>
    )
}
