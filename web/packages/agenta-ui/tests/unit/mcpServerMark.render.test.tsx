// @vitest-environment jsdom
import {cleanup, render} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {McpServerMark} from "../../src/agent-icon/McpServerMark"

afterEach(cleanup)

const tile = () => document.querySelector('[data-slot="icon-tile"]') as HTMLElement | null

describe("McpServerMark", () => {
    it("is the neutral 28px tile with one glyph by default", () => {
        render(<McpServerMark />)
        expect(tile()?.dataset.tone).toBe("neutral")
        expect(tile()?.dataset.size).toBe("28")
        expect(tile()?.querySelectorAll("svg")).toHaveLength(1)
        expect(tile()?.getAttribute("aria-hidden")).toBe("true")
    })

    it.each([24, 32, 44] as const)("passes size %i to the tile", (size) => {
        render(<McpServerMark size={size} />)
        expect(tile()?.dataset.size).toBe(String(size))
    })
})
