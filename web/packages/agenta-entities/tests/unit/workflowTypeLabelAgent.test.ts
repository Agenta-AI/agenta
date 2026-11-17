import {describe, expect, it} from "vitest"

import {getWorkflowTypeColor, getWorkflowTypeLabel} from "../../src/workflow/core/schema"

describe("workflow type badge for agents", () => {
    it("labels an agent as 'Agent' with a color, like the other types", () => {
        expect(getWorkflowTypeLabel("agent")).toBe("Agent")
        expect(getWorkflowTypeColor("agent")).not.toBeNull()
    })
})
