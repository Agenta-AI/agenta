/**
 * Which playground sessions the local seam must carry (#5974, #6494).
 *
 * The server list cannot show a session until its first turn lands, so until then this rule is the
 * only thing keeping the row on the rail. It has regressed twice by leaning on signals that go
 * false as soon as you look away.
 */
import {describe, expect, it} from "vitest"

import type {AgentChatSession} from "@/oss/components/AgentChatSlice/state/sessions"

import {qualifiesForLocalRail} from "./localSessionRefs"

const session = (over: Partial<AgentChatSession> = {}): AgentChatSession => ({
    id: "s1",
    ...over,
})

/** Looking elsewhere, with nothing mounted for this session. */
const lookedAway = {isActive: false, isLive: false}

describe("qualifiesForLocalRail", () => {
    // The repro: send the first message, switch tabs before the turn lands.
    it("keeps a session the server has not confirmed yet", () => {
        expect(qualifiesForLocalRail(session(), lookedAway)).toBe(true)
    })

    it("drops it once the server list can carry it", () => {
        expect(qualifiesForLocalRail(session({serverKnown: true}), lookedAway)).toBe(false)
    })

    it("keeps the session you are looking at", () => {
        expect(
            qualifiesForLocalRail(session({serverKnown: true}), {isActive: true, isLive: false}),
        ).toBe(true)
    })

    it("keeps a running or awaiting session", () => {
        expect(
            qualifiesForLocalRail(session({serverKnown: true}), {isActive: false, isLive: true}),
        ).toBe(true)
    })
})
