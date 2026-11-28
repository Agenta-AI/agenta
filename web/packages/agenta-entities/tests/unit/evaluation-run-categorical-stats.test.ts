import {describe, expect, it} from "vitest"

import {unwrapCategoricalStats, unwrapStatsForCompare} from "../../src/evaluationRun/etl"

describe("unwrapCategoricalStats", () => {
    it("orders the labels by density, else count, the most frequent first", () => {
        expect(
            unwrapCategoricalStats({
                type: "categorical/single",
                freq: [
                    {value: "refund", density: 0.2},
                    {value: "exchange", density: 0.7},
                    {value: "other", density: 0.1},
                ],
            }),
        ).toEqual(["exchange", "refund", "other"])
        expect(
            unwrapCategoricalStats({
                type: "categorical/multiple",
                freq: [
                    {value: "a", count: 1},
                    {value: "b", count: 3},
                ],
            }),
        ).toEqual(["b", "a"])
    })

    it("leaves out labels that were never seen and spreads a list of labels", () => {
        expect(
            unwrapCategoricalStats({
                type: "categorical/multiple",
                freq: [{value: ["tone", "length"], count: 2}, {value: "unused", count: 0}, null],
            }),
        ).toEqual(["tone", "length"])
    })

    it("returns null for anything that is not a categorical blob", () => {
        const binary = {type: "binary", freq: [{value: true, density: 1}]}
        expect(unwrapCategoricalStats(binary)).toBeNull()
        expect(unwrapCategoricalStats({type: "numeric", mean: 0.5})).toBeNull()
        expect(unwrapCategoricalStats("label")).toBeNull()
        expect(unwrapCategoricalStats(null)).toBeNull()
        // The binary case stays with unwrapStatsForCompare.
        expect(unwrapStatsForCompare(binary)).toBe(true)
    })
})
