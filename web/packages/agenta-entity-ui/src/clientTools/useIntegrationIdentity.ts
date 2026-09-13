/**
 * Name + logo for an integration key, for surfaces that only need to IDENTIFY a connection and
 * not run its OAuth flow (the connect dock's stacked cards behind the front one).
 *
 * Shares `useToolIntegrationDetail`'s query atom with `useConnectFlow`, so a stack of cards costs
 * one catalog fetch per integration, not one per card.
 */
import {useToolIntegrationDetail} from "@agenta/entities/gatewayTool"
import type {ClientToolMeta} from "@agenta/shared/clientTools"
import {humanizeActionKey} from "@agenta/shared/utils"

/** `text_to_pdf` → `Text to PDF`: a readable label for the window before the catalog lookup
 * resolves. Shares the approval card's humanizer so one integration is not spelled two ways in two
 * docks that can sit on screen together. */
export const prettyIntegration = (key: string): string =>
    key ? humanizeActionKey(key) : "the service"

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
