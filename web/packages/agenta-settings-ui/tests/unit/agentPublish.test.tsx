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
    ChannelConnectFlow: ({
        platform,
        initialMode,
        onConnected,
    }: {
        platform: string
        initialMode: string
        onConnected: () => Promise<void>
    }) => (
        <div data-testid="connect-flow-body">
            connect {platform} {initialMode}
            <button data-testid="finish-connect" onClick={() => void onConnected()} />
        </div>
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

const ALL_LIVE: ChannelConnections = {
    slack: connected("slack"),
    telegram: connected("telegram"),
    whatsapp: null,
}

// A stand-in for the host's drawer: the open panel renders a dialog carrying its title.
const renderPanel = ({open, title, onClose, onBack, children}: ChannelsPanelRenderProps) =>
    open ? (
        <div role="dialog" data-title={title}>
            <button data-testid="close" onClick={onClose} />
            {onBack ? <button data-testid="back" onClick={onBack} /> : null}
            {children}
        </div>
    ) : null

describe("AgentPublish", () => {
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
        document.body.innerHTML = ""
    })

    const render = async (
        connections: ChannelConnections = ALL_LIVE,
        {actions = NOOP_ACTIONS} = {},
    ) => {
        await act(async () =>
            root.render(
                <AgentPublish
                    agentId={AGENT}
                    agentName="Agent"
                    projectId="project-1"
                    host="https://agenta.example"
                    connections={connections}
                    actions={actions}
                    renderPanel={renderPanel}
                />,
            ),
        )
    }

    const click = async (testId: string) => {
        const el = document.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null
        expect(el).not.toBeNull()
        await act(async () => el?.click())
    }

    const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null

    it("opens the hub from the Publish button", async () => {
        await render()
        await click("publish-button")
        expect(dialog()?.dataset.title).toBe("Publish")
        expect(document.querySelector('[data-testid="channels-hub"]')).not.toBeNull()
        expect(document.querySelector('[data-testid="back"]')).toBeNull()
    })

    it("goes from the hub to a connection and back", async () => {
        await render()
        await click("publish-button")
        await click("channels-hub-slack")
        // The card expands into its connections instead of navigating.
        expect(dialog()?.dataset.title).toBe("Publish")
        await click("channels-hub-connection-slack-1")
        expect(dialog()?.dataset.title).toBe("Slack")
        expect(document.querySelector('[data-testid="manage-panel-body"]')?.textContent).toBe(
            "manage slack",
        )
        await click("back")
        expect(dialog()?.dataset.title).toBe("Publish")
    })

    it("opens connect for a platform that is not set up", async () => {
        await render({slack: null, telegram: null, whatsapp: null})
        await click("publish-button")
        await click("channels-hub-add-slack")
        expect(dialog()?.dataset.title).toBe("Connect Slack")
        expect(document.querySelector('[data-testid="connect-flow-body"]')?.textContent).toContain(
            "connect slack hosted",
        )
    })

    it("adds a second Telegram bot as the agent's own", async () => {
        await render()
        await click("publish-button")
        await click("channels-hub-add-telegram")
        expect(dialog()?.dataset.title).toBe("Add a Telegram bot")
        expect(document.querySelector('[data-testid="connect-flow-body"]')?.textContent).toContain(
            "connect telegram custom",
        )
    })

    it("replaces the connect view with the new connection once connected", async () => {
        const fresh = {...connected("slack"), connectionId: "slack-2"}
        const next: ChannelConnections = {
            ...ALL_LIVE,
            agentConnections: {slack: [connected("slack"), fresh], telegram: [], whatsapp: []},
        }
        const reload = vi.fn(async () => next)
        await render(ALL_LIVE, {actions: {...NOOP_ACTIONS, reload}})
        await click("publish-button")
        await click("channels-hub-add-slack")
        await click("finish-connect")
        expect(dialog()?.dataset.title).toBe("Slack")
        await click("back")
        expect(dialog()?.dataset.title).toBe("Publish")
    })

    it("re-reads the connections when a connect view is left", async () => {
        const reload = vi.fn(async () => ALL_LIVE)
        await render(
            {slack: null, telegram: null, whatsapp: null},
            {actions: {...NOOP_ACTIONS, reload}},
        )
        await click("publish-button")
        await click("channels-hub-add-slack")
        await click("back")
        expect(reload).toHaveBeenCalledTimes(1)
    })

    it("opens the API view from the hub", async () => {
        await render()
        await click("publish-button")
        await click("channels-hub-api")
        expect(dialog()?.dataset.title).toBe("API")
    })
})
