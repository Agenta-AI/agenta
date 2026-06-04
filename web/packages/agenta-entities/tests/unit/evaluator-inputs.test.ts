import {describe, expect, it} from "vitest"

import {buildEvaluatorExecutionInputs, validateEvaluatorInputs} from "../../src/runnable"

describe("buildEvaluatorExecutionInputs", () => {
    it("unwraps evaluator envelope rows before populating the inputs object", () => {
        const result = buildEvaluatorExecutionInputs({
            testcaseData: {
                inputs: {
                    messages: [{role: "user", content: "What is the capital of France?"}],
                    context: "Use factual geography knowledge only.",
                },
                outputs: {
                    role: "assistant",
                    content: "Paris",
                },
                prediction: '{"role":"assistant","content":"Paris"}',
            },
            upstreamOutput: {
                role: "assistant",
                content: "Paris",
            },
            settings: {},
            inputSchema: {
                type: "object",
                properties: {
                    inputs: {type: "object"},
                    outputs: {type: "object"},
                },
                required: ["inputs", "outputs"],
                additionalProperties: false,
            },
        })

        expect(result).toEqual({
            inputs: {
                messages: [{role: "user", content: "What is the capital of France?"}],
                context: "Use factual geography knowledge only.",
            },
            outputs: {role: "assistant", content: "Paris"},
        })
    })
})

describe("validateEvaluatorInputs", () => {
    it("validates required fields against unwrapped evaluator testcase inputs", () => {
        const validation = validateEvaluatorInputs({
            testcaseData: {
                inputs: {
                    country: "France",
                },
                outputs: "Paris",
                prediction: "Paris",
            },
            upstreamOutput: "Paris",
            settings: {},
            inputSchema: {
                type: "object",
                properties: {
                    inputs: {type: "object"},
                    outputs: {type: "string"},
                    country: {type: "string"},
                },
                required: ["inputs", "outputs", "country"],
                additionalProperties: false,
            },
        })

        expect(validation).toEqual({
            valid: true,
            missingInputs: [],
        })
    })
})
