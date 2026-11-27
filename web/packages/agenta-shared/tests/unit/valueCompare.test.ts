import {describe, expect, it} from "vitest"

import {compareWithExpected} from "../../src/utils/valueCompare"

describe("compareWithExpected", () => {
    it("marks each leaf as a match or a mismatch and counts the matches", () => {
        const result = compareWithExpected({tier: "gold", seats: 4}, {tier: "gold", seats: 5})
        expect(result?.rows.map(({key, status}) => [key, status])).toEqual([
            ["tier", "match"],
            ["seats", "mismatch"],
        ])
        expect(result?.rows[1].expected).toBe(5)
        expect(result).toMatchObject({compared: 2, matched: 1})
    })

    it("parses a JSON text side before it compares, so parsed and text match", () => {
        const result = compareWithExpected({recommendation: "see"}, '{"recommendation": "see"}')
        expect(result).toMatchObject({compared: 1, matched: 1})
        expect(compareWithExpected('{"a": 1}', {a: 1})).toMatchObject({compared: 1, matched: 1})
    })

    it("ignores key order inside objects and arrays of objects", () => {
        const result = compareWithExpected(
            {lines: [{sku: "A", qty: 2}]},
            {lines: [{qty: 2, sku: "A"}]},
        )
        expect(result?.rows[0].status).toBe("match")
    })

    it("calls a leaf the expected value has and the output lacks missing", () => {
        const result = compareWithExpected({tier: "gold"}, {tier: "gold", seats: 5})
        expect(result?.rows.map(({key, status}) => [key, status])).toEqual([
            ["tier", "match"],
            ["seats", "missing"],
        ])
        expect(result).toMatchObject({compared: 2, matched: 1})
    })

    it("does not compare a leaf only the output has", () => {
        const result = compareWithExpected({tier: "gold", reason: "long text"}, {tier: "gold"})
        expect(result?.rows[1]).toMatchObject({key: "reason", status: "extra"})
        expect(result).toMatchObject({compared: 1, matched: 1})
    })

    it("groups nested objects and gives the group its worst leaf", () => {
        const result = compareWithExpected(
            {invoice: {number: "1", amount: "10"}, due: "2026-12-03"},
            {invoice: {number: "1", amount: "12"}, due: "2026-12-03"},
        )
        const invoice = result?.rows[0]
        expect(invoice?.status).toBe("mismatch")
        expect(invoice?.children?.map(({key, depth, status}) => [key, depth, status])).toEqual([
            ["number", 1, "match"],
            ["amount", 1, "mismatch"],
        ])
        expect(result).toMatchObject({compared: 3, matched: 2})
    })

    it("gives null when a side is not an object", () => {
        expect(compareWithExpected("plain answer", {a: 1})).toBeNull()
        expect(compareWithExpected({a: 1}, "not json")).toBeNull()
        expect(compareWithExpected([1, 2], [1, 2])).toBeNull()
    })
})
