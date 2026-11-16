// @vitest-environment jsdom
import {cleanup, render} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {SkillMark} from "../../src/agent-icon/SkillMark"

afterEach(cleanup)

const tile = () => document.querySelector('[data-slot="icon-tile"]') as HTMLElement | null

describe("SkillMark", () => {
    it("is the neutral 28px tile with one glyph by default", () => {
        render(<SkillMark />)
        expect(tile()?.dataset.tone).toBe("neutral")
        expect(tile()?.dataset.size).toBe("28")
        expect(tile()?.querySelectorAll("svg")).toHaveLength(1)
        expect(tile()?.getAttribute("aria-hidden")).toBe("true")
    })

    it.each([24, 32, 44] as const)("passes size %i to the tile", (size) => {
        render(<SkillMark size={size} />)
        expect(tile()?.dataset.size).toBe(String(size))
    })
})
