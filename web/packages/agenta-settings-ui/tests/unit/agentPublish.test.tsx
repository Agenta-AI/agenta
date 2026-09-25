// @vitest-environment jsdom
import React, {act} from "react"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

// The panels' own contents are covered by their tests; here only which one opens matters.
vi.mock("../../src/publish/AgentApiPanel", () => ({
    AgentApiPanel: ({agentId}: {agentId: string}) => (
        <div data-testid="api-panel-body">api for {agentId}</div>
    ),
}))
vi.mock("../../src/channels/ChannelManagePanel", () => ({
    ChannelManagePanel: ({connection}: {connection: {platform: string}}) => (
        <div data-testid="manage-panel-body">manage {connection.platform}</div>
    ),
}))
vi.mock("../../src/channels/ChannelConnectFlow", () => ({
    ChannelConnectFlow: ({platform}: {platform: string}) => (
        <div data-testid="connect-flow-body">connect {platform}</div>
    ),
}))

import {NOOP_ACTIONS} from "../../src/channels/helpers"
import type {ChannelConnection, ChannelConnections} from "../../src/channels/types"
import type {ChannelsPanelRenderProps} from "../../src/channels/useChannelPanel"
import {AgentPublish} from "../../src/publish/AgentPublish"

const AGENT = "agent-1"

const connected = (platform: "slack" | "telegram"): ChannelConnection => ({
    connectionId: `${platform}-1`,
    platform,
    kind: "hosted",
    status: "connected",
    dm: "allow",
    group: "allow",
    chats: [],
    agent: {id: AGENT, name: "Agent"},
})

const ALL_LIVE: ChannelConnections = {slack: connected("slack"), telegram: connected("telegram")}

// A stand-in for the host's drawer: open panels render a dialog carrying their title.
const renderPanel = ({open, title, onClose, children}: ChannelsPanelRenderProps) =>
    open ? (
        <div role="dialog" data-title={title}>
            <button onClick={onClose}>close</button>
            {children}
        </div>
    ) : null

describe("AgentPublish", () => {
    let root: Root
    let container: HTMLDivElement
    beforeEach(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true
        // Radix measures and scrolls its menu; jsdom has neither.
        Element.prototype.scrollIntoView ??= () => undefined
        Element.prototype.hasPointerCapture ??= () => false
        Element.prototype.releasePointerCapture ??= () => undefined
        globalThis.ResizeObserver ??= class {
            observe() {}
            unobserve() {}
            disconnect() {}
        } as unknown as typeof ResizeObserver
        container = document.createElement("div")
        document.body.append(container)
        root = createRoot(container)
    })
    afterEach(async () => {
        await act(async () => root.unmount())
        container.remove()
        document.body.innerHTML = ""
    })

    const render = async (connections: ChannelConnections = ALL_LIVE) => {
        await act(async () =>
            root.render(
                <AgentPublish
                    agentId={AGENT}
                    agentName="Agent"
                    projectId="project-1"
                    host="https://agenta.example"
                    connections={connections}
                    actions={NOOP_ACTIONS}
                    renderPanel={renderPanel}
                />,
            ),
        )
    }

    // Opens the real Radix menu the way a mouse does (pointerdown on the trigger) and picks
    // an item with a click, so the menu's own close-on-select runs as it does in the app.
    const choose = async (key: string) => {
        const trigger = document.querySelector('[data-testid="publish-button"]') as HTMLElement
        await act(async () => {
            trigger.dispatchEvent(
                new MouseEvent("pointerdown", {bubbles: true, cancelable: true, button: 0}),
            )
        })
        const item = document.querySelector(`[data-testid="publish-item-${key}"]`) as HTMLElement
        expect(item).not.toBeNull()
        await act(async () => {
            item.click()
        })
        // The menu has closed; only the panel is left.
        expect(document.querySelector('[data-testid^="publish-item-"]')).toBeNull()
    }

    const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null

    it("opens the Slack manage panel from the Publish menu when Slack is live", async () => {
        await render()
        expect(document.body.textContent).toContain("Live in 3 places")
        await choose("slack")
        expect(dialog()?.dataset.title).toBe("Slack")
        expect(document.querySelector('[data-testid="manage-panel-body"]')?.textContent).toBe(
            "manage slack",
        )
    })

    it("opens the Slack connect flow when Slack is not set up yet", async () => {
        await render({slack: null, telegram: null})
        await choose("slack")
        expect(dialog()?.dataset.title).toBe("Connect Slack")
        expect(document.querySelector('[data-testid="connect-flow-body"]')).not.toBeNull()
    })

    it("opens the API panel from the Publish menu", async () => {
        await render()
        await choose("api")
        expect(dialog()?.dataset.title).toBe("API")
        expect(document.querySelector('[data-testid="api-panel-body"]')?.textContent).toBe(
            `api for ${AGENT}`,
        )
    })

    it("closes the panel and lets the menu open another one", async () => {
        await render()
        await choose("api")
        await act(async () => (dialog()?.querySelector("button") as HTMLElement).click())
        expect(dialog()).toBeNull()
        await choose("telegram")
        expect(dialog()?.dataset.title).toBe("Telegram")
    })
})
