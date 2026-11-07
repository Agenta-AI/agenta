import {describe, expect, it} from "vitest"

import {splitIdList} from "../../src/channels/helpers"

describe("splitIdList", () => {
    it("splits on ASCII, full-width and ideographic commas", () => {
        expect(splitIdList("123, 456，789、1011")).toEqual(["123", "456", "789", "1011"])
    })

    it("drops blanks and surrounding spaces", () => {
        expect(splitIdList(" 1 ,, ，2 、 ")).toEqual(["1", "2"])
        expect(splitIdList("")).toEqual([])
    })
})
