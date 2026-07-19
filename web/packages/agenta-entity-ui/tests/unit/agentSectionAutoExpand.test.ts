import {describe, expect, it} from "vitest"

import {computeSectionCrossings} from "../../src/DrillInView/SchemaControls/agentSectionAutoExpand"

describe("computeSectionCrossings", () => {
    it("opens a section on a 0 → >0 crossing", () => {
        expect(computeSectionCrossings({tools: 0}, {tools: 2})).toEqual([
            {key: "tools", open: true},
        ])
    })
    it("closes a section on a >0 → 0 crossing", () => {
        expect(computeSectionCrossings({tools: 3}, {tools: 0})).toEqual([
            {key: "tools", open: false},
        ])
    })
    it("does nothing when the count changes but does not cross 0 (manual collapse sticks)", () => {
        expect(computeSectionCrossings({tools: 1}, {tools: 2})).toEqual([])
    })
    it("does nothing when unchanged", () => {
        expect(computeSectionCrossings({tools: 2, skills: 0}, {tools: 2, skills: 0})).toEqual([])
    })
    it("reports each crossing key independently", () => {
        expect(computeSectionCrossings({tools: 0, skills: 1}, {tools: 1, skills: 0})).toEqual([
            {key: "tools", open: true},
            {key: "skills", open: false},
        ])
    })
    it("closes a key present in prev but absent from next", () => {
        expect(computeSectionCrossings({tools: 2}, {})).toEqual([{key: "tools", open: false}])
    })
})
