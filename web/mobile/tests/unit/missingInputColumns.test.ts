import {describe, expect, it} from "vitest"

import {missingInputColumns} from "@/features/evaluations/new/missingInputColumns"

describe("missingInputColumns", () => {
    it("lists the expected inputs the test set has no column for", () => {
        expect(missingInputColumns(["country", "city"], ["org_id", "city"])).toEqual(["country"])
    })

    it("is empty when every input has a column", () => {
        expect(missingInputColumns(["country"], ["country", "correct_answer"])).toEqual([])
    })
})
