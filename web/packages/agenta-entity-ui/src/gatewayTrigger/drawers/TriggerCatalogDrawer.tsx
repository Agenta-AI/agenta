/**
 * TriggerCatalogDrawer
 *
 * The triggers catalog: a THIN wrapper over the shared {@link GatewayCatalogDrawer} (the same
 * component the tools catalog uses), pointed at the `@agenta/entities/gatewayTrigger` catalog
 * hooks with a "pick an event → create a subscription" leaf. Connecting an app and browsing a
 * connection's events (events drawer) are wired through the generic's connect + connection-menu
 * hooks. No bespoke catalog UI lives here anymore.
 */
import {useCallback, useMemo} from "react"

import {
    isConnectionActive,
    triggerCatalogDrawerOpenAtom,
    triggerEventsDrawerAtom,
    triggerEventsSearchAtom,
    triggerIntegrationsSearchAtom,
    triggerSubscriptionDrawerAtom,
    useTriggerCatalogEvents,
    useTriggerCatalogIntegrations,
    useTriggerConnectionsQuery,
    useTriggerIntegrationConnections,
    type TriggerCatalogEvent,
    type TriggerCatalogIntegration,
    type TriggerConnection,
} from "@agenta/entities/gatewayTrigger"
import {useAtom, useSetAtom} from "jotai"

import {
    GatewayCatalogDrawer,
    type CatalogAdapter,
    type CatalogConfig,
} from "../../drawers/shared/GatewayCatalogDrawer"

import TriggerConnectDrawer from "./TriggerConnectDrawer"

interface Props {
    onConnectionCreated?: () => void
    /** Pre-bind any subscription created here to a workflow (keyed like `data.references`). */
    defaultReferences?: Record<string, {id?: string; slug?: string}>
    defaultBoundLabel?: string
    playgroundEntityId?: string
}

const integrationAccessors = {
    key: (i: TriggerCatalogIntegration) => i.key,
    name: (i: TriggerCatalogIntegration) => i.name,
    logo: (i: TriggerCatalogIntegration) => i.logo ?? undefined,
    description: (i: TriggerCatalogIntegration) => i.description ?? undefined,
    authSchemes: (i: TriggerCatalogIntegration) => i.auth_schemes ?? [],
    categories: (i: TriggerCatalogIntegration) =>
        (i as {categories?: string[] | null}).categories ?? undefined,
}

const connectionAccessors = {
    id: (c: TriggerConnection) => c.id ?? undefined,
    name: (c: TriggerConnection) => c.name ?? undefined,
    slug: (c: TriggerConnection) => c.slug ?? undefined,
    integrationKey: (c: TriggerConnection) => c.integration_key,
}

const itemAccessors = {
    key: (t: TriggerCatalogEvent) => t.key,
    name: (t: TriggerCatalogEvent) => t.name ?? undefined,
    description: (t: TriggerCatalogEvent) => t.description ?? undefined,
    categories: (t: TriggerCatalogEvent) => t.categories ?? undefined,
}

export default function TriggerCatalogDrawer({
    onConnectionCreated,
    defaultReferences,
    defaultBoundLabel,
    playgroundEntityId,
}: Props) {
    const [open, setOpen] = useAtom(triggerCatalogDrawerOpenAtom)
    const setIntegrationsSearch = useSetAtom(triggerIntegrationsSearchAtom)
    const setEventsSearch = useSetAtom(triggerEventsSearchAtom)
    const openSubscription = useSetAtom(triggerSubscriptionDrawerAtom)
    const setEventsDrawer = useSetAtom(triggerEventsDrawerAtom)

    const adapter = useMemo<
        CatalogAdapter<TriggerCatalogIntegration, TriggerCatalogEvent, TriggerConnection>
    >(
        () => ({
            useIntegrations: () => {
                const r = useTriggerCatalogIntegrations()
                return {
                    items: r.integrations,
                    total: r.total,
                    prefetchThreshold: r.prefetchThreshold,
                    isLoading: r.isLoading,
                    hasNextPage: r.hasNextPage,
                    isFetchingNextPage: r.isFetchingNextPage,
                    requestMore: r.requestMore,
                }
            },
            useConnections: () => useTriggerConnectionsQuery(),
            useIntegrationConnections: (key: string) => useTriggerIntegrationConnections(key),
            useItems: (key: string) => {
                const r = useTriggerCatalogEvents(key)
                return {
                    items: r.events,
                    total: r.total,
                    prefetchThreshold: r.prefetchThreshold,
                    isLoading: r.isLoading,
                    hasNextPage: r.hasNextPage,
                    isFetchingNextPage: r.isFetchingNextPage,
                    requestMore: r.requestMore,
                }
            },
            isConnectionActive,
            integrationFromConnection: (c: TriggerConnection) =>
                ({
                    key: c.integration_key,
                    name: c.name || c.integration_key,
                }) as TriggerCatalogIntegration,
            setIntegrationsSearch,
            setItemsSearch: setEventsSearch,
            integration: integrationAccessors,
            connection: connectionAccessors,
            item: itemAccessors,
        }),
        [setIntegrationsSearch, setEventsSearch],
    )

    // Pick an event → leave the catalog and open the subscription config drawer, prefilled with the
    // chosen connection + event and pre-bound via defaultReferences.
    const handlePickEvent = useCallback(
        (
            conn: TriggerConnection,
            event: TriggerCatalogEvent,
            integration: TriggerCatalogIntegration | null,
        ) => {
            if (!conn.id) return
            setOpen(false)
            openSubscription({
                connectionId: conn.id,
                integrationKey: integration?.key ?? conn.integration_key,
                integrationName: integration?.name ?? conn.name ?? conn.integration_key,
                eventKey: event.key,
                defaultReferences,
                defaultBoundLabel,
                playgroundEntityId,
            })
        },
        [setOpen, openSubscription, defaultReferences, defaultBoundLabel, playgroundEntityId],
    )

    const config: CatalogConfig<TriggerCatalogIntegration, TriggerCatalogEvent, TriggerConnection> =
        {
            title: (selected) => (selected ? "Choose an event" : "Add an app trigger"),
            appsSearchPlaceholder: "Search integrations…",
            itemsSearchPlaceholder: "Search events…",
            connectionsHint: "Pick an event to create a trigger — no setup needed.",
            emptyItemsText: "This app has no triggers",
            onPickItem: handlePickEvent,
            // Items-view "Connect" split-menu: open a chosen connection's full events list.
            onConnectionMenu: (conn) =>
                setEventsDrawer({
                    providerKey: conn.provider_key ?? "composio",
                    integrationKey: conn.integration_key,
                    integrationName: conn.name ?? conn.integration_key,
                    connectionId: conn.id ?? undefined,
                }),
            renderConnect: (integration, handlers) => (
                <TriggerConnectDrawer
                    open
                    integrationKey={integration.key}
                    integrationName={integration.name}
                    integrationLogo={integration.logo ?? undefined}
                    integrationDescription={integration.description ?? undefined}
                    authSchemes={integration.auth_schemes ?? []}
                    onClose={handlers.onClose}
                    onSuccess={() => {
                        handlers.onSuccess()
                        onConnectionCreated?.()
                    }}
                />
            ),
        }

    return (
        <GatewayCatalogDrawer
            open={open}
            onClose={() => setOpen(false)}
            adapter={adapter}
            config={config}
        />
    )
}
