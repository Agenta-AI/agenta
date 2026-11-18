import {describe, expect, it} from "vitest"

import {metricDisplayLabel} from "@/features/evaluation-run/metricLabel"

describe("metric display label", () => {
    it("Humanizes a raw metric key the same way on every screen", () => {
        expect(metricDisplayLabel("success")).toBe("Success")
        expect(metricDisplayLabel("outputs.is_json")).toBe("Output Is JSON")
    })

    it("Drops the evaluator's own name from the front of the metric path", () => {
        expect(metricDisplayLabel("quality-rating.approved", "Quality Rating")).toBe("Approved")
        expect(metricDisplayLabel("Quality Rating Approved", "quality-rating")).toBe("Approved")
    })

    it("Keeps a label that does not start with the evaluator name", () => {
        expect(metricDisplayLabel("score", "Exact Match")).toBe("Score")
        expect(metricDisplayLabel("exact match", "Exact Match")).toBe("Exact Match")
    })
})
