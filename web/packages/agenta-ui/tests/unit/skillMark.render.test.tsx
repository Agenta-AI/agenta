// @vitest-environment jsdom
import {cleanup, render} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {SkillMark} from "../../src/agent-icon/SkillMark"

afterEach(cleanup)

const tile = () => document.querySelector('[data-slot="icon-tile"]') as HTMLElement | null

describe("SkillMark", () => {
    it("is the orange 28px tile with one white 14px glyph by default (canvas F07)", () => {
        render(<SkillMark />)
        expect(tile()?.dataset.size).toBe("28")
        expect(tile()?.style.background).toBe("rgb(194, 65, 12)")
        expect(tile()?.style.color).toBe("rgb(255, 255, 255)")
        expect(tile()?.querySelector("svg")?.style.width).toBe("14px")
        expect(tile()?.querySelectorAll("svg")).toHaveLength(1)
        expect(tile()?.getAttribute("aria-hidden")).toBe("true")
    })

    it.each([24, 32, 44] as const)("passes size %i to the tile", (size) => {
        render(<SkillMark size={size} />)
        expect(tile()?.dataset.size).toBe(String(size))
    })
})
