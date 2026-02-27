import {useState} from "react"

import {ArrowLeft, Plus} from "@phosphor-icons/react"
import {Button, Spin, Typography} from "antd"
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
                <Spin />
            </div>
        )
    }

    if (!integration) return null

    return (
        <section className="flex flex-col gap-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <Button
                    type="text"
                    aria-label="Go back"
                    icon={<ArrowLeft size={16} />}
                    onClick={onBack}
                />
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
                    <Typography.Title level={5} className="!mb-0">
                        {integration.name}
                    </Typography.Title>
                    {integration.description && (
                        <Typography.Text type="secondary" className="text-xs">
                            {integration.description}
                        </Typography.Text>
                    )}
                </div>
            </div>

            {/* Connections section */}
            <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                    <Typography.Text className="text-sm font-medium">Connections</Typography.Text>
                    <Button
                        type="primary"
                        size="small"
                        icon={<Plus size={14} />}
                        onClick={() => setIsConnectModalOpen(true)}
                    >
                        Connect
                    </Button>
                </div>
                <ConnectionsList integrationKey={integrationKey} connections={connections} />
            </div>

            {/* Actions section */}
            <div className="flex flex-col gap-2">
                <Typography.Text className="text-sm font-medium">
                    Available Actions ({integration.actions_count})
                </Typography.Text>
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
