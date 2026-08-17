/**
 * The per-turn clock behind the startup ladder (#6047).
 *
 * Three guarantees the ladder depends on: an entry exists only for a turn being narrated, starting
 * always installs a FRESH clock (so a new turn can never inherit the last one's elapsed time and
 * open on its final phase), and every settle path clears it (so a failed or cancelled run leaves no
 * stale label behind).
 */
import {createStore} from "jotai"
import {describe, expect, it} from "vitest"

import {clearTurnClockAtom, startTurnClockAtom, turnStartAtomFamily} from "./turnClock"

describe("turn clock", () => {
    it("has no clock for a session that isn't running a narrated turn", () => {
        const store = createStore()
        expect(store.get(turnStartAtomFamily(`clock-idle-${Date.now()}`))).toBeUndefined()
    })

    it("records when the turn started", () => {
        const store = createStore()
        const id = `clock-start-${Date.now()}`

        const before = Date.now()
        store.set(startTurnClockAtom, id)

        expect(store.get(turnStartAtomFamily(id))).toBeGreaterThanOrEqual(before)
    })

    it("replaces a leftover entry so a new turn never inherits the last one's start", async () => {
        const store = createStore()
        const id = `clock-replace-${Date.now()}`

        store.set(startTurnClockAtom, id)
        const first = store.get(turnStartAtomFamily(id)) ?? 0
        // A resume whose settle React batched away never cleared. Starting must still reset:
        // bailing out here opened the next turn on the last phase of the previous one.
        await new Promise((resolve) => setTimeout(resolve, 2))
        store.set(startTurnClockAtom, id)

        expect(store.get(turnStartAtomFamily(id))).toBeGreaterThan(first)
    })

    it("clears on settle, so a failed or cancelled run strands no label", () => {
        const store = createStore()
        const id = `clock-clear-${Date.now()}`

        store.set(startTurnClockAtom, id)
        store.set(clearTurnClockAtom, id)

        expect(store.get(turnStartAtomFamily(id))).toBeUndefined()
    })

    it("clears idempotently — several settle paths can race", () => {
        const store = createStore()
        const id = `clock-idempotent-${Date.now()}`

        store.set(startTurnClockAtom, id)
        store.set(clearTurnClockAtom, id)
        store.set(clearTurnClockAtom, id)

        expect(store.get(turnStartAtomFamily(id))).toBeUndefined()
    })

    it("lets the next turn start a fresh clock after the last one cleared", () => {
        const store = createStore()
        const id = `clock-restart-${Date.now()}`

        store.set(startTurnClockAtom, id)
        store.set(clearTurnClockAtom, id)
        store.set(startTurnClockAtom, id)

        expect(store.get(turnStartAtomFamily(id))).toBeDefined()
    })

    it("keeps sessions independent", () => {
        const store = createStore()
        const a = `clock-a-${Date.now()}`
        const b = `clock-b-${Date.now()}`

        store.set(startTurnClockAtom, a)
        store.set(startTurnClockAtom, b)
        store.set(clearTurnClockAtom, a)

        expect(store.get(turnStartAtomFamily(a))).toBeUndefined()
        expect(store.get(turnStartAtomFamily(b))).toBeDefined()
    })
})
