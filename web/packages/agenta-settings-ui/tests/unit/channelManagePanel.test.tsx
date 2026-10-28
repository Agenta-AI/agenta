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
        SheetFooter: ({children}: {children?: React.ReactNode}) => <div>{children}</div>,
        Button: ({children, onClick, disabled, ...props}: React.ComponentProps<"button">) => (
            <button disabled={disabled} onClick={onClick} data-testid={props["data-testid"]}>
                {children}
            </button>
        ),
        Checkbox: ({
            checked,
            onCheckedChange,
            disabled,
            ...props
        }: {
            checked?: boolean
            onCheckedChange?: (value: boolean) => void
            disabled?: boolean
            "aria-label"?: string
            "data-testid"?: string
        }) => (
            <input
                type="checkbox"
                checked={!!checked}
                disabled={disabled}
                aria-label={props["aria-label"]}
                data-testid={props["data-testid"]}
                onChange={(e) => onCheckedChange?.(e.target.checked)}
            />
        ),
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
const render = async (
    overrides: Partial<ChannelsActions>,
    connection: {platform?: "telegram" | "slack"; kind?: "hosted" | "custom"} = {},
) => {
    await act(async () =>
        root.render(
            <ChannelManagePanel
                agentName="QA"
                agentId="agent"
                connection={{
                    platform: connection.platform ?? "telegram",
                    kind: connection.kind ?? "hosted",
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
    const readAudience = vi
        .fn()
        .mockRejectedValueOnce(new Error("Allowed accounts unavailable"))
        .mockResolvedValue([person("123")])
    await render({readAudience})
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
    let behavior = {dm: true, group: true, channels: null as string[] | null}
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
    const writeAudience = vi.fn(async () => {})
    await render({readAudience: vi.fn().mockResolvedValue([person("111")]), writeAudience})
    await type('[data-testid="channels-allowed-input"]', "222, 333")
    const add = [...container.querySelectorAll("button")].find((b) => b.textContent === "Add")!
    await act(async () => add.click())
    expect(writeAudience).toHaveBeenCalledWith("connection", [
        person("111"),
        person("222"),
        person("333"),
    ])
    expect(container.querySelectorAll('[data-testid="channels-allowed-user"]')).toHaveLength(3)
})
it("refuses a Telegram username, which the bot could never match", async () => {
    const writeAudience = vi.fn(async () => {})
    await render({readAudience: vi.fn().mockResolvedValue([person("111")]), writeAudience})
    await type('[data-testid="channels-allowed-input"]', "222, @ana")
    const add = [...container.querySelectorAll("button")].find((b) => b.textContent === "Add")!
    await act(async () => add.click())
    expect(writeAudience).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="channels-allowed-error"]')?.textContent).toBe(
        "Enter the numeric Telegram ID. A username cannot be matched.",
    )
})
it("clears the allowed list when access goes back to everyone", async () => {
    const writeAudience = vi.fn(async () => {})
    await render({readAudience: vi.fn().mockResolvedValue([person("111")]), writeAudience})
    const select = container.querySelector('[data-testid="allowed-mode"]') as HTMLSelectElement
    await act(async () => {
        select.value = "everyone"
        select.dispatchEvent(new Event("change", {bubbles: true}))
    })
    expect(writeAudience).toHaveBeenCalledWith("connection", [])
    expect(container.textContent).toContain("Any Telegram account can message the bot.")
})
it("returns to Everyone when the last person is removed", async () => {
    const writeAudience = vi.fn(async () => {})
    await render({readAudience: vi.fn().mockResolvedValue([person("111")]), writeAudience})
    const remove = container.querySelector(
        '[data-testid="channels-allowed-user"] button',
    ) as HTMLButtonElement
    await act(async () => remove.click())
    expect(writeAudience).toHaveBeenCalledWith("connection", [])
    expect(
        (container.querySelector('[data-testid="allowed-mode"]') as HTMLSelectElement).value,
    ).toBe("everyone")
    expect(container.textContent).toContain("Any Telegram account can message the bot.")
})
it("offers Who can message it on Slack and picks a person by name", async () => {
    const writeAudience = vi.fn(async () => {})
    const queryPeople = vi.fn(async () => ({
        people: [
            {
                id: "U2",
                name: "Ben Ito",
                email: "ben@example.com",
                username: "ben",
                isGuest: false,
                isBot: false,
                isDeleted: false,
                source: "directory" as const,
            },
        ],
        directory: {state: "ready" as const, updatedAt: new Date().toISOString()},
    }))
    await render(
        {readAudience: vi.fn().mockResolvedValue([]), writeAudience, queryPeople},
        {platform: "slack", kind: "custom"},
    )
    expect(container.textContent).toContain("Any Slack member can message the bot.")
    const select = container.querySelector('[data-testid="allowed-mode"]') as HTMLSelectElement
    await act(async () => {
        select.value = "specific"
        select.dispatchEvent(new Event("change", {bubbles: true}))
    })
    await type('[data-testid="channels-allowed-input"]', "ben")
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300))
    })
    expect(queryPeople).toHaveBeenCalledWith("connection", "ben")
    const result = container.querySelector(
        '[data-testid="channels-people-result"]',
    ) as HTMLButtonElement
    await act(async () => result.click())
    expect(writeAudience).toHaveBeenCalledWith("connection", [
        {id: "U2", name: "Ben Ito", email: "ben@example.com"},
    ])
})
it("marks a channel left unchecked under Only these channels as off", async () => {
    const listSpaces = vi.fn().mockResolvedValue([
        {id: "c-support", kind: "topic", name: "#support"},
        {id: "c-random", kind: "topic", name: "#random"},
    ])
    const readBehavior = vi.fn(async () => ({dm: true, group: true, channels: ["c-support"]}))
    await render({listSpaces, readBehavior}, {platform: "slack", kind: "custom"})
    const rows = [...container.querySelectorAll('[data-testid="channels-space"]')].map(
        (row) => row.textContent,
    )
    expect(rows).toEqual(["#supportMentions only", "#randomOff"])
})
it("adds several channels from the picker at once", async () => {
    const addSpace = vi.fn(async () => {})
    const discoverSpaces = vi
        .fn()
        .mockResolvedValue([candidate("#support"), candidate("#ops"), candidate("#random")])
    await render({addSpace, discoverSpaces}, {platform: "slack", kind: "custom"})
    await act(async () =>
        (
            container.querySelector('[data-testid="channels-add-space"]') as HTMLButtonElement
        ).click(),
    )
    await type('[data-testid="channels-space-search"]', "p")
    const boxes = [...container.querySelectorAll('[data-testid="channels-space-candidate"] input')]
    // "p" matches #support and #ops, not #random
    expect(boxes).toHaveLength(2)
    for (const box of boxes) await act(async () => (box as HTMLInputElement).click())
    const add = container.querySelector('[data-testid="channels-space-add"]') as HTMLButtonElement
    expect(add.textContent).toBe("Add 2 channels")
    await act(async () => add.click())
    expect(addSpace).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[data-testid="channels-space-picker"]')).toBeNull()
})

function person(id: string) {
    return {id, name: null, email: null}
}

function candidate(name: string) {
    return {
        kind: "topic" as const,
        externalLocator: {channel: name},
        displayName: name,
        isConfigured: false,
        membership: "member" as const,
    }
}

async function type(selector: string, value: string) {
    const input = container.querySelector(selector) as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    await act(async () => {
        setter.call(input, value)
        input.dispatchEvent(new Event("input", {bubbles: true}))
    })
}
