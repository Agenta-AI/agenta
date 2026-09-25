// @vitest-environment jsdom
import React, {act, useState} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("@agenta/ui/ui", () => {
    const Wrap = ({children}: {children?: React.ReactNode}) => <div>{children}</div>
    return {
        Alert: ({message}: {message: string}) => <div role="alert">{message}</div>,
        Button: ({children, onClick, disabled, ...props}: React.ComponentProps<"button">) => (
            <button disabled={disabled} onClick={onClick} data-testid={props["data-testid"]}>
                {children}
            </button>
        ),
        Empty: Wrap,
        EmptyContent: Wrap,
        EmptyDescription: Wrap,
        EmptyHeader: Wrap,
        EmptyMedia: Wrap,
        EmptyTitle: Wrap,
        Input: ({value, onChange, ...props}: React.ComponentProps<"input">) => (
            <input value={value} onChange={onChange} data-testid={props["data-testid"]} />
        ),
        PasswordInput: () => <input />,
        RadioGroup: Wrap,
        RadioGroupItem: () => <span />,
        Select: Wrap,
        SelectContent: Wrap,
        SelectItem: Wrap,
        SelectTrigger: Wrap,
        SelectValue: () => null,
        SkeletonBlock: () => <span data-testid="skeleton" />,
        Spinner: () => <span />,
        Switch: () => <span />,
    }
})
vi.mock("../../src/channels/icons", () => ({AgentaMark: () => null, platformLogo: () => null}))
vi.mock("../../src/channels/qr", () => ({QrCode: () => null}))
vi.mock("../../src/channels/AgentMark", () => ({AgentMark: () => null}))
vi.mock("../../src/channels/ViewTransition", () => ({
    ViewTransition: ({children}: {children: React.ReactNode}) => <>{children}</>,
}))
vi.mock("../../src/channels/ChannelManagePanel", () => ({
    ChannelManagePanel: ({connection}: {connection: {connectionId?: string}}) => (
        <div data-testid={`manage-${connection.connectionId}`} />
    ),
}))
import {connectionsForAgent} from "../../src/channels/actions"
import {ChannelsSettingsPage} from "../../src/channels/ChannelsSettingsPage"
import {NOOP_ACTIONS} from "../../src/channels/helpers"
import type {ChannelConnection, ChannelsActions} from "../../src/channels/types"
import type {ChannelsPanelRenderProps} from "../../src/channels/useChannelPanel"

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

const AGENTS = [
    {id: "a1", name: "Support"},
    {id: "a2", name: "Growth"},
]

const connection = (over: Partial<ChannelConnection>): ChannelConnection => ({
    platform: "slack",
    kind: "hosted",
    status: "connected",
    dm: "allow",
    group: "allow",
    chats: [],
    ...over,
})

const SLACK_A2 = connection({connectionId: "s-a2", workspaceName: "Acme", agent: AGENTS[1]})
const ORPHAN = connection({connectionId: "s-orphan", workspaceName: "Beta", agent: null})
const PENDING = connection({
    connectionId: "t-pending",
    platform: "telegram",
    status: "pending",
    handle: "@pending_bot",
    agent: AGENTS[0],
})

describe("connectionsForAgent", () => {
    it("summarizes the agent's own connection and lists only its connections", () => {
        const mine = connection({connectionId: "s-a1", agent: AGENTS[0]})
        const result = connectionsForAgent([SLACK_A2, mine], "a1")
        expect(result.slack?.connectionId).toBe("s-a1")
        expect(result.agentConnections?.slack.map((c) => c.connectionId)).toEqual(["s-a1"])
        expect(result.allConnections).toHaveLength(2)
    })

    it("still summarizes another agent's connection when this one has none", () => {
        const result = connectionsForAgent([SLACK_A2], "a1")
        expect(result.slack?.connectionId).toBe("s-a2")
        expect(result.agentConnections?.slack).toEqual([])
    })
})

const renderPanel = ({open, children}: ChannelsPanelRenderProps) =>
    open ? <div data-testid="panel">{children}</div> : null

const Host = ({
    rows,
    onAgentChange,
    actions = NOOP_ACTIONS,
}: {
    rows: ChannelConnection[]
    onAgentChange?: (id: string) => void
    actions?: ChannelsActions
}) => {
    const [agentId, setAgentId] = useState("a1")
    return (
        <ChannelsSettingsPage
            agents={AGENTS}
            agentId={agentId}
            onAgentChange={(id) => {
                onAgentChange?.(id)
                setAgentId(id)
            }}
            connections={connectionsForAgent(rows, agentId)}
            onRetry={async () => undefined}
            actions={actions}
            renderPanel={renderPanel}
        />
    )
}

const byTestId = (id: string) => container.querySelector(`[data-testid="${id}"]`)
const clickTestId = async (id: string) => act(async () => (byTestId(id) as HTMLElement).click())

describe("ChannelsSettingsPage", () => {
    it("opens a card's manage view under the agent it answers as", async () => {
        const onAgentChange = vi.fn()
        await act(async () => root.render(<Host rows={[SLACK_A2]} onAgentChange={onAgentChange} />))
        await clickTestId("channels-card-s-a2")
        expect(onAgentChange).toHaveBeenCalledWith("a2")
        expect(byTestId("manage-s-a2")).not.toBeNull()
    })

    it("asks for the agent before opening a connection that answers as none", async () => {
        const onAgentChange = vi.fn()
        await act(async () => root.render(<Host rows={[ORPHAN]} onAgentChange={onAgentChange} />))
        await clickTestId("channels-card-s-orphan")
        expect(onAgentChange).not.toHaveBeenCalled()
        expect(byTestId("channels-agent-picker")).not.toBeNull()
        expect(byTestId("manage-s-orphan")).toBeNull()
    })

    it("opens a pending link on the hub without minting a new one", async () => {
        const connectHostedTelegram = vi.fn()
        await act(async () =>
            root.render(
                <Host rows={[PENDING]} actions={{...NOOP_ACTIONS, connectHostedTelegram}} />,
            ),
        )
        await clickTestId("channels-card-t-pending")
        expect(byTestId("channels-hub")).not.toBeNull()
        expect(connectHostedTelegram).not.toHaveBeenCalled()
    })

    it("starts a new connection with the agent picker", async () => {
        await act(async () => root.render(<Host rows={[SLACK_A2]} />))
        await clickTestId("channels-settings-connect")
        expect(byTestId("channels-agent-picker")).not.toBeNull()
        await clickTestId("channels-agent-a2")
        expect(byTestId("channels-hub")).not.toBeNull()
    })

    it("filters the cards by search and says when nothing matches", async () => {
        await act(async () => root.render(<Host rows={[SLACK_A2, ORPHAN]} />))
        const input = byTestId("channels-settings-search") as HTMLInputElement
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
        const type = async (value: string) =>
            act(async () => {
                setter.call(input, value)
                input.dispatchEvent(new Event("input", {bubbles: true}))
            })

        await type("growth")
        expect(byTestId("channels-card-s-a2")).not.toBeNull()
        expect(byTestId("channels-card-s-orphan")).toBeNull()

        await type("nothing-like-this")
        expect(container.textContent).toContain("No channels found")
    })
})
