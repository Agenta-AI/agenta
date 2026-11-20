// @vitest-environment jsdom
/**
 * The Channels page of an agent (A07, A08): connected channels first, then the ones to add.
 * "Manage" and "Connect" open the production views in place under "Channels › <platform>", and
 * "Channels" in the breadcrumb returns to the list.
 */
import React, {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

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
            agentConnections: {slack: [slackHere, {...slackRevoked, connectionId: "cx-2"}]},
        })
        expect(row("slack").textContent).toContain("Needs attention")
        expect(row("slack").textContent).toContain("Reconnect")
    })

    it("opens the manage view in place and returns with the breadcrumb", async () => {
        await render({...EMPTY_CONNECTIONS, slack: slackHere})
        await act(async () => row("slack").querySelector("button")!.click())
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

    it("shows skeleton rows while loading and Try again on a load error", async () => {
        await render(EMPTY_CONNECTIONS, {loading: true})
        expect(groups()).toEqual([])
        await render(EMPTY_CONNECTIONS, {loadError: "Could not load channels"})
        expect(container.textContent).toContain("Could not load channels")
        expect(container.textContent).toContain("Try again")
    })
})
