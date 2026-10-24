import {useCallback, useMemo} from "react"

import {toolIntegrationDetailQueryFamily} from "@agenta/entities/gatewayTool"
import type {DisclosedConnection, ShareDisclosure} from "@agenta/entities/sharing"
import {PROVIDERS} from "@agenta/entities/workflow"
import {defaultProviderLabel} from "@agenta/sessions-ui/sharing"
import {atom, useAtomValue} from "jotai"

/** The gateway whose catalog the integration detail query reads. */
const CATALOG_PROVIDER = "composio"

/**
 * The display name of one disclosed connection: the tool catalog's name for its integration
 * (the same cached detail read the connect drawer and the account rows use), then the app's
 * own provider table, then the title-cased slug.
 */
export const disclosureProviderLabel = (
    connection: DisclosedConnection,
    catalogNames: ReadonlyMap<string, string>,
): string =>
    catalogNames.get(connection.integration) ??
    PROVIDERS[connection.integration]?.label ??
    defaultProviderLabel(connection)

/** The label function both sharing dialogs take, for the connections of one disclosure. */
export const useDisclosureProviderLabel = (disclosure: ShareDisclosure | null | undefined) => {
    const integrations = useMemo(
        () => [
            ...new Set(
                (disclosure?.connections ?? [])
                    .filter((connection) => connection.provider === CATALOG_PROVIDER)
                    .map((connection) => connection.integration)
                    .filter(Boolean),
            ),
        ],
        [disclosure],
    )
    const key = integrations.join("\n")
    const namesAtom = useMemo(
        () =>
            atom((get) => {
                const names = new Map<string, string>()
                for (const integration of key ? key.split("\n") : []) {
                    const name = get(toolIntegrationDetailQueryFamily(integration)).data
                        ?.integration?.name
                    if (name?.trim()) names.set(integration, name.trim())
                }
                return names
            }),
        [key],
    )
    const names = useAtomValue(namesAtom)
    return useCallback(
        (connection: DisclosedConnection) => disclosureProviderLabel(connection, names),
        [names],
    )
}
