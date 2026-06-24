import {describe, it, expect} from "vitest"

import {
    evaluationRunsResponseSchema,
    evaluationRunSchema,
} from "../../src/evaluationRun/core/schema"

import realRun from "./__fixtures_realRun.json"

/**
 * Regression guard for the eval-runs migration: a real backend run payload carries
 * `data.mappings[].column.kind` values ("testset", "invocation", ...) that an earlier
 * `z.enum([...])` did not list. Because these fields live deep inside the optional
 * `data` tree, a strict enum failed the ENTIRE run parse, which failed the whole
 * `runs: z.array(...)` envelope, so `queryEvaluationRuns` returned no runs and the table
 * rendered blank "Created by" / metric cells. The schema must validate real payloads.
 */
describe("evaluationRun schema vs real backend payload", () => {
    it("parses a real /evaluations/runs/query response without dropping the run", () => {
        const parsed = evaluationRunsResponseSchema.safeParse(realRun)
        expect(parsed.success).toBe(true)
        expect(parsed.success && parsed.data.runs).toHaveLength(1)
    })

    it("preserves created_by_id and the real mapping kinds (passthrough)", () => {
        const run = realRun.runs[0]
        const parsed = evaluationRunSchema.safeParse(run)
        expect(parsed.success).toBe(true)
        if (!parsed.success) return

        // created_by_id must survive — its absence is what blanked the "Created by" column.
        expect((parsed.data as Record<string, unknown>).created_by_id).toBe(run.created_by_id)

        const kinds = new Set(
            (parsed.data.data?.mappings ?? [])
                .map((m) => m.column?.kind)
                .filter((k): k is string => typeof k === "string"),
        )
        // The values that the old enum rejected.
        expect(kinds.has("testset")).toBe(true)
        expect(kinds.has("invocation")).toBe(true)
    })
})
