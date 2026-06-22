import {describe, expect, it} from "vitest"

import {
    GROUND_TRUTH_PARAM_KEY,
    templateRequiresGroundTruth,
    type EvaluatorCatalogTemplate,
} from "../../src/workflow/api/templates"

const template = (
    properties: Record<string, unknown>,
    categories?: string[],
): EvaluatorCatalogTemplate => ({
    key: "test",
    categories,
    data: {
        schemas: {
            parameters: {
                type: "object",
                properties,
            },
        },
    },
})

describe("templateRequiresGroundTruth", () => {
    it("detects evaluators with a correct-answer parameter", () => {
        expect(
            templateRequiresGroundTruth(
                template({
                    [GROUND_TRUTH_PARAM_KEY]: {type: "string"},
                    prediction_key: {type: "string"},
                }),
            ),
        ).toBe(true)
    })

    it("allows evaluators without a correct-answer parameter", () => {
        expect(
            templateRequiresGroundTruth(
                template({
                    prediction_key: {type: "string"},
                    json_schema: {type: "object"},
                }),
            ),
        ).toBe(false)
    })

    it("allows AI judges whose correct-answer parameter is optional", () => {
        expect(
            templateRequiresGroundTruth(
                template(
                    {
                        [GROUND_TRUTH_PARAM_KEY]: {type: "string"},
                        prompt_template: {type: "array"},
                    },
                    ["ai_llm"],
                ),
            ),
        ).toBe(false)
    })
})
