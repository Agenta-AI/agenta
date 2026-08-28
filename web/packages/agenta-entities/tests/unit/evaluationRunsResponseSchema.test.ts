import {describe, expect, it} from "vitest"

import {evaluationRunsResponseSchema} from "../../src/evaluationRun/core/schema"

describe("evaluationRunsResponseSchema mapping-kind tolerance", () => {
    const run = (mappings: unknown) => ({
        id: "01a0352d-d47e-7762-add4-ba144b9d0290",
        name: "QA Queue",
        status: "running",
        data: {
            steps: [
                {key: "testcases", type: "input", origin: "custom", references: {}},
                {
                    key: "evaluator-quality-rating",
                    type: "annotation",
                    origin: "human",
                    references: {
                        evaluator: {id: "e-1", slug: "quality-rating"},
                        evaluator_variant: {id: "v-1", slug: "b92017ea5219"},
                        evaluator_revision: {id: "r-1", slug: "f5ea48c6659f", version: "1"},
                    },
                    inputs: [{key: "__all_inputs__"}],
                },
            ],
            repeats: 1,
            mappings,
        },
    })

    it("parses a queue run whose source mapping kind is 'testset'", () => {
        const result = evaluationRunsResponseSchema.safeParse({
            count: 1,
            runs: [
                run([
                    {
                        column: {kind: "testset", name: "data"},
                        step: {key: "testcases", path: "data"},
                    },
                    {
                        column: {kind: "annotation", name: "approved"},
                        step: {
                            key: "evaluator-quality-rating",
                            path: "attributes.ag.data.outputs.approved",
                        },
                    },
                ]),
            ],
        })
        expect(result.success).toBe(true)
        if (result.success) {
            const annotationStep = result.data.runs[0].data?.steps?.find(
                (step) => step.type === "annotation",
            )
            expect(annotationStep?.references?.evaluator?.id).toBe("e-1")
        }
    })

    it("accepts new mapping kinds without dropping the run", () => {
        const result = evaluationRunsResponseSchema.safeParse({
            count: 1,
            runs: [
                run([
                    {
                        column: {kind: "future-source-kind", name: "data"},
                        step: {key: "testcases", path: "data"},
                    },
                ]),
            ],
        })
        expect(result.success).toBe(true)
    })
})
