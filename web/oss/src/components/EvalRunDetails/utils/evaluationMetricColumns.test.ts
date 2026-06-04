import assert from "node:assert/strict"
import {describe, it} from "node:test"

import {selectStaticMetricColumnsForEvaluationType} from "./evaluationMetricColumns.ts"

const metricColumns = {
    auto: [
        {
            name: "auto metric",
            kind: "metric" as const,
            path: "metrics.auto",
            stepKey: "auto",
            metricType: "number",
        },
    ],
    human: [
        {
            name: "human metric",
            kind: "metric" as const,
            path: "metrics.human",
            stepKey: "human",
            metricType: "number",
        },
    ],
}

describe("selectStaticMetricColumnsForEvaluationType", () => {
    it("uses auto metrics for SDK/custom evaluations", () => {
        assert.deepEqual(
            selectStaticMetricColumnsForEvaluationType(metricColumns, "custom"),
            metricColumns.auto,
        )
    })

    it("uses human metrics only for human evaluations", () => {
        assert.deepEqual(
            selectStaticMetricColumnsForEvaluationType(metricColumns, "human"),
            metricColumns.human,
        )
    })
})
