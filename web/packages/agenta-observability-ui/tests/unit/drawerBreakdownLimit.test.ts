import {describe, expect, it} from "vitest"

import {breakdownLimit} from "../../src/analytics/drawer/DrawerBreakdown"
import {SPLIT_KEYS} from "../../src/analytics/useAnalyticsData"

/**
 * The breakdown splits cost and tokens with one request per key, so Show all must not ask for
 * every key a busy project has. Keys past the cap fold into the "Other (N)" row.
 */
describe("breakdownLimit", () => {
    it("shows the top 8 by default", () => {
        expect(breakdownLimit(false, 40)).toBe(8)
        expect(breakdownLimit(false, 3)).toBe(3)
    })

    it("shows every key under the cap when Show all is on", () => {
        expect(breakdownLimit(true, 12)).toBe(12)
    })

    it("caps Show all at SPLIT_KEYS", () => {
        expect(breakdownLimit(true, 400)).toBe(SPLIT_KEYS)
    })
})
