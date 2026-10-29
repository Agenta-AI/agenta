import {analyticsToDashboard} from "@agenta/observability"
import {describe, expect, it} from "vitest"

const TRACE_TYPE_PATH = "attributes.ag.type.trace"
const ERRORS_PATH = "attributes.ag.metrics.errors.cumulative"
const COST_PATH = "attributes.ag.metrics.costs.cumulative.total"

describe("analyticsToDashboard", () => {
    it("reports the failure rate as a 0..1 fraction", () => {
        const analytics = {
            buckets: [
                {
                    timestamp: "2026-08-12T10:00:00Z",
                    metrics: {
                        [TRACE_TYPE_PATH]: {count: 6},
                        [ERRORS_PATH]: {count: 1, sum: 1},
                    },
                },
            ],
        }

        const result = analyticsToDashboard(analytics, "24_hours")

        expect(result.failure_rate).toBeCloseTo(1 / 6, 4)
    })

    it("counts failed traces, not exception events", () => {
        // 10 traces. One of them failed 3 levels deep, so its root has errors.cumulative = 3.
        const analytics = {
            buckets: [
                {
                    timestamp: "2026-08-12T10:00:00Z",
                    metrics: {
                        [TRACE_TYPE_PATH]: {count: 10},
                        [ERRORS_PATH]: {count: 1, sum: 3},
                    },
                },
            ],
        }

        const result = analyticsToDashboard(analytics, "24_hours")

        expect(result.data[0].failure_count).toBe(1)
        expect(result.data[0].success_count).toBe(9)
        expect(result.total_count).toBe(10)
        expect(result.failure_rate).toBeCloseTo(0.1, 4)
    })

    it("counts traces whose root has no cost", () => {
        const analytics = {
            buckets: [
                {
                    timestamp: "2026-08-12T10:00:00Z",
                    metrics: {
                        [TRACE_TYPE_PATH]: {count: 4},
                        [COST_PATH]: {count: 3, sum: 0.3},
                    },
                },
                {
                    timestamp: "2026-08-12T11:00:00Z",
                    metrics: {},
                },
            ],
        }

        const result = analyticsToDashboard(analytics, "24_hours")

        expect(result.without_cost_count).toBe(1)
        expect(result.total_cost).toBeCloseTo(0.3, 6)
        expect(result.data).toHaveLength(2)
        expect(result.data[1].cost).toBe(0)
    })
})
