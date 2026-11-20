/**
 * What the Model providers list shows: only what the project has, in three groups.
 *
 * The "Agenta" row (the built-in models) comes first when the deployment serves any, then the
 * project's hosted subscriptions, then its API key connections. Organization connections and
 * manager-only connections are not the project's to edit here, so they are left out; Settings
 * shows the organization's own group beside the list.
 *
 * Pure, so the grouping is testable without React.
 */
import type {BuiltinModelEndpoint} from "./agentModelCandidates"
import {
    isOrganizationConnection,
    isSubscriptionConnection,
    type ProviderConnection,
} from "./connections"
import {subscriptionIsReady} from "./subscriptionConnections"
import {SecretManagementPolicy} from "./types"

/** The built-in models: every model of every built-in endpoint, each once. */
export interface BuiltinModelsRow {
    models: string[]
}

export interface SubscriptionRow {
    connection: ProviderConnection
    /** The stored sign-in cannot run anything: the row offers a new sign-in instead of Edit. */
    signInNeeded: boolean
}

export interface ModelProviderList {
    builtin: BuiltinModelsRow | null
    subscriptions: SubscriptionRow[]
    apiKeys: ProviderConnection[]
}

export const builtinModelsOf = (
    endpoints: readonly BuiltinModelEndpoint[] | null | undefined,
): string[] => [...new Set((endpoints ?? []).flatMap((endpoint) => endpoint.models))]

export const buildModelProviderList = ({
    connections,
    builtinEndpoints,
}: {
    connections: readonly ProviderConnection[]
    builtinEndpoints: readonly BuiltinModelEndpoint[] | null | undefined
}): ModelProviderList => {
    const own = connections.filter(
        (connection) =>
            !isOrganizationConnection(connection) &&
            connection.managementPolicy !== SecretManagementPolicy.ManagerOnly,
    )
    const models = builtinModelsOf(builtinEndpoints)
    return {
        builtin: models.length ? {models} : null,
        subscriptions: own.filter(isSubscriptionConnection).map((connection) => ({
            connection,
            signInNeeded: !subscriptionIsReady(connection.subscription),
        })),
        apiKeys: own.filter((connection) => !isSubscriptionConnection(connection)),
    }
}
