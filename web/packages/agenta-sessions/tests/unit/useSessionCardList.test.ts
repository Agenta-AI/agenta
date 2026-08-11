import {describe, expect, it} from "vitest"

import {pinnedSessionListArgs} from "../../src/state/useSessionCardList"

describe("pinnedSessionListArgs", () => {
    // A pin is an explicit user request and overrides the surface's origin filter — a pinned
    // automation session must still show on a human-mode (exclude-trigger) card (P2-8).
    it("overrides the surface's origin policy to 'all', keeping its expansions", () => {
        const policy = {origin: "exclude-trigger", expansions: ["last_message"]} as const
        expect(pinnedSessionListArgs(policy, "agent-1", ["pin-1", "pin-2"], true)).toEqual({
            originPolicy: "all",
            expansions: ["last_message"],
            agentId: "agent-1",
            sessionIds: ["pin-1", "pin-2"],
            enabled: true,
        })
    })

    it("does the same for a trigger-only (automation) surface", () => {
        const policy = {
            origin: "trigger-only",
            expansions: ["last_message", "trigger"],
        } as const
        expect(pinnedSessionListArgs(policy, undefined, [], false)).toEqual({
            originPolicy: "all",
            expansions: ["last_message", "trigger"],
            agentId: undefined,
            sessionIds: [],
            enabled: false,
        })
    })
})
