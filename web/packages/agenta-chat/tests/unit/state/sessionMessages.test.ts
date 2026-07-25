// @vitest-environment jsdom
import type {UIMessage} from "ai"
import {createStore} from "jotai"
import {describe, expect, it} from "vitest"

import {
    isSessionStreamingAtomFamily,
    persistSessionMessagesAtom,
    sessionMessagesAtom,
    sessionStatusAtomFamily,
    setSessionStatusAtom,
} from "../../../src/state/sessionMessages"

const msg = (id: string, text: string): UIMessage =>
    ({id, role: "user", parts: [{type: "text", text}]}) as UIMessage

describe("sessionMessages state", () => {
    it("persists a session's messages under its id", () => {
        const store = createStore()
        store.set(persistSessionMessagesAtom, {id: "s1", messages: [msg("m1", "hello")]})
        expect(store.get(sessionMessagesAtom)["s1"]).toHaveLength(1)
        // A later settle replaces that session's slice without touching others.
        store.set(persistSessionMessagesAtom, {id: "s2", messages: [msg("m2", "other")]})
        store.set(persistSessionMessagesAtom, {
            id: "s1",
            messages: [msg("m1", "hello"), msg("m3", "again")],
        })
        expect(store.get(sessionMessagesAtom)["s1"]).toHaveLength(2)
        expect(store.get(sessionMessagesAtom)["s2"]).toHaveLength(1)
    })

    it("run status defaults to idle, stores non-idle, and clears on idle", () => {
        const store = createStore()
        expect(store.get(sessionStatusAtomFamily("sx"))).toBe("idle")
        store.set(setSessionStatusAtom, {id: "sx", status: "running"})
        expect(store.get(sessionStatusAtomFamily("sx"))).toBe("running")
        expect(store.get(isSessionStreamingAtomFamily("sx"))).toBe(true)
        store.set(setSessionStatusAtom, {id: "sx", status: "awaiting"})
        expect(store.get(sessionStatusAtomFamily("sx"))).toBe("awaiting")
        expect(store.get(isSessionStreamingAtomFamily("sx"))).toBe(false)
        // Idle is stored as absence (clear-on-unmount semantics).
        store.set(setSessionStatusAtom, {id: "sx", status: "idle"})
        expect(store.get(sessionStatusAtomFamily("sx"))).toBe("idle")
    })
})
