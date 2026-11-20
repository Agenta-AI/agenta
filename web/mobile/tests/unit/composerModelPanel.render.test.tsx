/** @vitest-environment jsdom */
import type {ProviderGroup} from "@agenta/ui/select-llm-provider"
import {cleanup, fireEvent, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import {ComposerModelPanel} from "@/features/chat/ComposerModelPanel"

afterEach(cleanup)

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
        fireEvent.keyDown(document, {key: "Escape"})
        expect(handlers.onDismiss).toHaveBeenCalledWith("escape")
    })
})
