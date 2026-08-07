import {describe, expect, it} from "vitest"

import {classifyPageFailure} from "../../src/features/sessions/pageFailure"

describe("classifyPageFailure", () => {
    it("treats a query error as a whole-list failure", () => {
        expect(classifyPageFailure([], true)).toEqual({failed: true, laterPageFailed: false})
    })

    it("treats a null first page as a whole-list failure", () => {
        expect(classifyPageFailure([null], false)).toEqual({failed: true, laterPageFailed: false})
    })

    // The case this split exists for: rows are already on screen, so replacing them with a
    // full-screen error would throw away everything the reader scrolled through.
    it("keeps the list when only a later page fails", () => {
        expect(classifyPageFailure([[{id: "a"}], [{id: "b"}], null], false)).toEqual({
            failed: false,
            laterPageFailed: true,
        })
    })

    it("reports neither when every page arrived", () => {
        expect(classifyPageFailure([[{id: "a"}], []], false)).toEqual({
            failed: false,
            laterPageFailed: false,
        })
    })

    it("prefers the whole-list failure when the first page and a later page both failed", () => {
        expect(classifyPageFailure([null, [{id: "b"}], null], false)).toEqual({
            failed: true,
            laterPageFailed: false,
        })
    })
})
