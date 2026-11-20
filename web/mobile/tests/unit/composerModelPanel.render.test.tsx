/** @vitest-environment jsdom */
import type {ProviderGroup} from "@agenta/ui/select-llm-provider"
import {cleanup, fireEvent, render, screen} from "@testing-library/react"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {ComposerModelPanel} from "@/features/chat/ComposerModelPanel"

afterEach(cleanup)

// A mouse: the search takes the caret. A touch screen keeps it, so its keyboard stays down.
const pointer = {fine: true}
beforeEach(() => {
    window.matchMedia = ((query: string) => ({
        matches: query === "(pointer: fine)" ? pointer.fine : false,
    })) as unknown as typeof window.matchMedia
    pointer.fine = true
    // jsdom does not lay out, so it has no scrolling.
    Element.prototype.scrollIntoView = vi.fn()
})

const groups: ProviderGroup[] = [
    {
        key: "agenta",
        label: "Agenta",
        tag: "Built-in",
        iconKey: "agenta",
        options: [
            {key: "agenta::gemini", value: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash"},
            {key: "agenta::argon", value: "google/gemini-4-argon", label: "Gemini 4 Argon"},
        ],
    },
    {
        key: "openrouter",
        label: "openrouter",
        iconKey: "openrouter",
        options: [{key: "or::gpt", value: "openai/gpt-5.5", label: "OpenAI: GPT-5.5"}],
    },
]

const renderPanel = (props: Partial<Parameters<typeof ComposerModelPanel>[0]> = {}) => {
    const handlers = {
        onPick: vi.fn(),
        onDismiss: vi.fn(),
        onManageProviders: vi.fn(),
    }
    render(
        <ComposerModelPanel
            groups={groups}
            selectedKey="agenta::argon"
            value="google/gemini-4-argon"
            {...handlers}
            {...props}
        />,
    )
    return handlers
}

describe("ComposerModelPanel", () => {
    it("draws one list grouped by connection, with raw ids and a check on the current model", () => {
        renderPanel()
        // Every group is open at once: no connection column to hover first.
        expect(screen.getByText("Agenta")).toBeTruthy()
        expect(screen.getByText("Built-in")).toBeTruthy()
        expect(screen.getByText("openrouter")).toBeTruthy()
        expect(screen.getByText("google/gemini-3.8-flash")).toBeTruthy()
        expect(screen.getByText("openai/gpt-5.5")).toBeTruthy()
        const current = screen.getByRole("button", {name: /Gemini 4 Argon/})
        expect(current.getAttribute("aria-pressed")).toBe("true")
        expect(current.querySelector("svg")).not.toBeNull()
        const other = screen.getByRole("button", {name: /Gemini 3.8 Flash/})
        expect(other.getAttribute("aria-pressed")).toBe("false")
        // The current model is brought into view when the list opens.
        expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({block: "nearest"})
        expect(vi.mocked(Element.prototype.scrollIntoView).mock.contexts[0]).toBe(current)
        // The search field has its icon and names the command.
        expect(screen.getByText("/model")).toBeTruthy()
        expect(document.activeElement).toBe(screen.getByPlaceholderText("Search models"))
    })

    it("picks a model and opens the providers", () => {
        const handlers = renderPanel()
        fireEvent.click(screen.getByRole("button", {name: /GPT-5.5/}))
        expect(handlers.onPick).toHaveBeenCalledWith(
            "openai/gpt-5.5",
            expect.objectContaining({key: "or::gpt"}),
        )
        fireEvent.click(screen.getByRole("button", {name: "Manage model providers"}))
        expect(handlers.onManageProviders).toHaveBeenCalledOnce()
    })

    it("filters by the search text", () => {
        renderPanel()
        fireEvent.change(screen.getByPlaceholderText("Search models"), {target: {value: "argon"}})
        expect(screen.getByText("Gemini 4 Argon")).toBeTruthy()
        expect(screen.queryByText("OpenAI: GPT-5.5")).toBeNull()
    })

    it("offers the way back only when /model opened it", () => {
        renderPanel()
        expect(screen.queryByText(/back to commands/)).toBeNull()
        cleanup()
        const onBackToCommands = vi.fn()
        renderPanel({onBackToCommands})
        fireEvent.click(screen.getByText(/back to commands/))
        expect(onBackToCommands).toHaveBeenCalledOnce()
    })

    it("closes on Escape and on a press outside, not on a press inside", () => {
        const handlers = renderPanel()
        fireEvent.pointerDown(screen.getByText("Gemini 3.8 Flash"))
        expect(handlers.onDismiss).not.toHaveBeenCalled()
        fireEvent.pointerDown(document.body)
        expect(handlers.onDismiss).toHaveBeenCalledWith("outside")
        // The list takes its Escape, so the chat's Escape (Stop) does not run as well.
        const escape = new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
        })
        document.dispatchEvent(escape)
        expect(handlers.onDismiss).toHaveBeenCalledWith("escape")
        expect(escape.defaultPrevented).toBe(true)
        // And it reads as an open layer to the chat's other shortcuts.
        expect(document.querySelector('[role="dialog"][data-state="open"]')).not.toBeNull()
    })

    it("leaves the caret alone on a touch screen", () => {
        pointer.fine = false
        renderPanel()
        expect(document.activeElement).not.toBe(screen.getByPlaceholderText("Search models"))
        // The list takes focus instead, so an attached keyboard can still walk it.
        const panel = screen.getByRole("dialog")
        expect(document.activeElement).toBe(panel)
        fireEvent.keyDown(panel, {key: "ArrowDown"})
        expect(document.activeElement).toBe(screen.getByPlaceholderText("Search models"))
    })

    it("walks the rows with the arrow keys and goes back with Left from an empty search", () => {
        const onBackToCommands = vi.fn()
        renderPanel({onBackToCommands})
        const search = screen.getByPlaceholderText("Search models")
        fireEvent.keyDown(search, {key: "ArrowDown"})
        expect(document.activeElement).toBe(screen.getByRole("button", {name: /Gemini 3.8 Flash/}))
        fireEvent.keyDown(document.activeElement!, {key: "ArrowDown"})
        expect(document.activeElement).toBe(screen.getByRole("button", {name: /Gemini 4 Argon/}))
        fireEvent.keyDown(document.activeElement!, {key: "ArrowUp"})
        fireEvent.keyDown(document.activeElement!, {key: "ArrowUp"})
        expect(document.activeElement).toBe(search)
        fireEvent.keyDown(search, {key: "ArrowLeft"})
        expect(onBackToCommands).toHaveBeenCalledOnce()
    })

    it("keeps a press on its own button from closing it as a press outside", () => {
        const trigger = document.createElement("button")
        document.body.appendChild(trigger)
        const handlers = renderPanel({triggerRef: {current: trigger}})
        fireEvent.pointerDown(trigger)
        expect(handlers.onDismiss).not.toHaveBeenCalled()
        trigger.remove()
    })
})
