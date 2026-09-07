import {useEffect, useMemo} from "react"

import {
    useTriggerCatalogEvents,
    useTriggerCatalogIntegrations,
} from "@agenta/entities/gatewayTrigger"

import {eventLabel, type ConnectedApp} from "./connectedApps"
import {EventRow} from "./EventRow"

/**
 * One connected app's share of a flat search result.
 *
 * A component per app rather than a merged fetch: the catalog hook is keyed by integration, and
 * hooks cannot be called in a loop. Each group reports what it found so the parent can tell an
 * empty search from one that is still loading.
 */
export const EventSearchGroup = ({
    app,
    selectedEventKey,
    onPick,
    onReport,
}: {
    app: ConnectedApp
    selectedEventKey: string
    onPick: (connectionId: string, eventKey: string) => void
    onReport: (integrationKey: string, count: number, isLoading: boolean) => void
}) => {
    const {events, isLoading} = useTriggerCatalogEvents(app.integrationKey)
    const {integrations, isLoading: catalogLoading} = useTriggerCatalogIntegrations()
    const appLogo = useMemo(
        () => integrations.find((integration) => integration.key === app.integrationKey)?.logo,
        [app.integrationKey, integrations],
    )
    const appName = useMemo(
        () =>
            integrations.find((integration) => integration.key === app.integrationKey)?.name ||
            app.label,
        [app.integrationKey, app.label, integrations],
    )

    useEffect(() => {
        onReport(app.integrationKey, events.length, isLoading)
    }, [app.integrationKey, events.length, isLoading, onReport])

    return (
        <>
            {events.map((event) => (
                <EventRow
                    key={`${app.integrationKey}:${event.key}`}
                    label={`${appName} · ${eventLabel(event.name, event.key)}`}
                    logo={event.logo || appLogo}
                    logoLoading={catalogLoading}
                    selected={event.key === selectedEventKey}
                    onSelect={() => onPick(app.connectionId, event.key)}
                />
            ))}
        </>
    )
}
