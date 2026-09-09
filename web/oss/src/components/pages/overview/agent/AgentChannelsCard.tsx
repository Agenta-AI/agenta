import {useCallback, useEffect, useState} from "react"

import {
    ChannelsPage,
    type ChannelsPanelRenderProps,
    type DesignChannelConnections,
} from "@agenta/settings-ui"
import {Drawer} from "antd"

import {
    archiveChannelConnection,
    createTelegramHostedBindLink,
    queryChannelConnections,
} from "@/oss/state/channels/api"

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
        if (row?.deleted_at) continue // archived rows are not connections
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
            connectionId: row?.id,
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

    // Load the real connections and map them to the design shape. Reused after a
    // connect or disconnect so the card reflects the actual backend state (and the
    // real connection id) instead of a fabricated one.
    const load = useCallback(async () => {
        const res = await queryChannelConnections()
        setConnections(mapConnections((res as any)?.connections ?? []))
    }, [])

    useEffect(() => {
        void load().catch(() => {
            /* leave the last known state on a failed refresh */
        })
    }, [appId, load])

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

    const onConnectHostedTelegram = useCallback(async () => {
        const link = await createTelegramHostedBindLink({application: {id: appId}})
        // The mint ensured the project's hosted connection and pointed it at this
        // agent; reload so the card shows the real connection (with its id).
        await load().catch(() => {})
        return link
    }, [appId, load])

    const onDisconnect = useCallback(
        async (_platform: string, connectionId?: string) => {
            if (connectionId) await archiveChannelConnection(connectionId)
            await load().catch(() => {})
        },
        [load],
    )

    return (
        <ChannelsPage
            initialConnections={connections}
            renderPanel={renderPanel}
            onConnectHostedTelegram={onConnectHostedTelegram}
            onDisconnect={onDisconnect}
        />
    )
}

export default AgentChannelsCard
