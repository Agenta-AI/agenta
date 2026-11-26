import {useT} from "@agenta/i18n"
import agentsOverview from "@agenta/i18n/catalogs/agents.overview"
import {
    CHANNEL_PLATFORMS,
    agentConnectionsOf,
    connectionRowText,
    platformLogo,
    type ChannelConnection,
    type ChannelConnections,
} from "@agenta/settings-ui"
import {Broadcast} from "@phosphor-icons/react"

import {AgentOverviewCard} from "./AgentOverviewCard"
import {AgentOverviewCardRow} from "./AgentOverviewCardRow"
import {AgentOverviewCardError} from "./states/AgentOverviewCardError"
import {AgentOverviewCardSkeleton} from "./states/AgentOverviewCardSkeleton"

const ICON = 16

/**
 * The agent overview's Channels card: the connections this agent answers through, each opening
 * its manage view. With none, a single Publish row opens the hub instead.
 */
export const AgentChannelsCard = ({
    connections,
    loading,
    loadError,
    onRetry,
    onOpenHub,
    onOpenConnection,
}: {
    connections: ChannelConnections
    loading: boolean
    loadError: string | null
    onRetry: () => void
    onOpenHub: () => void
    onOpenConnection: (connection: ChannelConnection) => void
}) => {
    const t = useT(agentsOverview)
    const mine = CHANNEL_PLATFORMS.flatMap((platform) => agentConnectionsOf(connections, platform))

    return (
        <AgentOverviewCard
            title={t("agents.overview.channelsTitle")}
            action={mine.length ? t("agents.overview.channelsManage") : undefined}
            onAction={onOpenHub}
        >
            {loading ? (
                <AgentOverviewCardSkeleton rows={2} />
            ) : loadError ? (
                <AgentOverviewCardError
                    message={t("agents.overview.channelsLoadError")}
                    onRetry={onRetry}
                />
            ) : mine.length === 0 ? (
                <AgentOverviewCardRow
                    icon={<Broadcast size={ICON} />}
                    label={t("agents.overview.channelsPublish")}
                    // Overlapped like the Integrations row's logos.
                    detail={
                        <span
                            className="flex items-center"
                            aria-label={t("agents.overview.channelsLogosLabel")}
                        >
                            {CHANNEL_PLATFORMS.map((platform, i) => (
                                <span
                                    key={platform}
                                    className="inline-flex"
                                    style={i ? {marginLeft: -Math.round(ICON * 0.18)} : undefined}
                                >
                                    {platformLogo(platform, ICON)}
                                </span>
                            ))}
                        </span>
                    }
                    onClick={onOpenHub}
                />
            ) : (
                mine.map((connection, i) => {
                    const {title, detail} = connectionRowText(connection)
                    return (
                        <AgentOverviewCardRow
                            key={connection.connectionId ?? i}
                            icon={platformLogo(connection.platform, ICON)}
                            label={title}
                            detail={
                                connection.status === "revoked" ? (
                                    <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                                        <span className="size-1.5 shrink-0 rounded-full bg-colorError" />
                                        {t("agents.overview.needsAttention")}
                                    </span>
                                ) : (
                                    detail
                                )
                            }
                            onClick={() => onOpenConnection(connection)}
                        />
                    )
                })
            )}
        </AgentOverviewCard>
    )
}

export default AgentChannelsCard
