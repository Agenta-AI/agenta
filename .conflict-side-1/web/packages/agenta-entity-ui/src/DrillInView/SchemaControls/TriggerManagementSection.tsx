/**
 * TriggerManagementSection
 *
 * The agent config panel's "Triggers" section. Lists the CURRENT agent's persisted
 * triggers — provider event subscriptions and recurring schedules — as rows, and lets
 * the user add/manage them through the existing propless, atom-driven trigger drawers
 * (`@agenta/entity-ui/gatewayTrigger`). It reuses the same hooks and "⋯" menu the
 * workspace settings sections use; nothing about trigger CRUD is rebuilt here. In the
 * playground, running/paused is irrelevant, so rows expose a "Run in playground" test
 * action (status shown as a passive dot); pause/resume stays in the schedule drawer.
 *
 * Two pieces of real work live here:
 *  1. Scoping — the list hooks return every project trigger, so we filter to the agent
 *     bound by `data.references`, matching any reference id against the current agent's
 *     app / variant / revision ids (resolved from the workflow molecule by revisionId).
 *  2. Default-bind — opening a create drawer from this section pre-binds the new trigger
 *     to the current agent via `defaultReferences` (see the trigger drawer atoms).
 */
import {useCallback} from "react"

import {
    describeCron,
    getScheduleMessagePreview,
    isEntityActive,
    triggerDeliveriesDrawerAtom,
    triggerScheduleDrawerAtom,
    triggerSubscriptionDrawerAtom,
    useTriggerSchedule,
    useTriggerSubscription,
    type TriggerSchedule,
    type TriggerSubscription,
} from "@agenta/entities/gatewayTrigger"
import {simulatedAgentRunAtomFamily} from "@agenta/shared/state"
import {message} from "@agenta/ui"
import {ConfigAccordionSection} from "@agenta/ui/components/presentational"
import {
    ArrowsClockwise,
    Clock,
    Lightning,
    ListChecks,
    PencilSimpleLine,
    Plus,
    Trash,
    XCircle,
} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"
import type {MenuProps} from "antd"
import {useSetAtom} from "jotai"

import TriggerDeliveriesDrawer from "../../gatewayTrigger/drawers/TriggerDeliveriesDrawer"
import TriggerScheduleDrawer from "../../gatewayTrigger/drawers/TriggerScheduleDrawer"
import TriggerSubscriptionDrawer from "../../gatewayTrigger/drawers/TriggerSubscriptionDrawer"

import {AddTextLink} from "./AddTextLink"
import {countSummary} from "./agentTemplate/agentTemplateUtils"
import {AppTriggerProviderGroups} from "./triggerManagement/AppTriggerProviderGroups"
import {TriggerRow} from "./triggerManagement/TriggerRow"
import {useAgentTriggers} from "./triggerManagement/useAgentTriggers"

export {AddTriggerDropdown} from "./triggerManagement/AddTriggerDropdown"
export {useAgentTriggers} from "./triggerManagement/useAgentTriggers"

export interface TriggerManagementSectionProps {
    /** The open agent's revision id (the drill-in entityId). */
    entityId: string | null
    /** Read-only mode (e.g. a non-editable revision). */
    disabled?: boolean
}

export function TriggerManagementSection({entityId, disabled}: TriggerManagementSectionProps) {
    const {scopedSubscriptions, scopedSchedules, defaultReferences, defaultBoundLabel} =
        useAgentTriggers(entityId)

    const {
        remove: removeSubscription,
        refresh: refreshSubscription,
        revoke: revokeSubscription,
    } = useTriggerSubscription()
    const {remove: removeSchedule} = useTriggerSchedule()

    const openSubscriptionDrawer = useSetAtom(triggerSubscriptionDrawerAtom)
    const openScheduleDrawer = useSetAtom(triggerScheduleDrawerAtom)
    const openDeliveries = useSetAtom(triggerDeliveriesDrawerAtom)
    const setPendingRun = useSetAtom(simulatedAgentRunAtomFamily(entityId ?? ""))

    // A schedule (cron) has no external event to replay — simulate it with its own
    // configured inputs, exactly like the schedule drawer's "Run in playground".
    const simulateSchedule = useCallback(
        (record: TriggerSchedule) => {
            if (!entityId) {
                message.info("Open this agent in the playground first")
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
            message.success("Running in playground")
        },
        [entityId, setPendingRun],
    )

    // ---- subscription actions ----
    const subscriptionMenu = useCallback(
        (record: TriggerSubscription): MenuProps["items"] => [
            {
                key: "deliveries",
                label: "View deliveries",
                icon: <ListChecks size={16} />,
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                    if (record.id)
                        openDeliveries({
                            owner: {kind: "subscription", id: record.id},
                            name: record.name ?? undefined,
                            playgroundEntityId: entityId ?? undefined,
                        })
                },
            },
            {
                key: "edit",
                label: "Edit",
                icon: <PencilSimpleLine size={16} />,
                disabled,
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                    if (record.id)
                        openSubscriptionDrawer({
                            subscriptionId: record.id,
                            playgroundEntityId: entityId ?? undefined,
                        })
                },
            },
            {
                key: "refresh",
                label: "Refresh",
                icon: <ArrowsClockwise size={16} />,
                disabled,
                onClick: async (e) => {
                    e.domEvent.stopPropagation()
                    if (!record.id) return
                    try {
                        await refreshSubscription(record.id)
                        message.success("Subscription refreshed")
                    } catch {
                        message.error("Failed to refresh subscription")
                    }
                },
            },
            {type: "divider"},
            {
                key: "revoke",
                label: "Revoke",
                icon: <XCircle size={16} />,
                disabled,
                onClick: async (e) => {
                    e.domEvent.stopPropagation()
                    if (!record.id) return
                    try {
                        await revokeSubscription(record.id)
                        message.success("Subscription revoked")
                    } catch {
                        message.error("Failed to revoke subscription")
                    }
                },
            },
            {
                key: "delete",
                label: "Delete",
                icon: <Trash size={16} />,
                danger: true,
                disabled,
                onClick: async (e) => {
                    e.domEvent.stopPropagation()
                    if (!record.id) return
                    try {
                        await removeSubscription(record.id)
                        message.success("Subscription deleted")
                    } catch {
                        message.error("Failed to delete subscription")
                    }
                },
            },
        ],
        [
            entityId,
            openDeliveries,
            openSubscriptionDrawer,
            refreshSubscription,
            revokeSubscription,
            removeSubscription,
            disabled,
        ],
    )

    // ---- schedule actions ----
    const scheduleMenu = useCallback(
        (record: TriggerSchedule): MenuProps["items"] => [
            {
                key: "deliveries",
                label: "View deliveries",
                icon: <ListChecks size={16} />,
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                    if (record.id)
                        openDeliveries({
                            owner: {kind: "schedule", id: record.id},
                            name: record.name ?? undefined,
                            playgroundEntityId: entityId ?? undefined,
                        })
                },
            },
            {
                key: "edit",
                label: "Edit",
                icon: <PencilSimpleLine size={16} />,
                disabled,
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                    if (record.id)
                        openScheduleDrawer({
                            scheduleId: record.id,
                            playgroundEntityId: entityId ?? undefined,
                        })
                },
            },
            {type: "divider"},
            {
                key: "delete",
                label: "Delete",
                icon: <Trash size={16} />,
                danger: true,
                disabled,
                onClick: async (e) => {
                    e.domEvent.stopPropagation()
                    if (!record.id) return
                    try {
                        await removeSchedule(record.id)
                        message.success("Schedule deleted")
                    } catch {
                        message.error("Failed to delete schedule")
                    }
                },
            },
        ],
        [openDeliveries, openScheduleDrawer, removeSchedule, entityId, disabled],
    )

    // Create flows for the per-section "+" and empty-state links — both default-bind to this agent.
    const openSubscriptionCreate = useCallback(() => {
        openSubscriptionDrawer({
            defaultReferences,
            defaultBoundLabel,
            playgroundEntityId: entityId ?? undefined,
        })
    }, [openSubscriptionDrawer, defaultReferences, defaultBoundLabel, entityId])
    const openScheduleCreate = useCallback(() => {
        openScheduleDrawer({
            defaultReferences,
            defaultBoundLabel,
            playgroundEntityId: entityId ?? undefined,
        })
    }, [openScheduleDrawer, defaultReferences, defaultBoundLabel, entityId])

    // Compact header "+" — the same affordance the config sections render in their `extra` slot.
    const headerAddButton = (label: string, onClick: () => void) => (
        <Tooltip title={label}>
            <Button type="text" icon={<Plus size={16} />} onClick={onClick} aria-label={label} />
        </Tooltip>
    )

    return (
        <div className="flex flex-col">
            {/* Subscriptions + Schedules render as the SAME accordion sections the template config
                uses (icon, count summary, header "+", collapse) so the Triggers region reads like
                the Configuration region. */}
            <ConfigAccordionSection
                // Remount on the empty↔non-empty boundary so `defaultOpen` re-applies: adding the
                // FIRST subscription (0→1) otherwise leaves the mount-time-collapsed section shut and
                // hides the new row.
                key={scopedSubscriptions.length > 0 ? "has-subscriptions" : "no-subscriptions"}
                icon={<Lightning size={16} />}
                title="Subscriptions"
                summary={countSummary(scopedSubscriptions.length, "subscription")}
                extra={
                    !disabled
                        ? headerAddButton("Add subscription", openSubscriptionCreate)
                        : undefined
                }
                defaultOpen={scopedSubscriptions.length > 0}
                animateInitialOpen
            >
                {scopedSubscriptions.length > 0 ? (
                    // Grouped by provider. The connections + catalog queries live inside this child
                    // so they only fire when there ARE app subscriptions to decorate.
                    <AppTriggerProviderGroups
                        scopedSubscriptions={scopedSubscriptions}
                        entityId={entityId}
                        disabled={disabled}
                        defaultReferences={defaultReferences}
                        defaultBoundLabel={defaultBoundLabel}
                        subscriptionMenu={subscriptionMenu}
                    />
                ) : !disabled ? (
                    <span className="text-xs text-[var(--ag-c-97A4B0,#97a4b0)]">
                        No subscriptions yet —{" "}
                        <AddTextLink label="add a subscription" onClick={openSubscriptionCreate} />
                    </span>
                ) : null}
            </ConfigAccordionSection>

            <ConfigAccordionSection
                // See the Subscriptions section: remount on 0↔1 so adding the first schedule opens it.
                key={scopedSchedules.length > 0 ? "has-schedules" : "no-schedules"}
                icon={<Clock size={16} />}
                title="Schedules"
                summary={countSummary(scopedSchedules.length, "schedule")}
                extra={!disabled ? headerAddButton("Add schedule", openScheduleCreate) : undefined}
                defaultOpen={scopedSchedules.length > 0}
                noDivider
                animateInitialOpen
            >
                {scopedSchedules.length > 0 ? (
                    <div className="flex flex-col gap-2">
                        {scopedSchedules.map((record) => {
                            const cron = record.data?.schedule
                            const named = !!record.name?.trim()
                            const message = getScheduleMessagePreview(record.data?.inputs_fields)
                            return (
                                <TriggerRow
                                    key={`schedule-${record.id}`}
                                    icon={<Clock size={15} />}
                                    name={named ? (record.name as string) : "Untitled schedule"}
                                    nameMuted={!named}
                                    chip={cron ? describeCron(cron) : undefined}
                                    subtitle={message || "No message set"}
                                    active={isEntityActive(record)}
                                    disabled={disabled}
                                    runDisabled={disabled || !record.id}
                                    onRun={() => simulateSchedule(record)}
                                    onOpen={() =>
                                        record.id &&
                                        openScheduleDrawer({
                                            scheduleId: record.id,
                                            playgroundEntityId: entityId ?? undefined,
                                        })
                                    }
                                    menuItems={scheduleMenu(record)}
                                />
                            )
                        })}
                    </div>
                ) : !disabled ? (
                    <span className="text-xs text-[var(--ag-c-97A4B0,#97a4b0)]">
                        No schedules yet —{" "}
                        <AddTextLink label="add a schedule" onClick={openScheduleCreate} />
                    </span>
                ) : null}
            </ConfigAccordionSection>

            {/* Propless, atom-driven drawers — mounted once; they manage their own
                visibility. App browsing + connecting now happens inside the subscription
                drawer (no separate catalog drawer in the playground). When a
                subscription/schedule is created here it default-binds to this agent. */}
            <TriggerSubscriptionDrawer />
            <TriggerScheduleDrawer />
            <TriggerDeliveriesDrawer />
        </div>
    )
}
