import {describe, expect, it} from "vitest"

import {
    requestedSessionRows,
    sessionTabListArgs,
    sessionTabRowsPending,
} from "../../src/state/useSessionTabRows"

describe("sessionTabListArgs", () => {
    // An open tab is an explicit choice: the surface's origin filter must not hide it, and an
    // automation session's title has to resolve — the same two reasons pins override the policy.
    it("fetches exactly the open ids, across every origin, with the trigger expansion", () => {
        const policy = {origin: "exclude-trigger", expansions: ["last_message"]} as const
        expect(sessionTabListArgs(policy, "agent-1", ["s-1", "s-2"])).toEqual({
            originPolicy: "all",
            expansions: ["last_message", "trigger"],
            agentId: "agent-1",
            sessionIds: ["s-1", "s-2"],
            enabled: true,
            lowPriority: false,
        })
    })

    // Without ids the request would read as "no restriction" and page the whole project.
    it("disables the query on an empty set", () => {
        const policy = {origin: "all", expansions: ["trigger"]} as const
        expect(sessionTabListArgs(policy, undefined, [])).toMatchObject({
            expansions: ["trigger"],
            sessionIds: [],
            enabled: false,
        })
    })
})

describe("sessionTabRowsPending", () => {
    it("waits only while a non-empty set has no rows yet", () => {
        expect(sessionTabRowsPending(2, true)).toBe(true)
        expect(sessionTabRowsPending(2, false)).toBe(false)
    })

    // A disabled query reports `pending` forever; an agent with no sessions is not loading.
    it("never waits on an empty set", () => {
        expect(sessionTabRowsPending(0, true)).toBe(false)
    })
})

describe("requestedSessionRows", () => {
    it("drops rows the previous set fetched but this set does not ask for", () => {
        const rows = [{session_id: "a"}, {session_id: "closed"}, {session_id: "b"}]
        expect(requestedSessionRows(rows, new Set(["a", "b"]))).toEqual([
            {session_id: "a"},
            {session_id: "b"},
        ])
    })
})
