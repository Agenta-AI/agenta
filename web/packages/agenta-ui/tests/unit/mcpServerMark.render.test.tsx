// @vitest-environment jsdom
import {cleanup, render} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {McpServerMark} from "../../src/agent-icon/McpServerMark"

afterEach(cleanup)

const tile = () => document.querySelector('[data-slot="icon-tile"]') as HTMLElement | null

describe("McpServerMark", () => {
    it("is the neutral 24px Mark with one glyph by default", () => {
        render(<McpServerMark />)
        expect(tile()?.dataset.tone).toBe("neutral")
        expect(tile()?.dataset.size).toBe("24")
        expect(tile()?.querySelectorAll("svg")).toHaveLength(1)
        expect(tile()?.getAttribute("aria-hidden")).toBe("true")
    })

    it("stays neutral for a named server: marks never color by entity", () => {
        render(<McpServerMark name="linear" />)
        expect(tile()?.dataset.tone).toBe("neutral")
        expect(tile()?.style.background).toBe("")
    })

    it.each([16, 20, 24, 32, 40] as const)("passes size %i to the tile", (size) => {
        render(<McpServerMark size={size} />)
        expect(tile()?.dataset.size).toBe(String(size))
    })
})
