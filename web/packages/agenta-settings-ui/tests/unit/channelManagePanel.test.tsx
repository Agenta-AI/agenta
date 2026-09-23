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
        Switch: ({
            onCheckedChange,
            checked,
            disabled,
            ...props
        }: {
            onCheckedChange: (value: boolean) => void
            checked: boolean
            disabled: boolean
            "data-testid"?: string
        }) => (
            <button
                data-testid={props["data-testid"]}
                disabled={disabled}
                onClick={() => onCheckedChange(!checked)}
            />
        ),
    }
})
import {ChannelManagePanel} from "../../src/channels/ChannelManagePanel"
import {NOOP_ACTIONS} from "../../src/channels/helpers"
import type {ChannelsActions} from "../../src/channels/types"

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
const render = async (overrides: Partial<ChannelsActions>) => {
    await act(async () =>
        root.render(
            <ChannelManagePanel
                agentName="QA"
                agentId="agent"
                connection={{
                    platform: "telegram",
                    kind: "hosted",
                    status: "connected",
                    connectionId: "connection",
                    agent: {id: "agent", name: "QA"},
                    dm: "allow",
                    group: "allow",
                    chats: [],
                }}
                onConnectHere={async () => {}}
                onDisconnect={async () => {}}
                actions={{...NOOP_ACTIONS, ...overrides}}
            />,
        ),
    )
}
it("shows an unknown allowed-user state on lookup failure and allows retry", async () => {
    const readAllowedUsers = vi
        .fn()
        .mockRejectedValueOnce(new Error("Allowed accounts unavailable"))
        .mockResolvedValue(["123"])
    await render({readAllowedUsers})
    expect(container.textContent).toContain("Allowed accounts unavailable")
    expect(container.textContent).not.toContain("Everyone")
    expect(
        (container.querySelector('[data-testid="channels-allowed-edit"]') as HTMLButtonElement)
            .disabled,
    ).toBe(true)
    const retry = [...container.querySelectorAll("button")].find(
        (b) => b.textContent === "Try again",
    )!
    await act(async () => retry.click())
    expect(container.textContent).toContain("1 account")
    expect(container.textContent).not.toContain("Allowed accounts unavailable")
})
it("keeps failed-save feedback after refreshing behavior grants", async () => {
    await render({writeBehavior: vi.fn().mockRejectedValue(new Error("Setting save failed"))})
    await act(async () =>
        (
            container.querySelector('[data-testid="channels-behavior-dm"]') as HTMLButtonElement
        ).click(),
    )
    expect(container.textContent).toContain("Setting save failed")
})
it("shows every private chat as one Direct messages row", async () => {
    const listSpaces = vi.fn().mockResolvedValue([
        {id: "dm-1", kind: "private", name: "Direct messages"},
        {id: "dm-2", kind: "private", name: "Direct messages"},
        {id: "group-1", kind: "group", name: "Team"},
    ])
    await render({listSpaces})
    const rows = [...container.querySelectorAll('[data-testid="channels-space"]')].map(
        (row) => row.textContent,
    )
    expect(rows).toEqual(["Direct messages", "Team"])
})
it("marks Direct messages off once the switch turns them off", async () => {
    let behavior = {dm: true, group: true}
    const readBehavior = vi.fn(async () => behavior)
    const writeBehavior = vi.fn(async (_p: unknown, _c: unknown, next: typeof behavior) => {
        behavior = next
    })
    const listSpaces = vi
        .fn()
        .mockResolvedValue([{id: "dm-1", kind: "private", name: "Direct messages"}])
    await render({readBehavior, writeBehavior, listSpaces})
    const row = () => container.querySelector('[data-testid="channels-space"]')?.textContent
    expect(row()).toBe("Direct messages")
    await act(async () =>
        (
            container.querySelector('[data-testid="channels-behavior-dm"]') as HTMLButtonElement
        ).click(),
    )
    expect(writeBehavior).toHaveBeenCalledWith(
        "telegram",
        "connection",
        expect.objectContaining({dm: false, group: true}),
    )
    expect(row()).toBe("Direct messagesOff")
})
it("shows no read-only settings: no Advanced defaults and no Status row", async () => {
    await render({})
    const text = container.textContent ?? ""
    for (const gone of [
        "Advanced",
        "Session memory",
        "Read earlier messages",
        "Read while thinking",
        "Message triggers",
        "Status",
        "Active",
    ]) {
        expect(text).not.toContain(gone)
    }
    expect(container.querySelector('[data-testid="channels-status"]')).toBeNull()
})
