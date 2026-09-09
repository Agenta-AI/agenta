/**
 * Channels — placeholder domain types.
 *
 * FIRST PASS: there is no channels data layer yet (no api-client calls, no jotai atoms). These
 * shapes describe the connect UI's state so the components compile and the flows work against
 * local state. When the backend lands, replace this file with the generated entity types and
 * wire `ChannelsPage`'s callbacks to real mutations.
 */

export type ChannelPlatform = "slack" | "telegram"

/** hosted = Agenta-owned app/bot (one click, the default); custom = the customer's own app/bot. */
export type ChannelInstallMode = "hosted" | "custom"

export type ChannelStatus = "connected" | "revoked"

export type ChannelChatType = "channel" | "group" | "dm"

/** Whether the agent answers direct messages / group chats. Both default to allow. */
export type ChannelBehavior = "allow" | "deny"

export interface ChannelChat {
    name: string
    type: ChannelChatType
    /** The bot was removed from this chat on the platform side — needs a re-add. */
    removed?: boolean
}

export interface ChannelConnection {
    /** Backend connection id, so the host can archive it on disconnect. */
    connectionId?: string
    platform: ChannelPlatform
    kind: ChannelInstallMode
    status: ChannelStatus
    dm: ChannelBehavior
    group: ChannelBehavior
    chats: ChannelChat[]
}

/** The workspace's connections, one per platform. `null` means "not connected". */
export interface ChannelConnections {
    slack: ChannelConnection | null
    telegram: ChannelConnection | null
}
