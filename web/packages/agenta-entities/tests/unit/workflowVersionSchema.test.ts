import {describe, expect, it} from "vitest"

import {workflowSchema, workflowRevisionResponseSchema} from "../../src/workflow/core/schema"

// Regression: the static catalog (reserved __ag__* workflows) serves `version: "vN"`
// (e.g. "v1"), while DB revisions carry a numeric version (3 or "3"). The schema used to
// `z.coerce.number()` the value directly, so "v1" coerced to NaN and the whole
// `workflowRevisionResponseSchema` parse failed — `retrieveWorkflowRevision` returned null
// and every static retrieve was silently discarded. The `version` field now strips a "v"
// prefix before coercing so all three shapes parse to a number.
describe("workflowSchema version normalization", () => {
    it('parses the static catalog "v1" string to 1', () => {
        const result = workflowSchema.safeParse({id: "wf-1", version: "v1"})
        expect(result.success).toBe(true)
        expect(result.data?.version).toBe(1)
    })

    it('parses a numeric-string version "3" to 3', () => {
        const result = workflowSchema.safeParse({id: "wf-1", version: "3"})
        expect(result.success).toBe(true)
        expect(result.data?.version).toBe(3)
    })

    it("parses a numeric version 3 to 3", () => {
        const result = workflowSchema.safeParse({id: "wf-1", version: 3})
        expect(result.success).toBe(true)
        expect(result.data?.version).toBe(3)
    })

    it("accepts a null / absent version", () => {
        expect(workflowSchema.safeParse({id: "wf-1", version: null}).success).toBe(true)
        expect(workflowSchema.safeParse({id: "wf-1"}).success).toBe(true)
    })

    it("parses the real static revision response shape without discarding it", () => {
        // Mirrors the `POST /workflows/revisions/retrieve` envelope for a reserved
        // __ag__build_kit workflow served by static_catalog.py (version stamped as "v1").
        const response = {
            count: 1,
            workflow_revision: {
                id: "00000000-0000-0000-0000-000000000000",
                slug: "__ag__build_kit",
                version: "v1",
                name: "Build Kit",
                flags: {is_static: true},
                data: {},
                workflow_id: "00000000-0000-0000-0000-000000000001",
                workflow_variant_id: "00000000-0000-0000-0000-000000000002",
            },
        }
        const result = workflowRevisionResponseSchema.safeParse(response)
        expect(result.success).toBe(true)
        expect(result.data?.workflow_revision?.version).toBe(1)
    })
})
