import {describe, expect, it} from "vitest"

import {agentOwnerLabel} from "../../src/features/agents/agentListView"

describe("the agent list Owner column", () => {
    const names = new Map([["bob", "Bob Lee"]])

    it("names the owner, says You for the reader, and covers no owner and a former member", () => {
        expect(agentOwnerLabel("me", "me", names)).toBe("You")
        expect(agentOwnerLabel("bob", "me", names)).toBe("Bob Lee")
        expect(agentOwnerLabel(null, "me", names)).toBe("No owner")
        expect(agentOwnerLabel("gone", "me", names)).toBe("Former member")
    })
})
