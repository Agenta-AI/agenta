import {describe, expect, it} from "vitest"

import {evaluationResultsResponseSchema} from "../../src/evaluationRun"

describe("evaluationResultSchema", () => {
    it("keeps who wrote a result and when, so a view can name the author", () => {
        const parsed = evaluationResultsResponseSchema.parse({
            count: 1,
            results: [
                {
                    run_id: "r",
                    scenario_id: "s",
                    step_key: "review",
                    created_at: "2026-11-27T10:00:00Z",
                    updated_at: "2026-11-28T09:00:00Z",
                    created_by_id: "user-1",
                    updated_by_id: "user-2",
                },
            ],
        })
        expect(parsed.results[0]).toMatchObject({
            created_at: "2026-11-27T10:00:00Z",
            updated_at: "2026-11-28T09:00:00Z",
            created_by_id: "user-1",
            updated_by_id: "user-2",
        })
    })
})
