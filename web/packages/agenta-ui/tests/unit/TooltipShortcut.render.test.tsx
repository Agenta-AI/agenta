// @vitest-environment jsdom
import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {Kbd} from "../../src/components/ui/kbd"
import {ShortcutKeys} from "../../src/shortcuts/ShortcutKeys"
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "../../src/components/ui/tooltip"

// jsdom has no ResizeObserver; Radix measures the arrow with one.
class StubResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}
globalThis.ResizeObserver ??= StubResizeObserver as unknown as typeof ResizeObserver

afterEach(cleanup)

describe("Tooltip shortcut", () => {
    it("renders caps inside the forced-open content", () => {
        render(
            <TooltipProvider>
                <Tooltip open>
                    <TooltipTrigger asChild>
                        <button type="button">go</button>
                    </TooltipTrigger>
                    <TooltipContent shortcut="Esc">Close</TooltipContent>
                </Tooltip>
            </TooltipProvider>,
        )
        const content = document.querySelector('[data-slot="tooltip-content"]')
        expect(content).not.toBeNull()
        expect(content!.className).toContain("text-field-sm")
        expect(content!.className).not.toContain("text-field-md")
        const caps = content!.querySelectorAll('[data-slot="kbd"]')
        expect(Array.from(caps).map((c) => c.textContent)).toEqual(["Esc"])
    })

    it("prints nothing for an empty chord", () => {
        render(
            <TooltipProvider>
                <Tooltip open>
                    <TooltipTrigger asChild>
                        <button type="button">go</button>
                    </TooltipTrigger>
                    <TooltipContent shortcut={[]}>Close</TooltipContent>
                </Tooltip>
            </TooltipProvider>,
        )
        expect(document.querySelector('[data-slot="tooltip-shortcut"]')).toBeNull()
    })

    it("ShortcutKeys prints Kbd caps", () => {
        render(<ShortcutKeys chord={{modifiers: ["mod"], key: "k"}} tone="inverse" size="md" />)
        const caps = document.querySelectorAll('[data-slot="kbd"]')
        expect(caps.length).toBe(2)
        expect(caps[0].className).toContain("bg-white/20")
        expect(caps[0].className).toContain("h-5")
    })

    it("Kbd flips to the inverse tone only under tooltip content", () => {
        render(<Kbd>K</Kbd>)
        expect(screen.getByText("K").className).toContain(
            "[[data-slot=tooltip-content]_&]:bg-white/20",
        )
    })
})
