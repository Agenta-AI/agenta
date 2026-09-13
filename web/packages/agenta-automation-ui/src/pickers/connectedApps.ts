import {isConnectionValid, type TriggerConnection} from "@agenta/entities/gatewayTrigger"

/** One row of the app rail: the connection a pick binds to, plus what to call it. */
export interface ConnectedApp {
    connectionId: string
    integrationKey: string
    label: string
}

/**
 * The workspace's connections as apps — one row per integration.
 *
 * Two connections to the same app are two accounts, not two apps, so the rail shows the
 * integration once; a valid connection wins over a broken one, since the pick binds to it.
 */
export function connectedApps(connections: TriggerConnection[]): ConnectedApp[] {
    const byIntegration = new Map<string, {connection: TriggerConnection; app: ConnectedApp}>()
    for (const connection of connections) {
        const connectionId = connection.id
        if (!connectionId) continue
        const current = byIntegration.get(connection.integration_key)
        if (current && (isConnectionValid(current.connection) || !isConnectionValid(connection))) {
            continue
        }
        byIntegration.set(connection.integration_key, {
            connection,
            app: {
                connectionId,
                integrationKey: connection.integration_key,
                label: appLabel(connection),
            },
        })
    }
    return [...byIntegration.values()].map((entry) => entry.app)
}

/**
 * What to call the app.
 *
 * The integration, not the connection: a connection is named for the account it authorises
 * ("gmail-main"), and a rail of app names has no business showing account slugs. The catalog's
 * display name wins when it has loaded; the key made readable stands in until then.
 */
export function appLabel(connection: TriggerConnection, catalogName?: string | null): string {
    const named = catalogName?.trim()
    if (named) return named
    return humanizeIntegrationKey(connection.integration_key)
}

/** "google_calendar" → "Google Calendar". */
export function humanizeIntegrationKey(key: string): string {
    return key.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

/** Catalog event names end in a redundant "Trigger" — this list is already the trigger list. */
export function eventLabel(name?: string | null, key?: string): string {
    const cleaned = (name ?? "").replace(/\s+trigger$/i, "").trim()
    return cleaned || name?.trim() || key || ""
}
