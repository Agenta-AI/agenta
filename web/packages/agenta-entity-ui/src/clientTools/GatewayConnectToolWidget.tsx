/**
 * The `request_connection` widget for a GATEWAY TARGET: a model provider the LLM plane refused,
 * or an MCP server the tool plane refused. The sibling `ConnectToolWidget` answers the other
 * shape of the same tool, an external integration named by key.
 *
 * It lives in this package, next to that sibling, rather than in the desktop app, because both
 * apps render one client-tool set: a widget only the desktop registers is a feature /m never
 * shows, and the surfaces it opens (the provider drawer, the MCP connect journey, the tool
 * catalog) are package-level and already mounted on both. It is styled with the shared kit for
 * the same reason.
 */
import {providerConnectionsAtom} from "@agenta/entities/secret"
import {
    isInteractionEndedOutput,
    type ClientToolWidgetProps as ClientToolHandlerProps,
} from "@agenta/shared/clientTools"
import {Button} from "@agenta/ui/ui"
import {CheckCircle, Plugs, Spinner, Warning} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {McpConnectJourney} from "../mcpEndpoint"
import {ProviderDrawer} from "../secretProvider"

import {useGatewayConnectFlow, type GatewayTarget} from "./useGatewayConnectFlow"

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
        connectingEndpoint,
        runConnect,
        onProviderSaved,
        onProviderClosed,
        onMcpConnectSuccess,
        onMcpDialogClosed,
        decline,
    } = useGatewayConnectFlow(target, meta, settle)
    const connections = useAtomValue(providerConnectionsAtom)

    const planeLabel = target.plane === "llm" ? "model provider" : "MCP server"

    if (phase === "connecting") {
        return (
            <>
                <ChipRow icon={<Spinner size={13} className="animate-spin text-colorPrimary" />}>
                    <span className="truncate text-xs text-colorTextSecondary">
                        Connecting {label}…
                    </span>
                </ChipRow>
                {target.plane === "llm" ? (
                    <ProviderDrawer
                        open={providerDrawerOpen}
                        onClose={onProviderClosed}
                        context="playground"
                        connections={connections}
                        onSaved={onProviderSaved}
                    />
                ) : (
                    // Only custom endpoints use a per-instance connection dialog. The
                    // agent named a server that is already registered, so this is the
                    // reconnect entry into the same journey settings uses.
                    <McpConnectJourney
                        open={!!connectingEndpoint?.id}
                        onClose={onMcpDialogClosed}
                        reconnect={
                            connectingEndpoint?.id && connectingEndpoint.slug
                                ? {
                                      id: connectingEndpoint.id,
                                      slug: connectingEndpoint.slug,
                                      name: connectingEndpoint.name || connectingEndpoint.slug,
                                      url: connectingEndpoint.data.route.base_url || "",
                                      authMode: connectingEndpoint.auth_mode,
                                  }
                                : null
                        }
                        onConnected={onMcpConnectSuccess}
                    />
                )}
            </>
        )
    }

    if (meta.settled || outcome) {
        if (isInteractionEndedOutput(meta.output)) {
            return (
                <ChipRow icon={<Plugs size={13} className="text-colorTextTertiary" />}>
                    <span className="truncate text-xs text-colorTextTertiary">
                        Connection request ended
                    </span>
                </ChipRow>
            )
        }
        const output = (meta.output ?? {}) as {connected?: boolean}
        if (outcome?.connected === true || output.connected === true) {
            return (
                <ChipRow
                    icon={<CheckCircle size={13} weight="fill" className="text-colorSuccess" />}
                >
                    <span className="truncate text-xs text-colorText">{label} connected</span>
                </ChipRow>
            )
        }
        return (
            <ChipRow icon={<Warning size={13} weight="fill" className="text-colorWarning" />}>
                <span className="truncate text-xs text-colorTextSecondary">
                    Connection not completed
                </span>
            </ChipRow>
        )
    }

    return (
        <ChipRow icon={<Plugs size={13} className="text-colorPrimary" />}>
            <span className="truncate text-xs text-colorText">
                Connect {label} ({planeLabel})
            </span>
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
                <Button variant="ghost" size="sm" onClick={decline} className="px-2">
                    Not now
                </Button>
                <Button size="sm" onClick={runConnect}>
                    Connect
                </Button>
            </div>
        </ChipRow>
    )
}

export default GatewayConnectToolWidget
