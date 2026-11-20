import {describe, expect, it} from "vitest"

import {MODEL_LIST_RENDER_CAP, modelListView} from "../../src/secret/core/cardCopy"

describe("modelListView", () => {
    it("never offers 'Show all' when every row is already rendered", () => {
        for (const total of [0, 1, 12, 25, 40, MODEL_LIST_RENDER_CAP]) {
            const view = modelListView({total, showAll: false})
            expect(view.truncated).toBe(false)
            expect(view.visibleCount).toBe(total)
        }
    })

    it("renders a typical provider's whole list — 25 models is the normal case, not an overflow", () => {
        expect(modelListView({total: 25, showAll: false})).toEqual({
            truncated: false,
            visibleCount: 25,
        })
    })

    it("caps only a list big enough for mounting it to be the real cost", () => {
        const view = modelListView({total: 400, showAll: false})
        expect(view.truncated).toBe(true)
        expect(view.visibleCount).toBe(MODEL_LIST_RENDER_CAP)
    })

    it("keeps the full list once it has been asked for", () => {
        expect(modelListView({total: 400, showAll: true})).toEqual({
            truncated: false,
            visibleCount: 400,
        })
    })

    it("decides on the row count alone, so no height measurement can make it flicker", () => {
        const first = modelListView({total: 61, showAll: false})
        const second = modelListView({total: 61, showAll: false})
        expect(first).toEqual(second)
        expect(first.truncated).toBe(true)
    })
})
