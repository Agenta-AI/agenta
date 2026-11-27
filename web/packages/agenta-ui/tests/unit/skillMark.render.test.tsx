// @vitest-environment jsdom
import {cleanup, render} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {SkillMark} from "../../src/agent-icon/SkillMark"

afterEach(cleanup)

const tile = () => document.querySelector('[data-slot="icon-tile"]') as HTMLElement

describe("SkillMark", () => {
    it("is the neutral 24px Mark with one glyph and no inline color", () => {
        render(<SkillMark />)
        expect(tile().dataset.tone).toBe("neutral")
        expect(tile().dataset.size).toBe("24")
        expect(tile().style.background).toBe("")
        expect(tile().querySelectorAll("svg")).toHaveLength(1)
    })

    it("passes its size to the Mark", () => {
        render(<SkillMark size={32} />)
        expect(tile().dataset.size).toBe("32")
    })
})
