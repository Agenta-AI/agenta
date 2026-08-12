/**
 * The local run-state record and its settle stamp — the input the running-elsewhere derivation
 * uses to distrust a liveness snapshot older than this browser's own turn (#5844).
 */
import {createStore} from "jotai"
import {describe, expect, it} from "vitest"

import {
    sessionLocalSettledAtAtomFamily,
    sessionStatusAtomFamily,
    setSessionStatusAtom,
} from "./sessions"

describe("setSessionStatusAtom", () => {
    it("stamps the settle time only on a non-idle → idle transition", () => {
        const store = createStore()
        const id = `run-status-${Date.now()}`

        expect(store.get(sessionStatusAtomFamily(id))).toBe("idle")
        // Idle → idle is a no-op: an unvisited session must not look like one that just finished.
        store.set(setSessionStatusAtom, {id, status: "idle"})
        expect(store.get(sessionLocalSettledAtAtomFamily(id))).toBeUndefined()

        store.set(setSessionStatusAtom, {id, status: "running"})
        expect(store.get(sessionStatusAtomFamily(id))).toBe("running")
        expect(store.get(sessionLocalSettledAtAtomFamily(id))).toBeUndefined()

        const before = Date.now()
        store.set(setSessionStatusAtom, {id, status: "idle"})
        const settledAt = store.get(sessionLocalSettledAtAtomFamily(id))
        expect(settledAt).toBeGreaterThanOrEqual(before)
        expect(store.get(sessionStatusAtomFamily(id))).toBe("idle")
    })

    it("stamps an active run when it errors without restamping on cleanup", () => {
        const store = createStore()
        const id = `run-status-parked-${Date.now()}`

        store.set(setSessionStatusAtom, {id, status: "awaiting"})
        store.set(setSessionStatusAtom, {id, status: "error"})
        const settledAt = store.get(sessionLocalSettledAtAtomFamily(id))
        expect(settledAt).toBeGreaterThan(0)

        store.set(setSessionStatusAtom, {id, status: "idle"})
        expect(store.get(sessionLocalSettledAtAtomFamily(id))).toBe(settledAt)
    })

    it("does not stamp an error without a preceding local run", () => {
        const store = createStore()
        const id = `run-status-hydrated-error-${Date.now()}`

        store.set(setSessionStatusAtom, {id, status: "error"})
        expect(store.get(sessionLocalSettledAtAtomFamily(id))).toBeUndefined()
    })
})
