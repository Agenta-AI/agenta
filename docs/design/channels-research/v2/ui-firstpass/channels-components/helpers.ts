import type {ChannelConnection, ChannelConnections, ChannelPlatform} from "./types"

export const platformLabel = (platform: ChannelPlatform): string =>
    platform === "slack" ? "Slack" : "Telegram"

/** The handle shown for a connection: the shared Agenta bot, or the customer's own. */
export const botHandle = (connection: ChannelConnection): string => {
    if (connection.kind === "hosted") return "@agenta"
    return connection.platform === "slack" ? "@agent0" : "@agent0_bot"
}

export interface ChannelRowSummary {
    /** One-line status/description under the platform name. */
    sub: string
    /** Tailwind class for the subtitle colour. */
    subClass: string
    /** Tailwind class for the status dot, or "" when there is no dot (not connected). */
    dotClass: string
    connected: boolean
    needsAttention: boolean
}

/** Derive the channels-card row summary from a connection (or its absence). */
export const summarizeConnection = (
    platform: ChannelPlatform,
    connection: ChannelConnection | null,
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
        }
    }

    if (connection.status === "revoked") {
        return {
            sub: "Credential revoked · reconnect",
            subClass: "text-colorError",
            dotClass: "bg-colorError",
            connected: true,
            needsAttention: true,
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

/**
 * A placeholder seed for local-state prototyping. Hosts may pass their own `initialConnections`;
 * this is the fallback used by the desktop/mobile bindings until the backend is wired.
 */
export const EMPTY_CONNECTIONS: ChannelConnections = {slack: null, telegram: null}

export const DIRECT_MESSAGES_CHAT = {name: "Direct messages", type: "dm" as const}
