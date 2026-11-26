import {describe, expect, it} from "vitest"

import {testsetSchema} from "../../src/testset/core/schema"

describe("testsetSchema", () => {
    it("keeps the id of the user who created the Testset", () => {
        const parsed = testsetSchema.parse({
            id: "t1",
            name: "Alpha set",
            created_by_id: "u1",
            created_at: "2026-01-02T03:04:05Z",
        })

        expect(parsed.created_by_id).toBe("u1")
    })
})
