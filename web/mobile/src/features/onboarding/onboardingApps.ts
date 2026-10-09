import type {ToolConnection} from "@agenta/entities/gatewayTool"
import {composioLogo, PROVIDERS} from "@agenta/entities/workflow"

import {isUsableToolConnection, SEED_TOOLS} from "./onboardingConfig"

const SEED_KEYS = new Set<string>(SEED_TOOLS.map((tool) => tool.key))

/** Usable tool connections by integration key, with the connection's name. */
export type ConnectedApps = ReadonlyMap<string, string>

/** An app's display name and logo: the provider table first, else the user's connection. */
export const appIdentity = (key: string, connected: ConnectedApps) => ({
    key,
    name: PROVIDERS[key]?.label ?? (connected.get(key) || key),
    logo: PROVIDERS[key]?.logo ?? composioLogo(key),
})

/** The usable connections, minus the zero-auth tools every first agent gets anyway. */
export const connectedApps = (connections: readonly ToolConnection[]): ConnectedApps =>
    new Map(
        connections
            .filter((item) => isUsableToolConnection(item) && !SEED_KEYS.has(item.integration_key!))
            .map((item) => [item.integration_key!, item.name ?? ""]),
    )
