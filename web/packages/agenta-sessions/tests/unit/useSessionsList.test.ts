import {describe, expect, it} from "vitest"

import {pinnedSessionListArgs} from "../../src/state/useSessionsList"

describe("pinnedSessionListArgs", () => {
    // A pin is an explicit user request and overrides the surface's origin filter — a pinned
    // automation session must still show in human (exclude-trigger) mode (P2-8). It also needs
    // the `trigger` expansion added regardless of the surface's own policy: a human-mode surface
    // never requests it, so a pinned automation row's name would otherwise never resolve and
    // fall back to "Missing schedule".
    it("overrides the origin policy to 'all' and adds the trigger expansion, keeping every other shared filter", () => {
        const shared = {
            originPolicy: "exclude-trigger" as const,
            expansions: ["last_message"] as const,
            search: "refund",
            agentId: "agent-1",
            status: "live" as const,
            includeArchived: false,
            waitingSessionIds: ["waiting-1"],
        }
        expect(pinnedSessionListArgs(shared, ["pin-1", "pin-2"])).toEqual({
            ...shared,
            originPolicy: "all",
            expansions: ["last_message", "trigger"],
            sessionIds: ["pin-1", "pin-2"],
            enabled: true,
        })
    })

    it("does not duplicate the trigger expansion when the surface already requests it", () => {
        const shared = {
            originPolicy: "trigger-only" as const,
            expansions: ["last_message", "trigger"] as const,
        }
        expect(pinnedSessionListArgs(shared, ["pin-1"])).toEqual({
            ...shared,
            originPolicy: "all",
            expansions: ["last_message", "trigger"],
            sessionIds: ["pin-1"],
            enabled: true,
        })
    })

    it("disables the pinned query when there are no pins", () => {
        const shared = {originPolicy: "trigger-only" as const, expansions: [] as const}
        expect(pinnedSessionListArgs(shared, [])).toEqual({
            ...shared,
            originPolicy: "all",
            expansions: ["trigger"],
            sessionIds: [],
            enabled: false,
        })
    })
})
