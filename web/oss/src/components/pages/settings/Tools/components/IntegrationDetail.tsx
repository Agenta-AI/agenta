import {useState} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {Spinner} from "@agenta/primitive-ui/components/spinner"
import {ArrowLeft, Plus} from "@phosphor-icons/react"
import Image from "next/image"

import {useIntegrationDetail} from "../hooks/useIntegrationDetail"

import ActionsList from "./ActionsList"
import ConnectionsList from "./ConnectionsList"
import ConnectModal from "./ConnectModal"

interface Props {
    integrationKey: string
    onBack: () => void
}

export default function IntegrationDetail({integrationKey, onBack}: Props) {
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
                <Button variant="ghost" size="icon-sm" aria-label="Go back" onClick={onBack}>
                    <ArrowLeft size={16} />
                </Button>
                {integration.logo && (
                    <Image
                        src={integration.logo}
                        alt={integration.name}
                        width={32}
                        height={32}
                        className="w-8 h-8 rounded object-contain"
                        unoptimized
                    />
                )}
                <div>
                    <h5 className="text-base font-semibold">{integration.name}</h5>
                    {integration.description && (
                        <span className="text-xs text-muted-foreground">
                            {integration.description}
                        </span>
                    )}
                </div>
            </div>

            {/* Connections section */}
            <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Connections</span>
                    <Button size="sm" onClick={() => setIsConnectModalOpen(true)}>
                        <Plus size={14} />
                        Connect
                    </Button>
                </div>
                <ConnectionsList integrationKey={integrationKey} connections={connections} />
            </div>

            {/* Actions section */}
            <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">
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
