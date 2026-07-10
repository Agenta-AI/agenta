import {useEffect, useState} from "react"

import {
    isConnectionActive,
    useToolIntegrationConnections,
    useToolIntegrationDetail,
} from "@agenta/entities/gatewayTool"
import {ConnectDrawer} from "@agenta/entity-ui/gatewayTool"
import {CheckCircle, Plugs} from "@phosphor-icons/react"
import {Button} from "antd"
import clsx from "clsx"
import Image from "next/image"

import {PROVIDERS, type RequiredIntegration} from "../../assets/templates"

import SetupRow from "./SetupRow"

interface IntegrationRowProps {
    integration: RequiredIntegration
    /** Report connection state up so the drawer can compute "{n} left". */
    onConnectedChange: (slug: string, connected: boolean) => void
}

/**
 * "Required to run" integration row — reuses the real gateway connect flow: workspace
 * connections drive the Connected state; Connect opens the OAuth ConnectDrawer.
 */
const IntegrationRow = ({integration, onConnectedChange}: IntegrationRowProps) => {
    const provider = PROVIDERS[integration.slug]
    const {integration: detail} = useToolIntegrationDetail(integration.slug)
    const {connections} = useToolIntegrationConnections(integration.slug)
    const connected = connections.some(isConnectionActive)
    const [connectOpen, setConnectOpen] = useState(false)

    useEffect(() => {
        onConnectedChange(integration.slug, connected)
    }, [connected, integration.slug, onConnectedChange])

    const name = detail?.name ?? provider?.label ?? integration.slug
    const logo = detail?.logo ?? provider?.logo

    return (
        <div
            className={clsx(
                "rounded-lg border border-solid p-3 transition-colors",
                // Highlight the unfinished required item so it's clear what's left to connect.
                connected
                    ? "border-[var(--ag-colorBorder)]"
                    : "border-[var(--ag-colorWarningBorder)] bg-[var(--ag-colorWarningBg)]",
            )}
        >
            <SetupRow
                icon={
                    <span className="flex size-9 items-center justify-center overflow-hidden rounded-lg border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorBgContainer)]">
                        {logo ? (
                            <Image
                                src={logo}
                                alt={name}
                                width={20}
                                height={20}
                                unoptimized
                                className="object-contain"
                            />
                        ) : (
                            <Plugs size={18} className="text-[var(--ag-colorTextSecondary)]" />
                        )}
                    </span>
                }
                title={name}
                subtitle={integration.scope}
                right={
                    connected ? (
                        <span className="flex items-center gap-1 text-[11px] font-medium text-[var(--ag-colorSuccess)]">
                            <CheckCircle size={13} weight="fill" />
                            Connected
                        </span>
                    ) : (
                        <Button onClick={() => setConnectOpen(true)}>Connect</Button>
                    )
                }
            />

            <ConnectDrawer
                open={connectOpen}
                integrationKey={integration.slug}
                integrationName={name}
                integrationLogo={logo ?? undefined}
                integrationDescription={integration.scope}
                authSchemes={detail?.auth_schemes ?? ["oauth"]}
                onClose={() => setConnectOpen(false)}
                onSuccess={() => setConnectOpen(false)}
            />
        </div>
    )
}

export default IntegrationRow
