// @vitest-environment jsdom
import React, {act, useState} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, expect, it, vi} from "vitest"

// The radio mock hands each item its group's onValueChange, as Radix does.
const {RadioChange} = vi.hoisted(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const {createContext} = require("react") as typeof import("react")
    return {RadioChange: createContext<(value: string) => void>(() => undefined)}
})
vi.mock("@agenta/ui/ui", () => ({
    RadioGroup: ({
        children,
        onValueChange,
    }: {
        children: React.ReactNode
        onValueChange: (value: string) => void
    }) => <RadioChange.Provider value={onValueChange}>{children}</RadioChange.Provider>,
    RadioGroupItem: ({
        value,
        disabled,
        ...props
    }: {
        value: string
        disabled?: boolean
        "data-testid"?: string
    }) => {
        const change = React.useContext(RadioChange)
        return (
            <button
                disabled={disabled}
                onClick={() => change(value)}
                data-testid={props["data-testid"]}
            />
        )
    },
    Alert: ({message}: {message: string}) => <div>{message}</div>,
    Button: ({children, onClick, disabled, ...props}: React.ComponentProps<"button">) => (
        <button disabled={disabled} onClick={onClick} data-testid={props["data-testid"]}>
            {children}
        </button>
    ),
    Input: (props: React.ComponentProps<"input">) => <input {...props} />,
    InputAffix: ({
        onValueChange,
        prefix: _prefix,
        ...props
    }: React.ComponentProps<"input"> & {onValueChange: (value: string) => void}) => (
        <input {...props} onChange={(e) => onValueChange(e.target.value)} />
    ),
    Textarea: (props: React.ComponentProps<"textarea">) => <textarea {...props} />,
    PasswordInput: () => <input />,
    Spinner: () => <span />,
}))
vi.mock("../../src/channels/icons", () => ({AgentaMark: () => null, platformLogo: () => null}))
vi.mock("../../src/channels/qr", () => ({QrCode: () => null}))
import {ChannelConnectFlow} from "../../src/channels/ChannelConnectFlow"
import {NOOP_ACTIONS} from "../../src/channels/helpers"
import type {ChannelConnections, ChannelsActions} from "../../src/channels/types"

import {PanelHarness} from "./channelPanelHarness"

vi.mock("../../src/channels/ChannelManagePanel", () => ({
    ChannelManagePanel: () => <div>Connected management</div>,
}))

let root: Root
let container: HTMLDivElement
beforeEach(() => {
    vi.useFakeTimers()
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {writeText: vi.fn().mockResolvedValue(undefined)},
    })
    vi.spyOn(window, "open").mockImplementation(() => null)
})
afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.useRealTimers()
    vi.restoreAllMocks()
})
const click = async (text: string) => {
    const button = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === text,
    )
    expect(button, text).toBeTruthy()
    await act(async () => button!.click())
}
const clickTestId = async (testId: string) => {
    const el = container.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null
    expect(el, testId).toBeTruthy()
    await act(async () => el!.click())
}
const advance = async (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms))

it("mints one Telegram link when StrictMode replays the effect", async () => {
    const mint = vi.fn().mockResolvedValue({
        url: "https://t.me/qa?start=synthetic",
        connectionId: "qa",
        expiresInSeconds: 30,
    })
    await act(async () =>
        root.render(
            <React.StrictMode>
                <ChannelConnectFlow
                    platform="telegram"
                    agentName="QA"
                    onConnected={vi.fn()}
                    actions={{...NOOP_ACTIONS, connectHostedTelegram: mint}}
                />
            </React.StrictMode>,
        ),
    )
    expect(mint).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain("Open in Telegram")
})

it("keeps polling after copying the Telegram link", async () => {
    const count = vi.fn().mockResolvedValue(0)
    await act(async () =>
        root.render(
            <ChannelConnectFlow
                platform="telegram"
                agentName="QA"
                onConnected={vi.fn()}
                pollIntervalMs={100}
                actions={{
                    ...NOOP_ACTIONS,
                    connectHostedTelegram: async () => ({
                        url: "https://t.me/qa?start=synthetic",
                        connectionId: "qa",
                        expiresInSeconds: 30,
                    }),
                    countHostedTelegramBindings: count,
                }}
            />,
        ),
    )
    expect(count).toHaveBeenCalledTimes(1)
    await clickTestId("channels-copy-telegram-link")
    await advance(300)
    expect(count.mock.calls.length).toBeGreaterThan(1)
})

it("does not finish a Telegram connect after switching to custom mode", async () => {
    let resolvePoll!: (count: number) => void
    const count = vi
        .fn()
        .mockResolvedValueOnce(0)
        .mockImplementation(
            () =>
                new Promise<number>((resolve) => {
                    resolvePoll = resolve
                }),
        )
    const connected = vi.fn()
    await act(async () =>
        root.render(
            <ChannelConnectFlow
                platform="telegram"
                agentName="QA"
                onConnected={connected}
                pollIntervalMs={100}
                actions={{
                    ...NOOP_ACTIONS,
                    connectHostedTelegram: async () => ({
                        url: "https://t.me/qa?start=synthetic",
                        connectionId: "qa",
                        expiresInSeconds: 30,
                    }),
                    countHostedTelegramBindings: count,
                }}
            />,
        ),
    )
    await advance(100)
    await clickTestId("channels-method-custom")
    await act(async () => resolvePoll(1))
    expect(connected).not.toHaveBeenCalled()
})

it("does not treat an existing revoked Slack row as a completed install", async () => {
    const connectHere = vi.fn()
    const connected = vi.fn()
    await act(async () =>
        root.render(
            <ChannelConnectFlow
                platform="slack"
                agentName="QA"
                onConnected={connected}
                pollIntervalMs={100}
                actions={{
                    ...NOOP_ACTIONS,
                    hostedSlackInstallUrl: async () => "https://slack.com/synthetic",
                    reload: async () => ({
                        telegram: null,
                        slack: {
                            platform: "slack",
                            kind: "hosted",
                            status: "revoked",
                            connectionId: "revoked",
                            dm: "allow",
                            group: "allow",
                            chats: [],
                        },
                    }),
                    connectHere,
                }}
            />,
        ),
    )
    await click("Add to Slack")
    await advance(100)
    expect(connectHere).not.toHaveBeenCalled()
    expect(connected).not.toHaveBeenCalled()
})

it("does not retarget Slack after cancelling an in-flight poll", async () => {
    let resolveReload!: (value: unknown) => void
    const connectHere = vi.fn()
    const reload = vi
        .fn()
        .mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveReload = resolve
                }),
        )
        .mockResolvedValue({telegram: null, slack: null})
    await act(async () =>
        root.render(
            <ChannelConnectFlow
                platform="slack"
                agentName="QA"
                onConnected={vi.fn()}
                pollIntervalMs={100}
                actions={{
                    ...NOOP_ACTIONS,
                    hostedSlackInstallUrl: async () => "https://slack.com/synthetic",
                    reload,
                    connectHere,
                }}
            />,
        ),
    )
    await click("Add to Slack")
    await advance(100)
    await click("Cancel")
    await act(async () =>
        resolveReload({
            telegram: null,
            slack: {
                platform: "slack",
                kind: "hosted",
                status: "connected",
                connectionId: "another-agent-connection",
                dm: "allow",
                group: "allow",
                chats: [],
            },
        }),
    )
    expect(connectHere).not.toHaveBeenCalled()
})

it("finishes Slack assignment when a poll publishes the installed connection", async () => {
    const connectHere = vi.fn().mockResolvedValue(undefined)
    const result: ChannelConnections = {
        telegram: null,
        slack: {
            platform: "slack",
            kind: "hosted",
            status: "connected",
            connectionId: "installed",
            dm: "allow",
            group: "allow",
            chats: [],
        },
    }
    const Host = () => {
        const [connections, setConnections] = useState<ChannelConnections>({
            slack: null,
            telegram: null,
        })
        const [actions] = useState<ChannelsActions>(() => ({
            ...NOOP_ACTIONS,
            hostedSlackInstallUrl: async () => "https://slack.com/synthetic",
            connectHere,
            reload: async () => {
                setConnections(result)
                return result
            },
        }))
        return (
            <PanelHarness
                agentId="agent"
                connections={connections}
                actions={actions}
                renderPanel={({children}) => <div>{children}</div>}
            />
        )
    }
    await act(async () => root.render(<Host />))
    await act(async () =>
        (
            container.querySelector('[data-testid="channels-row-slack"]') as HTMLButtonElement
        ).click(),
    )
    await click("Add to Slack")
    await advance(2500)
    expect(connectHere).toHaveBeenCalledWith("slack", "installed")
    expect(container.textContent).toContain("Connected management")
})

const typeInto = async (testId: string, value: string) => {
    const el = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        `[data-testid="${testId}"]`,
    )
    expect(el, testId).toBeTruthy()
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value")!.set!
    await act(async () => {
        setter.call(el, value)
        el!.dispatchEvent(new Event("input", {bubbles: true}))
    })
}
const valueOf = (testId: string) =>
    container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-testid="${testId}"]`)!
        .value

const openSlackNaming = async (loadSetup: ChannelsActions["loadSetup"], description?: string) => {
    await act(async () =>
        root.render(
            <ChannelConnectFlow
                platform="slack"
                agentName="Product Copilot"
                agentDescription={description}
                onConnected={vi.fn()}
                actions={{...NOOP_ACTIONS, loadSetup}}
            />,
        ),
    )
    await clickTestId("channels-method-custom")
    // New app is the preselected choice.
    await click("Continue")
}

it("names a new Slack app from the agent and builds the manifest from it", async () => {
    const loadSetup = vi.fn(async () => ({
        manifest: '{"display_information":{"name":"Product Copilot"}}',
        fields: [],
        hostedAvailable: false,
    }))
    await openSlackNaming(loadSetup, "Answers product questions.")

    expect(valueOf("channels-slack-app-name")).toBe("Product Copilot")
    expect(valueOf("channels-slack-app-handle")).toBe("ProductCopilot")
    expect(valueOf("channels-slack-app-description")).toBe("Answers product questions.")
    expect(container.textContent).toContain("15/35")

    await typeInto("channels-slack-app-name", "Support Desk")
    expect(valueOf("channels-slack-app-handle")).toBe("SupportDesk")

    await click("Next")
    expect(loadSetup).toHaveBeenLastCalledWith("slack", {
        name: "Support Desk",
        handle: "SupportDesk",
        description: "Answers product questions.",
    })
    expect(container.textContent).toContain("Create the app from a manifest")
})

it("stops deriving the handle once it is edited, and strips what Slack refuses", async () => {
    const loadSetup = vi.fn(async () => ({manifest: null, fields: [], hostedAvailable: false}))
    await openSlackNaming(loadSetup)

    expect(valueOf("channels-slack-app-description")).toBe("Talk to Product Copilot in Slack.")

    await typeInto("channels-slack-app-handle", "@copilot bot!")
    expect(valueOf("channels-slack-app-handle")).toBe("copilotbot")

    await typeInto("channels-slack-app-name", "Something Else")
    expect(valueOf("channels-slack-app-handle")).toBe("copilotbot")
})

it("finishes only on a Slack install that was not connected before", async () => {
    const connectHere = vi.fn().mockResolvedValue(undefined)
    const connected = vi.fn()
    const row = (connectionId: string) => ({
        platform: "slack" as const,
        kind: "hosted" as const,
        status: "connected" as const,
        connectionId,
        dm: "allow" as const,
        group: "allow" as const,
        chats: [],
    })
    const reload = vi
        .fn()
        .mockResolvedValueOnce({slack: row("old"), telegram: null, allConnections: [row("old")]})
        .mockResolvedValue({
            slack: row("old"),
            telegram: null,
            allConnections: [row("old"), row("new")],
        })
    await act(async () =>
        root.render(
            <ChannelConnectFlow
                platform="slack"
                agentName="QA"
                onConnected={connected}
                pollIntervalMs={100}
                knownConnectionIds={["old"]}
                adding
                actions={{
                    ...NOOP_ACTIONS,
                    hostedSlackInstallUrl: async () => "https://slack.com/synthetic",
                    reload,
                    connectHere,
                }}
            />,
        ),
    )
    expect(container.textContent).toContain("Your other workspaces stay connected.")
    await click("Add to Slack")
    await advance(100)
    expect(connectHere).not.toHaveBeenCalled()
    await advance(100)
    expect(connectHere).toHaveBeenCalledWith("slack", "new")
    expect(connected).toHaveBeenCalled()
})

it("turns the Agenta bot off when this agent already answers through it", async () => {
    const loadSetup = vi.fn(async () => ({
        manifest: null,
        fields: [{name: "bot_token", label: "Bot token", secret: true, required: true}],
        hostedAvailable: true,
    }))
    const mint = vi.fn()
    await act(async () =>
        root.render(
            <ChannelConnectFlow
                platform="telegram"
                agentName="QA"
                onConnected={vi.fn()}
                hostedConnectedHere
                actions={{...NOOP_ACTIONS, loadSetup, connectHostedTelegram: mint}}
            />,
        ),
    )
    const hosted = container.querySelector(
        '[data-testid="channels-method-hosted"]',
    ) as HTMLButtonElement
    expect(hosted.disabled).toBe(true)
    expect(container.textContent).toContain("Connect bot")
    expect(mint).not.toHaveBeenCalled()
})
