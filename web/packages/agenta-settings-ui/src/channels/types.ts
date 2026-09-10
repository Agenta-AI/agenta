/**
 * Channels — the domain shapes the connect UI works with.
 *
 * The host maps backend rows (connections, channel agents, setup declarations) to these
 * shapes and supplies the actions in `ChannelsActions`. The components never call an
 * api-client themselves, so the same UI runs on desktop, on /m, and in Storybook.
 */

export type ChannelPlatform = "slack" | "telegram"

/** hosted = Agenta-owned app/bot (one click, the default); custom = the customer's own app/bot. */
export type ChannelInstallMode = "hosted" | "custom"

/** pending = the hosted connection exists but no chat has completed the link yet. */
export type ChannelStatus = "connected" | "revoked" | "pending"

export type ChannelChatType = "channel" | "group" | "dm"

/** Whether the agent answers direct messages / group chats. Both default to allow. */
export type ChannelBehavior = "allow" | "deny"

export interface ChannelChat {
    name: string
    type: ChannelChatType
    /** The bot was removed from this chat on the platform side — needs a re-add. */
    removed?: boolean
}

/** The backend's space kinds: a 1:1 chat, a group, and a thread-bearing room (a Slack channel). */
export type ChannelSpaceKind = "private" | "group" | "topic"

/** One place a connection answers in, as the backend stores it. */
export interface ChannelSpace {
    id: string
    kind: ChannelSpaceKind
    /** The display name; "Direct messages" for a private chat. */
    name: string
}

/** A place the connected app can see but that has no space row yet. */
export interface ChannelSpaceCandidate {
    kind: ChannelSpaceKind
    /** The platform-side address; passed straight back to `addSpace`. */
    externalLocator: Record<string, unknown>
    displayName: string
    /** True when a space row already backs it, so adding it again would be a no-op. */
    isConfigured: boolean
}

/**
 * The two behavior switches, as the agent's kind-level grants express them.
 *
 * An agent with no grant at all answers everywhere; once any grant exists, a kind nobody
 * named is denied. Both switches on therefore means "no kind-level grants".
 */
export interface ChannelBehaviorState {
    /** The agent answers a direct message. */
    dm: boolean
    /** The agent answers in a group chat (and, on Slack, in a channel). */
    group: boolean
}

/** The agent a connection answers as. `name` is null when the host could not resolve it. */
export interface ChannelAnsweringAgent {
    id: string
    name: string | null
}

export interface ChannelConnection {
    /** Backend connection id, so the host can archive or retarget it. */
    connectionId?: string
    platform: ChannelPlatform
    kind: ChannelInstallMode
    status: ChannelStatus
    dm: ChannelBehavior
    group: ChannelBehavior
    chats: ChannelChat[]
    /** Which agent answers on this connection. Undefined when the host has not resolved it. */
    agent?: ChannelAnsweringAgent | null
    /** When the connection was made, ISO 8601. */
    connectedAt?: string | null
    /** The bot/app handle this connection uses, e.g. "@newagentabot"; null when unknown. */
    handle?: string | null
}

/** The project's connections, one per platform. `null` means "not connected". */
export interface ChannelConnections {
    slack: ChannelConnection | null
    telegram: ChannelConnection | null
}

/**
 * How a connection relates to the agent whose page is open. A channel connection is one
 * per project; it answers as one agent, and the agent page retargets it ("connect here").
 */
export type ChannelScope = "here" | "elsewhere" | "unassigned" | "unknown"

/** The one-time deep link the hosted Telegram bot binds a chat with. */
export interface HostedTelegramLink {
    url: string
    expiresInSeconds: number
    connectionId: string
}

/** A field the backend declares for a custom app/bot: rendered as-is, never hardcoded. */
export interface ChannelSetupField {
    name: string
    label: string
    secret: boolean
    required: boolean
    help?: string | null
}

/** What the backend declares for connecting a custom app/bot on a platform. */
export interface ChannelSetupInfo {
    /** The manifest (Slack) or null when the platform has none. */
    manifest: string | null
    fields: ChannelSetupField[]
    /** True when this deployment offers the hosted (Agenta-owned) app/bot. */
    hostedAvailable: boolean
}

/**
 * The real actions the host wires to the backend. Every action rejects on failure with an
 * Error whose message is safe to show; the UI renders it and keeps the panel open.
 */
export interface ChannelsActions {
    /** Re-read the connections (with their answering agent) from the backend. */
    reload: () => Promise<ChannelConnections>
    /** Load the custom-app declaration (manifest + fields) for a platform. */
    loadSetup: (platform: ChannelPlatform) => Promise<ChannelSetupInfo>
    /** Mint the hosted-Telegram bind link; also ensures the project's hosted connection
     * and points it at the current agent. */
    connectHostedTelegram: () => Promise<HostedTelegramLink>
    /** How many chats a /start has bound to the hosted connection so far. */
    countHostedTelegramBindings: (connectionId: string) => Promise<number>
    /** The hosted Slack install URL (a browser redirect into Slack's OAuth), or null when
     * this deployment has no hosted Slack app. */
    hostedSlackInstallUrl: () => Promise<string | null>
    /** Create a custom-app connection from the declared field values, then point it at the
     * current agent. */
    connectCustom: (platform: ChannelPlatform, values: Record<string, string>) => Promise<void>
    /** Point an existing connection at the current agent ("connect here"). */
    connectHere: (platform: ChannelPlatform, connectionId: string) => Promise<void>
    /** Disconnect (archive) a connection. */
    disconnect: (platform: ChannelPlatform, connectionId: string) => Promise<void>
    /** The places this connection already answers in. */
    listSpaces: (connectionId: string) => Promise<ChannelSpace[]>
    /** The places the connected app can see, for the "Add channel" picker. */
    discoverSpaces: (connectionId: string) => Promise<ChannelSpaceCandidate[]>
    /** Turn a discovered candidate into a space the agent answers in. */
    addSpace: (connectionId: string, candidate: ChannelSpaceCandidate) => Promise<void>
    /** Read the two behavior switches from this agent's kind-level grants. */
    readBehavior: (platform: ChannelPlatform, connectionId: string) => Promise<ChannelBehaviorState>
    /** Write the two behavior switches back as kind-level grants. */
    writeBehavior: (
        platform: ChannelPlatform,
        connectionId: string,
        next: ChannelBehaviorState,
    ) => Promise<void>
    /** The Telegram accounts allowed to message the bot; empty means everyone. */
    readAllowedUsers: (connectionId: string) => Promise<string[]>
    /** Replace the allowed Telegram accounts; an empty list opens the bot to everyone. */
    writeAllowedUsers: (connectionId: string, ids: string[]) => Promise<void>
    /** Replace the secrets of a custom app/bot (a rotated Telegram token, a new Slack pair). */
    updateCredentials: (connectionId: string, credentials: Record<string, string>) => Promise<void>
}
