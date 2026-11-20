import {
    isOrganizationConnection,
    providerConnectionsAtom,
    vaultSecretsQueryAtom,
} from "@agenta/entities/secret"
import {providerConnectionView, providerListView} from "@agenta/entity-ui/secretProvider"
import {ViewDrawerHost} from "@agenta/ui/view-stack"
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
    if (!open) return null
    const connectionId = providerKind
        ? connections.find((item) => item.kind === providerKind && !isOrganizationConnection(item))
              ?.id
        : undefined
    // The drawer opens its view once, so it waits for the vault lookup: a form for a new
    // connection opens only when a current lookup found none.
    if (providerKind && !connectionId && (vault.isPending || vault.isFetching)) return null
    const lookupFailed = vault.isError && !Array.isArray(vault.data)
    // The drawer opens its view once; a closed drawer leaves, and the next open mounts a new one.
    if (!providerKind || lookupFailed) {
        return (
            <ViewDrawerHost
                request={{view: providerListView, params: {}, target: {kind: "project"}}}
                onClosed={onClose}
            />
        )
    }
    return (
        <ViewDrawerHost
            request={{
                view: providerConnectionView,
                params: {kind: providerKind, ...(connectionId ? {connectionId} : {})},
                target: {kind: "project"},
            }}
            onClosed={onClose}
        />
    )
}
