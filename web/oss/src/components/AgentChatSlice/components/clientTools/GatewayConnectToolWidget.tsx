/**
 * Gateway-target half of the connect widget (WP26). Rendered by `ConnectToolWidget` when
 * `meta.input.target` is present instead of `meta.input.integration`. Visual language matches
 * the existing chip row exactly; only the action differs (open a registration surface instead
 * of running an OAuth popup).
 */
import {providerConnectionsAtom} from "@agenta/entities/secret"
import {ProviderDrawer} from "@agenta/entity-ui/secretProvider"
import {isInteractionEndedOutput} from "@agenta/shared/clientTools"
import {CheckCircle, Plugs, Spinner, Warning} from "@phosphor-icons/react"
import {Button, Typography} from "antd"
import {useAtomValue} from "jotai"

import type {ClientToolHandlerProps} from "./types"
import {useGatewayConnectFlow, type GatewayTarget} from "./useGatewayConnectFlow"

const {Text} = Typography

const ChipRow = ({icon, children}: {icon: React.ReactNode; children: React.ReactNode}) => (
    <div className="flex min-w-0 items-center gap-2 py-1">
        <span className="shrink-0">{icon}</span>
        {children}
    </div>
)

const GatewayConnectToolWidget = ({
    target,
    meta,
    settle,
}: ClientToolHandlerProps & {target: GatewayTarget}) => {
    const {
        label,
        phase,
        outcome,
        providerDrawerOpen,
        runConnect,
        onProviderSaved,
        onProviderClosed,
        decline,
    } = useGatewayConnectFlow(target, meta, settle)
    const connections = useAtomValue(providerConnectionsAtom)

    const planeLabel = target.plane === "llm" ? "model provider" : "MCP server"

    if (phase === "connecting") {
        return (
            <>
                <ChipRow icon={<Spinner size={13} className="animate-spin text-colorPrimary" />}>
                    <Text type="secondary" className="!text-xs">
                        Connecting {label}…
                    </Text>
                </ChipRow>
                {target.plane === "llm" ? (
                    <ProviderDrawer
                        open={providerDrawerOpen}
                        onClose={onProviderClosed}
                        context="playground"
                        connections={connections}
                        onSaved={onProviderSaved}
                    />
                ) : null}
            </>
        )
    }

    if (meta.settled || outcome) {
        if (isInteractionEndedOutput(meta.output)) {
            return (
                <ChipRow icon={<Plugs size={13} className="text-colorTextTertiary" />}>
                    <Text type="secondary" className="!text-xs !text-colorTextTertiary">
                        Connection request ended
                    </Text>
                </ChipRow>
            )
        }
        const output = (meta.output ?? {}) as {connected?: boolean}
        if (outcome?.connected === true || output.connected === true) {
            return (
                <ChipRow
                    icon={<CheckCircle size={13} weight="fill" className="text-colorSuccess" />}
                >
                    <Text className="!text-xs">{label} connected</Text>
                </ChipRow>
            )
        }
        return (
            <ChipRow icon={<Warning size={13} weight="fill" className="text-colorWarning" />}>
                <Text type="secondary" className="!text-xs">
                    Connection not completed
                </Text>
            </ChipRow>
        )
    }

    return (
        <ChipRow icon={<Plugs size={13} className="text-colorPrimary" />}>
            <Text className="!text-xs">
                Connect {label} ({planeLabel})
            </Text>
            <div className="ml-auto flex items-center gap-1.5">
                <Button type="text" size="small" onClick={decline}>
                    Not now
                </Button>
                <Button type="primary" size="small" onClick={runConnect}>
                    Connect
                </Button>
            </div>
        </ChipRow>
    )
}

export default GatewayConnectToolWidget
