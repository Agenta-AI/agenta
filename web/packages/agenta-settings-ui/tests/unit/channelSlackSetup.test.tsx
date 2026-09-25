// @vitest-environment jsdom
import React, {act} from "react"
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
        Button: ({children, onClick, disabled}: React.ComponentProps<"button">) => (
            <button disabled={disabled} onClick={onClick}>
                {children}
            </button>
        ),
        Input: () => <input />,
        PasswordInput: () => <input />,
        Spinner: () => <span />,
        Switch: () => <button />,
    }
})
import {ChannelManagePanel} from "../../src/channels/ChannelManagePanel"
import {NOOP_ACTIONS, fieldPatternError} from "../../src/channels/helpers"
import type {
    ChannelConnection,
    ChannelSpaceCandidate,
    ChannelsActions,
} from "../../src/channels/types"

const CANDIDATES: ChannelSpaceCandidate[] = [
    {
        kind: "topic",
        externalLocator: {channel: "C1"},
        displayName: "general",
        isConfigured: false,
        membership: "member",
    },
    {
        kind: "topic",
        externalLocator: {channel: "C2"},
        displayName: "random",
        isConfigured: false,
        membership: "joinable",
    },
    {
        kind: "topic",
        externalLocator: {channel: "C3"},
        displayName: "leadership",
        isConfigured: false,
        membership: "invite_required",
    },
]

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

const render = async (overrides: Partial<ChannelsActions>, handle?: string | null) => {
    const connection: ChannelConnection = {
        platform: "slack",
        kind: "custom",
        status: "connected",
        connectionId: "connection",
        agent: {id: "agent", name: "QA"},
        dm: "allow",
        group: "allow",
        chats: [],
        handle,
    }
    await act(async () =>
        root.render(
            <ChannelManagePanel
                agentName="QA"
                agentId="agent"
                connection={connection}
                onConnectHere={async () => {}}
                onDisconnect={async () => {}}
                actions={{
                    ...NOOP_ACTIONS,
                    discoverSpaces: async () => CANDIDATES,
                    ...overrides,
                }}
            />,
        ),
    )
    await act(async () =>
        (
            container.querySelector('[data-testid="channels-add-space"]') as HTMLButtonElement
        ).click(),
    )
}

const candidateButton = (name: string) =>
    [...container.querySelectorAll('[data-testid="channels-space-picker"] button')].find((b) =>
        b.textContent?.includes(name),
    ) as HTMLButtonElement

it("marks the channels the app is already in", async () => {
    await render({}, "@support-bot")
    expect(candidateButton("general").textContent).toContain("In channel")
    expect(candidateButton("random").textContent).not.toContain("In channel")
})

it("asks for an /invite by the bot's handle instead of adding a private channel", async () => {
    const addSpace = vi.fn(async () => {})
    await render({addSpace}, "@support-bot")
    await act(async () => candidateButton("leadership").click())
    expect(addSpace).not.toHaveBeenCalled()
    expect(container.textContent).toContain(
        "#leadership is private. Run /invite @support-bot in it in Slack",
    )
})

it("falls back to @Agenta when Slack reported no handle", async () => {
    await render({}, null)
    await act(async () => candidateButton("leadership").click())
    expect(container.textContent).toContain("/invite @Agenta")
})

it("adds a public channel and shows the join failure the backend returns", async () => {
    const addSpace = vi.fn(async () => {
        throw new Error("The Slack app lacks the channels:join permission.")
    })
    await render({addSpace}, "@support-bot")
    await act(async () => candidateButton("random").click())
    expect(addSpace).toHaveBeenCalledWith("connection", CANDIDATES[1])
    expect(container.textContent).toContain("lacks the channels:join permission")
})

it("flags a Client ID in the App ID field with the declared error", () => {
    const field = {
        name: "api_app_id",
        label: "App ID",
        secret: false,
        required: true,
        pattern: "^A[A-Z0-9]+$",
        patternError: "This is not an App ID.",
    }
    expect(fieldPatternError(field, "7970714728294.12134175385185")).toBe("This is not an App ID.")
    expect(fieldPatternError(field, " A0B12CD34EF ")).toBeNull()
    expect(fieldPatternError(field, "")).toBeNull()
    expect(fieldPatternError({...field, pattern: "("}, "anything")).toBeNull()
})
