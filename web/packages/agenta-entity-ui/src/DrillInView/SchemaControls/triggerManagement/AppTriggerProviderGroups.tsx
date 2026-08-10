/** App subscriptions grouped by provider, plus the provider/event label helpers they need. */
import {useCallback, useMemo, type ReactNode} from "react"

import {
    isEntityActive,
    triggerSubscriptionDrawerAtom,
    useTriggerCatalogIntegrations,
    useTriggerConnectionsQuery,
    type TriggerSubscription,
} from "@agenta/entities/gatewayTrigger"
import {useAtom, useSetAtom} from "jotai"
import {atomWithStorage} from "jotai/utils"

import {CollapsibleProviderGroup} from "../sectionGroups"

import {SubscriptionChildRow} from "./SubscriptionChildRow"
import {SubscriptionRunPopover} from "./SubscriptionRunPopover"

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

// App triggers grouped by provider. Extracted into its own component so the connections +
// catalog-integrations queries (the heavy ~90-app catalog fetch) mount ONLY when there are app
// subscriptions to decorate — they are the sole consumers of that data. The always-mounted Triggers
// section otherwise fired both on every agent-playground load just to render a count badge / empty
// state, before the user ever opened the trigger picker.
export function AppTriggerProviderGroups({
    scopedSubscriptions,
    entityId,
    disabled,
    defaultReferences,
    defaultBoundLabel,
    subscriptionMenu,
}: {
    scopedSubscriptions: TriggerSubscription[]
    entityId: string | null
    disabled?: boolean
    defaultReferences: Record<string, {id?: string; slug?: string}>
    defaultBoundLabel: string
    /** Builds a row's composed "⋯" menu body (`DropdownMenuItem` JSX). */
    subscriptionMenu: (record: TriggerSubscription) => ReactNode
}) {
    const {connections} = useTriggerConnectionsQuery()
    const {integrations} = useTriggerCatalogIntegrations()
    const [groupsExpanded, setGroupsExpanded] = useAtom(triggerGroupsExpandedAtom)
    const openSubscriptionDrawer = useSetAtom(triggerSubscriptionDrawerAtom)

    const connById = useMemo(
        () => new Map(connections.map((c) => [c.id, c] as const)),
        [connections],
    )

    // Subscriptions grouped by provider (connection.integration_key); name/logo from the
    // catalog when loaded, else a prettified key + plug icon.
    const providerGroups = useMemo<ProviderGroupData[]>(() => {
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
    }, [scopedSubscriptions, connById, integrations])

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
    const connectionLabel = useCallback(
        (connectionId?: string) => {
            const c = connectionId ? connById.get(connectionId) : undefined
            return c ? c.name || c.slug || c.integration_key : undefined
        },
        [connById],
    )

    if (providerGroups.length === 0) return null

    return (
        <div className="flex flex-col gap-2">
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
                            const eventLabel = prettifyEventKey(record.data?.event_key ?? "")
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
                                            label={record.name || eventLabel || "trigger"}
                                            eventKey={record.data?.event_key ?? undefined}
                                            playgroundEntityId={entityId}
                                            disabled={disabled || !record.id}
                                        />
                                    }
                                    onOpen={() =>
                                        record.id &&
                                        openSubscriptionDrawer({
                                            subscriptionId: record.id,
                                            playgroundEntityId: entityId ?? undefined,
                                        })
                                    }
                                    menu={subscriptionMenu(record)}
                                />
                            )
                        })}
                    </CollapsibleProviderGroup>
                )
            })}
        </div>
    )
}
