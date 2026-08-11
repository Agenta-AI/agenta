/**
 * Pins the running-elsewhere decision (#5844): the strip appeared in the very tab that had just
 * answered, because `is_running` is a 15s poll snapshot while the local run-state is instant.
 *
 * `noteSessionLocalStatusAtom` is the app-side mirror of the run-state transition that stamps the
 * settle time (the run-state record itself now lives in `@agenta/chat/state`), so the same
 * transition rules the upstream `setSessionStatusAtom` test pinned are pinned here.
 */
import {createStore} from "jotai"
import {describe, expect, it} from "vitest"

import {
    isRunningElsewhere,
    noteSessionLocalStatusAtom,
    sessionLocalSettledAtAtomFamily,
} from "./liveness"

/** A session this browser has never run: no settle stamp, so the flag is trusted as-is. */
const neverRanHere = {localStatus: "idle", localSettledAt: undefined} as const

describe("isRunningElsewhere", () => {
    it("shows a genuinely remote run", () => {
        expect(
            isRunningElsewhere({...neverRanHere, isRunning: true, livenessUpdatedAt: 1_000}),
        ).toBe(true)
    })

    it("stays hidden when nothing is running", () => {
        expect(
            isRunningElsewhere({...neverRanHere, isRunning: false, livenessUpdatedAt: 1_000}),
        ).toBe(false)
    })

    it("stays hidden for active local states", () => {
        for (const localStatus of ["running", "awaiting"] as const) {
            expect(
                isRunningElsewhere({
                    localStatus,
                    isRunning: true,
                    localSettledAt: undefined,
                    livenessUpdatedAt: 1_000,
                }),
            ).toBe(false)
        }
    })

    it("distrusts stale liveness after a local error", () => {
        expect(
            isRunningElsewhere({
                localStatus: "error",
                isRunning: true,
                localSettledAt: 5_000,
                livenessUpdatedAt: 4_000,
            }),
        ).toBe(false)
    })

    it("shows a remote run refreshed after a local error", () => {
        expect(
            isRunningElsewhere({
                localStatus: "error",
                isRunning: true,
                localSettledAt: 5_000,
                livenessUpdatedAt: 5_001,
            }),
        ).toBe(true)
    })

    it("distrusts a liveness snapshot taken before our own turn ended", () => {
        expect(
            isRunningElsewhere({
                localStatus: "idle",
                isRunning: true,
                localSettledAt: 5_000,
                livenessUpdatedAt: 4_000,
            }),
        ).toBe(false)
    })

    it("trusts the flag again once liveness has been re-read since the turn ended", () => {
        expect(
            isRunningElsewhere({
                localStatus: "idle",
                isRunning: true,
                localSettledAt: 5_000,
                livenessUpdatedAt: 5_001,
            }),
        ).toBe(true)
    })
})

describe("noteSessionLocalStatusAtom", () => {
    it("stamps the settle time only on an active → idle transition", () => {
        const store = createStore()
        const id = `run-status-${Date.now()}`

        // Idle → idle is a no-op: an unvisited session must not look like one that just finished.
        store.set(noteSessionLocalStatusAtom, {id, status: "idle"})
        expect(store.get(sessionLocalSettledAtAtomFamily(id))).toBeUndefined()

        store.set(noteSessionLocalStatusAtom, {id, status: "running"})
        expect(store.get(sessionLocalSettledAtAtomFamily(id))).toBeUndefined()

        const before = Date.now()
        store.set(noteSessionLocalStatusAtom, {id, status: "idle"})
        const settledAt = store.get(sessionLocalSettledAtAtomFamily(id))
        expect(settledAt).toBeGreaterThanOrEqual(before)
    })

    it("stamps an active run when it errors without restamping on cleanup", () => {
        const store = createStore()
        const id = `run-status-parked-${Date.now()}`

        store.set(noteSessionLocalStatusAtom, {id, status: "awaiting"})
        store.set(noteSessionLocalStatusAtom, {id, status: "error"})
        const settledAt = store.get(sessionLocalSettledAtAtomFamily(id))
        expect(settledAt).toBeGreaterThan(0)

        store.set(noteSessionLocalStatusAtom, {id, status: "idle"})
        expect(store.get(sessionLocalSettledAtAtomFamily(id))).toBe(settledAt)
    })

    it("does not stamp an error without a preceding local run", () => {
        const store = createStore()
        const id = `run-status-hydrated-error-${Date.now()}`

        store.set(noteSessionLocalStatusAtom, {id, status: "error"})
        expect(store.get(sessionLocalSettledAtAtomFamily(id))).toBeUndefined()
    })
})
