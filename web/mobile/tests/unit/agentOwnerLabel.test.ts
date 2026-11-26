import type {Workflow} from "@agenta/entities/workflow"
import {describe, expect, it} from "vitest"

import {agentOwnerLabel, toAgentListRow} from "../../src/features/agents/agentListView"

describe("the agent list Owner column", () => {
    const names = new Map([["bob", "Bob Lee"]])

    it("names the owner, says You for the reader, and covers no owner and a former member", () => {
        expect(agentOwnerLabel("me", "me", names)).toBe("You")
        expect(agentOwnerLabel("bob", "me", names)).toBe("Bob Lee")
        expect(agentOwnerLabel(null, "me", names)).toBe("No owner")
        expect(agentOwnerLabel("gone", "me", names)).toBe("Former member")
    })
})

describe("toAgentListRow", () => {
    const names = new Map([["bob", "Bob Lee"]])
    const workflow = (patch: Partial<Workflow>): Workflow =>
        ({id: "wf", name: "Support triage", created_by_id: "me", ...patch}) as Workflow
    const owner = (w: Workflow) => {
        const row = toAgentListRow(w, {currentUserId: "me", ownerNames: names, waiting: 0})
        return [row.ownerId, row.ownerName, row.isPrivate]
    }

    it("reads the owner from the access policy, not the creator", () => {
        // Transferred: Alice created it, Bob owns it now.
        expect(owner(workflow({access: {visibility: "project", owner_user_id: "bob"}}))).toEqual([
            "bob",
            "Bob Lee",
            false,
        ])
        expect(owner(workflow({access: {visibility: "project"}}))).toEqual([
            null,
            "No owner",
            false,
        ])
        expect(owner(workflow({access: {visibility: "project", owner_user_id: "gone"}}))).toEqual([
            "gone",
            "Former member",
            false,
        ])
    })

    it("marks the reader's own private agent", () => {
        expect(owner(workflow({access: {visibility: "private", owner_user_id: "me"}}))).toEqual([
            "me",
            "You",
            true,
        ])
    })
})
