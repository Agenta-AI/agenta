/**
 * The client-created session registry behind #6776: a session the server cannot list yet is
 * noted at its first send, keeps its first message as its name, follows that send's fate, and
 * retires once the server carries it.
 */
import {createStore} from "jotai"
import {describe, expect, it} from "vitest"

import {
    dropUnacceptedLocalSessionAtom,
    forgetLocalSessionsAtom,
    localSessionNameFromText,
    localSessionsAtom,
    markLocalSessionAcceptedAtom,
    registerLocalSessionAtom,
} from "../../src/session"

describe("localSessions", () => {
    it("registers a session with its first message as the name, in its project", () => {
        const store = createStore()
        store.set(registerLocalSessionAtom, {
            sessionId: "s1",
            projectId: "p1",
            agentId: "a1",
            name: "  Write a file named qa.html \n second line",
            now: 1_000,
        })
        expect(store.get(localSessionsAtom)).toEqual({
            s1: {
                sessionId: "s1",
                projectId: "p1",
                agentId: "a1",
                name: "Write a file named qa.html",
                createdAt: 1_000,
                state: "submitting",
            },
        })
    })

    it("keeps the first name and creation time on a repeat, only filling a missing agent", () => {
        const store = createStore()
        store.set(registerLocalSessionAtom, {
            sessionId: "s1",
            projectId: "p1",
            name: "first",
            now: 1_000,
        })
        const before = store.get(localSessionsAtom)
        store.set(registerLocalSessionAtom, {
            sessionId: "s1",
            projectId: "p1",
            name: "second",
            now: 2_000,
        })
        // Nothing changed, so the same object comes back — no spurious list re-render.
        expect(store.get(localSessionsAtom)).toBe(before)
        store.set(registerLocalSessionAtom, {
            sessionId: "s1",
            projectId: "p1",
            agentId: "a1",
            name: "third",
        })
        expect(store.get(localSessionsAtom).s1).toEqual({
            sessionId: "s1",
            projectId: "p1",
            agentId: "a1",
            name: "first",
            createdAt: 1_000,
            state: "submitting",
        })
    })

    // A rejected or refused first send: the server will never list this session, so the row
    // must not outlive the send (#6783 review).
    it("drops a session whose only send failed", () => {
        const store = createStore()
        store.set(registerLocalSessionAtom, {sessionId: "s1", projectId: "p1", name: "one"})
        store.set(dropUnacceptedLocalSessionAtom, {sessionId: "s1"})
        expect(store.get(localSessionsAtom)).toEqual({})
    })

    it("keeps an accepted session through a later failure, until the server lists it", () => {
        const store = createStore()
        store.set(registerLocalSessionAtom, {sessionId: "s1", projectId: "p1", name: "one"})
        store.set(markLocalSessionAcceptedAtom, {sessionId: "s1", sendId: "m1"})
        expect(store.get(localSessionsAtom).s1.state).toBe("accepted")
        const accepted = store.get(localSessionsAtom)
        // Accepting twice, or dropping on a LATER message's failure, changes nothing.
        store.set(markLocalSessionAcceptedAtom, {sessionId: "s1", sendId: "m2"})
        store.set(dropUnacceptedLocalSessionAtom, {sessionId: "s1", sendId: "m2"})
        store.set(dropUnacceptedLocalSessionAtom, {sessionId: "s1"})
        expect(store.get(localSessionsAtom)).toBe(accepted)
        // Only the server list retires it.
        store.set(forgetLocalSessionsAtom, ["s1"])
        expect(store.get(localSessionsAtom)).toEqual({})
    })

    // The non-durable send path admits on reaching the transport, so its admission is provisional:
    // a rejection before any turn was named retracts it and the row goes with it (#6783 review).
    it("drops an accepted session when the admitting send is the one that failed", () => {
        const store = createStore()
        store.set(registerLocalSessionAtom, {sessionId: "s1", projectId: "p1", name: "one"})
        store.set(markLocalSessionAcceptedAtom, {sessionId: "s1", sendId: "m1"})
        expect(store.get(localSessionsAtom).s1.admittedBy).toBe("m1")
        store.set(dropUnacceptedLocalSessionAtom, {sessionId: "s1", sendId: "m1"})
        expect(store.get(localSessionsAtom)).toEqual({})
    })

    it("ignores lifecycle events for a session it never registered", () => {
        const store = createStore()
        const before = store.get(localSessionsAtom)
        store.set(markLocalSessionAcceptedAtom, {sessionId: "missing", sendId: "m1"})
        store.set(dropUnacceptedLocalSessionAtom, {sessionId: "missing", sendId: "m1"})
        expect(store.get(localSessionsAtom)).toBe(before)
    })

    it("forgets only the ids it holds and leaves the map untouched otherwise", () => {
        const store = createStore()
        store.set(registerLocalSessionAtom, {sessionId: "s1", projectId: "p1", name: "one", now: 1})
        store.set(registerLocalSessionAtom, {sessionId: "s2", projectId: "p1", name: "two", now: 2})
        const before = store.get(localSessionsAtom)
        store.set(forgetLocalSessionsAtom, ["missing"])
        expect(store.get(localSessionsAtom)).toBe(before)
        store.set(forgetLocalSessionsAtom, ["s1", "missing"])
        expect(Object.keys(store.get(localSessionsAtom))).toEqual(["s2"])
    })

    it("derives a title from the first line, bounded, or none from blank text", () => {
        expect(localSessionNameFromText("  hi \n there")).toBe("hi")
        expect(localSessionNameFromText("   \n  ")).toBeNull()
        expect(localSessionNameFromText(undefined)).toBeNull()
        expect(localSessionNameFromText("x".repeat(200))).toBe(`${"x".repeat(120)}…`)
    })
})
