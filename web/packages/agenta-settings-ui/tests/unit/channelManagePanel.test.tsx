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
        Button: ({children, onClick, disabled, ...props}: React.ComponentProps<"button">) => (
            <button disabled={disabled} onClick={onClick} data-testid={props["data-testid"]}>
                {children}
            </button>
        ),
        Checkbox: () => <input type="checkbox" />,
        Input: (props: React.ComponentProps<"input">) => <input {...props} />,
        PasswordInput: () => <input />,
        RadioGroup: Wrap,
        RadioGroupItem: (props: {"data-testid"?: string}) => (
            <input type="radio" data-testid={props["data-testid"]} />
        ),
        Select: ({
            value,
            onValueChange,
            disabled,
        }: {
            value: string
            onValueChange: (value: string) => void
            disabled?: boolean
        }) => (
            <select
                data-testid="allowed-mode"
                value={value}
                disabled={disabled}
                onChange={(e) => onValueChange(e.target.value)}
            >
                <option value="everyone" />
                <option value="specific" />
            </select>
        ),
        SelectContent: Wrap,
        SelectItem: Wrap,
        SelectTrigger: Wrap,
        SelectValue: () => null,
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
    expect(container.textContent).toContain("Unavailable")
    expect(
        (container.querySelector('[data-testid="allowed-mode"]') as HTMLSelectElement).disabled,
    ).toBe(true)
    const retry = [...container.querySelectorAll("button")].find(
        (b) => b.textContent === "Try again",
    )!
    await act(async () => retry.click())
    expect(container.textContent).toContain("Only 1 account.")
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
    expect(rows).toEqual(["Direct messages", "TeamMentions only"])
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
it("shows no read-only settings: Advanced holds only editable controls and no Status row", async () => {
    await render({})
    const toggle = container.querySelector(
        '[data-testid="channels-advanced-toggle"]',
    ) as HTMLButtonElement
    expect(toggle.textContent).toBe("Advanced")
    await act(async () => toggle.click())
    const advanced = container.querySelector('[data-testid="channels-advanced"]')!
    // Every setting in the section is a control the user can change: the posting switch and
    // the readable-channels choice. Nothing is shown as a fixed value.
    const controls = [...advanced.querySelectorAll('[data-testid^="channels-advanced-"]')].map(
        (node) => node.getAttribute("data-testid"),
    )
    expect(controls).toEqual([
        "channels-advanced-toggle",
        "channels-advanced-post",
        "channels-advanced-telegram-help",
        "channels-advanced-read-all",
        "channels-advanced-read-only",
    ])
    const text = container.textContent ?? ""
    for (const gone of [
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
it("adds an allowed account and saves the list at once", async () => {
    const writeAllowedUsers = vi.fn(async () => {})
    await render({readAllowedUsers: vi.fn().mockResolvedValue(["111"]), writeAllowedUsers})
    const input = container.querySelector(
        '[data-testid="channels-allowed-input"]',
    ) as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    await act(async () => {
        setter.call(input, "222, @333")
        input.dispatchEvent(new Event("input", {bubbles: true}))
    })
    const add = [...container.querySelectorAll("button")].find((b) => b.textContent === "Add")!
    await act(async () => add.click())
    expect(writeAllowedUsers).toHaveBeenCalledWith("connection", ["222", "333", "111"])
    expect(container.querySelectorAll('[data-testid="channels-allowed-user"]')).toHaveLength(3)
})
it("clears the allowed list when access goes back to everyone", async () => {
    const writeAllowedUsers = vi.fn(async () => {})
    await render({readAllowedUsers: vi.fn().mockResolvedValue(["111"]), writeAllowedUsers})
    const select = container.querySelector('[data-testid="allowed-mode"]') as HTMLSelectElement
    await act(async () => {
        select.value = "everyone"
        select.dispatchEvent(new Event("change", {bubbles: true}))
    })
    expect(writeAllowedUsers).toHaveBeenCalledWith("connection", [])
    expect(container.textContent).toContain("Any Telegram account can message the bot.")
})
