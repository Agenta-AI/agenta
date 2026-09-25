// @vitest-environment jsdom
import React, {act, useState} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, expect, it, vi} from "vitest"

vi.mock("@agenta/ui/ui", () => {
    const Wrap = ({children}: {children: React.ReactNode}) => <div>{children}</div>
    return {
        Accordion: Wrap,
        AccordionContent: Wrap,
        AccordionItem: Wrap,
        AccordionTrigger: Wrap,
        Alert: ({message}: {message: string}) => <div role="alert">{message}</div>,
        Button: ({children, onClick, disabled, ...props}: React.ComponentProps<"button">) => (
            <button disabled={disabled} onClick={onClick} data-testid={props["data-testid"]}>
                {children}
            </button>
        ),
        Input: () => <input />,
        PasswordInput: () => <input />,
        RadioGroup: Wrap,
        RadioGroupItem: () => <span />,
        Select: Wrap,
        SelectContent: Wrap,
        SelectItem: Wrap,
        SelectTrigger: Wrap,
        SelectValue: () => null,
        Spinner: () => <span />,
        Switch: () => <span />,
    }
})
vi.mock("../../src/channels/icons", () => ({AgentaMark: () => null, platformLogo: () => null}))
vi.mock("../../src/channels/qr", () => ({QrCode: () => null}))
import {NOOP_ACTIONS} from "../../src/channels/helpers"
import type {ChannelConnection, ChannelConnections, ChannelsActions} from "../../src/channels/types"
import type {ChannelsPanelRenderProps} from "../../src/channels/useChannelPanel"

import {PanelHarness} from "./channelPanelHarness"

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

const SLACK: ChannelConnection = {
    platform: "slack",
    kind: "hosted",
    status: "connected",
    connectionId: "slack-connection",
    agent: {id: "agent", name: "QA"},
    dm: "allow",
    group: "allow",
    chats: [],
}

const renderPanel = ({open, children}: ChannelsPanelRenderProps) =>
    open ? <div data-testid="panel">{children}</div> : null

/** A host like the agent pages: `reload` is the only thing that moves `connections`. */
const Host = ({
    actions,
    initial,
}: {
    actions: Omit<ChannelsActions, "reload"> & {reload: () => Promise<ChannelConnections>}
    initial: ChannelConnections
}) => {
    const [connections, setConnections] = useState(initial)
    const wired: ChannelsActions = {
        ...actions,
        reload: async () => {
            const next = await actions.reload()
            setConnections(next)
            return next
        },
    }
    return (
        <PanelHarness
            agentId="agent"
            agentName="QA"
            connections={connections}
            actions={wired}
            renderPanel={renderPanel}
        />
    )
}

const buttonByText = (text: string) => {
    const button = [...container.querySelectorAll("button")].find((b) =>
        b.textContent?.includes(text),
    )
    expect(button, text).toBeTruthy()
    return button as HTMLButtonElement
}
const click = async (text: string) => act(async () => buttonByText(text).click())

const openAndDisconnect = async () => {
    await act(async () =>
        (
            container.querySelector('[data-testid="channels-row-slack"]') as HTMLButtonElement
        ).click(),
    )
    await click("Disconnect")
    // The confirm step's own button.
    const confirm = [...container.querySelectorAll("button")].find(
        (b) => b.textContent === "Disconnect",
    )!
    await act(async () => confirm.click())
}

it("closes the panel when the backend archived the row but answered with an error", async () => {
    const disconnect = vi.fn().mockRejectedValue(new Error("Internal Server Error"))
    const reload = vi.fn().mockResolvedValue({slack: null, telegram: null, whatsapp: null})
    await act(async () =>
        root.render(
            <Host
                initial={{slack: SLACK, telegram: null, whatsapp: null}}
                actions={{...NOOP_ACTIONS, disconnect, reload}}
            />,
        ),
    )

    await openAndDisconnect()

    expect(disconnect).toHaveBeenCalledWith("slack", "slack-connection")
    expect(reload).toHaveBeenCalled()
    expect(container.querySelector('[data-testid="panel"]')).toBeNull()
})

it("shows a failed disconnect next to the Disconnect button when the row is still there", async () => {
    const disconnect = vi.fn().mockRejectedValue(new Error("Could not disconnect."))
    const reload = vi.fn().mockResolvedValue({slack: SLACK, telegram: null, whatsapp: null})
    await act(async () =>
        root.render(
            <Host
                initial={{slack: SLACK, telegram: null, whatsapp: null}}
                actions={{...NOOP_ACTIONS, disconnect, reload}}
            />,
        ),
    )

    await openAndDisconnect()

    expect(container.querySelector('[data-testid="panel"]')).not.toBeNull()
    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toBe("Could not disconnect.")
    // The message sits in the pinned footer with the button, not at the top of the panel.
    const block = buttonByText("Disconnect").closest("div.sticky")
    expect(block?.contains(alert!)).toBe(true)
})

it("closes the panel after a clean disconnect", async () => {
    const disconnect = vi.fn().mockResolvedValue(undefined)
    const reload = vi.fn().mockResolvedValue({slack: null, telegram: null, whatsapp: null})
    await act(async () =>
        root.render(
            <Host
                initial={{slack: SLACK, telegram: null, whatsapp: null}}
                actions={{...NOOP_ACTIONS, disconnect, reload}}
            />,
        ),
    )

    await openAndDisconnect()

    expect(container.querySelector('[data-testid="panel"]')).toBeNull()
})

const TELEGRAM_A: ChannelConnection = {
    platform: "telegram",
    kind: "custom",
    status: "connected",
    connectionId: "bot-a",
    handle: "@bot_a",
    agent: {id: "agent", name: "QA"},
    dm: "allow",
    group: "allow",
    chats: [],
}
const TELEGRAM_B: ChannelConnection = {...TELEGRAM_A, connectionId: "bot-b", handle: "@bot_b"}

it("lists each of the agent's connections on a platform and disconnects only the selected one", async () => {
    const disconnect = vi.fn().mockResolvedValue(undefined)
    const reload = vi.fn().mockResolvedValue({
        slack: null,
        telegram: TELEGRAM_B,
        agentConnections: {slack: [], telegram: [TELEGRAM_B], whatsapp: []},
    })
    await act(async () =>
        root.render(
            <Host
                initial={{
                    slack: null,
                    telegram: TELEGRAM_A,
                    agentConnections: {slack: [], telegram: [TELEGRAM_A, TELEGRAM_B], whatsapp: []},
                }}
                actions={{...NOOP_ACTIONS, disconnect, reload}}
            />,
        ),
    )
    const row = container.querySelector('[data-testid="channels-row-telegram"]') as HTMLElement
    await act(async () => row.click())

    expect(container.querySelector('[data-testid="channels-connection-list"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="channels-connection-bot-a"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="channels-connection-bot-b"]')).not.toBeNull()

    await act(async () =>
        (
            container.querySelector('[data-testid="channels-connection-bot-a"]') as HTMLElement
        ).click(),
    )
    await click("Disconnect")
    const confirm = [...container.querySelectorAll("button")].find(
        (b) => b.textContent === "Disconnect",
    )!
    await act(async () => confirm.click())

    expect(disconnect).toHaveBeenCalledWith("telegram", "bot-a")
    expect(disconnect).toHaveBeenCalledTimes(1)
    // The panel steps back to the list, which now holds only the bot that is left.
    expect(container.querySelector('[data-testid="panel"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="channels-connection-list"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="channels-connection-bot-a"]')).toBeNull()
    expect(container.querySelector('[data-testid="channels-connection-bot-b"]')).not.toBeNull()
})

it("opens the manage view of the connection picked in the list", async () => {
    const disconnect = vi.fn().mockResolvedValue(undefined)
    await act(async () =>
        root.render(
            <Host
                initial={{
                    slack: null,
                    telegram: TELEGRAM_A,
                    agentConnections: {slack: [], telegram: [TELEGRAM_A, TELEGRAM_B], whatsapp: []},
                }}
                actions={{...NOOP_ACTIONS, disconnect}}
            />,
        ),
    )
    await act(async () =>
        (container.querySelector('[data-testid="channels-row-telegram"]') as HTMLElement).click(),
    )
    await act(async () =>
        (
            container.querySelector('[data-testid="channels-connection-bot-b"]') as HTMLElement
        ).click(),
    )
    expect(container.textContent).toContain("@bot_b")
    await click("Disconnect")
    const confirm = [...container.querySelectorAll("button")].find(
        (b) => b.textContent === "Disconnect",
    )!
    await act(async () => confirm.click())
    expect(disconnect).toHaveBeenCalledWith("telegram", "bot-b")
})
