import {useCallback, useEffect, useState} from "react"

import {
    ChannelsPage,
    type ChannelsPanelRenderProps,
    type DesignChannelConnections,
} from "@agenta/settings-ui"
import {Drawer} from "antd"

import {createTelegramHostedBindLink, queryChannelConnections} from "@/oss/state/channels/api"

/**
 * The agent page's Channels section: the designed connect screen, wired to the real
 * backend connection list. The connect and disconnect ACTIONS are wired next; this
 * first pass shows the real connected state for Slack and Telegram on the agent page.
 */
const EMPTY: DesignChannelConnections = {slack: null, telegram: null}

/** Map the backend connection rows to the design's one-per-platform shape. */
function mapConnections(rows: any[]): DesignChannelConnections {
    const out: DesignChannelConnections = {slack: null, telegram: null}
    for (const row of rows ?? []) {
        const channel: string = row?.channel ?? ""
        const flags = row?.flags ?? {}
        const platform = channel.startsWith("telegram")
            ? "telegram"
            : channel.startsWith("slack")
              ? "slack"
              : null
        if (!platform) continue
        // one connection per platform in the design; first active wins
        if (out[platform] && out[platform]?.status === "connected") continue
        out[platform] = {
            platform,
            kind: flags?.is_hosted ? "hosted" : "custom",
            status: flags?.is_active === false ? "revoked" : "connected",
            dm: "allow",
            group: "allow",
            chats: [],
        }
    }
    return out
}

const AgentChannelsCard = ({appId}: {appId: string}) => {
    const [connections, setConnections] = useState<DesignChannelConnections>(EMPTY)

    useEffect(() => {
        let alive = true
        queryChannelConnections()
            .then((res) => {
                if (alive) setConnections(mapConnections((res as any)?.connections ?? []))
            })
            .catch(() => {
                /* read-only first pass: leave empty on failure */
            })
        return () => {
            alive = false
        }
    }, [appId])

    const renderPanel = useCallback(
        ({open, title, subtitle, onClose, children}: ChannelsPanelRenderProps) => (
            <Drawer
                open={open}
                title={
                    <div className="flex flex-col">
                        <span>{title}</span>
                        {subtitle ? (
                            <span className="text-xs font-normal text-colorTextSecondary">
                                {subtitle}
                            </span>
                        ) : null}
                    </div>
                }
                onClose={onClose}
                width={460}
                destroyOnClose
            >
                {children}
            </Drawer>
        ),
        [],
    )

    const onConnectHostedTelegram = useCallback(
        () => createTelegramHostedBindLink({application: {id: appId}}),
        [appId],
    )

    return (
        <ChannelsPage
            initialConnections={connections}
            renderPanel={renderPanel}
            onConnectHostedTelegram={onConnectHostedTelegram}
        />
    )
}

export default AgentChannelsCard
