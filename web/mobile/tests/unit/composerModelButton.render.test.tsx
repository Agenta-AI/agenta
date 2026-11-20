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

    it("falls back to the model id when no row has the key", () => {
        expect(selectedModelOf(groups, null, "claude-sonnet-5-5")).toEqual({
            label: "Claude Sonnet 5.5",
            iconKey: "anthropic",
        })
        expect(selectedModelOf(groups, null, "unknown")).toBeNull()
    })
})

describe("ComposerModelButton", () => {
    it("shows the logo, the model name and a caret, and opens the list", () => {
        const onOpen = vi.fn()
        const onPressStart = vi.fn()
        render(
            <ComposerModelButton
                groups={groups}
                selectedKey="anthropic-org::claude-sonnet-5-5"
                modelId="claude-sonnet-5-5"
                open={false}
                onPressStart={onPressStart}
                onOpen={onOpen}
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
        fireEvent.click(button)
        expect(onPressStart).toHaveBeenCalledOnce()
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
            />,
        )
        const button = screen.getByRole("button", {name: "Model: custom/model-x"})
        expect(button.getAttribute("aria-expanded")).toBe("true")
        expect(button.getAttribute("data-state")).toBe("open")
        // No row, no logo: only the caret.
        expect(button.querySelectorAll("svg").length).toBe(1)
    })

    it("renders nothing with no model at all", () => {
        const {container} = render(
            <ComposerModelButton
                groups={[]}
                selectedKey={null}
                modelId={null}
                open={false}
                onOpen={vi.fn()}
            />,
        )
        expect(container.firstChild).toBeNull()
    })
})
