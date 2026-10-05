import {useCallback, useMemo, useState} from "react"

import {Button} from "@agenta/ui/ui"
import {GearSix, LinkBreak} from "@phosphor-icons/react"

import type {ConfirmDestructive} from "../confirm"
import {
    SettingsCatalog,
    type SettingsCatalogGroup,
    type SettingsCatalogItem,
} from "../shared/SettingsCatalog"
import {SettingsRowMenu} from "../shared/SettingsRowMenu"

import {connectionsForAgent} from "./actions"
import {
    CHANNEL_PLATFORMS,
    EMPTY_CONNECTIONS,
    NOOP_ACTIONS,
    connectionRowText,
    platformLabel,
} from "./helpers"
import {platformLogo} from "./icons"
import type {
    ChannelConnection,
    ChannelConnections,
    ChannelPlatform,
    ChannelsActions,
    ChannelsPanelAgent,
} from "./types"
import {useChannelPanel, type ChannelsPanelRenderProps} from "./useChannelPanel"

export interface ChannelsSettingsPageProps {
    /** The project's agents: the ones a connection can answer as. */
    agents: ChannelsPanelAgent[]
    /** The agent the panel acts for; `actions` must be built for it. */
    agentId?: string
    /** Switch the agent the panel acts for; the host rebuilds `actions` for it. */
    onAgentChange: (agentId: string) => void
    /** Seeds the description of a new Slack app. */
    agentDescription?: string | null
    workspaceName?: string
    /** The project's connections, as loaded by the host (`allConnections` lists them all). */
    connections?: ChannelConnections
    /** True while the host loads `connections` for the first time. */
    loading?: boolean
    loadError?: string | null
    onRetry: () => Promise<void>
    actions?: ChannelsActions
    renderPanel: (props: ChannelsPanelRenderProps) => React.ReactNode
    hostedHandle?: string
    /** Confirms a disconnect; without it the row menu offers no Disconnect. */
    confirm?: ConfirmDestructive
}

const PLATFORM_DESCRIPTIONS: Record<ChannelPlatform, string> = {
    slack: "Mention or DM an agent in Slack",
    telegram: "Chat with an agent through a hosted bot or your own",
    whatsapp: "Let customers message an agent on WhatsApp",
}

/** A connection's trailing mark: live, waiting on a first chat, or broken. */
const connectionStatus = (
    connection: ChannelConnection,
): Pick<SettingsCatalogItem, "status" | "statusLabel"> => {
    if (connection.status === "revoked")
        return {status: "attention", statusLabel: "Needs attention"}
    if (connection.status === "pending") return {status: "attention", statusLabel: "Not linked yet"}
    if (connection.agent === null) return {status: "attention", statusLabel: "No agent"}
    return {status: "connected", statusLabel: "Live"}
}

const agentText = (connection: ChannelConnection): string =>
    connection.agent === null ? "No agent yet" : connection.agent?.name?.trim() || "Unknown agent"

/**
 * Settings > Channels: every connection in the project, whichever agent it answers as, then the
 * platforms to connect. A connection opens the Publish panel on it; a platform starts a new
 * connection by choosing the agent.
 */
export const ChannelsSettingsPage = ({
    agents,
    agentId,
    onAgentChange,
    agentDescription,
    workspaceName,
    connections = EMPTY_CONNECTIONS,
    loading = false,
    loadError = null,
    onRetry,
    actions = NOOP_ACTIONS,
    renderPanel,
    hostedHandle = "@agenta",
    confirm,
}: ChannelsSettingsPageProps) => {
    const [retrying, setRetrying] = useState(false)
    const agentName = agents.find((agent) => agent.id === agentId)?.name

    // The panel's agent changes before the host reloads for it, so derive its view here.
    const forAgent = useMemo(
        () =>
            agentId && connections.allConnections
                ? connectionsForAgent(connections.allConnections, agentId)
                : connections,
        [connections, agentId],
    )

    const firstLoad = loading && !connections.allConnections

    const panel = useChannelPanel({
        agentId,
        agentName,
        agentDescription,
        workspaceName,
        connections: forAgent,
        // A switch of agent reloads too, but `forAgent` already holds that agent's view.
        loading: firstLoad,
        loadError,
        actions,
        renderPanel,
        hostedHandle,
        agents,
        onAgentChange,
    })
    const {openRoute, openConnection: openPanelConnection} = panel

    const openConnection = useCallback(
        (connection: ChannelConnection) => {
            const owner = connection.agent?.id
            // No known owner: ask which agent, rather than act for whichever was picked last.
            if (!owner || !agents.some((agent) => agent.id === owner)) {
                openRoute({view: "agents"})
                return
            }
            if (owner !== agentId) onAgentChange(owner)
            openPanelConnection(connection)
        },
        [agents, agentId, onAgentChange, openRoute, openPanelConnection],
    )
    const startConnect = useCallback(
        (platform: ChannelPlatform) => openRoute({view: "agents", platform}),
        [openRoute],
    )

    const groups = useMemo<SettingsCatalogGroup[]>(() => {
        const connected = (connections.allConnections ?? []).map(
            (connection, index): SettingsCatalogItem => {
                const {title, detail} = connectionRowText(connection, hostedHandle)
                return {
                    key: connection.connectionId ?? `${connection.platform}-${index}`,
                    logo: platformLogo(connection.platform, 18),
                    name: title,
                    description: `${agentText(connection)} · ${detail}`,
                    ...connectionStatus(connection),
                    onOpen: () => openConnection(connection),
                    menu: (
                        <SettingsRowMenu
                            label="Channel actions"
                            items={[
                                {
                                    key: "manage",
                                    label:
                                        connection.status === "pending"
                                            ? "Finish linking"
                                            : "Manage",
                                    icon: <GearSix size={14} />,
                                    onClick: () => openConnection(connection),
                                },
                                {type: "divider"},
                                {
                                    key: "disconnect",
                                    label: "Disconnect",
                                    icon: <LinkBreak size={14} />,
                                    danger: true,
                                    hidden: !confirm || !connection.connectionId,
                                    onClick: () =>
                                        confirm?.({
                                            title: "Disconnect channel",
                                            message: `${title} stops answering on ${platformLabel(connection.platform)}. You can connect it again later.`,
                                            okText: "Disconnect",
                                            danger: true,
                                            onOk: async () => {
                                                await actions.disconnect(
                                                    connection.platform,
                                                    connection.connectionId as string,
                                                )
                                                await actions.reload()
                                            },
                                        }),
                                },
                            ]}
                        />
                    ),
                    testId: `channels-card-${connection.connectionId}`,
                }
            },
        )

        const platforms = CHANNEL_PLATFORMS.map(
            (platform): SettingsCatalogItem => ({
                key: platform,
                logo: platformLogo(platform, 18),
                name: platformLabel(platform),
                description: PLATFORM_DESCRIPTIONS[platform],
                status: "available",
                statusLabel: `Connect ${platformLabel(platform)}`,
                onOpen: () => startConnect(platform),
                testId: `channels-platform-${platform}`,
            }),
        )

        return [
            {key: "connected", label: "Connected", items: connected},
            {key: "platforms", label: "Messaging platforms", items: platforms},
        ]
    }, [actions, confirm, connections.allConnections, hostedHandle, openConnection, startConnect])

    const retry = async () => {
        setRetrying(true)
        try {
            await onRetry()
        } catch {
            // The host keeps the error until a reload succeeds.
        } finally {
            setRetrying(false)
        }
    }

    return (
        <div data-testid="channels-settings">
            <SettingsCatalog
                groups={groups}
                loading={firstLoad}
                notice={
                    loadError ? (
                        <div
                            role="alert"
                            className="flex items-center justify-between gap-3 rounded-lg border border-solid border-border px-3 py-2.5 text-[13px] text-error"
                        >
                            <span className="min-w-0">{loadError}</span>
                            <Button variant="outline" disabled={retrying} onClick={retry}>
                                {retrying ? "Retrying…" : "Try again"}
                            </Button>
                        </div>
                    ) : undefined
                }
            />

            {panel.panel}
        </div>
    )
}
