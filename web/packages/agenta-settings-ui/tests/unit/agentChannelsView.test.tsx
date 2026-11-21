// @vitest-environment jsdom
/**
 * The Channels page of an agent (A07, A08): connected channels first, then the ones to add.
 * "Manage" and "Connect" open the production views in place under "Channels › <platform>", and
 * "Channels" in the breadcrumb returns to the list. API and Embed open the same way.
 */
import React, {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const phone = vi.hoisted(() => ({value: false}))
vi.mock("@agenta/ui/phone", async (original) => ({
    ...(await original<object>()),
    useIsPhone: () => phone.value,
}))
vi.mock("../../src/channels/icons", () => ({AgentaMark: () => null, platformLogo: () => null}))
vi.mock("../../src/channels/lazyPanel", () => ({
    lazyPanel: () => () => (props: {connection?: {platform: string}; platform?: string}) => (
        <div data-testid="inner-view">{props.connection?.platform ?? props.platform}</div>
    ),
}))

import {AgentChannelsView} from "../../src/channels/AgentChannelsView"
import {EMPTY_CONNECTIONS, NOOP_ACTIONS} from "../../src/channels/helpers"
import {
    AGENT_ID,
    AGENT_NAME,
    slackHere,
    slackRevoked,
    telegramBotRemoved,
    telegramPending,
    telegramRevoked,
} from "../../src/channels/storyFixtures"
import type {ChannelConnections} from "../../src/channels/types"

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
    phone.value = false
})

const render = async (connections: ChannelConnections, extra = {}) => {
    await act(async () =>
        root.render(
            <AgentChannelsView
                agentId={AGENT_ID}
                agentName={AGENT_NAME}
                connections={connections}
                actions={NOOP_ACTIONS}
                {...extra}
            />,
        ),
    )
}

const row = (platform: string) =>
    container.querySelector<HTMLElement>(`[data-testid="agent-channels-${platform}"]`)!
const groups = () => [...container.querySelectorAll("h3")].map((h) => h.textContent)

describe("AgentChannelsView", () => {
    it("lists the connected channel first and the others under Add a channel", async () => {
        await render({...EMPTY_CONNECTIONS, slack: slackHere})
        expect(container.textContent).toContain(
            `A channel lets people talk to ${AGENT_NAME} in the chat app they already use.`,
        )
        expect(groups()).toEqual(["Connected", "Add a channel"])
        expect(row("slack").textContent).toContain("Manage")
        expect(row("slack").textContent).not.toContain("Needs attention")
        expect(row("telegram").textContent).toContain("Connect")
        // A connected channel is one button; a channel to add has its own Connect button (A07).
        expect(row("slack").tagName).toBe("BUTTON")
        expect(row("telegram").querySelector("button")?.textContent).toBe("Connect")
    })

    it("says your agent while the agent name is not known", async () => {
        await render(EMPTY_CONNECTIONS, {agentName: undefined})
        expect(container.textContent).toContain(
            "A channel lets people talk to your agent in the chat app they already use.",
        )
    })

    it("shows only Add a channel when nothing is connected", async () => {
        await render(EMPTY_CONNECTIONS)
        expect(groups()).toEqual(["Add a channel"])
    })

    it("marks a broken channel with Needs attention and Reconnect", async () => {
        await render({...EMPTY_CONNECTIONS, slack: slackRevoked})
        expect(row("slack").textContent).toContain("Needs attention")
        expect(row("slack").textContent).toContain("Reconnect")
    })

    it("marks a channel whose bot was removed from a chat, with Manage", async () => {
        await render({...EMPTY_CONNECTIONS, telegram: telegramBotRemoved})
        expect(row("telegram").textContent).toContain("Needs attention")
        expect(row("telegram").textContent).toContain("Manage")
        expect(row("telegram").textContent).not.toContain("Reconnect")
    })

    it("marks the platform when a second connection of the agent is broken", async () => {
        await render({
            ...EMPTY_CONNECTIONS,
            slack: slackHere,
            agentConnections: {
                slack: [slackHere, {...slackRevoked, connectionId: "cx-2"}],
                telegram: [],
                whatsapp: [],
                discord: [],
                teams: [],
            },
        })
        expect(row("slack").textContent).toContain("Needs attention")
        expect(row("slack").textContent).toContain("Reconnect")
    })

    it("lists a platform with a working connection as connected even when a link is pending", async () => {
        await render({
            ...EMPTY_CONNECTIONS,
            telegram: telegramPending,
            agentConnections: {
                slack: [],
                telegram: [telegramPending, telegramRevoked],
                whatsapp: [],
                discord: [],
                teams: [],
            },
        })
        expect(groups()).toEqual(["Connected", "Add a channel"])
        expect(row("telegram").textContent).toContain("Needs attention")
        await act(async () => row("telegram").click())
        // The existing connection's manage view, not the hosted setup.
        expect(container.querySelector('[data-testid="inner-view"]')?.textContent).toBe("telegram")
        expect(container.querySelector("nav")?.textContent).toContain("Telegram")
        expect(container.querySelector("nav")?.textContent).not.toContain("Connect")
    })

    it("opens the manage view in place and returns with the breadcrumb", async () => {
        await render({...EMPTY_CONNECTIONS, slack: slackHere})
        await act(async () => row("slack").click())
        const view = container.querySelector('[data-testid="agent-channels-open-view"]')!
        expect(view.querySelector("nav")?.textContent).toContain("Channels")
        expect(view.querySelector("nav")?.textContent).toContain("Slack")
        expect(container.querySelector('[data-testid="inner-view"]')?.textContent).toBe("slack")
        const crumb = [...view.querySelectorAll("nav button")].find(
            (button) => button.textContent === "Channels",
        ) as HTMLButtonElement
        await act(async () => crumb.click())
        expect(container.querySelector('[data-testid="agent-channels-open-view"]')).toBeNull()
        expect(groups()).toEqual(["Connected", "Add a channel"])
    })

    it("on a phone covers the screen, keeps focus inside, and Escape goes back to the list", async () => {
        phone.value = true
        await render({...EMPTY_CONNECTIONS, slack: slackHere})
        await act(async () => row("slack").click())
        const layer = document.querySelector<HTMLElement>(
            '[data-testid="agent-channels-open-view-phone"]',
        )!
        expect(layer.getAttribute("role")).toBe("dialog")
        expect(layer.contains(document.activeElement)).toBe(true)
        expect(layer.querySelector('[data-testid="inner-view"]')?.textContent).toBe("slack")
        await act(async () => {
            layer.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}))
        })
        expect(document.querySelector('[data-testid="agent-channels-open-view-phone"]')).toBeNull()
        expect(groups()).toEqual(["Connected", "Add a channel"])
    })

    it("lists API and Embed after the channels to add, and opens each in place", async () => {
        const embed = vi.fn(({connectionId}: {connectionId: string | null}) => (
            <div data-testid="embed-view">{connectionId ?? "list"}</div>
        ))
        await render(EMPTY_CONNECTIONS, {api: <div data-testid="api-view" />, embed})
        const rows = [...container.querySelectorAll("[data-testid^=agent-channels-]")].map((el) =>
            el.getAttribute("data-testid"),
        )
        expect(rows.slice(-2)).toEqual(["agent-channels-api", "agent-channels-embed"])
        expect(row("api").tagName).toBe("BUTTON")
        expect(row("api").textContent).toContain("Always on for saved versions")
        expect(row("embed").textContent).toContain("A chat on your website")

        await act(async () => row("api").click())
        let view = container.querySelector('[data-testid="agent-channels-open-view"]')!
        expect(view.querySelector("nav")?.textContent).toContain("API")
        expect(view.querySelector('[data-testid="api-view"]')).not.toBeNull()
        const crumb = [...view.querySelectorAll("nav button")].find(
            (button) => button.textContent === "Channels",
        ) as HTMLButtonElement
        await act(async () => crumb.click())

        await act(async () => row("embed").click())
        view = container.querySelector('[data-testid="agent-channels-open-view"]')!
        expect(view.querySelector("nav")?.textContent).toContain("Embed")
        expect(view.querySelector('[data-testid="embed-view"]')?.textContent).toBe("list")
    })

    it("lists neither API nor Embed when the host does not give them", async () => {
        await render(EMPTY_CONNECTIONS)
        expect(container.querySelector('[data-testid="agent-channels-api"]')).toBeNull()
        expect(container.querySelector('[data-testid="agent-channels-embed"]')).toBeNull()
    })

    it("on a phone opens API over the screen", async () => {
        phone.value = true
        await render(EMPTY_CONNECTIONS, {api: <div data-testid="api-view" />})
        await act(async () => row("api").click())
        const layer = document.querySelector<HTMLElement>(
            '[data-testid="agent-channels-open-view-phone"]',
        )!
        expect(layer.querySelector('[data-testid="api-view"]')).not.toBeNull()
    })

    it("keeps API and Embed while the channels load or fail to load", async () => {
        const extra = {api: <div data-testid="api-view" />, embed: () => null}
        await render(EMPTY_CONNECTIONS, {...extra, loading: true})
        expect(row("api")).not.toBeNull()
        expect(row("embed")).not.toBeNull()
        expect(container.querySelector('[data-testid="agent-channels-slack"]')).toBeNull()
        await render(EMPTY_CONNECTIONS, {...extra, loadError: "Could not load channels"})
        expect(container.textContent).toContain("Try again")
        await act(async () => row("api").click())
        expect(container.querySelector('[data-testid="api-view"]')).not.toBeNull()
    })

    it("shows skeleton rows while loading and Try again on a load error", async () => {
        await render(EMPTY_CONNECTIONS, {loading: true})
        expect(groups()).toEqual([])
        await render(EMPTY_CONNECTIONS, {loadError: "Could not load channels"})
        expect(container.textContent).toContain("Could not load channels")
        expect(container.textContent).toContain("Try again")
    })
})
