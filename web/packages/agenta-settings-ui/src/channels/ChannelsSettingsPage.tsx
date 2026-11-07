import {useCallback, useMemo, useState} from "react"

import {useT, type CatalogKey} from "@agenta/i18n"
import channelsPageCatalog from "@agenta/i18n/catalogs/channels.page"
import commonCatalog from "@agenta/i18n/catalogs/common"
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
    /** The project's name, for the agent step's audience note. */
    projectName?: string
}

const PLATFORM_DESCRIPTIONS: Record<
    ChannelPlatform,
    CatalogKey<typeof channelsPageCatalog | typeof commonCatalog>
> = {
    slack: "channels.page.slackDescription",
    telegram: "channels.page.telegramDescription",
    whatsapp: "channels.page.whatsappDescription",
}

type Translate = ReturnType<typeof useT>

/** A connection's trailing mark: live, waiting on a first chat, or broken. */
const connectionStatus = (
    connection: ChannelConnection,
    t: Translate,
): Pick<SettingsCatalogItem, "status" | "statusLabel"> => {
    if (connection.status === "revoked")
        return {status: "attention", statusLabel: t("common.needsAttention")}
    if (connection.status === "pending")
        return {status: "attention", statusLabel: t("channels.page.notLinkedYet")}
    if (connection.agent === null)
        return {status: "attention", statusLabel: t("channels.page.noAgent")}
    return {status: "connected", statusLabel: t("common.live")}
}

const agentText = (connection: ChannelConnection, t: Translate): string =>
    connection.agent === null
        ? t("channels.page.noAgentYet")
        : connection.agent?.name?.trim() || t("channels.page.unknownAgent")

/** Settings > Channels: every connection in the project, then the platforms to connect. */
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
    projectName,
}: ChannelsSettingsPageProps) => {
    const t = useT(channelsPageCatalog, commonCatalog)
    const [retrying, setRetrying] = useState(false)
    const current = agents.find((agent) => agent.id === agentId)
    const agentName = current?.name

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
        projectName,
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
                const owner = connection.agent?.id
                // Answers as an agent this member cannot see: the row has nothing to open.
                const hiddenOwner = !!owner && !agents.some((agent) => agent.id === owner)
                return {
                    key: connection.connectionId ?? `${connection.platform}-${index}`,
                    logo: platformLogo(connection.platform, 18),
                    name: title,
                    description: `${agentText(connection, t)} · ${detail}`,
                    ...connectionStatus(connection, t),
                    onOpen: hiddenOwner ? undefined : () => openConnection(connection),
                    menu: (
                        <SettingsRowMenu
                            label={t("channels.page.channelActions")}
                            items={[
                                {
                                    key: "manage",
                                    label:
                                        connection.status === "pending"
                                            ? t("channels.page.finishLinking")
                                            : t("common.manage"),
                                    icon: <GearSix size={14} />,
                                    hidden: hiddenOwner,
                                    onClick: () => openConnection(connection),
                                },
                                {type: "divider"},
                                {
                                    key: "disconnect",
                                    label: t("common.disconnect"),
                                    icon: <LinkBreak size={14} />,
                                    danger: true,
                                    hidden: !confirm || !connection.connectionId,
                                    onClick: () =>
                                        confirm?.({
                                            title: t("channels.page.disconnectTitle"),
                                            message: t("channels.page.disconnectMessage", {
                                                name: title,
                                                platform: platformLabel(connection.platform),
                                            }),
                                            okText: t("common.disconnect"),
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
                description: t(PLATFORM_DESCRIPTIONS[platform]),
                status: "available",
                statusLabel: t("channels.page.connectPlatform", {
                    platform: platformLabel(platform),
                }),
                onOpen: () => startConnect(platform),
                testId: `channels-platform-${platform}`,
            }),
        )

        return [
            {key: "connected", label: t("common.connected"), items: connected},
            {
                key: "platforms",
                label: t("channels.page.messagingPlatforms"),
                items: platforms,
            },
        ]
    }, [
        actions,
        agents,
        confirm,
        connections.allConnections,
        hostedHandle,
        openConnection,
        startConnect,
        t,
    ])

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
                                {retrying ? t("common.retrying") : t("common.tryAgain")}
                            </Button>
                        </div>
                    ) : undefined
                }
            />

            {panel.panel}
        </div>
    )
}
