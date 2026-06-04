/**
 * Unit tests for buildEvaluatorExecutionInputs — native JSON transport.
 *
 * Pins the RFC invariant: "native JSON stays native until template rendering."
 * Object and array values from testcase / upstream output / ground_truth must
 * survive transport as native JSON, NOT as stringified text. This is what
 * lets `{{geo.region}}` work in mustache against an object-typed variable.
 *
 * Pre-Step-1 behavior: `normalizeCompact` stringifies every non-string value.
 * Tests in this file FAIL until Step 1 (transport surgery) lands and pass after.
 *
 * Strings that happen to contain JSON-shaped text MUST stay strings —
 * the runtime should never silently parse them. (RFC gap-04.)
 */

import {describe, it, expect} from "vitest"

import {buildEvaluatorExecutionInputs, type EvaluatorInputContext} from "../../src/runnable/utils"

const makeCtx = (overrides: Partial<EvaluatorInputContext> = {}): EvaluatorInputContext => ({
    testcaseData: {},
    upstreamOutput: undefined,
    settings: {},
    inputSchema: null,
    ...overrides,
})

describe("buildEvaluatorExecutionInputs — native JSON transport", () => {
    // ── Schema-driven path ──────────────────────────────────────────────────

    describe("with inputSchema (schema-driven)", () => {
        it("preserves object value resolved via a *_key setting", () => {
            const geo = {region: "Pacific Islands", subregion: "Western Melanesia"}
            const ctx = makeCtx({
                testcaseData: {geography_col: geo},
                settings: {geo_key: "geography_col"},
                inputSchema: {
                    type: "object",
                    properties: {geo: {type: "object"}},
                },
            })

            const inputs = buildEvaluatorExecutionInputs(ctx)

            expect(inputs.geo).toBe(geo) // same reference — not stringified
            expect(typeof inputs.geo).toBe("object")
        })

        it("preserves array value via direct schema property match", () => {
            const languages = ["en", "bi", "fr"]
            const ctx = makeCtx({
                testcaseData: {languages},
                inputSchema: {
                    type: "object",
                    properties: {languages: {type: "array"}},
                },
            })

            const inputs = buildEvaluatorExecutionInputs(ctx)

            expect(inputs.languages).toBe(languages)
            expect(Array.isArray(inputs.languages)).toBe(true)
        })

        it("preserves object upstream output as `outputs` / `prediction`", () => {
            const upstreamOutput = {answer: "Port Vila", iso: "VU"}
            const ctx = makeCtx({
                upstreamOutput,
                inputSchema: {
                    type: "object",
                    properties: {outputs: {type: "object"}, prediction: {type: "object"}},
                },
            })

            const inputs = buildEvaluatorExecutionInputs(ctx)

            expect(inputs.outputs).toBe(upstreamOutput)
            // `prediction` should be the native value too — not a stringified copy.
            expect(inputs.prediction).toEqual(upstreamOutput)
            expect(typeof inputs.prediction).toBe("object")
        })

        it("keeps strings that look like JSON as strings (gap-04)", () => {
            const metadata = '{"source":"trace","trace_id":"vu-001"}'
            const ctx = makeCtx({
                testcaseData: {metadata},
                inputSchema: {
                    type: "object",
                    properties: {metadata: {type: "string"}},
                },
            })

            const inputs = buildEvaluatorExecutionInputs(ctx)

            expect(inputs.metadata).toBe(metadata)
            expect(typeof inputs.metadata).toBe("string")
        })

        it("preserves nested object via additionalProperties spread", () => {
            const profile = {name: "Ada", tags: ["admin"]}
            const ctx = makeCtx({
                testcaseData: {profile, age: 30},
                inputSchema: {
                    type: "object",
                    properties: {age: {type: "number"}},
                    // additionalProperties not explicitly false → spread allowed
                },
            })

            const inputs = buildEvaluatorExecutionInputs(ctx)

            expect(inputs.profile).toBe(profile)
            expect(inputs.age).toBe(30)
        })

        it("preserves primitive types unchanged (number, boolean)", () => {
            const ctx = makeCtx({
                testcaseData: {age: 42, is_active: true, ratio: 3.14},
                inputSchema: {
                    type: "object",
                    properties: {
                        age: {type: "number"},
                        is_active: {type: "boolean"},
                        ratio: {type: "number"},
                    },
                },
            })

            const inputs = buildEvaluatorExecutionInputs(ctx)

            expect(inputs.age).toBe(42)
            expect(inputs.is_active).toBe(true)
            expect(inputs.ratio).toBe(3.14)
        })
    })

    // ── Legacy path (no schema) ──────────────────────────────────────────────

    describe("without inputSchema (legacy fallback)", () => {
        it("spreads testcase data preserving native object/array values", () => {
            const geo = {region: "Pacific Islands"}
            const languages = ["en", "bi"]
            const ctx = makeCtx({
                testcaseData: {country: "Vanuatu", geo, languages, age: 320},
            })

            const inputs = buildEvaluatorExecutionInputs(ctx)

            expect(inputs.country).toBe("Vanuatu")
            expect(inputs.geo).toBe(geo)
            expect(inputs.languages).toBe(languages)
            expect(inputs.age).toBe(320)
        })

        it("preserves object upstream output as `prediction`", () => {
            const upstreamOutput = {answer: "Port Vila", iso: "VU"}
            const ctx = makeCtx({
                testcaseData: {country: "Vanuatu"},
                upstreamOutput,
            })

            const inputs = buildEvaluatorExecutionInputs(ctx)

            // `prediction` is always present in legacy path
            expect(inputs.prediction).toEqual(upstreamOutput)
            expect(typeof inputs.prediction).toBe("object")
        })

        it("preserves object ground_truth resolved via correct_answer_key", () => {
            const correctAnswer = {capital: "Port Vila", iso: "VU"}
            const ctx = makeCtx({
                testcaseData: {answer_col: correctAnswer, question: "?"},
                settings: {correct_answer_key: "answer_col"},
            })

            const inputs = buildEvaluatorExecutionInputs(ctx)

            // Aliased under both `ground_truth` and the original column name.
            expect(inputs.ground_truth).toBe(correctAnswer)
            expect(inputs.answer_col).toBe(correctAnswer)
            expect(typeof inputs.ground_truth).toBe("object")
        })

        it("handles testcase.<col> prefix in correct_answer_key", () => {
            const correctAnswer = ["Port Vila"]
            const ctx = makeCtx({
                testcaseData: {answer_col: correctAnswer},
                settings: {correct_answer_key: "testcase.answer_col"},
            })

            const inputs = buildEvaluatorExecutionInputs(ctx)

            expect(inputs.ground_truth).toBe(correctAnswer)
            expect(Array.isArray(inputs.ground_truth)).toBe(true)
        })

        it("keeps strings that look like JSON as strings (gap-04)", () => {
            const metadata = '{"source":"trace"}'
            const ctx = makeCtx({
                testcaseData: {metadata, country: "Vanuatu"},
            })

            const inputs = buildEvaluatorExecutionInputs(ctx)

            expect(inputs.metadata).toBe(metadata)
            expect(typeof inputs.metadata).toBe("string")
        })

        it("handles null and undefined values without stringifying", () => {
            const ctx = makeCtx({
                testcaseData: {nullable: null, missing: undefined, present: "x"},
            })

            const inputs = buildEvaluatorExecutionInputs(ctx)

            expect(inputs.nullable).toBeNull()
            expect(inputs.missing).toBeUndefined()
            expect(inputs.present).toBe("x")
        })
    })

    // ── Special "inputs" key (TESTCASE_OBJECT_KEYS) ─────────────────────────

    describe('special "inputs" key', () => {
        it("passes the whole testcaseData object as `inputs` when schema requests it", () => {
            const testcaseData = {country: "Vanuatu", age: 320, geo: {region: "Pacific"}}
            const ctx = makeCtx({
                testcaseData,
                inputSchema: {
                    type: "object",
                    properties: {inputs: {type: "object"}},
                },
            })

            const inputs = buildEvaluatorExecutionInputs(ctx)

            expect(inputs.inputs).toBe(testcaseData)
            // Nested object inside is also native, not stringified.
            expect((inputs.inputs as Record<string, unknown>).geo).toEqual({region: "Pacific"})
        })
    })
})
