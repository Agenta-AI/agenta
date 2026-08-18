import {describe, expect, it} from "vitest"

import {analyticsToGeneration} from "./helpers"

const TRACE_TYPE_PATH = "attributes.ag.type.trace"
const ERRORS_PATH = "attributes.ag.metrics.errors.cumulative"

describe("analyticsToGeneration", () => {
    it("reports the failure rate as a percentage", () => {
        const analytics = {
            buckets: [
                {
                    timestamp: "2026-08-12T10:00:00Z",
                    metrics: {
                        [TRACE_TYPE_PATH]: {count: 6},
                        [ERRORS_PATH]: {sum: 1},
                    },
                },
            ],
        }

        const result = analyticsToGeneration(analytics, "24_hours")

        expect(result.failure_rate).toBeCloseTo(16.67, 2)
    })
})
