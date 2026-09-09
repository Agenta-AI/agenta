import type {
    ChannelConnection,
    ChannelConnections,
    ChannelPlatform,
    ChannelScope,
    ChannelsActions,
} from "./types"

export const platformLabel = (platform: ChannelPlatform): string =>
    platform === "slack" ? "Slack" : "Telegram"

/** The handle shown for a connection: the shared Agenta bot, or the customer's own. */
export const botHandle = (connection: ChannelConnection, hostedHandle = "@agenta"): string => {
    if (connection.handle) return connection.handle
    if (connection.kind === "hosted") return hostedHandle
    return connection.platform === "slack" ? "your Slack app" : "your bot"
}

/**
 * Where a connection points, relative to the agent whose page is open:
 * "here" = it answers as this agent; "elsewhere" = it answers as another agent;
 * "unknown" = the host did not resolve the answering agent (treated like "here").
 */
export const connectionScope = (
    connection: ChannelConnection,
    agentId: string | undefined,
): ChannelScope => {
    if (!agentId || connection.agent === undefined || connection.agent === null) return "unknown"
    return connection.agent.id === agentId ? "here" : "elsewhere"
}

/** The display name of the agent a connection answers as, with a fallback. */
export const answeringAgentName = (connection: ChannelConnection): string =>
    connection.agent?.name?.trim() || "another agent"

export interface ChannelRowSummary {
    /** One-line status/description under the platform name. */
    sub: string
    /** Tailwind class for the subtitle colour. */
    subClass: string
    /** Tailwind class for the status dot, or "" when there is no dot (not connected). */
    dotClass: string
    connected: boolean
    needsAttention: boolean
    /** The row's trailing affordance: open the manage view, offer "connect here", or connect. */
    action: "manage" | "connect-here" | "connect"
}

/** Derive the channels-card row summary from a connection (or its absence). */
export const summarizeConnection = (
    platform: ChannelPlatform,
    connection: ChannelConnection | null,
    agentId?: string,
): ChannelRowSummary => {
    if (!connection) {
        return {
            sub:
                platform === "slack"
                    ? "Chat with the agent in your team’s workspace"
                    : "Chat with the agent from your phone",
            subClass: "text-colorTextTertiary",
            dotClass: "",
            connected: false,
            needsAttention: false,
            action: "connect",
        }
    }

    if (connection.status === "revoked") {
        return {
            sub: "Credential revoked · reconnect",
            subClass: "text-colorError",
            dotClass: "bg-colorError",
            connected: true,
            needsAttention: true,
            action: "manage",
        }
    }

    if (connection.status === "pending") {
        return {
            sub: "Not linked yet · finish connecting",
            subClass: "text-colorWarning",
            dotClass: "bg-colorWarning",
            connected: false,
            needsAttention: false,
            action: "connect",
        }
    }

    if (connectionScope(connection, agentId) === "elsewhere") {
        return {
            sub: `Connected to ${answeringAgentName(connection)}`,
            subClass: "text-colorTextSecondary",
            dotClass: "bg-colorTextQuaternary",
            connected: true,
            needsAttention: false,
            action: "connect-here",
        }
    }

    const removed = connection.chats.filter((chat) => chat.removed).length
    if (removed > 0) {
        return {
            sub: `Bot removed from ${removed} channel${removed > 1 ? "s" : ""}`,
            subClass: "text-colorWarning",
            dotClass: "bg-colorWarning",
            connected: true,
            needsAttention: true,
            action: "manage",
        }
    }

    const nonDm = connection.chats.filter((chat) => chat.type !== "dm").length
    const noun = platform === "slack" ? "channel" : "group"
    const where = nonDm ? `${nonDm} ${noun}${nonDm > 1 ? "s" : ""} + DMs` : "Direct messages"
    return {
        sub: `${botHandle(connection)} · ${where}`,
        subClass: "text-colorTextTertiary",
        dotClass: "bg-colorSuccess",
        connected: true,
        needsAttention: false,
        action: "manage",
    }
}

export const hasAnyIssue = (connections: ChannelConnections): boolean =>
    (["slack", "telegram"] as const).some((platform) => {
        const connection = connections[platform]
        return (
            !!connection &&
            (connection.status === "revoked" || connection.chats.some((chat) => chat.removed))
        )
    })

/** Nothing connected on either platform. */
export const EMPTY_CONNECTIONS: ChannelConnections = {slack: null, telegram: null}

export const DIRECT_MESSAGES_CHAT = {name: "Direct messages", type: "dm" as const}

/** A readable message from a rejected action, for the UI's error states. */
export const errorMessage = (error: unknown, fallback: string): string => {
    if (error instanceof Error && error.message.trim()) return error.message
    if (typeof error === "string" && error.trim()) return error
    return fallback
}

/**
 * Actions that do nothing but resolve, for previews (Storybook) and for hosts that have not
 * wired a platform yet. Every mutation leaves the connections unchanged.
 */
export const NOOP_ACTIONS: ChannelsActions = {
    reload: async () => EMPTY_CONNECTIONS,
    loadSetup: async () => ({manifest: null, fields: [], hostedAvailable: true}),
    connectHostedTelegram: async () => {
        throw new Error("The hosted Telegram bot is not available in this preview.")
    },
    countHostedTelegramBindings: async () => 0,
    hostedSlackInstallUrl: async () => null,
    connectCustom: async () => {},
    connectHere: async () => {},
    disconnect: async () => {},
}
