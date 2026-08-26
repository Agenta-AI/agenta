/**
 * Name + logo for an integration key, for surfaces that only need to IDENTIFY a connection and
 * not run its OAuth flow (the connect dock's stacked cards behind the front one).
 *
 * Shares `useToolIntegrationDetail`'s query atom with `useConnectFlow`, so a stack of cards costs
 * one catalog fetch per integration, not one per card.
 */
import {useToolIntegrationDetail} from "@agenta/entities/gatewayTool"
import type {ClientToolMeta} from "@agenta/shared/clientTools"

/** `github` → `Github`: a readable label for the window before the catalog lookup resolves. */
export const prettyIntegration = (key: string): string =>
    key ? key.charAt(0).toUpperCase() + key.slice(1) : "the service"

export const useIntegrationIdentity = (integrationKey: string) => {
    const {integration} = useToolIntegrationDetail(integrationKey)
    return {
        label: integration?.name || prettyIntegration(integrationKey),
        logo: integration?.logo ?? null,
    }
}

/** The integration key a `request_connection` call names, as `useConnectFlow` reads it. */
export const connectIntegrationKey = (meta: ClientToolMeta): string => {
    const integration = (meta.input as {integration?: unknown} | undefined)?.integration
    return typeof integration === "string" ? integration : ""
}
