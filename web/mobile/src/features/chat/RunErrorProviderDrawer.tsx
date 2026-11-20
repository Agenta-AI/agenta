import {useRef} from "react"

import {
    isOrganizationConnection,
    providerConnectionsAtom,
    vaultSecretsQueryAtom,
} from "@agenta/entities/secret"
import {providerConnectionView, providerListView} from "@agenta/entity-ui/secretProvider"
import {ViewDrawerHost, type ViewRequest} from "@agenta/ui/view-stack"
import {useAtomValue} from "jotai"

/**
 * The provider form in a drawer over the chat: the failed provider's own connection when the
 * project has one, else a new connection of that provider. With no provider, or when the vault
 * cannot be read, the provider list opens instead; it says so and offers "Try again". The form
 * checks the key by itself, and Save stores the connection in the project.
 */
export const RunErrorProviderDrawer = ({
    open,
    onClose,
    providerKind,
}: {
    open: boolean
    onClose: () => void
    providerKind?: string
}) => {
    const connections = useAtomValue(providerConnectionsAtom)
    const vault = useAtomValue(vaultSecretsQueryAtom)
    // The drawer opens its view once. The choice of view is made once per opening, so the vault
    // refresh after a save does not close and reopen the drawer.
    const chosen = useRef<ViewRequest<unknown> | null>(null)
    if (!open) {
        chosen.current = null
        return null
    }
    if (!chosen.current) {
        const connectionId = providerKind
            ? connections.find(
                  (item) => item.kind === providerKind && !isOrganizationConnection(item),
              )?.id
            : undefined
        // A form for a new connection opens only when a current lookup found none.
        if (providerKind && !connectionId && (vault.isPending || vault.isFetching)) return null
        const lookupFailed = vault.isError && !Array.isArray(vault.data)
        chosen.current = (
            !providerKind || lookupFailed
                ? {view: providerListView, params: {}, target: {kind: "project"}}
                : {
                      view: providerConnectionView,
                      params: {kind: providerKind, ...(connectionId ? {connectionId} : {})},
                      target: {kind: "project"},
                  }
        ) as ViewRequest<unknown>
    }
    // A closed drawer leaves, and the next open mounts a new one.
    return <ViewDrawerHost request={chosen.current} onClosed={onClose} />
}
