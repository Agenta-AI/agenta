import {describe, expect, it} from "vitest"

import {toBucketsResult} from "../../src/analytics/queries"

describe("toBucketsResult", () => {
    it("keeps the buckets and the restricted flag", () => {
        const buckets = [{timestamp: "2026-10-28T00:00:00Z", interval: 60, metrics: {}}]
        expect(toBucketsResult({buckets, access: {restricted: true}})).toEqual({
            buckets,
            restricted: true,
        })
    })

    it("is not restricted without access or when access says so", () => {
        expect(toBucketsResult({buckets: []}).restricted).toBe(false)
        expect(toBucketsResult({buckets: [], access: {restricted: false}}).restricted).toBe(false)
        expect(toBucketsResult(null)).toEqual({buckets: [], restricted: false})
    })
})
