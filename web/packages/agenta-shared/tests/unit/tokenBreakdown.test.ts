import {describe, expect, it} from "vitest"

import {splitTokenUsage} from "../../src/utils/tokenBreakdown"

const sum = (b: {input: number; cacheRead: number; cacheWrite: number; output: number}) =>
    b.input + b.cacheRead + b.cacheWrite + b.output

describe("splitTokenUsage", () => {
    it("returns null without cache counts", () => {
        expect(splitTokenUsage({prompt: 10, completion: 5, total: 15})).toBeNull()
        expect(splitTokenUsage({prompt: 10, completion: 5, cacheRead: 0, total: 15})).toBeNull()
    })

    it("keeps a runner prompt count that excludes the cache", () => {
        const breakdown = splitTokenUsage({
            prompt: 956,
            completion: 39,
            cacheRead: 0,
            cacheWrite: 82116,
            total: 83111,
            inputIncludesCache: false,
        })
        expect(breakdown).toEqual({
            input: 956,
            cacheRead: 0,
            cacheWrite: 82116,
            output: 39,
            total: 83111,
        })
        expect(sum(breakdown!)).toBe(83111)
    })

    it("takes the cache out of an inclusive prompt count", () => {
        const breakdown = splitTokenUsage({
            prompt: 1000,
            completion: 10,
            cacheRead: 600,
            cacheWrite: 100,
            total: 1010,
        })
        expect(breakdown).toEqual({
            input: 300,
            cacheRead: 600,
            cacheWrite: 100,
            output: 10,
            total: 1010,
        })
    })

    it("reads a count that adds up to the total with the cache as exclusive", () => {
        // A roll-up carries no marker; the total still shows the prompt excludes the cache.
        const breakdown = splitTokenUsage({
            prompt: 5000,
            completion: 100,
            cacheRead: 2000,
            total: 7100,
        })
        expect(breakdown?.input).toBe(5000)
        expect(sum(breakdown!)).toBe(7100)
    })
})
