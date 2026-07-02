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
import {type ReactNode, useCallback, useMemo, useState} from "react"

import {
    describeCron,
    getScheduleMessagePreview,
    isEntityActive,
    triggerDeliveriesDrawerAtom,
    triggerScheduleDrawerAtom,
    triggerSubscriptionDrawerAtom,
    useTriggerCatalogIntegrations,
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
import {message} from "@agenta/ui"
import {MoreOutlined} from "@ant-design/icons"
import {
    ArrowsClockwise,
    CaretRight,
    Clock,
    Flask,
    Lightning,
    ListChecks,
    PencilSimpleLine,
    Plus,
    Sparkle,
    Trash,
    XCircle,
} from "@phosphor-icons/react"
import {Button, Dropdown, Tooltip} from "antd"
import type {MenuProps} from "antd"
import {useAtom, useAtomValue, useSetAtom} from "jotai"
import {atomWithStorage} from "jotai/utils"

import {captureEntityUiEvent} from "../../analytics"
import {AddItemMenu, type AddItemGroup} from "../../drawers/shared/AddItemMenu"
import {loadRecentSamples, waitForNewDelivery} from "../../gatewayTrigger/drawers/shared/deliveries"
import {
    EventSourcePicker,
    type SampledEvent,
} from "../../gatewayTrigger/drawers/shared/EventSourcePicker"
import TriggerDeliveriesDrawer from "../../gatewayTrigger/drawers/TriggerDeliveriesDrawer"
import TriggerScheduleDrawer from "../../gatewayTrigger/drawers/TriggerScheduleDrawer"
import TriggerSubscriptionDrawer from "../../gatewayTrigger/drawers/TriggerSubscriptionDrawer"

import {AddTextLink} from "./AddTextLink"
import {CollapsibleProviderGroup, SubSectionHeader} from "./sectionGroups"

// Persisted per-agent expand state for provider groups (key = `${entityId}:${providerKey}`).
const triggerGroupsExpandedAtom = atomWithStorage<Record<string, boolean>>(
    "agenta:triggers:groups-expanded",
    {},
)

// "SLACK_MESSAGE_REACTION_ADDED" → "Message reaction added" (drop provider prefix, title-case).
function prettifyEventKey(key: string): string {
    if (!key) return ""
    const parts = key.split("_")
    const text = (parts.length > 1 ? parts.slice(1) : parts).join(" ").toLowerCase().trim()
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : key
}

function prettifyProvider(key: string): string {
    if (!key) return "Other"
    return key.charAt(0).toUpperCase() + key.slice(1)
}

interface ProviderGroupData {
    key: string
    name: string
    logo?: string | null
    subs: TriggerSubscription[]
}

/** A subscription rendered as a child under its provider group: dot + event + actions. */
function SubscriptionChildRow({
    primary,
    primaryMuted,
    secondary,
    active,
    disabled,
    runSlot,
    onOpen,
    menuItems,
}: {
    primary: string
    primaryMuted?: boolean
    secondary?: string
    active: boolean
    disabled?: boolean
    /** The "Run in playground" affordance (an event-source picker), supplied by the parent. */
    runSlot: ReactNode
    onOpen: () => void
    menuItems: MenuProps["items"]
}) {
    const open = disabled ? undefined : onOpen
    return (
        <div
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled || undefined}
            onClick={open}
            onKeyDown={(e) => {
                if (e.target !== e.currentTarget || !open) return
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    open()
                }
            }}
            className={`group flex items-center gap-2.5 rounded px-2.5 py-1.5 transition-colors ${
                disabled
                    ? "cursor-default"
                    : "cursor-pointer hover:bg-[var(--ag-colorFillSecondary)]"
            }`}
        >
            <Tooltip title={active ? "Active" : "Paused"}>
                <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                        active
                            ? "bg-[var(--ag-colorSuccess)]"
                            : "bg-[var(--ag-colorTextQuaternary)]"
                    }`}
                />
            </Tooltip>
            <div className="min-w-0 flex-1">
                <div
                    className={`truncate text-xs font-medium ${
                        primaryMuted ? "italic text-[var(--ag-colorTextTertiary)]" : ""
                    }`}
                >
                    {primary}
                </div>
                {secondary ? (
                    <div className="truncate text-[11px] leading-snug text-[var(--ag-colorTextTertiary)]">
                        {secondary}
                    </div>
                ) : null}
            </div>
            <div
                className="flex shrink-0 items-center gap-1"
                onClick={(e) => e.stopPropagation()}
                role="presentation"
            >
                {runSlot}
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

/**
 * The subscription row's "Run in playground" flask — opens the EventSourcePicker (wait for a
 * new event / pick a recent delivery) so the user runs a SPECIFIC real event, instead of
 * silently replaying whatever delivery happened to be latest.
 */
function SubscriptionRunPopover({
    subscriptionId,
    label,
    eventKey,
    playgroundEntityId,
    disabled,
}: {
    subscriptionId: string
    label: string
    eventKey?: string
    playgroundEntityId: string | null
    disabled?: boolean
}) {
    const setPendingRun = useSetAtom(simulatedAgentRunAtomFamily(playgroundEntityId ?? ""))
    const [recent, setRecent] = useState<SampledEvent[]>([])

    const refresh = useCallback(async () => {
        try {
            setRecent(await loadRecentSamples(subscriptionId, label))
        } catch {
            message.error("Couldn't load recent events")
        }
    }, [subscriptionId, label])

    const waitForEvent = useCallback(async () => {
        let result: Awaited<ReturnType<typeof waitForNewDelivery>>
        try {
            result = await waitForNewDelivery(subscriptionId, label)
        } catch {
            message.error("Couldn't check for new events")
            return null
        }
        if (!result) {
            message.info("No event arrived yet — trigger it from the app, then try again.")
            return null
        }
        setRecent(result.recent)
        return result.sample
    }, [subscriptionId, label])

    const run = useCallback(
        (event: SampledEvent) => {
            if (!playgroundEntityId) {
                message.info("Open this agent in the playground first")
                return
            }
            const inputs =
                event.payload && typeof event.payload === "object"
                    ? (event.payload as Record<string, unknown>)
                    : {}
            const msg = getScheduleMessagePreview(inputs)
            const text = msg.trim()
                ? msg
                : `[Triggered by ${label}${eventKey ? ` · ${eventKey}` : ""}]\n\`\`\`json\n${JSON.stringify(
                      inputs,
                      null,
                      2,
                  )}\n\`\`\``
            setPendingRun({text, nonce: Date.now(), newSession: true})
            message.success("Running in playground")
        },
        [playgroundEntityId, setPendingRun, label, eventKey],
    )

    return (
        <EventSourcePicker
            placement="bottomRight"
            onOpenChange={(open) => open && refresh()}
            trigger={
                <Tooltip title="Run in playground">
                    <Button
                        type="text"
                        icon={<Flask size={16} />}
                        aria-label="Run in playground"
                        disabled={disabled}
                        onClick={(e) => e.stopPropagation()}
                    />
                </Tooltip>
            }
            recentEvents={recent}
            onPick={run}
            onWaitForEvent={waitForEvent}
            waitHint="trigger it from the app now"
        />
    )
}

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

/** A trigger row: leading status-dot icon, bold name + chevron, subtitle, run + ⋯ menu. */
function TriggerRow({
    icon,
    name,
    nameMuted,
    chip,
    subtitle,
    active,
    disabled,
    runDisabled,
    onRun,
    onOpen,
    menuItems,
}: {
    icon: ReactNode
    name: string
    nameMuted?: boolean
    chip?: ReactNode
    subtitle: string
    active: boolean
    disabled?: boolean
    runDisabled?: boolean
    onRun: () => void
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
                // run button or ⋯ menu must not also open the drawer.
                if (e.target !== e.currentTarget || !open) return
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    open()
                }
            }}
            className={`group flex items-center gap-2.5 rounded border border-solid border-[var(--ag-colorBorderSecondary)] px-3 py-2 transition-colors ${disabled ? "cursor-default" : "cursor-pointer hover:border-[var(--ag-colorBorder)]"}`}
        >
            <Tooltip title={active ? "Active" : "Paused"}>
                <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded bg-[var(--ag-colorFillSecondary)] text-[var(--ag-colorTextSecondary)]">
                    {icon}
                    <span
                        className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-solid border-[var(--ag-colorBgContainer)] ${
                            active
                                ? "bg-[var(--ag-colorSuccess)]"
                                : "bg-[var(--ag-colorTextQuaternary)]"
                        }`}
                    />
                </span>
            </Tooltip>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                    <span
                        className={`truncate text-xs font-medium ${
                            nameMuted ? "italic text-[var(--ag-colorTextTertiary)]" : ""
                        }`}
                    >
                        {name}
                    </span>
                    <CaretRight
                        size={12}
                        className="shrink-0 text-[var(--ag-colorTextSecondary)]"
                    />
                    {chip ? (
                        <span className="ml-0.5 max-w-[170px] shrink-0 truncate rounded bg-[var(--ag-colorFillSecondary)] px-1.5 py-0.5 text-[10px] text-[var(--ag-colorTextSecondary)]">
                            {chip}
                        </span>
                    ) : null}
                </div>
                <div className="mt-0.5 line-clamp-2 max-w-prose text-xs leading-snug text-[var(--ag-colorTextSecondary)]">
                    {subtitle}
                </div>
            </div>
            <div
                className="flex shrink-0 items-center gap-1"
                onClick={(e) => e.stopPropagation()}
                role="presentation"
            >
                <Tooltip title="Run in playground">
                    <Button
                        type="text"
                        icon={<Flask size={16} />}
                        aria-label="Run in playground"
                        disabled={runDisabled}
                        onClick={(e) => {
                            e.stopPropagation()
                            onRun()
                        }}
                    />
                </Tooltip>
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
    const {integrations} = useTriggerCatalogIntegrations()
    const [groupsExpanded, setGroupsExpanded] = useAtom(triggerGroupsExpandedAtom)

    // Subscriptions grouped by provider (connection.integration_key); name/logo from the
    // catalog when loaded, else a prettified key + plug icon.
    const providerGroups = useMemo<ProviderGroupData[]>(() => {
        const connById = new Map(connections.map((c) => [c.id, c] as const))
        const intgByKey = new Map(integrations.map((i) => [i.key, i] as const))
        const groups = new Map<string, ProviderGroupData>()
        for (const sub of scopedSubscriptions) {
            const conn = connById.get(sub.connection_id)
            const providerKey = conn?.integration_key || "other"
            let group = groups.get(providerKey)
            if (!group) {
                const intg = intgByKey.get(providerKey)
                group = {
                    key: providerKey,
                    name: intg?.name || prettifyProvider(providerKey),
                    logo: intg?.logo,
                    subs: [],
                }
                groups.set(providerKey, group)
            }
            group.subs.push(sub)
        }
        return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name))
    }, [scopedSubscriptions, connections, integrations])

    const isGroupOpen = useCallback(
        (group: ProviderGroupData) =>
            groupsExpanded[`${entityId}:${group.key}`] ?? group.subs.length === 1,
        [groupsExpanded, entityId],
    )
    const toggleGroup = useCallback(
        (group: ProviderGroupData) => {
            const k = `${entityId}:${group.key}`
            setGroupsExpanded((prev) => ({...prev, [k]: !(prev[k] ?? group.subs.length === 1)}))
        },
        [entityId, setGroupsExpanded],
    )
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

    const connectionLabel = useCallback(
        (connectionId?: string) => {
            const c = connections.find((conn) => conn.id === connectionId)
            return c ? c.name || c.slug || c.integration_key : undefined
        },
        [connections],
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
                <div className="flex flex-col gap-3">
                    {/* App triggers — grouped by provider (subscriptions first). */}
                    {providerGroups.length > 0 && (
                        <div className="flex flex-col gap-2">
                            <SubSectionHeader
                                label="App triggers"
                                count={scopedSubscriptions.length}
                            />
                            {providerGroups.map((group) => {
                                const open = isGroupOpen(group)
                                const activeCount = group.subs.filter(isEntityActive).length
                                return (
                                    <CollapsibleProviderGroup
                                        key={group.key}
                                        logo={group.logo}
                                        name={group.name}
                                        countText={`${activeCount} active · ${group.subs.length} total`}
                                        open={open}
                                        onToggle={() => toggleGroup(group)}
                                        onAdd={
                                            !disabled
                                                ? () =>
                                                      openSubscriptionDrawer({
                                                          defaultReferences,
                                                          defaultBoundLabel,
                                                          playgroundEntityId: entityId ?? undefined,
                                                          integrationKey: group.key,
                                                          integrationName: group.name,
                                                      })
                                                : undefined
                                        }
                                        addLabel={`Add ${group.name} trigger`}
                                    >
                                        {group.subs.map((record) => {
                                            const named = !!record.name?.trim()
                                            const eventLabel = prettifyEventKey(
                                                record.data?.event_key ?? "",
                                            )
                                            const primary = named
                                                ? (record.name as string)
                                                : eventLabel || "Untitled subscription"
                                            const secondary = named
                                                ? eventLabel || undefined
                                                : connectionLabel(record.connection_id) ||
                                                  record.description ||
                                                  undefined
                                            return (
                                                <SubscriptionChildRow
                                                    key={`subscription-${record.id}`}
                                                    primary={primary}
                                                    primaryMuted={!named && !eventLabel}
                                                    secondary={secondary}
                                                    active={isEntityActive(record)}
                                                    disabled={disabled}
                                                    runSlot={
                                                        <SubscriptionRunPopover
                                                            subscriptionId={record.id ?? ""}
                                                            label={
                                                                record.name ||
                                                                eventLabel ||
                                                                "trigger"
                                                            }
                                                            eventKey={
                                                                record.data?.event_key ?? undefined
                                                            }
                                                            playgroundEntityId={entityId}
                                                            disabled={disabled || !record.id}
                                                        />
                                                    }
                                                    onOpen={() =>
                                                        record.id &&
                                                        openSubscriptionDrawer({
                                                            subscriptionId: record.id,
                                                            playgroundEntityId:
                                                                entityId ?? undefined,
                                                        })
                                                    }
                                                    menuItems={subscriptionMenu(record)}
                                                />
                                            )
                                        })}
                                    </CollapsibleProviderGroup>
                                )
                            })}
                        </div>
                    )}

                    {/* Schedules — flat (no provider), listed last. */}
                    {scopedSchedules.length > 0 && (
                        <div className="flex flex-col gap-2">
                            <SubSectionHeader label="Schedules" count={scopedSchedules.length} />
                            {scopedSchedules.map((record) => {
                                const cron = record.data?.schedule
                                const named = !!record.name?.trim()
                                const message = getScheduleMessagePreview(
                                    record.data?.inputs_fields,
                                )
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
                    )}
                </div>
            )}

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
    const openSubscriptionDrawer = useSetAtom(triggerSubscriptionDrawerAtom)
    const openScheduleDrawer = useSetAtom(triggerScheduleDrawerAtom)

    // Shares the tools add-menu's row treatment (AddItemMenu). A trigger is always a NEW trigger of
    // some kind, so the tools' "add existing / create new" split doesn't apply — one "Add new"
    // section (kept labelled for visual consistency with the tools popover) lists the trigger types.
    const groups: AddItemGroup[] = useMemo(
        () => [
            {
                label: "Add new",
                items: [
                    {
                        key: "app",
                        icon: <Lightning size={17} />,
                        title: "App trigger",
                        subtitle: "React to an event from a connected app",
                        opensDrawer: true,
                        onSelect: () =>
                            openSubscriptionDrawer({
                                defaultReferences,
                                defaultBoundLabel,
                                playgroundEntityId: entityId ?? undefined,
                            }),
                    },
                    {
                        key: "schedule",
                        icon: <Clock size={17} />,
                        title: "Scheduled trigger",
                        subtitle: "Run on a recurring schedule",
                        opensDrawer: true,
                        onSelect: () =>
                            openScheduleDrawer({
                                defaultReferences,
                                defaultBoundLabel,
                                playgroundEntityId: entityId ?? undefined,
                            }),
                    },
                    {
                        key: "ai",
                        icon: <Sparkle size={17} />,
                        title: "Create with AI",
                        subtitle: "Describe it and let AI set it up",
                        disabled: true,
                        disabledHint: "Coming soon",
                    },
                ],
            },
        ],
        [
            openSubscriptionDrawer,
            openScheduleDrawer,
            defaultReferences,
            defaultBoundLabel,
            entityId,
        ],
    )

    return (
        <AddItemMenu
            groups={groups}
            ariaLabel="Add trigger"
            onOpen={() => captureEntityUiEvent("agent_trigger_menu_opened")}
            trigger={
                trigger ?? (
                    <Tooltip title="Add trigger">
                        <Button
                            type="text"
                            icon={<Plus size={16} />}
                            aria-label="Add trigger"
                            onClick={(e) => e.stopPropagation()}
                        />
                    </Tooltip>
                )
            }
        />
    )
}
