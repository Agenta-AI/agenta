import {useState} from "react"

import {Button, Spinner} from "@agenta/ui/ui"
import {ArrowLeft, Plus} from "@phosphor-icons/react"

import type {ConfirmDestructive} from "../confirm"

import ActionsList from "./ActionsList"
import ConnectionsList from "./ConnectionsList"
import ConnectModal from "./ConnectModal"
import {useIntegrationDetail} from "./hooks/useIntegrationDetail"

interface Props {
    integrationKey: string
    onBack: () => void
    /** Passed through to the connections list for its delete confirmation. */
    confirm?: ConfirmDestructive
}

export default function IntegrationDetail({integrationKey, onBack, confirm}: Props) {
    const {integration, connections, actions, isLoading} = useIntegrationDetail(integrationKey)
    const [isConnectModalOpen, setIsConnectModalOpen] = useState(false)

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Spinner />
            </div>
        )
    }

    if (!integration) return null

    return (
        <section className="flex flex-col gap-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <Button variant="ghost" aria-label="Go back" onClick={onBack}>
                    <ArrowLeft size={16} />
                </Button>
                {integration.logo && (
                    <img
                        src={integration.logo}
                        alt={integration.name}
                        className="size-8 rounded object-contain"
                    />
                )}
                <div>
                    <h2 className="m-0 text-base font-medium text-colorText">{integration.name}</h2>
                    {integration.description && (
                        <p className="m-0 text-xs text-colorTextSecondary">
                            {integration.description}
                        </p>
                    )}
                </div>
            </div>

            {/* Connections section */}
            <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-colorText">Connections</span>
                    <Button size="sm" onClick={() => setIsConnectModalOpen(true)}>
                        <Plus size={14} />
                        Connect
                    </Button>
                </div>
                <ConnectionsList
                    integrationKey={integrationKey}
                    connections={connections}
                    confirm={confirm}
                />
            </div>

            {/* Actions section */}
            <div className="flex flex-col gap-2">
                <span className="text-xs font-medium text-colorText">
                    Available Actions ({integration.actions_count})
                </span>
                <ActionsList actions={actions} />
            </div>

            {/* Connect modal */}
            <ConnectModal
                open={isConnectModalOpen}
                integrationKey={integrationKey}
                integrationName={integration.name}
                authSchemes={integration.auth_schemes ?? []}
                onClose={() => setIsConnectModalOpen(false)}
            />
        </section>
    )
}
