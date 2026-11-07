// @vitest-environment jsdom
import React, {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("@agenta/ui/ui", () => ({
    Alert: ({
        message,
        description,
        ...props
    }: {
        message: string
        description?: React.ReactNode
        "data-testid"?: string
    }) => (
        <div role="alert" data-testid={props["data-testid"]}>
            {message}
            {description}
        </div>
    ),
    SheetFooter: ({children}: {children?: React.ReactNode}) => <div>{children}</div>,
    Button: ({children, onClick, disabled, asChild, ...props}: any) =>
        asChild ? (
            children
        ) : (
            <button disabled={disabled} onClick={onClick} data-testid={props["data-testid"]}>
                {children}
            </button>
        ),
    Input: (props: React.ComponentProps<"input">) => <input {...props} />,
    InputAffix: (props: React.ComponentProps<"input">) => <input {...props} />,
    Textarea: (props: React.ComponentProps<"textarea">) => <textarea {...props} />,
    PasswordInput: (props: React.ComponentProps<"input">) => <input {...props} />,
    Spinner: () => <span />,
    Checkbox: () => <input type="checkbox" />,
    RadioGroup: ({children}: {children?: React.ReactNode}) => <div>{children}</div>,
    RadioGroupItem: () => <input type="radio" />,
    Switch: (props: {"data-testid"?: string; "aria-label"?: string}) => (
        <button data-testid={props["data-testid"]} aria-label={props["aria-label"]} />
    ),
}))
vi.mock("../../src/channels/icons", () => ({AgentaMark: () => null, platformLogo: () => null}))
vi.mock("../../src/channels/qr", () => ({QrCode: () => null}))

import {
    buildAgentChannelsActions,
    connectionsForAgent,
    groupKindsOf,
    mapSpaceRow,
    type ChannelsClientLike,
} from "../../src/channels/actions"
import {ChannelConnectFlow} from "../../src/channels/ChannelConnectFlow"
import {ChannelManagePanel} from "../../src/channels/ChannelManagePanel"
import {CHANNEL_PLATFORMS, NOOP_ACTIONS, summarizeConnection} from "../../src/channels/helpers"
import type {ChannelConnection, ChannelSetupField} from "../../src/channels/types"

const FIELDS: ChannelSetupField[] = [
    {name: "bot_token", label: "Bot token", secret: true, required: true},
]

const INVITE_URL =
    "https://discord.com/oauth2/authorize?client_id=123&scope=bot&permissions=309237763136"

const CONNECTED: ChannelConnection = {
    connectionId: "dc-1",
    platform: "discord",
    kind: "custom",
    status: "connected",
    dm: "allow",
    group: "allow",
    chats: [],
    agent: {id: "agent", name: "QA"},
    handle: "@SupportAgent",
}

let root: Root
let container: HTMLDivElement
beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
})
afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
})

const byTestId = (id: string) => container.querySelector(`[data-testid="${id}"]`)

const type = async (id: string, value: string) => {
    const input = byTestId(id) as HTMLInputElement
    expect(input, id).toBeTruthy()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    await act(async () => {
        setter.call(input, value)
        input.dispatchEvent(new Event("input", {bubbles: true}))
    })
}

const click = async (text: string) => {
    const button = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === text,
    )
    expect(button, text).toBeTruthy()
    await act(async () => button!.click())
}

describe("Discord connect flow", () => {
    const renderFlow = async (overrides = {}) => {
        const onConnected = vi.fn()
        const connectCustom = vi.fn().mockResolvedValue(CONNECTED)
        const discordInviteUrl = vi.fn().mockResolvedValue(INVITE_URL)
        await act(async () =>
            root.render(
                <ChannelConnectFlow
                    platform="discord"
                    agentName="QA"
                    onConnected={onConnected}
                    actions={{
                        ...NOOP_ACTIONS,
                        loadSetup: async () => ({
                            manifest: null,
                            fields: FIELDS,
                            hostedAvailable: false,
                        }),
                        connectCustom,
                        discordInviteUrl,
                        ...overrides,
                    }}
                />,
            ),
        )
        return {onConnected, connectCustom, discordInviteUrl}
    }

    it("opens on the three steps with no method choice", async () => {
        await renderFlow()
        expect(byTestId("channels-method")).toBeNull()
        expect(container.textContent).toContain("Create a bot in Discord")
        expect(container.textContent).toContain("Turn on Message Content Intent")
        expect(container.textContent).toContain("Paste the bot token")
        expect(
            container.querySelector('a[href="https://discord.com/developers/applications"]'),
        ).toBeTruthy()
        expect(byTestId("channels-field-bot_token")).toBeTruthy()
    })

    it("connects, then shows the invite link before finishing", async () => {
        const {onConnected, connectCustom, discordInviteUrl} = await renderFlow()
        await type("channels-field-bot_token", "bot-token")
        await click("Connect bot")

        expect(connectCustom).toHaveBeenCalledWith("discord", {bot_token: "bot-token"})
        expect(discordInviteUrl).toHaveBeenCalledWith("dc-1")
        const link = byTestId("channels-discord-invite-link") as HTMLAnchorElement | null
        expect(link?.getAttribute("href")).toBe(INVITE_URL)
        expect(onConnected).not.toHaveBeenCalled()

        await click("Done")
        expect(onConnected).toHaveBeenCalledTimes(1)
    })

    it("offers a retry when the invite link does not load, without connecting again", async () => {
        const discordInviteUrl = vi
            .fn()
            .mockRejectedValueOnce(new Error("Could not load the invite link."))
            .mockResolvedValueOnce(INVITE_URL)
        const {onConnected, connectCustom} = await renderFlow({discordInviteUrl})
        await type("channels-field-bot_token", "bot-token")
        await click("Connect bot")

        expect(container.textContent).toContain("Could not load the invite link.")
        expect(byTestId("channels-discord-invite-link")).toBeNull()
        expect(onConnected).not.toHaveBeenCalled()

        await click("Try again")
        expect(connectCustom).toHaveBeenCalledTimes(1)
        expect(discordInviteUrl).toHaveBeenCalledTimes(2)
        expect(container.textContent).not.toContain("Could not load the invite link.")
        expect(byTestId("channels-discord-invite-link")?.getAttribute("href")).toBe(INVITE_URL)
    })

    it("treats a setup document with no link as a failed load", async () => {
        const {onConnected} = await renderFlow({discordInviteUrl: vi.fn().mockResolvedValue(null)})
        await type("channels-field-bot_token", "bot-token")
        await click("Connect bot")
        expect(container.textContent).toContain("Could not load the invite link.")
        expect(onConnected).not.toHaveBeenCalled()
    })

    it("shows why Discord refused and keeps the token", async () => {
        const message =
            "Turn on the Message Content intent for this bot in the Discord Developer Portal, then try again."
        const {onConnected} = await renderFlow({
            connectCustom: vi.fn().mockRejectedValue(new Error(message)),
        })
        await type("channels-field-bot_token", "bot-token")
        await click("Connect bot")
        expect(container.textContent).toContain(message)
        expect((byTestId("channels-field-bot_token") as HTMLInputElement).value).toBe("bot-token")
        expect(onConnected).not.toHaveBeenCalled()
    })
})

describe("Discord actions", () => {
    const fixture = () => {
        const client = {
            fetchChannelSetup: vi.fn().mockResolvedValue({
                setup: {fields: FIELDS, hosted_available: false},
            }),
            fetchChannelConnectionSetup: vi.fn().mockResolvedValue({
                setup: {document: {format: "url", content: INVITE_URL, link: INVITE_URL}},
            }),
            createChannelConnection: vi.fn().mockResolvedValue({
                connection: {
                    id: "dc-1",
                    channel: "discord",
                    flags: {is_active: true},
                    data: {
                        connection_locator: {application_id: "123"},
                        bot_user_id: "456",
                        bot_username: "SupportAgent",
                        application_name: "Support agent",
                    },
                },
            }),
            queryChannelAgents: vi.fn().mockResolvedValue({agents: []}),
            createChannelAgent: vi.fn().mockResolvedValue({}),
        }
        const actions = buildAgentChannelsActions({
            client: client as unknown as ChannelsClientLike,
            projectId: () => "project-1",
            appId: "app-1",
            resolveAgentName: () => null,
            hostedSlackInstallUrl: () => null,
        })
        return {client, actions}
    }

    it("sends the bot token as a credential on the discord channel", async () => {
        const {client, actions} = fixture()
        const created = await actions.connectCustom("discord", {bot_token: "bot-token"})
        expect(client.createChannelConnection).toHaveBeenCalledWith(
            {connection: {channel: "discord", data: {}, credentials: {bot_token: "bot-token"}}},
            {queryParams: {project_id: "project-1"}},
        )
        expect(created?.platform).toBe("discord")
        expect(created?.handle).toBe("@SupportAgent")
    })

    it("reads the invite link from the connection's setup document", async () => {
        const {client, actions} = fixture()
        expect(await actions.discordInviteUrl("dc-1")).toBe(INVITE_URL)
        expect(client.fetchChannelConnectionSetup).toHaveBeenCalledWith(
            {connection_id: "dc-1"},
            {queryParams: {project_id: "project-1"}},
        )
    })

    it("tells two Discord channels apart, by stored name or by channel id", () => {
        const row = (id: string, channelId: string, name?: string) =>
            mapSpaceRow({
                id,
                kind: "topic",
                ...(name ? {name} : {}),
                data: {external_locator: {guild_id: "900", channel_id: channelId, thread_id: ""}},
            })
        const named = [row("s1", "111", "support"), row("s2", "222", "sales")]
        expect(named.map((space) => space?.name)).toEqual(["support", "sales"])
        expect(named.map((space) => space?.externalId)).toEqual(["111", "222"])
        const unnamed = [row("s3", "111"), row("s4", "222")]
        expect(unnamed.map((space) => space?.name)).toEqual(["Channel 111", "Channel 222"])
    })

    it("answers in channels with the group switch, and lists Discord last", () => {
        expect(groupKindsOf("discord")).toEqual(["group", "topic"])
        expect(CHANNEL_PLATFORMS.at(-1)).toBe("discord")
        const out = connectionsForAgent([CONNECTED], "agent")
        expect(out.discord).toBe(CONNECTED)
        expect(out.agentConnections?.discord).toEqual([CONNECTED])
    })
})

describe("Discord row summary", () => {
    it("offers to connect when nothing is connected", () => {
        const row = summarizeConnection("discord", null, "agent")
        expect(row.action).toBe("connect")
        expect(row.sub).toBe("Chat with the agent in your Discord server")
    })

    it("asks for a new token when the token was revoked", () => {
        const row = summarizeConnection("discord", {...CONNECTED, status: "revoked"}, "agent")
        expect(row.sub).toBe("Bot token revoked · update it")
        expect(row.needsAttention).toBe(true)
    })

    it("offers to connect here when another agent answers", () => {
        const row = summarizeConnection(
            "discord",
            {...CONNECTED, agent: {id: "other", name: "Sales"}},
            "agent",
        )
        expect(row.action).toBe("connect-here")
        expect(row.sub).toBe("Connected to Sales")
    })

    it("counts channels, not groups", () => {
        const row = summarizeConnection(
            "discord",
            {...CONNECTED, chats: [{name: "support", type: "channel"}]},
            "agent",
        )
        expect(row.sub).toBe("@SupportAgent · 1 channel + DMs")
    })
})

describe("Discord manage panel", () => {
    const renderPanel = async (connection: ChannelConnection, overrides = {}) =>
        act(async () =>
            root.render(
                <ChannelManagePanel
                    agentName="QA"
                    agentId="agent"
                    connection={connection}
                    onConnectHere={async () => {}}
                    onDisconnect={async () => {}}
                    actions={{
                        ...NOOP_ACTIONS,
                        discordInviteUrl: async () => INVITE_URL,
                        ...overrides,
                    }}
                />,
            ),
        )

    it("offers the invite link again and speaks of channels", async () => {
        await renderPanel(CONNECTED)
        const link = byTestId("channels-discord-invite-link") as HTMLAnchorElement | null
        expect(link?.getAttribute("href")).toBe(INVITE_URL)
        expect(container.textContent).toContain("Channels it’s in")
        expect(container.textContent).toContain(
            "Add @SupportAgent to a server and mention it in a channel. The channel appears here.",
        )
        expect(container.textContent).not.toContain("Telegram")
    })

    it("shows an error and a retry when the invite link does not load", async () => {
        const discordInviteUrl = vi
            .fn()
            .mockRejectedValueOnce(new Error("Could not load the invite link."))
            .mockResolvedValueOnce(INVITE_URL)
        await renderPanel(CONNECTED, {discordInviteUrl})
        expect(container.textContent).toContain("Could not load the invite link.")
        await act(async () => (byTestId("channels-discord-invite-retry") as HTMLElement).click())
        expect(discordInviteUrl).toHaveBeenCalledTimes(2)
        expect(container.textContent).not.toContain("Could not load the invite link.")
        expect(byTestId("channels-discord-invite-link")?.getAttribute("href")).toBe(INVITE_URL)
    })

    it("points a revoked bot at the Discord Developer Portal", async () => {
        await renderPanel({...CONNECTED, status: "revoked"})
        expect(container.textContent).toContain("Discord revoked the bot token")
        expect(container.textContent).toContain(
            "QA cannot answer there until you paste a new token from the Discord Developer Portal.",
        )
        expect(container.textContent).not.toContain("BotFather")
    })
})
