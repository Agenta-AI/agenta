/**
 * Schema contract tests for the evaluationRun family.
 *
 * Pins the two properties the T2 slice locked in:
 *   1. PASSTHROUGH — unknown backend fields survive validation instead of being
 *      silently stripped. The backend mounts these payloads with extra="allow", and
 *      downstream consumers (e.g. OSS EvalRunDetails enrichment) read fields beyond
 *      what the schema declares. Stripping them would silently lose data. This is the
 *      de-risk for routing the OSS run-fetch through the package molecule (T6).
 *   2. STRICT on known fields — a malformed payload (missing required id) still fails,
 *      so backend drift surfaces (and is now logged in production via safeParseWithLogging).
 *
 * The fixtures mirror the shape of real `/evaluations/{runs,results,metrics}/query`
 * responses, including representative extra fields the backend sends.
 */
import assert from "node:assert/strict"
import {describe, it} from "node:test"

import {evaluationMetricSchema, evaluationResultSchema, evaluationRunSchema} from "../schema"

// Recursive, index-accessible view for asserting on passthrough (undeclared) fields
// without using `any`. Every key resolves to Json, so nested access type-checks.
interface Json {
    [key: string]: Json
}

// A realistic run payload, including fields NOT declared in the schema (extra="allow").
const RUN_FIXTURE = {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Nightly eval",
    status: "success",
    flags: {is_live: false},
    // Undeclared top-level field the backend sends — must survive.
    sequence_number: 42,
    created_at: "2026-06-08T00:00:00Z",
    created_by_id: "22222222-2222-2222-2222-222222222222",
    data: {
        steps: [
            {
                key: "inv-1.exact",
                type: "annotation",
                origin: "human",
                references: {
                    // Undeclared nested ref field — must survive.
                    evaluator_revision: {
                        id: "33333333-3333-3333-3333-333333333333",
                        extra_ref: "x",
                    },
                },
                // Undeclared step field the enrichment may read — must survive.
                repeat_idx: 0,
            },
        ],
        mappings: [
            {
                column: {kind: "evaluator", name: "exact-match.score"},
                step: {key: "inv-1.exact", path: "data.outputs.score"},
            },
        ],
        // Undeclared data field — must survive.
        concurrency: {max: 4},
    },
}

describe("evaluationRunSchema", () => {
    it("validates a realistic run payload", () => {
        const result = evaluationRunSchema.safeParse(RUN_FIXTURE)
        assert.equal(result.success, true)
    })

    it("preserves unknown top-level, nested data, and nested ref fields (passthrough)", () => {
        const parsed = evaluationRunSchema.parse(RUN_FIXTURE) as unknown as Json
        assert.equal(parsed.sequence_number, 42)
        assert.equal(parsed.data.concurrency.max, 4)
        assert.equal(parsed.data.steps[0].repeat_idx, 0)
        assert.equal(parsed.data.steps[0].references.evaluator_revision.extra_ref, "x")
    })

    it("still fails when a required field (id) is missing — drift surfaces", () => {
        const {id: _omitted, ...withoutId} = RUN_FIXTURE
        assert.equal(evaluationRunSchema.safeParse(withoutId).success, false)
    })
})

describe("evaluationResultSchema", () => {
    it("preserves unknown fields and keeps the required keys", () => {
        const parsed = evaluationResultSchema.parse({
            run_id: "r1",
            scenario_id: "s1",
            step_key: "inv-1",
            status: "success",
            // undeclared backend field
            repeat_idx: 2,
        }) as unknown as Json
        assert.equal(parsed.repeat_idx, 2)
        assert.equal(parsed.run_id, "r1")
    })

    it("fails without the required run_id", () => {
        assert.equal(
            evaluationResultSchema.safeParse({scenario_id: "s1", step_key: "k"}).success,
            false,
        )
    })
})

describe("evaluationMetricSchema", () => {
    it("preserves unknown fields", () => {
        const parsed = evaluationMetricSchema.parse({
            id: "m1",
            run_id: "r1",
            data: {"inv-1.exact": {type: "numeric/continuous", mean: 7.5}},
            // undeclared backend field
            variant_label: "control",
        }) as unknown as Json
        assert.equal(parsed.variant_label, "control")
        assert.deepEqual(parsed.data["inv-1.exact"], {type: "numeric/continuous", mean: 7.5})
    })
})
