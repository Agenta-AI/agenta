import {providerConnectionsAtom, useVaultSecret} from "@agenta/entities/secret"
import {ProviderDrawer} from "@agenta/entity-ui/secretProvider"
import {useAtomValue} from "jotai"

/** The providers drawer over the chat, on the failed provider's own card when the project has one. */
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
    const {mutate} = useVaultSecret()
    const connection = providerKind
        ? (connections.find((item) => item.kind === providerKind) ?? null)
        : null
    return (
        <ProviderDrawer
            open={open}
            onClose={onClose}
            context="playground"
            connections={connections}
            connection={connection}
            kind={connection ? null : (providerKind ?? null)}
            onSaved={mutate}
        />
    )
}
