/**
 * TriggerManagementSection
 *
 * The agent config panel's "Triggers" section. Lists the CURRENT agent's persisted
 * triggers — provider event subscriptions and recurring schedules — as rows, and lets
 * the user add/manage them through the existing propless, atom-driven trigger drawers
 * (`@agenta/entity-ui/gatewayTrigger`). It reuses the same hooks, ActiveToggle, and
 * "⋯" menu the workspace settings sections use; nothing about trigger CRUD is rebuilt
 * here.
 *
 * Two pieces of real work live here:
 *  1. Scoping — the list hooks return every project trigger, so we filter to the agent
 *     bound by `data.references`, matching any reference id against the current agent's
 *     app / variant / revision ids (resolved from the workflow molecule by revisionId).
 *  2. Default-bind — opening a create drawer from this section pre-binds the new trigger
 *     to the current agent via `defaultReferences` (see the trigger drawer atoms).
 */
import {useCallback, useMemo} from "react"

import {
    describeCron,
    isEntityActive,
    isEntityValid,
    triggerCatalogDrawerOpenAtom,
    triggerDeliveriesDrawerAtom,
    triggerScheduleDrawerAtom,
    triggerSubscriptionDrawerAtom,
    useTriggerConnectionsQuery,
    useTriggerSchedule,
    useTriggerSchedules,
    useTriggerSubscription,
    useTriggerSubscriptions,
    type TriggerReference,
    type TriggerSchedule,
    type TriggerSubscription,
} from "@agenta/entities/gatewayTrigger"
import {workflowMolecule} from "@agenta/entities/workflow"
import {MoreOutlined} from "@ant-design/icons"
import {
    ArrowsClockwise,
    CaretRight,
    Clock,
    Lightning,
    ListChecks,
    PencilSimpleLine,
    Plus,
    Sparkle,
    Trash,
    XCircle,
} from "@phosphor-icons/react"
import {Button, Dropdown, Tooltip, Typography, message} from "antd"
import type {MenuProps} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import ActiveToggle from "../../gatewayTrigger/components/ActiveToggle"
import TriggerCatalogDrawer from "../../gatewayTrigger/drawers/TriggerCatalogDrawer"
import TriggerDeliveriesDrawer from "../../gatewayTrigger/drawers/TriggerDeliveriesDrawer"
import TriggerScheduleDrawer from "../../gatewayTrigger/drawers/TriggerScheduleDrawer"
import TriggerSubscriptionDrawer from "../../gatewayTrigger/drawers/TriggerSubscriptionDrawer"

export interface TriggerManagementSectionProps {
    /** The open agent's revision id (the drill-in entityId). */
    entityId: string | null
    /** Read-only mode (e.g. a non-editable revision). */
    disabled?: boolean
}

/** Whether any id in a trigger's `data.references` matches one of the agent's ids. */
function referencesMatch(
    references: Record<string, TriggerReference> | null | undefined,
    agentIds: Set<string>,
): boolean {
    if (!references || agentIds.size === 0) return false
    for (const ref of Object.values(references)) {
        if (ref?.id && agentIds.has(ref.id)) return true
    }
    return false
}

/**
 * Resolve the agent's matchable ids, its `defaultReferences`, and the project triggers
 * scoped to it. Shared by the section body and the header count badge / add-dropdown in
 * {@link AgentConfigControl} so scoping is defined in exactly one place.
 */
export function useAgentTriggers(entityId: string | null) {
    // The drill-in entity only carries `parameters`; read the parent ids straight from
    // the workflow molecule (keyed by the revision id, which is the entityId).
    const revision = useAtomValue(
        useMemo(() => workflowMolecule.selectors.resolvedData(entityId ?? ""), [entityId]),
    )
    const appId = revision?.workflow_id ?? null
    const variantId = revision?.workflow_variant_id ?? revision?.variant_id ?? null
    // Readable label for the default binding so the drawer's bound-workflow field
    // shows the agent's name instead of a raw id. Falls back when the name is unresolved.
    const defaultBoundLabel = (revision as {name?: string} | null)?.name ?? "Current agent"

    const agentIds = useMemo(() => {
        const ids = new Set<string>()
        if (entityId) ids.add(entityId)
        if (appId) ids.add(appId)
        if (variantId) ids.add(variantId)
        return ids
    }, [entityId, appId, variantId])

    // Pre-bind any trigger created from this section to the current agent. The drawers
    // store the picker's leaf id under `application_variant` (the BE completes the
    // family), so use the variant id when known, else the revision id.
    const defaultReferences = useMemo(() => {
        const refs: Record<string, {id: string}> = {}
        if (appId) refs.application = {id: appId}
        const variantRef = variantId ?? entityId
        if (variantRef) refs.application_variant = {id: variantRef}
        return refs
    }, [appId, variantId, entityId])

    const {subscriptions} = useTriggerSubscriptions()
    const {schedules} = useTriggerSchedules()

    const scopedSubscriptions = useMemo(
        () => subscriptions.filter((s) => referencesMatch(s.data?.references, agentIds)),
        [subscriptions, agentIds],
    )
    const scopedSchedules = useMemo(
        () => schedules.filter((s) => referencesMatch(s.data?.references, agentIds)),
        [schedules, agentIds],
    )

    return {
        defaultReferences,
        defaultBoundLabel,
        scopedSubscriptions,
        scopedSchedules,
        count: scopedSubscriptions.length + scopedSchedules.length,
    }
}

/** A trigger row: leading icon, bold name + chevron, subtitle, ActiveToggle, ⋯ menu. */
function TriggerRow({
    icon,
    name,
    subtitle,
    active,
    toggleDisabled,
    onToggle,
    onOpen,
    menuItems,
}: {
    icon: React.ReactNode
    name: string
    subtitle: string
    active: boolean
    toggleDisabled?: boolean
    onToggle: (next: boolean) => Promise<void>
    onOpen: () => void
    menuItems: MenuProps["items"]
}) {
    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onOpen}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onOpen()
                }
            }}
            className="group flex cursor-pointer items-center gap-2.5 rounded border border-solid border-[var(--ag-c-EAEFF5,#eaeff5)] px-3 py-2 transition-colors hover:border-[var(--ag-c-97A4B0,#97a4b0)]"
        >
            <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--ag-c-97A4B0,#97a4b0)]"
                style={{background: "var(--ag-c-0517290F)"}}
            >
                {icon}
            </span>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 truncate text-xs font-medium">
                    <span className="truncate">{name}</span>
                    <CaretRight size={12} className="shrink-0 text-[var(--ag-c-97A4B0,#97a4b0)]" />
                </div>
                <Typography.Text type="secondary" className="block truncate text-xs leading-tight">
                    {subtitle}
                </Typography.Text>
            </div>
            <div
                className="flex shrink-0 items-center gap-1"
                onClick={(e) => e.stopPropagation()}
                role="presentation"
            >
                <ActiveToggle
                    active={active}
                    onToggle={onToggle}
                    disabled={toggleDisabled}
                    activatedMessage="Trigger resumed"
                    pausedMessage="Trigger paused"
                    errorMessage="Failed to update trigger"
                />
                <Dropdown
                    trigger={["click"]}
                    styles={{root: {width: 180}}}
                    menu={{items: menuItems}}
                >
                    <Button
                        type="text"
                        icon={<MoreOutlined />}
                        aria-label="Open trigger actions"
                        onClick={(e) => e.stopPropagation()}
                    />
                </Dropdown>
            </div>
        </div>
    )
}

export function TriggerManagementSection({entityId, disabled}: TriggerManagementSectionProps) {
    const {scopedSubscriptions, scopedSchedules, count, defaultReferences, defaultBoundLabel} =
        useAgentTriggers(entityId)

    const {connections} = useTriggerConnectionsQuery()
    const {
        setActive: setSubscriptionActive,
        remove: removeSubscription,
        refresh: refreshSubscription,
        revoke: revokeSubscription,
    } = useTriggerSubscription()
    const {setActive: setScheduleActive, remove: removeSchedule} = useTriggerSchedule()

    const openSubscriptionDrawer = useSetAtom(triggerSubscriptionDrawerAtom)
    const openScheduleDrawer = useSetAtom(triggerScheduleDrawerAtom)
    const openDeliveries = useSetAtom(triggerDeliveriesDrawerAtom)

    const connectionLabel = useCallback(
        (connectionId?: string) => {
            const c = connections.find((conn) => conn.id === connectionId)
            return c ? c.name || c.slug || c.integration_key : undefined
        },
        [connections],
    )

    // ---- subscription actions ----
    const handleSubscriptionToggle = useCallback(
        (record: TriggerSubscription) => async (next: boolean) => {
            if (!record.id) return
            await setSubscriptionActive(record.id, next)
        },
        [setSubscriptionActive],
    )
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
                        })
                },
            },
            {
                key: "edit",
                label: "Edit",
                icon: <PencilSimpleLine size={16} />,
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                    if (record.id) openSubscriptionDrawer({subscriptionId: record.id})
                },
            },
            {
                key: "refresh",
                label: "Refresh",
                icon: <ArrowsClockwise size={16} />,
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
            openDeliveries,
            openSubscriptionDrawer,
            refreshSubscription,
            revokeSubscription,
            removeSubscription,
        ],
    )

    // ---- schedule actions ----
    const handleScheduleToggle = useCallback(
        (record: TriggerSchedule) => async (next: boolean) => {
            if (!record.id) return
            await setScheduleActive(record.id, next)
        },
        [setScheduleActive],
    )
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
                        })
                },
            },
            {
                key: "edit",
                label: "Edit",
                icon: <PencilSimpleLine size={16} />,
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                    if (record.id) openScheduleDrawer({scheduleId: record.id})
                },
            },
            {type: "divider"},
            {
                key: "delete",
                label: "Delete",
                icon: <Trash size={16} />,
                danger: true,
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
        [openDeliveries, openScheduleDrawer, removeSchedule],
    )

    return (
        <div className="flex flex-col gap-2">
            {count === 0 ? (
                <Typography.Text type="secondary" className="text-xs">
                    No triggers yet. Add an app trigger or a schedule to run this agent
                    automatically.
                </Typography.Text>
            ) : (
                <div className="flex flex-col gap-2">
                    {scopedSchedules.map((record) => {
                        const cron = record.data?.schedule
                        return (
                            <TriggerRow
                                key={`schedule-${record.id}`}
                                icon={<Clock size={15} />}
                                name={record.name || record.id || "Schedule"}
                                subtitle={cron ? describeCron(cron) : "Recurring schedule"}
                                active={isEntityActive(record)}
                                toggleDisabled={disabled || !record.id}
                                onToggle={handleScheduleToggle(record)}
                                onOpen={() =>
                                    record.id && openScheduleDrawer({scheduleId: record.id})
                                }
                                menuItems={scheduleMenu(record)}
                            />
                        )
                    })}
                    {scopedSubscriptions.map((record) => {
                        const subtitle =
                            record.description ||
                            record.data?.event_key ||
                            connectionLabel(record.connection_id) ||
                            "App subscription"
                        return (
                            <TriggerRow
                                key={`subscription-${record.id}`}
                                icon={<Lightning size={15} />}
                                name={record.name || record.id || "Subscription"}
                                subtitle={subtitle}
                                active={isEntityActive(record)}
                                toggleDisabled={disabled || !record.id || !isEntityValid(record)}
                                onToggle={handleSubscriptionToggle(record)}
                                onOpen={() =>
                                    record.id && openSubscriptionDrawer({subscriptionId: record.id})
                                }
                                menuItems={subscriptionMenu(record)}
                            />
                        )
                    })}
                </div>
            )}

            {/* Propless, atom-driven drawers — mounted once; they manage their own
                visibility (and the catalog renders its own connect flow internally).
                When a subscription/schedule is created from here it default-binds to
                this agent. */}
            <TriggerCatalogDrawer
                defaultReferences={defaultReferences}
                defaultBoundLabel={defaultBoundLabel}
            />
            <TriggerSubscriptionDrawer />
            <TriggerScheduleDrawer />
            <TriggerDeliveriesDrawer />
        </div>
    )
}

/**
 * The "+ Trigger" add affordance, rendered in the section header's `extra` slot. A
 * dropdown with: "Create with AI" (disabled placeholder), "App trigger" (opens the
 * catalog), and "Scheduled trigger" (opens the schedule create drawer, default-bound to
 * the current agent). Kept separate from the section body because the accordion renders
 * `extra` outside the section content.
 */
export function AddTriggerDropdown({entityId}: {entityId: string | null}) {
    const {defaultReferences, defaultBoundLabel} = useAgentTriggers(entityId)
    const openCatalog = useSetAtom(triggerCatalogDrawerOpenAtom)
    const openScheduleDrawer = useSetAtom(triggerScheduleDrawerAtom)

    const items: MenuProps["items"] = useMemo(
        () => [
            {
                key: "ai",
                label: (
                    <Tooltip title="Coming soon">
                        <span>Create with AI</span>
                    </Tooltip>
                ),
                icon: <Sparkle size={16} />,
                disabled: true,
            },
            {
                key: "app",
                label: "App trigger",
                icon: <Lightning size={16} />,
                onClick: () => openCatalog(true),
            },
            {
                key: "schedule",
                label: "Scheduled trigger",
                icon: <Clock size={16} />,
                onClick: () => openScheduleDrawer({defaultReferences, defaultBoundLabel}),
            },
        ],
        [openCatalog, openScheduleDrawer, defaultReferences, defaultBoundLabel],
    )

    return (
        <Dropdown trigger={["click"]} menu={{items}} styles={{root: {width: 200}}}>
            <Tooltip title="Add trigger">
                <Button
                    type="text"
                    icon={<Plus size={16} />}
                    aria-label="Add trigger"
                    onClick={(e) => e.stopPropagation()}
                />
            </Tooltip>
        </Dropdown>
    )
}
