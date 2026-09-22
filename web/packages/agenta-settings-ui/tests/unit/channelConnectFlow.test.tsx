// @vitest-environment jsdom
import React, {act, useState} from "react"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, expect, it, vi} from "vitest"

vi.mock("@agenta/ui/ui", () => ({
    Alert: ({message}: {message: string}) => <div>{message}</div>,
    Button: ({children, onClick, disabled, ...props}: React.ComponentProps<"button">) => (
        <button disabled={disabled} onClick={onClick} data-testid={props["data-testid"]}>
            {children}
        </button>
    ),
    Input: () => <input />,
    PasswordInput: () => <input />,
    Spinner: () => <span />,
    Segmented: ({onChange}: {onChange: (value: string) => void}) => (
        <button onClick={() => onChange("custom")}>choose-custom</button>
    ),
}))
vi.mock("../../src/channels/icons", () => ({AgentaMark: () => null, platformLogo: () => null}))
vi.mock("../../src/channels/qr", () => ({QrCode: () => null}))
import {ChannelConnectFlow} from "../../src/channels/ChannelConnectFlow"
import {ChannelsPage} from "../../src/channels/ChannelsPage"
import type {ChannelConnections, ChannelsActions} from "../../src/channels/types"
import {NOOP_ACTIONS} from "../../src/channels/helpers"

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
    expect(container.textContent).toContain("Continue in Telegram")
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
    await click("Copy the link instead")
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
    await click("choose-custom")
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
    await click("cancel")
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
            <ChannelsPage
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
