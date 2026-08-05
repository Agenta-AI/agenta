/**
 * Unit tests for evaluator (LLM-as-a-judge) template-format handling.
 *
 * Mahmoud QA 2026-06-03: new judges should default to `mustache` (curly is
 * legacy and hidden for new prompts). The format must survive the
 * nest→flatten round-trip so picker changes / the seeded default persist on
 * commit. Legacy judges (no stored format) must stay untouched.
 */
import {describe, expect, it} from "vitest"

import {
    flattenEvaluatorConfiguration,
    nestEvaluatorConfiguration,
} from "../../src/runnable/evaluatorTransforms"

const flatJudge = (extra: Record<string, unknown> = {}) => ({
    prompt_template: [
        {role: "system", content: "You are a judge."},
        {role: "user", content: "Score {{prediction}} against {{ground_truth}}."},
    ],
    model: "gpt-4o-mini",
    response_type: "json_schema",
    ...extra,
})

describe("evaluator template_format — nest", () => {
    it("surfaces a stored flat template_format into prompt.template_format", () => {
        const nested = nestEvaluatorConfiguration(flatJudge({template_format: "mustache"}))
        const prompt = nested.prompt as Record<string, unknown>
        expect(prompt.template_format).toBe("mustache")
    })

    it("omits prompt.template_format when the flat params have none (legacy judge)", () => {
        const nested = nestEvaluatorConfiguration(flatJudge())
        const prompt = nested.prompt as Record<string, unknown>
        // No format → picker keeps its existing curly fallback. We must NOT
        // inject one here, or legacy judges would flip to dirty.
        expect("template_format" in prompt).toBe(false)
    })

    it("does not leak template_format to the top level via the rest spread", () => {
        const nested = nestEvaluatorConfiguration(flatJudge({template_format: "mustache"}))
        expect("template_format" in nested).toBe(false)
    })
})

describe("evaluator template_format — flatten round-trip", () => {
    it("round-trips prompt.template_format back to flat template_format", () => {
        const nested = nestEvaluatorConfiguration(flatJudge({template_format: "mustache"}))
        const flat = flattenEvaluatorConfiguration(nested, flatJudge({template_format: "mustache"}))
        expect(flat.template_format).toBe("mustache")
    })

    it("persists a picker change (curly → mustache) on flatten", () => {
        // Simulate the picker setting mustache on the nested prompt.
        const nested = nestEvaluatorConfiguration(flatJudge())
        ;(nested.prompt as Record<string, unknown>).template_format = "mustache"
        const flat = flattenEvaluatorConfiguration(nested, flatJudge())
        expect(flat.template_format).toBe("mustache")
    })

    it("leaves flat params without a template_format when the prompt has none", () => {
        const nested = nestEvaluatorConfiguration(flatJudge())
        const flat = flattenEvaluatorConfiguration(nested, flatJudge())
        // Legacy judge: no format set anywhere → nothing written → no
        // spurious dirty diff against the server's format-less params.
        expect("template_format" in flat).toBe(false)
    })

    it("full nest→flatten is idempotent for the format field", () => {
        const original = flatJudge({template_format: "jinja2"})
        const nested = nestEvaluatorConfiguration(original)
        const flat = flattenEvaluatorConfiguration(nested, original)
        expect(flat.template_format).toBe("jinja2")
        // And re-nesting reads it back.
        const reNested = nestEvaluatorConfiguration(flat)
        expect((reNested.prompt as Record<string, unknown>).template_format).toBe("jinja2")
    })
})
