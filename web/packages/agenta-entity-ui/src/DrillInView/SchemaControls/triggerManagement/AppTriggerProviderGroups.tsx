/** App subscriptions as a flat list of rows, sub-grouped by account only when an app has 2+. */
import {useCallback, useMemo, type ReactNode} from "react"

import {
    isEntityActive,
    triggerSubscriptionDrawerAtom,
    useTriggerCatalogIntegrations,
    useTriggerConnectionsQuery,
    type TriggerSubscription,
} from "@agenta/entities/gatewayTrigger"
import {useSetAtom} from "jotai"

import {SubscriptionChildRow} from "./SubscriptionChildRow"

// "SLACK_MESSAGE_REACTION_ADDED" → "Message reaction added" (drop provider prefix, title-case).
function prettifyEventKey(key: string): string {
    if (!key) return ""
    const parts = key.split("_")
    const text = (parts.length > 1 ? parts.slice(1) : parts).join(" ").toLowerCase().trim()
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : key
}

interface ConnectionGroup {
    connId: string
    integrationKey: string
    /** The account label (connection name / slug), shown as a header when the app has 2+ accounts. */
    label: string
    logo?: string | null
    subs: TriggerSubscription[]
    /** True when this app has more than one connected account — then the account header renders. */
    showHeader: boolean
}

// App subscriptions as a flat, bordered list matching the schedule rows. The same app connected
// under two accounts can't be told apart by logo alone, so rows are sub-grouped by connection and
// the account name is shown above the group — but only when that app has 2+ accounts (a single
// account stays a plain flat list). Extracted so the connections + catalog-integrations queries
// (the heavy ~90-app catalog fetch) mount ONLY when there are app subscriptions to decorate.
export function AppTriggerProviderGroups({
    scopedSubscriptions,
    entityId,
    disabled,
    subscriptionMenu,
}: {
    scopedSubscriptions: TriggerSubscription[]
    entityId: string | null
    disabled?: boolean
    /** Builds a row's composed "⋯" menu body (`DropdownMenuItem` JSX). */
    subscriptionMenu: (record: TriggerSubscription) => ReactNode
}) {
    const {connections} = useTriggerConnectionsQuery()
    const {integrations} = useTriggerCatalogIntegrations()
    const openSubscriptionDrawer = useSetAtom(triggerSubscriptionDrawerAtom)

    const connById = useMemo(
        () => new Map(connections.map((c) => [c.id, c] as const)),
        [connections],
    )
    const intgByKey = useMemo(
        () => new Map(integrations.map((i) => [i.key, i] as const)),
        [integrations],
    )

    const providerKey = useCallback(
        (connectionId?: string) => connById.get(connectionId ?? "")?.integration_key || "other",
        [connById],
    )
    // The connected app's logo (catalog when loaded, else the plug fallback in ProviderLogo).
    const providerLogo = useCallback(
        (connectionId?: string) => intgByKey.get(providerKey(connectionId))?.logo ?? null,
        [intgByKey, providerKey],
    )
    const connectionLabel = useCallback(
        (connectionId?: string) => {
            const c = connectionId ? connById.get(connectionId) : undefined
            return c ? c.name || c.slug || c.integration_key : undefined
        },
        [connById],
    )
    const eventLabelOf = (record: TriggerSubscription) =>
        prettifyEventKey(record.data?.event_key ?? "")

    // Group by connection (account), then flag which groups need an account header: only apps with
    // more than one connected account. Ordered by app, then account, so clusters stay stable.
    const groups = useMemo<ConnectionGroup[]>(() => {
        const byConn = new Map<string, ConnectionGroup>()
        for (const sub of scopedSubscriptions) {
            const connId = sub.connection_id ?? "none"
            let group = byConn.get(connId)
            if (!group) {
                group = {
                    connId,
                    integrationKey: providerKey(sub.connection_id),
                    label: connectionLabel(sub.connection_id) ?? "",
                    logo: providerLogo(sub.connection_id),
                    subs: [],
                    showHeader: false,
                }
                byConn.set(connId, group)
            }
            group.subs.push(sub)
        }
        const list = [...byConn.values()]
        const accountsPerApp = new Map<string, number>()
        for (const g of list)
            accountsPerApp.set(g.integrationKey, (accountsPerApp.get(g.integrationKey) ?? 0) + 1)
        for (const g of list) g.showHeader = (accountsPerApp.get(g.integrationKey) ?? 0) > 1
        return list.sort(
            (a, b) =>
                a.integrationKey.localeCompare(b.integrationKey) || a.label.localeCompare(b.label),
        )
    }, [scopedSubscriptions, providerKey, connectionLabel, providerLogo])

    if (groups.length === 0) return null

    return (
        <div className="flex flex-col gap-2">
            {groups.map((group) => (
                <div key={group.connId} className="flex flex-col gap-2">
                    {group.showHeader && group.label ? (
                        <div className="flex items-center gap-1.5 px-0.5 pt-0.5 text-[12px] text-[var(--ag-colorTextTertiary)]">
                            {/* No logo: the header only appears when one app has several
                                accounts, so it names the account — the app is already obvious
                                from the rows beneath it. */}
                            <span className="truncate">{group.label}</span>
                        </div>
                    ) : null}
                    {group.subs.map((record) => {
                        const named = !!record.name?.trim()
                        const eventLabel = eventLabelOf(record)
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
                                logo={group.logo}
                                primary={primary}
                                primaryMuted={!named && !eventLabel}
                                secondary={secondary}
                                active={isEntityActive(record)}
                                disabled={disabled}
                                subscriptionId={record.id ?? ""}
                                runLabel={record.name || eventLabel || "trigger"}
                                eventKey={record.data?.event_key ?? undefined}
                                references={record.data?.references}
                                playgroundEntityId={entityId}
                                runDisabled={disabled || !record.id}
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
                </div>
            ))}
        </div>
    )
}
