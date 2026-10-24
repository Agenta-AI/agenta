import {useCallback, useMemo} from "react"

import {toolIntegrationDetailQueryFamily} from "@agenta/entities/gatewayTool"
import type {DisclosedConnection, ShareDisclosure} from "@agenta/entities/sharing"
import {PROVIDERS} from "@agenta/entities/workflow"
import {defaultProviderLabel} from "@agenta/sessions-ui/sharing"
import {atom, useAtomValue, useSetAtom} from "jotai"

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

/**
 * The label function both sharing dialogs take, for the connections of one disclosure, and
 * whether the dialogs may show it yet. The design names accounts by display name, never by
 * slug, so a dialog waits (`pending`) while a catalog name is still loading, and shows its load
 * error (`failed`, with `retry`) when the catalog read failed for an integration the app's own
 * provider table cannot name either. The title-cased slug is left only for a catalog that
 * answered without a name.
 */
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
    const catalogAtom = useMemo(
        () =>
            atom((get) => {
                const names = new Map<string, string>()
                const failedIntegrations: string[] = []
                let pending = false
                for (const integration of key ? key.split("\n") : []) {
                    const query = get(toolIntegrationDetailQueryFamily(integration))
                    const name = query.data?.integration?.name
                    if (name?.trim()) names.set(integration, name.trim())
                    else if (query.isPending) pending = true
                    else if (query.isError && !PROVIDERS[integration]?.label) {
                        failedIntegrations.push(integration)
                    }
                }
                return {names, pending, failedIntegrations}
            }),
        [key],
    )
    const {names, pending, failedIntegrations} = useAtomValue(catalogAtom)
    const failedKey = failedIntegrations.join("\n")
    const retryAtom = useMemo(
        () =>
            atom(null, (get) => {
                for (const integration of failedKey ? failedKey.split("\n") : []) {
                    void get(toolIntegrationDetailQueryFamily(integration)).refetch()
                }
            }),
        [failedKey],
    )
    const retry = useSetAtom(retryAtom)
    const label = useCallback(
        (connection: DisclosedConnection) => disclosureProviderLabel(connection, names),
        [names],
    )
    return {label, pending, failed: failedIntegrations.length > 0, retry}
}
