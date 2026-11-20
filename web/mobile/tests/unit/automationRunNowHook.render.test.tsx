// @vitest-environment jsdom
/**
 * "Run now" keeps today's browser path: a new session with the automation's message, and the
 * screen moves to it. The detail button and the list row menu call the one hook and refuse for
 * the same reasons.
 */
import {act, createElement} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const startTask = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
const hookCalls = vi.hoisted(() => [] as string[])

vi.mock("next/router", () => ({useRouter: () => ({push: vi.fn(), basePath: "/m"})}))
vi.mock("@/features/chat/useStartTaskSession", () => ({useStartTaskSession: () => startTask}))
vi.mock("@/features/automations/runNowText", () => ({
    runNowText: async () => "Summarize yesterday's tickets",
}))
vi.mock("@agenta/ui/app-message", () => ({
    message: {error: toastError, success: vi.fn(), info: vi.fn()},
}))
vi.mock("@agenta/automation-ui", () => ({
    useAutomation: () => ({remove: vi.fn(), setActive: vi.fn()}),
}))
vi.mock("@/features/automations/useAutomationRunNow", async (importOriginal) => {
    const actual =
        await importOriginal<typeof import("@/features/automations/useAutomationRunNow")>()
    return {
        ...actual,
        useAutomationRunNow: (...args: Parameters<typeof actual.useAutomationRunNow>) => {
            hookCalls.push(args[0]?.id ?? "")
            return actual.useAutomationRunNow(...args)
        },
    }
})

import type {Automation} from "@agenta/automation-ui"

import {AutomationActionsMenu} from "@/features/automations/AutomationActionsMenu"
import {AutomationTestRunButton} from "@/features/automations/AutomationTestRunButton"

const automation = (overrides: Partial<Automation> = {}) =>
    ({
        id: "sch-1",
        kind: "schedule",
        name: "Daily summary",
        agentId: "agent-1",
        isActive: true,
        raw: {data: {inputs_fields: {message: "Summarize yesterday's tickets"}}},
        ...overrides,
    }) as unknown as Automation

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    startTask.mockReset()
    toastError.mockReset()
    hookCalls.length = 0
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

const flush = () => act(async () => await new Promise((resolve) => setTimeout(resolve, 0)))

describe("Run now", () => {
    it("starts a new session with the automation's message from the button", async () => {
        act(() =>
            root.render(
                createElement(AutomationTestRunButton, {
                    automation: automation(),
                    base: "/w/ws/p/pr",
                    dirty: false,
                }),
            ),
        )
        expect(hookCalls).toContain("sch-1")
        const button = container.querySelector("button") as HTMLButtonElement
        expect(button.disabled).toBe(false)
        act(() => button.click())
        await flush()
        expect(startTask).toHaveBeenCalledWith("agent-1", "Summarize yesterday's tickets")
    })

    it("is blocked with the production reason while settings have unsaved edits", () => {
        act(() =>
            root.render(
                createElement(AutomationTestRunButton, {
                    automation: automation(),
                    base: "/w/ws/p/pr",
                    dirty: true,
                }),
            ),
        )
        const button = container.querySelector("button") as HTMLButtonElement
        expect(button.disabled).toBe(true)
        expect(button.title.startsWith("Save your changes first")).toBe(true)
    })

    it("is blocked when the automation has no instruction", () => {
        act(() =>
            root.render(
                createElement(AutomationTestRunButton, {
                    automation: automation({raw: {data: {inputs_fields: {}}}} as never),
                    base: "/w/ws/p/pr",
                    dirty: false,
                }),
            ),
        )
        expect((container.querySelector("button") as HTMLButtonElement).title).toBe(
            "Add an instruction to test this automation",
        )
    })

    it("starts the same session from the list row menu, through the same hook", async () => {
        act(() =>
            root.render(
                createElement(AutomationActionsMenu, {
                    automation: automation(),
                    base: "/w/ws/p/pr",
                    surface: "list",
                }),
            ),
        )
        expect(hookCalls).toContain("sch-1")
        const trigger = container.querySelector("button") as HTMLButtonElement
        act(() => {
            trigger.focus()
            trigger.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}))
        })
        const item = [...document.querySelectorAll("[role=menuitem]")].find(
            (element) => element.textContent === "Run now",
        ) as HTMLElement
        expect(item).toBeTruthy()
        act(() => item.click())
        await flush()
        expect(startTask).toHaveBeenCalledWith("agent-1", "Summarize yesterday's tickets")
    })

    it("tells the reason in a toast when the row menu cannot run", async () => {
        act(() =>
            root.render(
                createElement(AutomationActionsMenu, {
                    automation: automation({agentId: null} as never),
                    base: "/w/ws/p/pr",
                    surface: "list",
                }),
            ),
        )
        const trigger = container.querySelector("button") as HTMLButtonElement
        act(() => {
            trigger.focus()
            trigger.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}))
        })
        const item = [...document.querySelectorAll("[role=menuitem]")].find(
            (element) => element.textContent === "Run now",
        ) as HTMLElement
        act(() => item.click())
        await flush()
        expect(startTask).not.toHaveBeenCalled()
        expect(toastError).toHaveBeenCalledWith("Pick the agent this automation runs first")
    })
})
