import {describe, expect, it} from "vitest"

import {workflowsResponseSchema} from "../../src/workflow/core/schema"
import {toWorkflowListRef} from "../../src/workflow/state/store"

const ALICE = "0190a3c4-0000-7000-8000-00000000a11c"

describe("workflow list access", () => {
    it("keeps the access policy of each list row through the schema and the list ref", () => {
        const parsed = workflowsResponseSchema.parse({
            count: 2,
            workflows: [
                {id: "wf-1", access: {visibility: "private", owner_user_id: ALICE}},
                {id: "wf-2", access: {visibility: "project"}},
                {id: "wf-3"},
            ],
        })

        const refs = parsed.workflows.map(toWorkflowListRef)

        expect(refs[0]?.access).toEqual({visibility: "private", owner_user_id: ALICE})
        expect(refs[1]?.access).toEqual({visibility: "project"})
        expect(refs[2]?.access).toBeNull()
    })
})
