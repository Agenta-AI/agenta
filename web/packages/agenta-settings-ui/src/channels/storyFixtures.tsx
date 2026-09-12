import {useEffect, useState, type ReactNode} from "react"

import {Button} from "@agenta/ui/ui"

import {ChannelConnectFlow} from "./ChannelConnectFlow"
import {ChannelsPage} from "./ChannelsPage"
import {DIRECT_MESSAGES_CHAT, EMPTY_CONNECTIONS} from "./helpers"
import type {
    ChannelBehaviorState,
    ChannelConnection,
    ChannelConnections,
    ChannelInstallMode,
    ChannelPlatform,
    ChannelSetupInfo,
    ChannelSpace,
    ChannelSpaceCandidate,
    ChannelsActions,
    HostedTelegramLink,
} from "./types"

/**
 * Fixtures and fake actions for the Channels stories.
 *
 * The components never call an api-client themselves: the host passes a `ChannelsActions`
 * object and the connections it loaded. `createChannelStoryActions` gives Storybook a real
 * implementation of that contract, backed by an in-memory fixture, so every flow in the
 * stories is clickable and ends in the same state the product would reach.
 *
 * This file is a story helper. It is not exported from the package barrel.
 */

export const AGENT_ID = "agent-support"
export const AGENT_NAME = "Support agent"
export const WORKSPACE_NAME = "Acme"
export const HOSTED_HANDLE = "@agenta"

/** The agent a connection points at when it does not answer as the open agent. */
export const OTHER_AGENT = {id: "agent-release-notes", name: "Release notes agent"}

export const TELEGRAM_LINK: HostedTelegramLink = {
    url: "https://t.me/newagentabot?start=demo-token",
    expiresInSeconds: 1800,
    connectionId: "c1",
}

export const TELEGRAM_SETUP: ChannelSetupInfo = {
    manifest: null,
    hostedAvailable: true,
    fields: [
        {
            name: "bot_token",
            label: "Bot token",
            secret: true,
            required: true,
            help: "From @BotFather",
        },
    ],
}

const SLACK_MANIFEST = `display_information:
  name: Support agent
features:
  bot_user:
    display_name: Support agent
    always_online: true
oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - channels:history
      - chat:write
      - im:history
      - im:write
settings:
  event_subscriptions:
    request_url: https://cloud.agenta.ai/api/channels/slack/events
    bot_events:
      - app_mention
      - message.im
`

export const SLACK_SETUP: ChannelSetupInfo = {
    manifest: SLACK_MANIFEST,
    hostedAvailable: true,
    fields: [
        {name: "bot_token", label: "Bot token", secret: true, required: true},
        {name: "signing_secret", label: "Signing secret", secret: true, required: true},
    ],
}

export const telegramHere: ChannelConnection = {
    connectionId: "cx-telegram",
    platform: "telegram",
    kind: "hosted",
    status: "connected",
    dm: "allow",
    group: "allow",
    chats: [DIRECT_MESSAGES_CHAT, {name: "Support squad", type: "group"}],
    agent: {id: AGENT_ID, name: AGENT_NAME},
    connectedAt: "2026-08-21T10:12:00.000Z",
}

export const telegramElsewhere: ChannelConnection = {
    ...telegramHere,
    agent: OTHER_AGENT,
}

export const telegramBotRemoved: ChannelConnection = {
    ...telegramHere,
    chats: [DIRECT_MESSAGES_CHAT, {name: "Support squad", type: "group", removed: true}],
}

export const slackHere: ChannelConnection = {
    connectionId: "cx-slack",
    platform: "slack",
    kind: "hosted",
    status: "connected",
    dm: "allow",
    group: "allow",
    chats: [DIRECT_MESSAGES_CHAT, {name: "#support", type: "channel"}],
    agent: {id: AGENT_ID, name: AGENT_NAME},
    connectedAt: "2026-07-03T09:00:00.000Z",
}

export const slackCustomHere: ChannelConnection = {
    ...slackHere,
    kind: "custom",
    connectedAt: "2026-08-30T16:45:00.000Z",
}

export const slackRevoked: ChannelConnection = {
    ...slackHere,
    status: "revoked",
}

/** The customer's own Telegram bot, so the panel carries a Token row. */
export const telegramCustomHere: ChannelConnection = {
    ...telegramHere,
    connectionId: "cx-telegram-own",
    kind: "custom",
    handle: "@acme_support_bot",
    chats: [DIRECT_MESSAGES_CHAT],
    connectedAt: "2026-09-02T08:30:00.000Z",
}

/** Telegram threw the bot token away: the panel leads with the update form. */
export const telegramRevoked: ChannelConnection = {
    ...telegramCustomHere,
    status: "revoked",
}

/** The hosted link is minted, but no chat has tapped Start yet. */
export const telegramPending: ChannelConnection = {
    ...telegramHere,
    status: "pending",
    chats: [],
}

// --- where each fixture connection answers ---------------------------------- //

export const SLACK_SPACES: ChannelSpace[] = [
    {id: "sp-support", kind: "topic", name: "#support"},
    {id: "sp-oncall", kind: "topic", name: "#eng-oncall"},
    {id: "sp-dm", kind: "private", name: "Direct messages"},
]

export const TELEGRAM_SPACES: ChannelSpace[] = [
    {id: "sp-tg-dm", kind: "private", name: "Direct messages"},
    {id: "sp-tg-ops", kind: "group", name: "Ops team"},
]

/** What the Slack app can see: two rooms it was added to that have no space row yet. */
export const SLACK_CANDIDATES: ChannelSpaceCandidate[] = [
    {
        kind: "topic",
        externalLocator: {channel: "C0SUPPORT"},
        displayName: "#support",
        isConfigured: true,
    },
    {
        kind: "topic",
        externalLocator: {channel: "C0PRODUCT"},
        displayName: "#product",
        isConfigured: false,
    },
    {
        kind: "topic",
        externalLocator: {channel: "C0SALES"},
        displayName: "#sales-questions",
        isConfigured: false,
    },
]

const DEFAULT_SPACES: Record<string, ChannelSpace[]> = {
    "cx-slack": SLACK_SPACES,
    "cx-telegram": TELEGRAM_SPACES,
    "cx-telegram-own": [TELEGRAM_SPACES[0]],
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export interface ChannelStoryActionsOptions {
    /** The fixture the actions read and mutate. */
    connections?: ChannelConnections
    /** Every action resolves after this delay, so the busy states are visible. */
    latencyMs?: number
    /** The declaration `loadSetup` returns per platform. */
    setup?: Partial<Record<ChannelPlatform, ChannelSetupInfo>>
    /** The link `connectHostedTelegram` mints. `null` makes it reject. */
    telegramLink?: HostedTelegramLink | null
    /** The message the rejected `connectHostedTelegram` carries. */
    telegramError?: string
    /** How long the wait runs before a /start binds a chat. Undefined = never binds. */
    telegramBindAfterMs?: number
    /** What `hostedSlackInstallUrl` returns. `null` = this deployment has no hosted app. */
    slackInstallUrl?: string | null
    /** How long after the install starts the Slack connection appears. Undefined = never. */
    slackConnectsAfterMs?: number
    connectCustomError?: string
    connectHereError?: string
    disconnectError?: string
    /** The places each connection answers in, keyed by connection id. */
    spaces?: Record<string, ChannelSpace[]>
    /** What "Add channel" discovers, keyed by connection id. */
    candidates?: Record<string, ChannelSpaceCandidate[]>
    /** The switches each connection starts with, keyed by connection id. Default: both on. */
    behavior?: Record<string, ChannelBehaviorState>
    /** The allowed Telegram accounts, keyed by connection id. Default: everyone. */
    allowedUsers?: Record<string, string[]>
    spacesError?: string
    discoverError?: string
    addSpaceError?: string
    behaviorError?: string
    allowedUsersError?: string
    credentialsError?: string
    /** Called with the fixture after every change, so a host component can re-render. */
    onChange?: (connections: ChannelConnections) => void
}

export interface ChannelStoryActions {
    actions: ChannelsActions
    /** The current fixture. */
    read: () => ChannelConnections
}

/**
 * A working `ChannelsActions` over an in-memory fixture. Each action resolves after a short
 * delay, mutates the fixture, and reports the new state through `onChange`.
 */
export const createChannelStoryActions = (
    options: ChannelStoryActionsOptions = {},
): ChannelStoryActions => {
    const {
        latencyMs = 400,
        setup = {},
        telegramLink = TELEGRAM_LINK,
        telegramError = "The hosted Telegram bot is not available on this deployment.",
        telegramBindAfterMs,
        slackInstallUrl = null,
        slackConnectsAfterMs,
        connectCustomError,
        connectHereError,
        disconnectError,
        spacesError,
        discoverError,
        addSpaceError,
        behaviorError,
        allowedUsersError,
        credentialsError,
        onChange,
    } = options

    let store: ChannelConnections = options.connections ?? EMPTY_CONNECTIONS

    const spaces: Record<string, ChannelSpace[]> = {...DEFAULT_SPACES, ...options.spaces}
    const candidates: Record<string, ChannelSpaceCandidate[]> = {
        "cx-slack": SLACK_CANDIDATES,
        ...options.candidates,
    }
    const behavior: Record<string, ChannelBehaviorState> = {...options.behavior}
    const allowedUsers: Record<string, string[]> = {...options.allowedUsers}
    let nextSpaceId = 0

    const write = (next: ChannelConnections) => {
        store = next
        onChange?.(store)
    }

    // The first read is the baseline the flow takes when it mints the link; the reads after
    // it are the polls, so the clock starts when the user begins to wait.
    let telegramReads = 0
    let telegramWaitStartedAt: number | null = null

    const actions: ChannelsActions = {
        reload: async () => {
            await delay(latencyMs)
            return store
        },
        loadSetup: async (platform) => {
            await delay(latencyMs)
            return setup[platform] ?? {manifest: null, fields: [], hostedAvailable: true}
        },
        connectHostedTelegram: async () => {
            await delay(latencyMs)
            if (!telegramLink) throw new Error(telegramError)
            return telegramLink
        },
        countHostedTelegramBindings: async () => {
            await delay(latencyMs)
            telegramReads += 1
            if (telegramReads === 1 || telegramBindAfterMs === undefined) return 0
            if (telegramWaitStartedAt === null) telegramWaitStartedAt = Date.now()
            if (Date.now() - telegramWaitStartedAt < telegramBindAfterMs) return 0
            write({...store, telegram: store.telegram ?? telegramHere})
            return 1
        },
        hostedSlackInstallUrl: async () => {
            await delay(latencyMs)
            if (slackInstallUrl && slackConnectsAfterMs !== undefined) {
                setTimeout(
                    () => write({...store, slack: store.slack ?? slackHere}),
                    slackConnectsAfterMs,
                )
            }
            return slackInstallUrl
        },
        connectCustom: async (platform) => {
            await delay(latencyMs)
            if (connectCustomError) throw new Error(connectCustomError)
            const connection: ChannelConnection = {
                ...(platform === "slack" ? slackCustomHere : telegramHere),
                kind: "custom",
                agent: {id: AGENT_ID, name: AGENT_NAME},
            }
            write({...store, [platform]: connection})
        },
        connectHere: async (platform) => {
            await delay(latencyMs)
            if (connectHereError) throw new Error(connectHereError)
            const current = store[platform]
            if (!current) return
            write({...store, [platform]: {...current, agent: {id: AGENT_ID, name: AGENT_NAME}}})
        },
        disconnect: async (platform) => {
            await delay(latencyMs)
            if (disconnectError) throw new Error(disconnectError)
            write({...store, [platform]: null})
        },
        listSpaces: async (connectionId) => {
            await delay(latencyMs)
            if (spacesError) throw new Error(spacesError)
            return spaces[connectionId] ?? []
        },
        discoverSpaces: async (connectionId) => {
            await delay(latencyMs)
            if (discoverError) throw new Error(discoverError)
            const known = new Set((spaces[connectionId] ?? []).map((space) => space.name))
            return (candidates[connectionId] ?? []).map((candidate) => ({
                ...candidate,
                isConfigured: candidate.isConfigured || known.has(candidate.displayName),
            }))
        },
        addSpace: async (connectionId, candidate) => {
            await delay(latencyMs)
            if (addSpaceError) throw new Error(addSpaceError)
            nextSpaceId += 1
            const added: ChannelSpace = {
                id: `sp-added-${nextSpaceId}`,
                kind: candidate.kind,
                name: candidate.displayName,
            }
            const current = spaces[connectionId] ?? []
            // A new room sits above the direct-messages row, as the backend orders them.
            const dm = current.findIndex((space) => space.kind === "private")
            spaces[connectionId] =
                dm < 0
                    ? [...current, added]
                    : [...current.slice(0, dm), added, ...current.slice(dm)]
        },
        readBehavior: async (_platform, connectionId) => {
            await delay(latencyMs)
            return behavior[connectionId] ?? {dm: true, group: true}
        },
        writeBehavior: async (_platform, connectionId, next) => {
            await delay(latencyMs)
            if (behaviorError) throw new Error(behaviorError)
            behavior[connectionId] = next
        },
        readAllowedUsers: async (connectionId) => {
            await delay(latencyMs)
            return allowedUsers[connectionId] ?? []
        },
        writeAllowedUsers: async (connectionId, ids) => {
            await delay(latencyMs)
            if (allowedUsersError) throw new Error(allowedUsersError)
            allowedUsers[connectionId] = ids
        },
        updateCredentials: async (connectionId) => {
            await delay(latencyMs)
            if (credentialsError) throw new Error(credentialsError)
            // A good token brings the connection back: the panel re-reads it as active.
            for (const platform of ["slack", "telegram"] as const) {
                const current = store[platform]
                if (current?.connectionId === connectionId && current.status === "revoked") {
                    write({...store, [platform]: {...current, status: "connected"}})
                }
            }
        },
    }

    return {actions, read: () => store}
}

export interface InlinePanelProps {
    title: string
    subtitle?: string
    onClose: () => void
    children: ReactNode
}

/**
 * The story stand-in for the host's sliding panel: a bordered box with the same title,
 * subtitle and close affordance. The product renders a drawer on desktop and a sheet on /m;
 * neither is needed to review what the panel holds.
 */
export const InlinePanel = ({title, subtitle, onClose, children}: InlinePanelProps) => (
    <div className="flex w-full max-w-[520px] flex-col overflow-hidden rounded-xl border border-solid border-colorBorderSecondary bg-colorBgContainer">
        <div className="flex items-start justify-between gap-3 border-0 border-b border-solid border-colorBorderSecondary px-4 py-3">
            <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium text-colorText">{title}</span>
                {subtitle ? (
                    <span className="truncate text-xs text-colorTextSecondary">{subtitle}</span>
                ) : null}
            </div>
            <Button variant="outline" size="sm" onClick={onClose}>
                Close
            </Button>
        </div>
        <div className="p-4">{children}</div>
    </div>
)

/**
 * Holds `window.open` for as long as the story is mounted and shows what was asked for.
 * The hosted Slack step opens the install redirect in a new tab; in Storybook the URL is a
 * placeholder, so the story reports the call instead of leaving the page.
 */
export const CapturePopups = ({children}: {children: ReactNode}) => {
    const [opened, setOpened] = useState<string[]>([])
    useEffect(() => {
        const real = window.open
        window.open = ((url?: string | URL) => {
            setOpened((list) => [...list, String(url ?? "")])
            return null
        }) as typeof window.open
        return () => {
            window.open = real
        }
    }, [])
    return (
        <div className="flex flex-col gap-2">
            {children}
            {opened.length ? (
                <p className="m-0 rounded-md border border-solid border-colorBorderSecondary bg-colorFillQuaternary p-2 text-xs text-colorTextSecondary">
                    The story held these <code>window.open</code> calls: {opened.join(", ")}
                </p>
            ) : null}
        </div>
    )
}

export interface ConnectFlowHostProps {
    platform: ChannelPlatform
    /** Which tab the flow opens on. */
    mode?: ChannelInstallMode
    options?: ChannelStoryActionsOptions
    pollIntervalMs?: number
    /** Wrap the flow so the hosted Slack redirect does not leave Storybook. */
    capturePopups?: boolean
}

/**
 * A connect flow inside the story panel, with the fake actions wired. Close and re-open the
 * panel to run a flow again from the start.
 */
export const ConnectFlowHost = ({
    platform,
    mode = "hosted",
    options,
    pollIntervalMs,
    capturePopups = false,
}: ConnectFlowHostProps) => {
    const [open, setOpen] = useState(true)
    const [connected, setConnected] = useState(false)
    // One actions object per run: the flow keeps it in effect dependencies, and a fresh one
    // also resets the fake bind clock when the reader re-opens the panel.
    const [run, setRun] = useState(() => ({id: 0, ...createChannelStoryActions(options)}))
    const name = platform === "slack" ? "Slack" : "Telegram"

    if (!open) {
        return (
            <Button
                variant="outline"
                onClick={() => {
                    setConnected(false)
                    setRun((current) => ({
                        id: current.id + 1,
                        ...createChannelStoryActions(options),
                    }))
                    setOpen(true)
                }}
            >
                Connect {name}
            </Button>
        )
    }

    const flow = (
        <ChannelConnectFlow
            key={run.id}
            platform={platform}
            agentName={AGENT_NAME}
            workspaceName={WORKSPACE_NAME}
            hostedHandle={HOSTED_HANDLE}
            actions={run.actions}
            initialMode={mode}
            pollIntervalMs={pollIntervalMs}
            onConnected={() => setConnected(true)}
        />
    )

    return (
        <InlinePanel
            title={`Connect ${name}`}
            subtitle={`${AGENT_NAME} · ${platform === "slack" ? WORKSPACE_NAME : "Telegram"}`}
            onClose={() => setOpen(false)}
        >
            {capturePopups ? <CapturePopups>{flow}</CapturePopups> : flow}
            {connected ? (
                <p
                    className="m-0 mt-4 rounded-md border border-solid border-colorSuccessBorder bg-colorSuccessBg p-2 text-xs text-colorText"
                    data-testid="story-connected"
                >
                    The flow reported a connection. The host reloads here and the panel shows the
                    manage view.
                </p>
            ) : null}
        </InlinePanel>
    )
}

export interface ChannelsPageHostProps {
    /** The connections the page starts with. */
    initial?: ChannelConnections
    loading?: boolean
    options?: ChannelStoryActionsOptions
}

/**
 * The channels card with state. The host owns the connections, as the app does: every action
 * mutates the fixture and the card and panel re-render from it.
 */
export const ChannelsPageHost = ({
    initial = EMPTY_CONNECTIONS,
    loading = false,
    options,
}: ChannelsPageHostProps) => {
    const [connections, setConnections] = useState(initial)
    const [{actions}] = useState(() =>
        createChannelStoryActions({...options, connections: initial, onChange: setConnections}),
    )

    return (
        <div className="w-full max-w-[520px]">
            <ChannelsPage
                agentId={AGENT_ID}
                agentName={AGENT_NAME}
                workspaceName={WORKSPACE_NAME}
                hostedHandle={HOSTED_HANDLE}
                connections={connections}
                loading={loading}
                actions={actions}
                renderPanel={({open, title, subtitle, onClose, children}) =>
                    open ? (
                        <InlinePanel title={title} subtitle={subtitle} onClose={onClose}>
                            {children}
                        </InlinePanel>
                    ) : null
                }
            />
        </div>
    )
}
