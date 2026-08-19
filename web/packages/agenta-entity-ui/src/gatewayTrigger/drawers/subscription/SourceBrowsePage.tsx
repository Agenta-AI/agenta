/** Full-drawer source selection: the connected-app rail + catalog chooser + connect flow. */
import {
    isConnectionValid,
    useTriggerCatalogEvents,
    useTriggerCatalogIntegrations,
    type TriggerCatalogEvent,
    type TriggerCatalogIntegration,
    type TriggerConnection,
} from "@agenta/entities/gatewayTrigger"
import {dayjs} from "@agenta/shared/utils"

import {CatalogChooser} from "../../../drawers/shared/CatalogChooser"
import TriggerConnectDrawer from "../TriggerConnectDrawer"

// SourceBrowsePage — full-context source selection within the drawer (not inlined in the
// section): the app rail + detail/connect chooser. The "back" affordance lives in the smart
// drawer header (see browseHeaderAtom). Picking an event returns to the form with the source.
export function SourceBrowsePage({
    connections,
    defaultIntegrationKey,
    onPick,
}: {
    connections: TriggerConnection[]
    defaultIntegrationKey?: string
    onPick: (connectionId: string, eventKey: string) => void
}) {
    return (
        <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-hidden px-6 py-4">
                <SourceChooser
                    connections={connections}
                    defaultIntegrationKey={defaultIntegrationKey}
                    onPick={onPick}
                />
            </div>
        </div>
    )
}

// Catalog data wrappers (custom hooks) adapting the trigger catalog hooks to CatalogChooser's shape.
function useTriggerIntegrationsList() {
    const r = useTriggerCatalogIntegrations()
    return {
        integrations: r.integrations,
        hasNextPage: r.hasNextPage,
        isFetchingNextPage: r.isFetchingNextPage,
        isLoading: r.isLoading,
        requestMore: r.requestMore,
        setSearch: r.setSearch,
    }
}

function useTriggerEventList(integrationKey: string) {
    const r = useTriggerCatalogEvents(integrationKey)
    return {
        items: r.events,
        isLoading: r.isLoading,
        hasNextPage: r.hasNextPage,
        isFetchingNextPage: r.isFetchingNextPage,
        requestMore: r.requestMore,
        setSearch: r.setSearch,
    }
}

// Composio marks superseded events with a "DEPRECATED: use X instead." description prefix (there's
// no structured flag) — surface it as a badge so the user avoids picking a dead event.
function isDeprecatedEvent(description?: string | null): boolean {
    return /^\s*deprecated\b/i.test(description ?? "")
}

// Drop the redundant trailing "Trigger" from a catalog event name ("Reaction Added Trigger" →
// "Reaction Added") — we're already in a "Choose a trigger" context.
function cleanEventName(name?: string | null): string | undefined {
    if (!name) return undefined
    return name.replace(/\s+trigger$/i, "").trim() || name
}

// SourceChooser — connected-accounts rail + 2-column app grid + app detail. Shared with the tools
// catalog via the generic CatalogChooser; the events leaf picks an event -> onPick(connId, eventKey).
function SourceChooser({
    connections,
    defaultIntegrationKey,
    onPick,
}: {
    connections: TriggerConnection[]
    defaultIntegrationKey?: string
    onPick: (connectionId: string, eventKey: string) => void
}) {
    return (
        <CatalogChooser<TriggerCatalogIntegration, TriggerCatalogEvent, TriggerConnection>
            connections={connections}
            defaultIntegrationKey={defaultIntegrationKey}
            isConnectionReady={isConnectionValid}
            useIntegrations={useTriggerIntegrationsList}
            useItems={useTriggerEventList}
            integration={{
                key: (i) => i.key,
                name: (i) => i.name,
                logo: (i) => i.logo,
                description: (i) => i.description,
                categories: (i) => i.categories,
                actionsCount: (i) => i.actions_count,
            }}
            connection={{
                id: (c) => c.id ?? undefined,
                name: (c) => c.name ?? undefined,
                slug: (c) => c.slug ?? undefined,
                integrationKey: (c) => c.integration_key,
                connectedAt: (c) =>
                    c.created_at ? dayjs(c.created_at).format("MMM D, YYYY") : undefined,
            }}
            item={{
                key: (e) => e.key,
                name: (e) => cleanEventName(e.name),
                description: (e) => e.description ?? undefined,
                categories: (e) => e.categories ?? undefined,
                deprecated: (e) => isDeprecatedEvent(e.description),
            }}
            itemsLabel="Choose an event"
            itemsSearchPlaceholder="Search events"
            emptyItemsText="No events for this app"
            onPickItem={(conn, event) => conn.id && onPick(conn.id, event.key)}
            renderConnect={(integration, h) => (
                <TriggerConnectDrawer
                    open
                    integrationKey={integration.key}
                    integrationName={integration.name}
                    integrationLogo={integration.logo ?? undefined}
                    integrationDescription={integration.description ?? undefined}
                    authSchemes={integration.auth_schemes ?? []}
                    onClose={h.onClose}
                    onSuccess={h.onSuccess}
                />
            )}
        />
    )
}
