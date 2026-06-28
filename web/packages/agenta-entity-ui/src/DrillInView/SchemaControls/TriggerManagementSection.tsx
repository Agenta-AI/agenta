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
import {type ReactNode, useCallback, useMemo} from "react"

import {
    describeCron,
    isEntityActive,
    isEntityValid,
    triggerCatalogDrawerOpenAtom,
    triggerDeliveriesDrawerAtom,
    triggerScheduleDrawerAtom,
    triggerSubscriptionDrawerAtom,
    queryTriggerDeliveries,
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
import {simulatedAgentRunAtomFamily} from "@agenta/shared/state"
import {MoreOutlined} from "@ant-design/icons"
import {
    ArrowsClockwise,
    CaretRight,
    Clock,
    Lightning,
    ListChecks,
    PencilSimpleLine,
    Play,
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

import {AddTextLink} from "./AddTextLink"

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
    // The app slug — needed for "By environment" binding, which resolves via the
    // application slug + environment (see triggers/service.py `_normalize_references`).
    const appSlug = (revision as {slug?: string} | null)?.slug ?? null
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
        const refs: Record<string, {id?: string; slug?: string}> = {}
        if (appId || appSlug) {
            refs.application = {...(appId ? {id: appId} : {}), ...(appSlug ? {slug: appSlug} : {})}
        }
        const variantRef = variantId ?? entityId
        if (variantRef) refs.application_variant = {id: variantRef}
        return refs
    }, [appId, appSlug, variantId, entityId])

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
    disabled,
    toggleDisabled,
    onToggle,
    onOpen,
    menuItems,
}: {
    icon: React.ReactNode
    name: string
    subtitle: string
    active: boolean
    disabled?: boolean
    toggleDisabled?: boolean
    onToggle: (next: boolean) => Promise<void>
    onOpen: () => void
    menuItems: MenuProps["items"]
}) {
    // Read-only mode opens nothing: the row's target is an editable drawer.
    const open = disabled ? undefined : onOpen
    return (
        <div
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled || undefined}
            onClick={open}
            onKeyDown={(e) => {
                // Only the row itself activates — keyboard events bubbling up from the
                // toggle or ⋯ menu must not also open the drawer.
                if (e.target !== e.currentTarget || !open) return
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    open()
                }
            }}
            className={`group flex items-center gap-2.5 rounded border border-solid border-[var(--ag-colorBorderSecondary)] px-3 py-2 transition-colors ${disabled ? "cursor-default" : "cursor-pointer hover:border-[var(--ag-colorBorder)]"}`}
        >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-[var(--ag-colorFillSecondary)] text-[var(--ag-colorTextSecondary)]">
                {icon}
            </span>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 truncate text-xs font-medium">
                    <span className="truncate">{name}</span>
                    <CaretRight
                        size={12}
                        className="shrink-0 text-[var(--ag-colorTextSecondary)]"
                    />
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
    const setPendingRun = useSetAtom(simulatedAgentRunAtomFamily(entityId ?? ""))

    // Row "Run in playground": replay the trigger's latest captured delivery (a real
    // event) into the agent's active chat session. A fired trigger only runs
    // server-side, so this is how you observe it in the playground. No delivery yet
    // → tell the user to Test first.
    const runInPlayground = useCallback(
        async (args: {
            kind: "subscription" | "schedule"
            id: string
            label: string
            eventKey?: string
        }) => {
            if (!entityId) {
                message.info("Open this agent in the playground first")
                return
            }
            try {
                const {deliveries} = await queryTriggerDeliveries(
                    args.kind === "subscription"
                        ? {subscription_id: args.id}
                        : {schedule_id: args.id},
                )
                const hit = deliveries.find(
                    (d) => d.data?.inputs && Object.keys(d.data.inputs).length > 0,
                )
                if (!hit?.data?.inputs) {
                    message.info(
                        "No captured events yet — open the trigger and Test to capture one",
                    )
                    return
                }
                const text = `[Triggered by ${args.label}${args.eventKey ? ` · ${args.eventKey}` : ""}]\n\`\`\`json\n${JSON.stringify(
                    hit.data.inputs,
                    null,
                    2,
                )}\n\`\`\``
                setPendingRun({text, nonce: Date.now()})
                message.success("Running in playground")
            } catch {
                message.error("Couldn't load the trigger's events")
            }
        },
        [entityId, setPendingRun],
    )

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
                            playgroundEntityId: entityId ?? undefined,
                        })
                },
            },
            {
                key: "run-in-playground",
                label: "Run in playground",
                icon: <Play size={16} />,
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                    if (record.id)
                        runInPlayground({
                            kind: "subscription",
                            id: record.id,
                            label: record.name || record.data?.event_key || "trigger",
                            eventKey: record.data?.event_key ?? undefined,
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
            runInPlayground,
            disabled,
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
                            playgroundEntityId: entityId ?? undefined,
                        })
                },
            },
            {
                key: "run-in-playground",
                label: "Run in playground",
                icon: <Play size={16} />,
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                    if (record.id)
                        runInPlayground({
                            kind: "schedule",
                            id: record.id,
                            label: record.name || "schedule",
                            eventKey: record.data?.event_key ?? undefined,
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
        [openDeliveries, openScheduleDrawer, removeSchedule, runInPlayground, entityId, disabled],
    )

    return (
        <div className="flex flex-col gap-2">
            {count === 0 ? (
                !disabled ? (
                    <span className="text-xs text-[var(--ag-c-97A4B0,#97a4b0)]">
                        No triggers yet —{" "}
                        <AddTriggerDropdown
                            entityId={entityId}
                            trigger={<AddTextLink label="add a trigger" />}
                        />
                    </span>
                ) : null
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
                                disabled={disabled}
                                toggleDisabled={disabled || !record.id}
                                onToggle={handleScheduleToggle(record)}
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
                                disabled={disabled}
                                toggleDisabled={disabled || !record.id || !isEntityValid(record)}
                                onToggle={handleSubscriptionToggle(record)}
                                onOpen={() =>
                                    record.id &&
                                    openSubscriptionDrawer({
                                        subscriptionId: record.id,
                                        playgroundEntityId: entityId ?? undefined,
                                    })
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
                playgroundEntityId={entityId ?? undefined}
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
export function AddTriggerDropdown({
    entityId,
    trigger,
}: {
    entityId: string | null
    /** Custom trigger element (e.g. an inline text-link for an empty state). Defaults to a `+`. */
    trigger?: ReactNode
}) {
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
                onClick: () =>
                    openScheduleDrawer({
                        defaultReferences,
                        defaultBoundLabel,
                        playgroundEntityId: entityId ?? undefined,
                    }),
            },
        ],
        [openCatalog, openScheduleDrawer, defaultReferences, defaultBoundLabel, entityId],
    )

    return (
        <Dropdown trigger={["click"]} menu={{items}} styles={{root: {width: 200}}}>
            {trigger ?? (
                <Tooltip title="Add trigger">
                    <Button
                        type="text"
                        icon={<Plus size={16} />}
                        aria-label="Add trigger"
                        onClick={(e) => e.stopPropagation()}
                    />
                </Tooltip>
            )}
        </Dropdown>
    )
}
