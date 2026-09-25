// @vitest-environment jsdom
import React, {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("@agenta/ui/ui", () => {
    const Wrap = ({children}: {children: React.ReactNode}) => <div>{children}</div>
    return {
        Accordion: Wrap,
        AccordionContent: Wrap,
        AccordionItem: Wrap,
        AccordionTrigger: Wrap,
        Alert: ({message}: {message: string}) => <div role="alert">{message}</div>,
        Button: ({children, onClick, disabled}: React.ComponentProps<"button">) => (
            <button disabled={disabled} onClick={onClick}>
                {children}
            </button>
        ),
        Input: () => <input />,
        PasswordInput: () => <input />,
        Spinner: () => <span />,
        Switch: () => <span />,
    }
})
import {mapConnectionRow, mapSpaceRow, nameSpacesFrom} from "../../src/channels/actions"
import {ChannelConnectionList} from "../../src/channels/ChannelConnectionList"
import {ChannelManagePanel} from "../../src/channels/ChannelManagePanel"
import {NOOP_ACTIONS, connectionLabel, disconnectSubject} from "../../src/channels/helpers"
import type {ChannelConnection, ChannelsActions} from "../../src/channels/types"

const slackRow = (overrides: Record<string, unknown> = {}) => ({
    id: "slack-1",
    channel: "slack",
    flags: {is_hosted: false, is_active: true},
    created_at: "2026-09-08T10:00:00Z",
    data: {team_name: "Agenta", api_app_id: "A0SLACK1"},
    ...overrides,
})

const connection = (overrides: Partial<ChannelConnection> = {}): ChannelConnection => ({
    platform: "telegram",
    kind: "custom",
    status: "connected",
    connectionId: "connection",
    agent: {id: "agent", name: "Slack QA Agent"},
    dm: "allow",
    group: "allow",
    chats: [],
    ...overrides,
})

describe("connection labels", () => {
    it("tells two legacy Slack apps apart by app id when neither stored a bot name", () => {
        const first = mapConnectionRow(slackRow())!
        const second = mapConnectionRow(
            slackRow({id: "slack-2", data: {team_name: "Agenta", api_app_id: "A0SLACK2"}}),
        )!
        expect(first.appId).toBe("A0SLACK1")
        expect(connectionLabel(first)).toBe("Slack app A0SLACK1 · Agenta")
        expect(connectionLabel(second)).toBe("Slack app A0SLACK2 · Agenta")
    })

    it("reads the app id from the routing locator of an older install", () => {
        const row = mapConnectionRow(
            slackRow({
                data: {
                    team_name: "Agenta",
                    connection_locator: {team_id: "T1", api_app_id: "A095VSRP683"},
                },
            }),
        )!
        expect(connectionLabel(row)).toBe("Slack app A095VSRP683 · Agenta")
    })

    it("prefers the stored bot name over the app id", () => {
        const row = mapConnectionRow(
            slackRow({data: {team_name: "Agenta", api_app_id: "A0X", bot_username: "qa_bot"}}),
        )!
        expect(connectionLabel(row)).toBe("@qa_bot · Agenta")
    })

    it("keeps the generic label for a Slack app with neither name nor app id", () => {
        const row = mapConnectionRow(slackRow({data: {team_name: "Agenta"}}))!
        expect(connectionLabel(row)).toBe("your Slack app · Agenta")
    })

    it("renders distinguishable rows in the connection switcher", async () => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true
        const container = document.createElement("div")
        document.body.append(container)
        const root = createRoot(container)
        await act(async () =>
            root.render(
                <ChannelConnectionList
                    connections={[
                        mapConnectionRow(slackRow())!,
                        mapConnectionRow(
                            slackRow({
                                id: "slack-2",
                                data: {team_name: "Agenta", api_app_id: "A0SLACK2"},
                            }),
                        )!,
                    ]}
                    selectedId="slack-1"
                    onSelect={() => {}}
                />,
            ),
        )
        const labels = [...container.querySelectorAll("button")].map(
            (row) => row.querySelector("span.truncate")?.textContent,
        )
        expect(labels).toEqual(["Slack app A0SLACK1 · Agenta", "Slack app A0SLACK2 · Agenta"])
        await act(async () => root.unmount())
        container.remove()
    })
})

describe("disconnectSubject", () => {
    it("names a Telegram bot by its handle", () => {
        expect(disconnectSubject(connection({handle: "@nancypreg29bot"}))).toBe("@nancypreg29bot")
    })

    it("names a Slack app and its workspace", () => {
        expect(
            disconnectSubject(
                connection({platform: "slack", handle: "@qa_bot", workspaceName: "Agenta"}),
            ),
        ).toBe("@qa_bot in Agenta")
        expect(
            disconnectSubject(
                connection({platform: "slack", appId: "A0SLACK1", workspaceName: "Agenta"}),
            ),
        ).toBe("Slack app A0SLACK1 in Agenta")
        expect(disconnectSubject(connection({platform: "slack", workspaceName: "Agenta"}))).toBe(
            "Slack in Agenta",
        )
    })

    it("falls back to the platform when the connection has nothing of its own", () => {
        expect(disconnectSubject(connection({kind: "hosted"}))).toBe("Telegram")
    })
})

describe("space names", () => {
    it("stands in the platform id for a place stored without a name", () => {
        expect(
            mapSpaceRow({
                id: "s1",
                kind: "topic",
                data: {external_locator: {team: "T1", channel: "C0RELEASE"}},
            }),
        ).toEqual({
            id: "s1",
            kind: "topic",
            name: "#C0RELEASE",
            externalId: "C0RELEASE",
            unnamed: true,
        })
        expect(
            mapSpaceRow({id: "s2", kind: "group", data: {external_locator: {chat_id: -100123}}}),
        ).toMatchObject({name: "Group -100123", externalId: "-100123", unnamed: true})
        expect(mapSpaceRow({id: "s3", kind: "topic"})).toMatchObject({name: "Unnamed channel"})
    })

    it("keeps a stored name and never says Untitled", () => {
        expect(
            mapSpaceRow({
                id: "s1",
                kind: "topic",
                name: "release-v115",
                data: {external_locator: {channel: "C1"}},
            }),
        ).toEqual({id: "s1", kind: "topic", name: "release-v115", externalId: "C1"})
    })

    it("fills an unnamed place from discovery by platform id", () => {
        const spaces = [
            {id: "s1", kind: "topic" as const, name: "#C1", externalId: "C1", unnamed: true},
            {id: "s2", kind: "topic" as const, name: "general", externalId: "C2"},
        ]
        const named = nameSpacesFrom(spaces, [
            {
                kind: "topic",
                externalLocator: {team: "T", channel: "C1"},
                displayName: "release-v118",
                isConfigured: true,
                membership: "member",
            },
            {
                kind: "topic",
                externalLocator: {team: "T", channel: "C2"},
                displayName: "renamed",
                isConfigured: true,
                membership: "member",
            },
        ])
        expect(named.map((space) => space.name)).toEqual(["release-v118", "general"])
    })
})

describe("ChannelManagePanel", () => {
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
    })

    const render = async (value: ChannelConnection, overrides: Partial<ChannelsActions> = {}) => {
        await act(async () =>
            root.render(
                <ChannelManagePanel
                    agentName="Slack QA Agent"
                    agentId="agent"
                    connection={value}
                    onConnectHere={async () => {}}
                    onDisconnect={async () => {}}
                    actions={{...NOOP_ACTIONS, ...overrides}}
                />,
            ),
        )
    }
    const button = (text: string) =>
        [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!

    it("names the specific bot in the Disconnect confirmation", async () => {
        await render(connection({handle: "@nancypreg29bot"}))
        await act(async () => button("Disconnect Telegram").click())
        expect(container.textContent).toContain(
            "Disconnect @nancypreg29bot? Slack QA Agent stops answering there.",
        )
        expect(container.textContent).not.toContain("Disconnect Telegram?")
    })

    it("shows a discovered name for a channel first seen through a message", async () => {
        const discoverSpaces = vi.fn().mockResolvedValue([
            {
                kind: "topic",
                externalLocator: {team: "T", channel: "C0RELEASE"},
                displayName: "release-v118",
                isConfigured: true,
                membership: "member",
            },
        ])
        await render(connection({platform: "slack", workspaceName: "Agenta"}), {
            listSpaces: vi.fn().mockResolvedValue([
                {id: "s1", kind: "topic", name: "release-v115", externalId: "C0OLD"},
                {
                    id: "s2",
                    kind: "topic",
                    name: "#C0RELEASE",
                    externalId: "C0RELEASE",
                    unnamed: true,
                },
            ]),
            discoverSpaces,
        })
        const rows = [...container.querySelectorAll('[data-testid="channels-space"]')].map(
            (row) => row.textContent,
        )
        expect(rows).toEqual(["release-v115", "release-v118"])
        expect(discoverSpaces).toHaveBeenCalledTimes(1)
    })

    it("does not call discovery when every place has a name", async () => {
        const discoverSpaces = vi.fn().mockResolvedValue([])
        await render(connection({platform: "slack"}), {
            listSpaces: vi
                .fn()
                .mockResolvedValue([{id: "s1", kind: "topic", name: "general", externalId: "C1"}]),
            discoverSpaces,
        })
        expect(discoverSpaces).not.toHaveBeenCalled()
    })

    it("keeps the id stand-in when discovery fails", async () => {
        await render(connection({platform: "slack"}), {
            listSpaces: vi.fn().mockResolvedValue([
                {
                    id: "s2",
                    kind: "topic",
                    name: "#C0RELEASE",
                    externalId: "C0RELEASE",
                    unnamed: true,
                },
            ]),
            discoverSpaces: vi.fn().mockRejectedValue(new Error("nope")),
        })
        const rows = [...container.querySelectorAll('[data-testid="channels-space"]')].map(
            (row) => row.textContent,
        )
        expect(rows).toEqual(["#C0RELEASE"])
    })
})
