import type {
    ChannelConnection,
    ChannelConnections,
    ChannelPlatform,
    ChannelScope,
    ChannelSetupField,
    ChannelsActions,
    ChannelToolSettings,
} from "./types"

export const platformLabel = (platform: ChannelPlatform): string =>
    platform === "slack" ? "Slack" : "Telegram"

/** The handle shown for a connection: the shared Agenta bot, or the customer's own. */
export const botHandle = (connection: ChannelConnection, hostedHandle = "@agenta"): string => {
    if (connection.handle) return connection.handle
    if (connection.kind === "hosted") return hostedHandle
    // A Slack app installed before bot names were stored has only its app id to go by.
    if (connection.platform === "slack") {
        return connection.appId ? `Slack app ${connection.appId}` : "your Slack app"
    }
    return "your bot"
}

/** How one of several connections on a platform is told apart: its handle, and on Slack the
 * workspace it is installed in. */
export const connectionLabel = (
    connection: ChannelConnection,
    hostedHandle = "@agenta",
): string => {
    const handle = botHandle(connection, hostedHandle)
    return connection.platform === "slack" && connection.workspaceName
        ? `${handle} · ${connection.workspaceName}`
        : handle
}

/**
 * The connection a Disconnect confirmation names: the bot or app, and on Slack the workspace,
 * so with several connections on one platform the question says which one goes. Falls back to
 * the platform when the connection has nothing of its own to be called by.
 */
export const disconnectSubject = (connection: ChannelConnection): string => {
    const platform = platformLabel(connection.platform)
    const own =
        connection.handle ??
        (connection.kind === "hosted"
            ? null
            : connection.platform === "slack" && connection.appId
              ? `Slack app ${connection.appId}`
              : null)
    const workspace = connection.platform === "slack" ? connection.workspaceName : null
    if (own && workspace) return `${own} in ${workspace}`
    if (own) return own
    if (workspace) return `${platform} in ${workspace}`
    return platform
}

/**
 * Every connection on a platform that answers as the agent whose page is open, the summarized
 * one first. A pending hosted link answers nowhere yet, so it is left out. Falls back to the
 * summarized connection alone when the host did not list them.
 */
export const agentConnectionsOf = (
    connections: ChannelConnections,
    platform: ChannelPlatform,
): ChannelConnection[] => {
    const primary = connections[platform]
    const all = connections.agentConnections?.[platform] ?? (primary ? [primary] : [])
    return all.filter((connection) => connection.status !== "pending")
}

/** The handle `/invite` takes in Slack: what Slack reported for the bot, else "@Agenta". */
export const slackInviteHandle = (connection: ChannelConnection): string =>
    connection.handle || "@Agenta"

/**
 * Where a connection points, relative to the agent whose page is open:
 * "here" = it answers as this agent; "elsewhere" = it answers as another agent;
 * "unassigned" = the connection has no answering agent yet (repairable with "connect here");
 * "unknown" = the host did not resolve the answering agent (treated like "here").
 */
export const connectionScope = (
    connection: ChannelConnection,
    agentId: string | undefined,
): ChannelScope => {
    if (!agentId || connection.agent === undefined) return "unknown"
    // Resolved, and no channel agent at all: the connection answers as nobody yet.
    if (connection.agent === null) return "unassigned"
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
            sub:
                platform === "telegram"
                    ? "Bot token revoked · update it"
                    : "App uninstalled · reconnect",
            subClass: "text-colorError",
            dotClass: "bg-colorError",
            connected: true,
            needsAttention: true,
            action: "manage",
        }
    }

    // The hosted link is minted before any chat taps Start. Nothing answers yet, so the row
    // leads back into the connect flow rather than into a manage view with nothing in it.
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

    if (connectionScope(connection, agentId) === "unassigned") {
        return {
            sub: "Not answering as any agent yet · connect here",
            subClass: "text-colorWarning",
            dotClass: "bg-colorWarning",
            connected: true,
            needsAttention: true,
            action: "connect-here",
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
            (connection.status === "revoked" ||
                connection.agent === null ||
                connection.chats.some((chat) => chat.removed))
        )
    })

/** The channel tool settings of a bot that never saved any. */
export const DEFAULT_TOOL_SETTINGS: ChannelToolSettings = {
    canPostOutsideConversation: true,
    readableSpaceKeys: null,
}

/** Nothing connected on either platform. */
export const EMPTY_CONNECTIONS: ChannelConnections = {slack: null, telegram: null}

export const DIRECT_MESSAGES_CHAT = {name: "Direct messages", type: "dm" as const}

/** Slack's manifest limits (docs.slack.dev/reference/app-manifest); the backend enforces them too. */
export const SLACK_APP_NAME_MAX = 35
export const SLACK_BOT_HANDLE_MAX = 80
export const SLACK_APP_DESCRIPTION_MAX = 140

/** Keep only the characters Slack allows in a bot handle. Case is kept, so the handle reads like
 * the name it came from. */
export const slackHandleFrom = (value: string): string =>
    value.replace(/[^A-Za-z0-9._-]/g, "").slice(0, SLACK_BOT_HANDLE_MAX)

/** The name, handle and description a new Slack app starts with, from the agent it answers as. */
export const defaultSlackIdentity = (agentName: string, agentDescription?: string | null) => {
    const name = agentName.trim().slice(0, SLACK_APP_NAME_MAX).trim()
    const description = (agentDescription ?? "").replace(/\s+/g, " ").trim()
    return {
        name,
        handle: slackHandleFrom(name),
        description: (description || `Talk to ${name || "your agent"} in Slack.`)
            .slice(0, SLACK_APP_DESCRIPTION_MAX)
            .trim(),
    }
}

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
    listSpaces: async () => [],
    discoverSpaces: async () => [],
    addSpace: async () => {},
    readBehavior: async () => ({dm: true, group: true}),
    writeBehavior: async () => {},
    readAllowedUsers: async () => [],
    writeAllowedUsers: async () => {},
    updateCredentials: async () => {},
    readToolSettings: async () => DEFAULT_TOOL_SETTINGS,
    writeToolSettings: async () => {},
    listReadableChannels: async () => [],
}

/** The field's declared pattern error when a non-empty value does not match it. */
export const fieldPatternError = (field: ChannelSetupField, value: string): string | null => {
    const trimmed = value.trim()
    if (!field.pattern || !trimmed) return null
    let matches = true
    try {
        matches = new RegExp(field.pattern).test(trimmed)
    } catch {
        // An unparseable pattern is the backend's to enforce; never block the form on it.
        return null
    }
    return matches ? null : field.patternError || `${field.label} is not valid.`
}

/**
 * Whether a connection is live for the agent whose page is open: connected (not pending,
 * not revoked) and answering as this agent.
 */
export const isLiveForAgent = (
    connection: ChannelConnection | null | undefined,
    agentId: string | undefined,
): boolean => {
    if (!connection || connection.status !== "connected") return false
    const scope = connectionScope(connection, agentId)
    return scope === "here" || scope === "unknown"
}
