import {describe, expect, it} from "vitest"

import {pinnedSessionListArgs, sessionCardListIsStale} from "../../src/state/useSessionCardList"

describe("pinnedSessionListArgs", () => {
    // A pin is an explicit user request and overrides the surface's origin filter — a pinned
    // automation session must still show on a human-mode (exclude-trigger) card (P2-8). It also
    // needs the `trigger` expansion added regardless of the card's own policy: a human-mode card
    // never requests it, so a pinned automation row's name would otherwise never resolve and
    // fall back to "Missing schedule".
    it("overrides the surface's origin policy to 'all' and adds the trigger expansion", () => {
        const policy = {origin: "exclude-trigger", expansions: ["last_message"]} as const
        expect(pinnedSessionListArgs(policy, "agent-1", ["pin-1", "pin-2"], true)).toEqual({
            originPolicy: "all",
            expansions: ["last_message", "trigger"],
            agentId: "agent-1",
            sessionIds: ["pin-1", "pin-2"],
            enabled: true,
            lowPriority: false,
        })
    })

    it("does not duplicate the trigger expansion for a trigger-only (automation) surface", () => {
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
            lowPriority: false,
        })
    })
})

describe("sessionCardListIsStale", () => {
    it("is stale while a pinned or waiting query still shows the previous agent's rows", () => {
        const list = {placeholder: false, used: true}
        expect(sessionCardListIsStale([list, {placeholder: true, used: true}])).toBe(true)
        expect(sessionCardListIsStale([list, {placeholder: false, used: true}])).toBe(false)
    })

    it("ignores a query the card does not use", () => {
        expect(
            sessionCardListIsStale([
                {placeholder: false, used: true},
                {placeholder: true, used: false},
            ]),
        ).toBe(false)
    })
})
