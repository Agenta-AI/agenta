/**
 * Which of the viewer's own accounts can fill a "user" item. Pure, so the drawers, "Attach a
 * secret" and the setup card list the same accounts.
 */
import {isConnectionActive, type ToolConnection} from "@agenta/entities/gatewayTool"
import {CustomSecretFormat, type NamedSecretRow} from "@agenta/entities/secret"

/** The viewer's active connections to one integration (and provider, when it is known). */
export const personalConnectionsFor = (
    connections: readonly ToolConnection[] | null | undefined,
    target: {integration: string; provider?: string | null},
): ToolConnection[] =>
    (connections ?? []).filter(
        (connection) =>
            connection.integration_key === target.integration &&
            (!target.provider || connection.provider_key === target.provider) &&
            isConnectionActive(connection),
    )

/** The viewer's text secrets, the only kind a sandbox secret item takes. */
export const personalTextSecrets = (secrets: readonly NamedSecretRow[]): NamedSecretRow[] =>
    secrets.filter((secret) => secret.format === CustomSecretFormat.Text && Boolean(secret.id))
