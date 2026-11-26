import {describe, expect, it} from "vitest"

import {humanEvaluatorMetricsFromSchema} from "../../src/workflow/core/humanEvaluatorMetrics"
import {
    buildHumanEvaluatorOutputsSchema,
    type HumanEvaluatorMetric,
} from "../../src/workflow/state/evaluatorUtils"

describe("humanEvaluatorMetricsFromSchema", () => {
    it("reads back every feedback type the create form writes", () => {
        const metrics: HumanEvaluatorMetric[] = [
            {name: "score", type: "integer", optional: false, minimum: 1, maximum: 5},
            {name: "ratio", type: "number", optional: true, minimum: 0, maximum: 1},
            {name: "approved", type: "boolean", optional: false},
            {name: "tone", type: "class", optional: false, enum: ["calm", "rude"]},
            {name: "topics", type: "label", optional: true, enum: ["billing", "login"]},
            {name: "comment", type: "string", optional: true},
        ]
        const schema = buildHumanEvaluatorOutputsSchema(metrics)
        expect(humanEvaluatorMetricsFromSchema(schema)).toEqual(metrics)
    })

    it("returns no fields for a schema it cannot read", () => {
        expect(humanEvaluatorMetricsFromSchema(null)).toEqual([])
        expect(humanEvaluatorMetricsFromSchema({type: "object"})).toEqual([])
    })
})
