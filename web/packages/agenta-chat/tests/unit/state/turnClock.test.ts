import {createStore} from "jotai"
import {describe, expect, it} from "vitest"

import {clearTurnClockAtom, startTurnClockAtom, turnStartAtomFamily} from "../../../src/state/turnClock"

describe("turn startup label", () => {
    it("has no label for an idle session", () => {
        const store = createStore()
        expect(store.get(turnStartAtomFamily("idle"))).toBeUndefined()
    })

    it("records and replaces the latest observed label", () => {
        const store = createStore()
        store.set(startTurnClockAtom, "session", "Working")
        expect(store.get(turnStartAtomFamily("session"))).toBe("Working")

        store.set(startTurnClockAtom, "session", "Agent ready")
        expect(store.get(turnStartAtomFamily("session"))).toBe("Agent ready")
    })

    it("clears idempotently on every terminal path", () => {
        const store = createStore()
        store.set(startTurnClockAtom, "session", "Working")
        store.set(clearTurnClockAtom, "session")
        store.set(clearTurnClockAtom, "session")
        expect(store.get(turnStartAtomFamily("session"))).toBeUndefined()
    })
})
