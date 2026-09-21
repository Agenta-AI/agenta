// @vitest-environment jsdom
/**
 * The tool row's "Show more" was the last MCP control under the touch minimum: an inline toggle
 * with no chrome, sitting on the control scale's 24px floor. It keeps that floor, because giving
 * it 44px of its own would push every tool row taller on the desktop, and grows an invisible box
 * to the minimum instead.
 *
 * Asserted through the shared reader so a later change to the floor has to change the expansion
 * with it. Only the height is asserted: the toggle's own label is wider than the minimum, and no
 * class states its width for a test to read.
 *
 * A newline is what makes the toggle appear at all here, because jsdom has no layout and the
 * width measurement the row normally uses always reads zero.
 */
import {act, createElement} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it} from "vitest"

import {TOUCH_TARGET_MINIMUM_PX, touchTargetHeight, touchTargetWidth} from "@agenta/ui/ui"

import {ExpandableDescription} from "../../src/DrillInView/SchemaControls/agentTemplate/ExpandableDescription"

const MULTILINE = "Merges a pull request.\n\nFails on a closed pull request."

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

const renderDescription = async () => {
    await act(async () => {
        root.render(
            createElement(ExpandableDescription, {
                description: MULTILINE,
                label: "merge_pull_request",
            }),
        )
    })
}

const toggle = () => {
    const found = host.querySelector<HTMLButtonElement>("button")
    expect(found, "no Show more toggle").not.toBeNull()
    return found!
}

describe("the tool row's Show more toggle", () => {
    it("has a 44px hit area while keeping its 24px floor", async () => {
        await renderDescription()

        expect(toggle().getAttribute("aria-label")).toBe("Show more about merge_pull_request")
        expect(toggle().className).toContain("min-h-control-xs")
        expect(touchTargetHeight(toggle().className)).toBe(TOUCH_TARGET_MINIMUM_PX)
        expect(touchTargetWidth(toggle().className), "the label carries the width").toBeNull()
    })

    it("keeps the hit area once the description is open", async () => {
        // The toggle becomes "Show less" in place and is the control that closes the row again,
        // so losing the expansion on the expanded state would strand a reader who opened one.
        await renderDescription()
        await act(async () => {
            toggle().click()
        })

        expect(toggle().getAttribute("aria-label")).toBe("Show less about merge_pull_request")
        expect(touchTargetHeight(toggle().className)).toBe(TOUCH_TARGET_MINIMUM_PX)
    })

    it("gains the hit area with nothing a reader can see", async () => {
        await renderDescription()

        expect(toggle().className).not.toMatch(/after:(bg|border|text|shadow)-/)
        expect(toggle().className).toContain("bg-transparent")
    })
})
