// @vitest-environment jsdom
import {cleanup, render} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {McpServerMark, serverColor} from "../../src/agent-icon/McpServerMark"

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

    it("is a solid tile with a stable color per server name", () => {
        const {unmount} = render(<McpServerMark name="linear" />)
        const first = tile()?.style.background
        expect(tile()?.dataset.tone).toBe("solid")
        expect(first).not.toBe("")
        unmount()
        render(<McpServerMark name="linear" />)
        expect(tile()?.style.background).toBe(first)
    })

    it("gives different servers different colors, and never the red swatch", () => {
        const names = ["linear", "github", "notion", "acme", "zendesk", "slack", "jira"]
        const colors = new Set(names.map(serverColor))
        expect(colors.size).toBeGreaterThan(1)
        expect(colors.has("#D61010")).toBe(false)
    })

    it.each([24, 32, 44] as const)("passes size %i to the tile", (size) => {
        render(<McpServerMark size={size} />)
        expect(tile()?.dataset.size).toBe(String(size))
    })
})
