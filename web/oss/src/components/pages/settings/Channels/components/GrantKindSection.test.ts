import type {AgentaApi} from "@agentaai/api-client"
import {describe, expect, it} from "vitest"

import {kindAnswer, planKindTransition} from "./GrantKindSection"

function grant(overrides: Partial<AgentaApi.ChannelGrant> = {}): AgentaApi.ChannelGrant {
    return {
        id: "g1",
        agent_id: "agent-1",
        effect: "allow",
        kind: "private",
        data: {},
        ...overrides,
    }
}

describe("kindAnswer", () => {
    it("reads unanswered from an empty set", () => {
        expect(kindAnswer([])).toBe("unanswered")
    })

    it("reads allow when the only matching row allows", () => {
        expect(kindAnswer([grant({effect: "allow"})])).toBe("allow")
    })

    it("reads deny when any matching row denies, deny-first like evaluation", () => {
        expect(
            kindAnswer([grant({id: "g1", effect: "allow"}), grant({id: "g2", effect: "deny"})]),
        ).toBe("deny")
    })
})

describe("planKindTransition", () => {
    const base = {agentId: "agent-1", kind: "private" as AgentaApi.ChannelSpaceKind}

    it("unanswered -> allow creates with nothing to remove", () => {
        const plan = planKindTransition({...base, existing: [], next: "allow"})
        expect(plan.toRemoveIds).toEqual([])
        expect(plan.toCreate).toEqual({agent_id: "agent-1", kind: "private", effect: "allow"})
    })

    it("allow -> deny removes the old row and creates a new one, never edits it", () => {
        const existing = [grant({id: "g1", effect: "allow"})]
        const plan = planKindTransition({...base, existing, next: "deny"})
        expect(plan.toRemoveIds).toEqual(["g1"])
        expect(plan.toCreate).toEqual({agent_id: "agent-1", kind: "private", effect: "deny"})
    })

    it("deny -> unanswered only removes, creates nothing", () => {
        const existing = [grant({id: "g1", effect: "deny"})]
        const plan = planKindTransition({...base, existing, next: "unanswered"})
        expect(plan.toRemoveIds).toEqual(["g1"])
        expect(plan.toCreate).toBeUndefined()
    })

    it("drops rows with no id rather than passing undefined to remove()", () => {
        const existing = [grant({id: undefined})]
        const plan = planKindTransition({...base, existing, next: "unanswered"})
        expect(plan.toRemoveIds).toEqual([])
    })
})
