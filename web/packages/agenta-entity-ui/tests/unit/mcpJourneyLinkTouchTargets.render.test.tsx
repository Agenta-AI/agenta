// @vitest-environment jsdom
/**
 * The three link buttons on the connect journey that were still under the touch minimum.
 *
 * They are the quiet half of each screen's actions: "Change" on the probe result, and, while a
 * consent window is open, "Open the window again" and the way out. A link with no chrome sits on
 * the control scale's smallest step, 24px, which a finger misses, and the row rhythm needs that
 * step, so each grows an invisible box instead of a taller control.
 *
 * The reach is derived here rather than asked of the kit, the way the other site packages do it.
 * D126 shipped because the helper and its reader shared one assumption, so a case that asks
 * either of them confirms the class the helper wrote rather than the box a finger gets.
 */
import {act, createElement} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {ProbeResultCard} from "../../src/mcpEndpoint/components/ProbeResultCard"

/** Control heights in px, restated here so this file does not lean on the kit for them. */
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

const buttonReading = (label: string) =>
    [...document.querySelectorAll("button")].find(
        (button) => (button.textContent ?? "").trim() === label,
    )

describe("the probe result card's Change", () => {
    it("keeps the card's own row height, which is what the expansion is for", async () => {
        // A taller control here would push the probe card's row and change what the spec draws.
        await act(async () => {
            root.render(
                createElement(ProbeResultCard, {
                    mode: "oauth",
                    onChange: vi.fn(),
                }),
            )
        })

        const change = buttonReading("Change")
        expect(change!.className).toContain("h-control-xs")
        expect(change!.className).not.toMatch(/after:(bg|border|text|shadow)-/)
    })

    it("offers no Change when the card cannot be changed", async () => {
        // The reach is only interesting where the control exists; a read-only card has none.
        await act(async () => {
            root.render(
                createElement(ProbeResultCard, {
                    mode: "oauth",
                }),
            )
        })

        expect(buttonReading("Change")).toBeUndefined()
    })
})
