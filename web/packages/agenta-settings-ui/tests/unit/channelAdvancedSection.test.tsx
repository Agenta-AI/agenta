// @vitest-environment jsdom
import React, {act} from "react"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, expect, it, vi} from "vitest"

vi.mock("@agenta/ui/ui", async () => {
    const {createContext, useContext} = await import("react")
    const Radio = createContext<{value: string; onValueChange: (value: string) => void}>({
        value: "",
        onValueChange: () => {},
    })
    type Toggle = {
        onCheckedChange: (value: boolean) => void
        checked: boolean
        disabled?: boolean
        "data-testid"?: string
    }
    return {
        Alert: ({message}: {message: string}) => <div role="alert">{message}</div>,
        Button: ({children, onClick, disabled, ...props}: React.ComponentProps<"button">) => (
            <button
                disabled={disabled}
                onClick={onClick}
                data-testid={(props as {"data-testid"?: string})["data-testid"]}
            >
                {children}
            </button>
        ),
        Spinner: () => <span />,
        Switch: ({onCheckedChange, checked, disabled, ...props}: Toggle) => (
            <button
                data-testid={props["data-testid"]}
                data-checked={String(checked)}
                disabled={disabled}
                onClick={() => onCheckedChange(!checked)}
            />
        ),
        Checkbox: ({onCheckedChange, checked, disabled, ...props}: Toggle) => (
            <button
                data-testid={props["data-testid"]}
                data-checked={String(checked)}
                disabled={disabled}
                onClick={() => onCheckedChange(!checked)}
            />
        ),
        RadioGroup: ({
            value,
            onValueChange,
            children,
        }: {
            value: string
            onValueChange: (value: string) => void
            children: React.ReactNode
        }) => <Radio.Provider value={{value, onValueChange}}>{children}</Radio.Provider>,
        RadioGroupItem: ({value, ...props}: {value: string; "data-testid"?: string}) => {
            const group = useContext(Radio)
            return (
                <button
                    data-testid={props["data-testid"]}
                    data-checked={String(group.value === value)}
                    onClick={() => group.onValueChange(value)}
                />
            )
        },
    }
})
import {ChannelAdvancedSection} from "../../src/channels/ChannelAdvancedSection"
import {NOOP_ACTIONS} from "../../src/channels/helpers"
import type {ChannelPlatform, ChannelsActions} from "../../src/channels/types"

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

const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement
const click = async (id: string) => act(async () => byId(id).click())

const open = async (overrides: Partial<ChannelsActions>, platform: ChannelPlatform = "slack") => {
    await act(async () =>
        root.render(
            <ChannelAdvancedSection
                platform={platform}
                connectionId="connection"
                actions={{...NOOP_ACTIONS, ...overrides}}
            />,
        ),
    )
    await click("channels-advanced-toggle")
}

const CHANNELS = [
    {key: "k1", name: "#support", kind: "topic" as const},
    {key: "k2", name: "#releases", kind: "topic" as const},
    {key: "k3", name: "#finance", kind: "topic" as const},
]

it("is collapsed by default and loads nothing until opened", async () => {
    const readToolSettings = vi.fn(NOOP_ACTIONS.readToolSettings)
    await act(async () =>
        root.render(
            <ChannelAdvancedSection
                platform="slack"
                connectionId="connection"
                actions={{...NOOP_ACTIONS, readToolSettings}}
            />,
        ),
    )
    expect(container.textContent).toContain("Advanced")
    expect(byId("channels-advanced-post")).toBeNull()
    expect(readToolSettings).not.toHaveBeenCalled()
})

it("shows the posting switch on and All channels by default", async () => {
    await open({})
    expect(byId("channels-advanced-post").dataset.checked).toBe("true")
    expect(byId("channels-advanced-read-all").dataset.checked).toBe("true")
    expect(byId("channels-advanced-checklist")).toBeNull()
})

it("saves only the checked channels under Only these channels", async () => {
    const writeToolSettings = vi.fn(async () => {})
    await open({writeToolSettings, listReadableChannels: async () => CHANNELS})
    await click("channels-advanced-read-only")
    expect(writeToolSettings).not.toHaveBeenCalled()
    await click("channels-advanced-channel-k1")
    await click("channels-advanced-channel-k2")
    await click("channels-advanced-save")
    expect(writeToolSettings).toHaveBeenCalledWith("connection", {
        canPostOutsideConversation: true,
        readableSpaceKeys: ["k1", "k2"],
    })
})

it("shows the error and the stored value after a failed save", async () => {
    const stored = {canPostOutsideConversation: true, readableSpaceKeys: ["k1"]}
    const readToolSettings = vi.fn(async () => stored)
    await open({
        readToolSettings,
        listReadableChannels: async () => CHANNELS,
        writeToolSettings: vi.fn().mockRejectedValue(new Error("The backend refused it")),
    })
    expect(byId("channels-advanced-read-only").dataset.checked).toBe("true")
    await click("channels-advanced-read-all")
    expect(container.textContent).toContain("The backend refused it")
    expect(byId("channels-advanced-read-only").dataset.checked).toBe("true")
    expect(byId("channels-advanced-channel-k1").dataset.checked).toBe("true")
    expect(byId("channels-advanced-channel-k2").dataset.checked).toBe("false")
    expect(readToolSettings).toHaveBeenCalledTimes(2)
})

it("explains the Telegram limits", async () => {
    await open({}, "telegram")
    expect(byId("channels-advanced-telegram-help").textContent).toContain(
        "can read only messages it received",
    )
    await click("channels-advanced-read-only")
    expect(byId("channels-advanced-checklist").textContent).toContain("The bot is in no group yet")
})

it("keeps an unsaved channel checklist when the posting switch is saved", async () => {
    const writeToolSettings = vi.fn(async () => {})
    await open({writeToolSettings, listReadableChannels: async () => CHANNELS})
    await click("channels-advanced-read-only")
    await click("channels-advanced-channel-k1")
    await click("channels-advanced-post")
    expect(writeToolSettings).toHaveBeenCalledWith("connection", {
        canPostOutsideConversation: false,
        readableSpaceKeys: null,
    })
    expect(byId("channels-advanced-read-only").dataset.checked).toBe("true")
    expect(byId("channels-advanced-channel-k1").dataset.checked).toBe("true")
})
