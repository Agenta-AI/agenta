import type {ToolConnection} from "@agenta/entities/gatewayTool"
import {composioLogo, PROVIDERS} from "@agenta/entities/workflow"

import {isUsableToolConnection} from "./onboardingConfig"

/** Usable tool connections by integration key, with the connection's name. */
export type ConnectedApps = ReadonlyMap<string, string>

/** An app's display name and logo: the provider table first, else the user's connection. */
export const appIdentity = (key: string, connected: ConnectedApps) => ({
    key,
    name: PROVIDERS[key]?.label ?? (connected.get(key) || key),
    logo: PROVIDERS[key]?.logo ?? composioLogo(key),
})

/** The usable connections. */
export const connectedApps = (connections: readonly ToolConnection[]): ConnectedApps =>
    new Map(
        connections
            .filter(isUsableToolConnection)
            .map((item) => [item.integration_key!, item.name ?? ""]),
    )
