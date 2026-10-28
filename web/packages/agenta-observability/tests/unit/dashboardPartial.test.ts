import {describe, expect, it} from "vitest"

import {analyticsToDashboard} from "../../src/core/analytics"

describe("analyticsToDashboard access", () => {
    it("marks the totals partial when the scope removed traces", () => {
        expect(
            analyticsToDashboard({buckets: [], access: {restricted: true}}, "30_days").partial,
        ).toBe(true)
    })

    it("is not partial without access or when unrestricted", () => {
        expect(analyticsToDashboard({buckets: []}, "30_days").partial).toBe(false)
        expect(
            analyticsToDashboard({buckets: [], access: {restricted: false}}, "30_days").partial,
        ).toBe(false)
    })
})
