/**
 * The client-created session registry behind #6776: a session the server cannot list yet is
 * noted at its first send, keeps its first message as its name, and retires once the server
 * carries it.
 */
import {createStore} from "jotai"
import {describe, expect, it} from "vitest"

import {
    forgetLocalSessionsAtom,
    localSessionNameFromText,
    localSessionsAtom,
    registerLocalSessionAtom,
} from "../../src/session"

describe("localSessions", () => {
    it("registers a session with its first message as the name", () => {
        const store = createStore()
        store.set(registerLocalSessionAtom, {
            sessionId: "s1",
            agentId: "a1",
            name: "  Write a file named qa.html \n second line",
            now: 1_000,
        })
        expect(store.get(localSessionsAtom)).toEqual({
            s1: {
                sessionId: "s1",
                agentId: "a1",
                name: "Write a file named qa.html",
                createdAt: 1_000,
            },
        })
    })

    it("keeps the first name and creation time on a repeat, only filling a missing agent", () => {
        const store = createStore()
        store.set(registerLocalSessionAtom, {sessionId: "s1", name: "first", now: 1_000})
        const before = store.get(localSessionsAtom)
        store.set(registerLocalSessionAtom, {sessionId: "s1", name: "second", now: 2_000})
        // Nothing changed, so the same object comes back — no spurious list re-render.
        expect(store.get(localSessionsAtom)).toBe(before)
        store.set(registerLocalSessionAtom, {sessionId: "s1", agentId: "a1", name: "third"})
        expect(store.get(localSessionsAtom).s1).toEqual({
            sessionId: "s1",
            agentId: "a1",
            name: "first",
            createdAt: 1_000,
        })
    })

    it("forgets only the ids it holds and leaves the map untouched otherwise", () => {
        const store = createStore()
        store.set(registerLocalSessionAtom, {sessionId: "s1", name: "one", now: 1})
        store.set(registerLocalSessionAtom, {sessionId: "s2", name: "two", now: 2})
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
