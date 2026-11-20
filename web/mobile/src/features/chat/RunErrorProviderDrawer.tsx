import {isOrganizationConnection, providerConnectionsAtom} from "@agenta/entities/secret"
import {providerConnectionView, providerListView} from "@agenta/entity-ui/secretProvider"
import {ViewDrawerHost} from "@agenta/ui/view-stack"
import {useAtomValue} from "jotai"

/**
 * The provider form in a drawer over the chat: the failed provider's own connection when the
 * project has one, else a new connection of that provider, else the provider list. The form
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
    if (!open) return null
    // The drawer opens its view once; a closed drawer leaves, and the next open mounts a new one.
    if (!providerKind) {
        return (
            <ViewDrawerHost
                request={{view: providerListView, params: {}, target: {kind: "project"}}}
                onClosed={onClose}
            />
        )
    }
    const connectionId = connections.find(
        (item) => item.kind === providerKind && !isOrganizationConnection(item),
    )?.id
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
