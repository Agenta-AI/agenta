import {useCallback, useRef, useState} from "react"

import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@agenta/ui/ui"
import {Broadcast, Code} from "@phosphor-icons/react"

import {ChannelAgentPicker} from "./ChannelAgentPicker"
import {ChannelConnectFlow} from "./ChannelConnectFlow"
import {ChannelConnectionList} from "./ChannelConnectionList"
import {ChannelManagePanel} from "./ChannelManagePanel"
import {ChannelsHubView} from "./ChannelsHubView"
import {
    agentConnectionsOf,
    EMPTY_CONNECTIONS,
    liveCountOf,
    NOOP_ACTIONS,
    platformLabel,
} from "./helpers"
import {platformLogo} from "./icons"
import type {
    ChannelConnection,
    ChannelConnections,
    ChannelInstallMode,
    ChannelPlatform,
    ChannelsActions,
    ChannelsPanelAgent,
} from "./types"
import {ViewTransition} from "./ViewTransition"

export interface ChannelsPanelRenderProps {
    open: boolean
    title: string
    /** The agent's name, or a picker to switch agent when the host offers one. */
    subtitle?: React.ReactNode
    onClose: () => void
    children: React.ReactNode
    /** A wider container for code (Publish > API); the channel panels leave it unset. */
    wide?: boolean
    /** Steps back one view; unset on the first view. */
    onBack?: () => void
    /** The mark shown beside the title. */
    icon?: React.ReactNode
}

/** One view of the panel; the panel keeps a stack of them for the back button. */
export type ChannelsRoute =
    | {view: "hub"}
    | {view: "platform"; platform: ChannelPlatform}
    | {
          view: "connect"
          platform: ChannelPlatform
          mode: ChannelInstallMode
          /** Connection ids that existed when the view opened, to spot the new one. */
          known: string[]
          /** The connection a reconnect repairs. */
          connectionId?: string
      }
    | {view: "manage"; platform: ChannelPlatform; connectionId: string | null}
    | {view: "api"}
    /** Choose the agent a new connection answers as; needs `agents`. */
    | {view: "agents"}

export interface UseChannelPanelOptions {
    /** The agent whose page this is; decides "connected here" versus "connected to X". */
    agentId?: string
    agentName?: string
    /** Seeds the description of a new Slack app. */
    agentDescription?: string | null
    workspaceName?: string
    connections?: ChannelConnections
    /** True while the host loads `connections` for the first time. */
    loading?: boolean
    loadError?: string | null
    actions?: ChannelsActions
    /** Host-provided sliding container: a drawer on desktop, a Sheet on /m. */
    renderPanel: (props: ChannelsPanelRenderProps) => React.ReactNode
    hostedHandle?: string
    /** The API view's content; the hub lists API only when it is given. */
    api?: React.ReactNode
    /** Agents to switch between from the header; the header shows the agent's name without it. */
    agents?: ChannelsPanelAgent[]
    /** Switch the panel to another agent; it reopens on that agent's hub. */
    onAgentChange?: (agentId: string) => void
}

const knownIds = (connections: ChannelConnections, platform: ChannelPlatform): string[] =>
    [
        ...(connections.allConnections ?? []),
        ...agentConnectionsOf(connections, platform),
        connections[platform],
    ]
        .filter(
            (c): c is ChannelConnection =>
                !!c?.connectionId && c.platform === platform && c.status === "connected",
        )
        .map((c) => c.connectionId as string)

/** One key per distinct view, so a change of view (not a re-render) animates. */
const routeKey = (route: ChannelsRoute, depth: number): string => {
    switch (route.view) {
        case "platform":
            return `${depth}:platform:${route.platform}`
        case "connect":
            return `${depth}:connect:${route.platform}:${route.mode}`
        case "manage":
            return `${depth}:manage:${route.platform}:${route.connectionId ?? ""}`
        default:
            return `${depth}:${route.view}`
    }
}

const findConnection = (
    connections: ChannelConnections,
    platform: ChannelPlatform,
    connectionId: string | null,
): ChannelConnection | null => {
    if (!connectionId) return connections[platform]
    const pool = [
        ...(connections.allConnections ?? []),
        ...agentConnectionsOf(connections, platform),
        connections[platform],
    ]
    return pool.find((c) => c?.connectionId === connectionId) ?? null
}

/** The Publish / channels panel every entry point opens: a stack of views with a back button. */
export const useChannelPanel = ({
    agentId,
    agentName = "your agent",
    agentDescription,
    workspaceName = "your workspace",
    connections = EMPTY_CONNECTIONS,
    loading = false,
    loadError = null,
    actions = NOOP_ACTIONS,
    renderPanel,
    hostedHandle = "@agenta",
    api,
    agents,
    onAgentChange,
}: UseChannelPanelOptions) => {
    const [stack, setStack] = useState<ChannelsRoute[]>([])
    // Which way the last move went, so the next view slides in from that side.
    const [direction, setDirection] = useState(1)
    const top = stack.at(-1) ?? null
    const topRef = useRef(top)
    topRef.current = top

    // Leaving a connect view drops its polls; one re-read shows an install that finished anyway.
    const reloadAfterConnect = useCallback(() => {
        if (topRef.current?.view === "connect") void actions.reload().catch(() => null)
    }, [actions])

    const close = useCallback(() => {
        reloadAfterConnect()
        setStack([])
    }, [reloadAfterConnect])

    const back = useCallback(() => {
        reloadAfterConnect()
        setDirection(-1)
        setStack((current) => current.slice(0, -1))
    }, [reloadAfterConnect])

    const push = useCallback((route: ChannelsRoute) => {
        setDirection(1)
        setStack((s) => [...s, route])
    }, [])
    const replace = useCallback((route: ChannelsRoute) => {
        setDirection(1)
        setStack((s) => [...s.slice(0, -1), route])
    }, [])
    /** Opens on `routes`, the last one shown; back walks down the rest. */
    const openRoute = useCallback((...routes: ChannelsRoute[]) => {
        setDirection(1)
        setStack(routes)
    }, [])

    const connectRoute = useCallback(
        (platform: ChannelPlatform, mode?: ChannelInstallMode, connectionId?: string) => {
            const mine = agentConnectionsOf(connections, platform)
            // One Agenta bot answers as one agent, so a second Telegram bot is the agent's own.
            const hostedHere = platform === "telegram" && mine.some((c) => c.kind === "hosted")
            return {
                view: "connect",
                platform,
                mode: mode ?? (hostedHere ? "custom" : "hosted"),
                known: knownIds(connections, platform),
                connectionId,
            } satisfies ChannelsRoute
        },
        [connections],
    )

    /** Where a platform opens: connect when nothing answers, else its list or its one connection. */
    const entryRoute = useCallback(
        (platform: ChannelPlatform): ChannelsRoute => {
            const primary = connections[platform]
            const mine = agentConnectionsOf(connections, platform)
            if (!primary || primary.status === "pending") return connectRoute(platform, "hosted")
            if (mine.length > 1) return {view: "platform", platform}
            return {view: "manage", platform, connectionId: primary.connectionId ?? null}
        },
        [connections, connectRoute],
    )

    const open = useCallback(
        (platform: ChannelPlatform) => openRoute(entryRoute(platform)),
        [openRoute, entryRoute],
    )

    /** Opens on one connection's manage view, over the hub. A pending link opens on the hub:
     * resuming it mints a new link, which only an explicit Connect should do. */
    const openConnection = useCallback(
        (connection: ChannelConnection) => {
            const {platform, connectionId = null} = connection
            if (connection.status === "pending") openRoute({view: "hub"})
            else openRoute({view: "hub"}, {view: "manage", platform, connectionId})
        },
        [openRoute],
    )

    const onConnected = async (route: Extract<ChannelsRoute, {view: "connect"}>) => {
        const next = await actions.reload()
        const mine = agentConnectionsOf(next, route.platform)
        const fresh =
            mine.find((c) => c.connectionId && !route.known.includes(c.connectionId)) ??
            mine.find((c) => c.connectionId === route.connectionId) ??
            mine[0]
        // Nothing answers yet (e.g. a hosted link still pending): stay on the connect view.
        if (!fresh?.connectionId) return
        const manage: ChannelsRoute = {
            view: "manage",
            platform: route.platform,
            connectionId: fresh.connectionId,
        }
        // Swap only the view that started the connect; the user may have navigated since.
        setDirection(1)
        setStack((s) => (s.at(-1) === route ? [...s.slice(0, -1), manage] : s))
    }

    const onDisconnect = async (platform: ChannelPlatform, connectionId: string) => {
        let failure: unknown = null
        try {
            await actions.disconnect(platform, connectionId)
        } catch (error) {
            failure = error
        }
        // The backend can archive the row and still answer with an error, so re-read either way.
        const next = await actions.reload().catch(() => null)
        const remaining = next
            ? agentConnectionsOf(next, platform).filter((c) => c.connectionId !== connectionId)
            : []
        if (failure) {
            const gone =
                next !== null &&
                next[platform]?.connectionId !== connectionId &&
                !agentConnectionsOf(next, platform).some((c) => c.connectionId === connectionId)
            if (!gone) throw failure
        }
        if (stack.length > 1) {
            setDirection(-1)
            setStack((s) => s.slice(0, -1))
            return
        }
        // Opened straight on this connection: stay on what the agent still answers through.
        if (remaining.length > 1) replace({view: "platform", platform})
        else if (remaining[0]?.connectionId)
            replace({view: "manage", platform, connectionId: remaining[0].connectionId})
        else setStack([])
    }

    const renderView = (route: ChannelsRoute) => {
        switch (route.view) {
            case "hub":
                return (
                    <ChannelsHubView
                        agentId={agentId}
                        connections={connections}
                        loading={loading}
                        loadError={loadError}
                        onRetry={() => actions.reload().then(() => undefined)}
                        showApi={!!api}
                        apiLive={!!agentId}
                        hostedHandle={hostedHandle}
                        onOpenPlatform={(platform) => push(entryRoute(platform))}
                        onOpenConnection={(platform, connectionId) =>
                            push({view: "manage", platform, connectionId})
                        }
                        onAdd={(platform) => push(connectRoute(platform))}
                        onOpenApi={() => push({view: "api"})}
                    />
                )
            case "platform":
                return (
                    <ChannelConnectionList
                        platform={route.platform}
                        connections={agentConnectionsOf(connections, route.platform)}
                        hostedHandle={hostedHandle}
                        onSelect={(connectionId) =>
                            push({view: "manage", platform: route.platform, connectionId})
                        }
                        onAdd={() => push(connectRoute(route.platform))}
                    />
                )
            case "connect":
                return (
                    <ChannelConnectFlow
                        key={`${route.platform}-${route.mode}`}
                        platform={route.platform}
                        agentName={agentName}
                        agentDescription={agentDescription}
                        workspaceName={workspaceName}
                        hostedHandle={hostedHandle}
                        actions={actions}
                        initialMode={route.mode}
                        knownConnectionIds={route.known}
                        adding={agentConnectionsOf(connections, route.platform).length > 0}
                        hostedConnectedHere={
                            route.platform === "telegram" &&
                            agentConnectionsOf(connections, "telegram").some(
                                (c) => c.kind === "hosted",
                            )
                        }
                        onConnected={() => onConnected(route)}
                    />
                )
            case "manage": {
                const connection = findConnection(connections, route.platform, route.connectionId)
                if (!connection) return null
                return (
                    <ChannelManagePanel
                        key={connection.connectionId ?? route.platform}
                        connection={connection}
                        agentId={agentId}
                        agentName={agentName}
                        workspaceName={workspaceName}
                        hostedHandle={hostedHandle}
                        actions={actions}
                        onAdd={() => push(connectRoute(route.platform))}
                        onUseOwnBot={() => push(connectRoute(route.platform, "custom"))}
                        onReconnect={() =>
                            push(
                                connectRoute(
                                    route.platform,
                                    connection.kind,
                                    connection.connectionId,
                                ),
                            )
                        }
                        onConnectHere={async () => {
                            if (!connection.connectionId) {
                                throw new Error("This connection has no id yet.")
                            }
                            await actions.connectHere(route.platform, connection.connectionId)
                            await actions.reload()
                        }}
                        onDisconnect={async () => {
                            if (!connection.connectionId) {
                                throw new Error("This connection has no id yet.")
                            }
                            await onDisconnect(route.platform, connection.connectionId)
                        }}
                    />
                )
            }
            case "api":
                return api ?? null
            case "agents":
                return (
                    <ChannelAgentPicker
                        agents={agents ?? []}
                        connections={connections}
                        onSelect={(id) => {
                            onAgentChange?.(id)
                            push({view: "hub"})
                        }}
                    />
                )
        }
    }

    const headerOf = (route: ChannelsRoute): {title: string; icon: React.ReactNode} => {
        switch (route.view) {
            case "hub":
                return {title: "Publish", icon: <Broadcast size={18} />}
            case "api":
                return {title: "API", icon: <Code size={18} weight="bold" />}
            case "agents":
                return {title: "Connect a channel", icon: <Broadcast size={18} />}
            case "connect": {
                const label = platformLabel(route.platform)
                const hasAny = agentConnectionsOf(connections, route.platform).length > 0
                const title = !hasAny
                    ? `Connect ${label}`
                    : route.platform === "slack"
                      ? "Add a Slack workspace"
                      : route.platform === "whatsapp"
                        ? "Add a WhatsApp number"
                        : "Add a Telegram bot"
                return {title, icon: platformLogo(route.platform, 18)}
            }
            default:
                return {
                    title: platformLabel(route.platform),
                    icon: platformLogo(route.platform, 18),
                }
        }
    }

    const switchAgent = (id: string) => {
        reloadAfterConnect()
        onAgentChange?.(id)
        setDirection(1)
        // A picked agent keeps the picker under its hub, so back still offers the others.
        setStack((s) => (s[0]?.view === "agents" ? [s[0], {view: "hub"}] : [{view: "hub"}]))
    }

    const subtitle =
        agents?.length && onAgentChange && top?.view !== "agents" ? (
            <Select value={agentId} onValueChange={switchAgent}>
                <SelectTrigger
                    variant="ghost"
                    size="sm"
                    aria-label="Agent"
                    className="h-auto w-auto max-w-full px-0 text-xs text-muted-foreground"
                    data-testid="channels-panel-agent"
                >
                    <SelectValue />
                </SelectTrigger>
                <SelectContent align="start" className="w-auto min-w-[220px] max-w-[320px]">
                    {agents.map((agent) => {
                        const live = liveCountOf(connections, agent.id)
                        return (
                            <SelectItem key={agent.id} value={agent.id}>
                                {live ? `${agent.name} · ${live} live` : agent.name}
                            </SelectItem>
                        )
                    })}
                </SelectContent>
            </Select>
        ) : top?.view === "agents" ? (
            "Choose the agent that answers"
        ) : (
            agentName
        )

    const header = top ? headerOf(top) : null
    const panel =
        top && header
            ? renderPanel({
                  open: true,
                  title: header.title,
                  subtitle,
                  icon: header.icon,
                  onBack: stack.length > 1 ? back : undefined,
                  onClose: close,
                  children: (
                      <ViewTransition viewKey={routeKey(top, stack.length)} direction={direction}>
                          {renderView(top)}
                      </ViewTransition>
                  ),
              })
            : null

    return {open, openRoute, openConnection, close, panel}
}
