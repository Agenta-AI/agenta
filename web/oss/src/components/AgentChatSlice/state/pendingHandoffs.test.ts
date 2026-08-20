/**
 * Unit tests for the create/open handoff lists (#6042).
 *
 * Regression: both carriers were single slots, so creating a second session before the first
 * playground consumed its handoff OVERWROTE the first — the earlier session was never created and
 * its message was silently lost (reproduced live on the 8180 dev stack: "Repro test 1 …" left no
 * session row, no run, no error, while "Repro test 2 …" ran normally).
 */
import {createStore} from "jotai"
import {describe, expect, it} from "vitest"

import {
    addFirstRunSeedAtom,
    agentFirstRunSeedsAtom,
    removeFirstRunSeedAtom,
    type AgentFirstRunSeed,
} from "./firstRunSeed"
import {
    addPendingSessionOpenAtom,
    pendingSessionOpensAtom,
    removePendingSessionOpensAtom,
    type PendingSessionOpen,
} from "./pendingSessionOpen"

const seed = (over: Partial<AgentFirstRunSeed> = {}): AgentFirstRunSeed => ({
    appId: "app-1",
    sessionId: "session-1",
    seedMessage: "first message",
    autoSend: true,
    ...over,
})

describe("first-run seed list", () => {
    it("keeps a parked seed when a second session's seed arrives", () => {
        const store = createStore()
        const first = seed()
        const second = seed({sessionId: "session-2", seedMessage: "second message"})
        store.set(addFirstRunSeedAtom, first)
        store.set(addFirstRunSeedAtom, second)
        expect(store.get(agentFirstRunSeedsAtom)).toEqual([first, second])
    })

    it("replaces a re-sent seed for the SAME session instead of duplicating it", () => {
        const store = createStore()
        store.set(addFirstRunSeedAtom, seed())
        const resent = seed({seedMessage: "edited message"})
        store.set(addFirstRunSeedAtom, resent)
        expect(store.get(agentFirstRunSeedsAtom)).toEqual([resent])
    })

    it("keeps id-less legacy seeds alongside addressed ones", () => {
        const store = createStore()
        const legacy = seed({sessionId: undefined})
        const addressed = seed()
        store.set(addFirstRunSeedAtom, legacy)
        store.set(addFirstRunSeedAtom, addressed)
        expect(store.get(agentFirstRunSeedsAtom)).toEqual([legacy, addressed])
    })

    it("removes exactly the given seed, by identity", () => {
        const store = createStore()
        const first = seed()
        // Same text on purpose: removal must not match by content.
        const twin = seed({sessionId: "session-2"})
        store.set(addFirstRunSeedAtom, first)
        store.set(addFirstRunSeedAtom, twin)
        store.set(removeFirstRunSeedAtom, first)
        expect(store.get(agentFirstRunSeedsAtom)).toEqual([twin])
    })
})

const open = (over: Partial<PendingSessionOpen> = {}): PendingSessionOpen => ({
    appId: "app-1",
    newSessionId: "session-1",
    ...over,
})

describe("pending session-open list", () => {
    it("queues a second create instead of overwriting the first", () => {
        const store = createStore()
        const first = open()
        const second = open({newSessionId: "session-2"})
        store.set(addPendingSessionOpenAtom, first)
        store.set(addPendingSessionOpenAtom, second)
        expect(store.get(pendingSessionOpensAtom)).toEqual([first, second])
    })

    it("replaces a repeat click for the same session", () => {
        const store = createStore()
        store.set(addPendingSessionOpenAtom, open({sessionId: "adopt-1", newSessionId: undefined}))
        const repeat = open({sessionId: "adopt-1", newSessionId: undefined, title: "renamed"})
        store.set(addPendingSessionOpenAtom, repeat)
        expect(store.get(pendingSessionOpensAtom)).toEqual([repeat])
    })

    it("removes only the consumed entries", () => {
        const store = createStore()
        const mine = open()
        const other = open({appId: "app-2", newSessionId: "session-2"})
        store.set(addPendingSessionOpenAtom, mine)
        store.set(addPendingSessionOpenAtom, other)
        store.set(removePendingSessionOpensAtom, [mine])
        expect(store.get(pendingSessionOpensAtom)).toEqual([other])
    })
})
