import {useRef} from "react"

import {ViewDrawerHost, type ViewRequest} from "@agenta/ui/view-stack"

import type {ConnectionOwner} from "../../accounts/ConnectOwnerField"
import {
    integrationConnectView,
    type IntegrationConnectViewParams,
} from "../../DrillInView/SchemaControls/agentTemplate/views/integrationConnectView"

interface Props {
    open: boolean
    integrationKey: string
    onClose: () => void
    /** The connection is made; `owner` is who it belongs to. */
    onSuccess?: (owner: ConnectionOwner) => void
    /**
     * Who may own the new connection; the first is the default. Two ask "Who can use it", one
     * is used without asking. Absent, the connection is the project's.
     */
    owners?: ConnectionOwner[]
    /** Why this place asks for the app; absent, the app's own description. */
    description?: string
}

/** The connect view in a drawer, for the hosts that keep one (the onboarding accounts card). */
export default function ConnectDrawer({
    open,
    integrationKey,
    owners,
    description,
    onClose,
    onSuccess,
}: Props) {
    // The owner of the connection the form made; the drawer reports it once it closes.
    const created = useRef<ConnectionOwner | null>(null)
    if (!open) return null
    const request: ViewRequest<IntegrationConnectViewParams> = {
        view: integrationConnectView,
        params: {
            integrationKey,
            owners,
            description,
            onCreated: (connection) => {
                created.current = connection.owner
            },
        },
        target: {kind: "project"},
    }
    return (
        <ViewDrawerHost
            request={request}
            onClosed={() => {
                const owner = created.current
                created.current = null
                if (owner) onSuccess?.(owner)
                onClose()
            }}
        />
    )
}
