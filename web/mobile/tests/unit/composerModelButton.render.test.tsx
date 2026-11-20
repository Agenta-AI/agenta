/** @vitest-environment jsdom */
import type {ProviderGroup} from "@agenta/ui/select-llm-provider"
import {cleanup, fireEvent, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import {ComposerModelButton} from "@/features/chat/ComposerModelButton"
import {selectedModelOf} from "@/features/chat/selectedModelOf"

afterEach(cleanup)

const groups: ProviderGroup[] = [
    {
        key: "agenta",
        label: "Agenta",
        iconKey: "agenta",
        options: [{key: "agenta::gpt-5.5", value: "gpt-5.5", label: "GPT-5.5 (built-in)"}],
    },
    {
        key: "anthropic-org",
        label: "Anthropic",
        iconKey: "anthropic",
        options: [
            {
                key: "anthropic-org::claude-sonnet-5-5",
                value: "claude-sonnet-5-5",
                label: "Claude Sonnet 5.5",
            },
        ],
    },
    {
        key: "openai-key",
        label: "OpenAI",
        iconKey: "openai",
        options: [{key: "openai-key::gpt-5.5", value: "gpt-5.5", label: "GPT-5.5"}],
    },
]

describe("selectedModelOf", () => {
    it("takes the row the key names, not the first row with the same model id", () => {
        expect(selectedModelOf(groups, "openai-key::gpt-5.5", "gpt-5.5")).toEqual({
            label: "GPT-5.5",
            iconKey: "openai",
        })
    })

    it("matches by model id only when no key is known, as the list does", () => {
        expect(selectedModelOf(groups, null, "claude-sonnet-5-5")).toEqual({
            label: "Claude Sonnet 5.5",
            iconKey: "anthropic",
        })
        // A key the list no longer has marks no row in the list, so the button names no row.
        expect(selectedModelOf(groups, "gone::gpt-5.5", "gpt-5.5")).toBeNull()
        expect(selectedModelOf(groups, null, "unknown")).toBeNull()
    })
})

describe("ComposerModelButton", () => {
    it("shows the logo, the model name and a caret, and opens the list", () => {
        const onOpen = vi.fn()
        const onClose = vi.fn()
        render(
            <ComposerModelButton
                groups={groups}
                selectedKey="anthropic-org::claude-sonnet-5-5"
                modelId="claude-sonnet-5-5"
                open={false}
                onOpen={onOpen}
                onClose={onClose}
            />,
        )
        const button = screen.getByRole("button", {name: "Model: Claude Sonnet 5.5"})
        expect(button.textContent).toBe("Claude Sonnet 5.5")
        expect(button.getAttribute("aria-expanded")).toBe("false")
        // Logo and caret.
        expect(button.querySelectorAll("svg").length).toBe(2)
        // The name is cut with "…" rather than wrapping the composer row.
        expect(screen.getByText("Claude Sonnet 5.5").className).toContain("truncate")
        fireEvent.pointerDown(button)
        fireEvent.click(button, {detail: 1})
        expect(onOpen).toHaveBeenCalledOnce()
        expect(onClose).not.toHaveBeenCalled()
    })

    it("closes on a press that started while the list was open", () => {
        const onOpen = vi.fn()
        const onClose = vi.fn()
        const view = render(
            <ComposerModelButton
                groups={groups}
                selectedKey={null}
                modelId="claude-sonnet-5-5"
                open
                onOpen={onOpen}
                onClose={onClose}
            />,
        )
        const button = screen.getByRole("button", {name: "Model: Claude Sonnet 5.5"})
        fireEvent.pointerDown(button)
        // The list closes on the pointer-down outside it before the click lands.
        view.rerender(
            <ComposerModelButton
                groups={groups}
                selectedKey={null}
                modelId="claude-sonnet-5-5"
                open={false}
                onOpen={onOpen}
                onClose={onClose}
            />,
        )
        fireEvent.click(button, {detail: 1})
        expect(onOpen).not.toHaveBeenCalled()
        expect(onClose).toHaveBeenCalledOnce()
        // A keyboard click (no press) reads the state as it is now.
        fireEvent.click(button, {detail: 0})
        expect(onOpen).toHaveBeenCalledOnce()
    })

    it("marks the open state and shows the raw id when the list has no such row", () => {
        render(
            <ComposerModelButton
                groups={groups}
                selectedKey={null}
                modelId="custom/model-x"
                open
                onOpen={vi.fn()}
                onClose={vi.fn()}
            />,
        )
        const button = screen.getByRole("button", {name: "Model: custom/model-x"})
        expect(button.getAttribute("aria-expanded")).toBe("true")
        expect(button.getAttribute("data-state")).toBe("open")
        // No row, no logo: only the caret.
        expect(button.querySelectorAll("svg").length).toBe(1)
    })
})
