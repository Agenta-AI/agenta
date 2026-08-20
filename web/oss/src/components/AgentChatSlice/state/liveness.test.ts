/**
 * Pins the running-elsewhere decision (#5844): the strip appeared in the very tab that had just
 * answered, because `is_running` is a 15s poll snapshot while the local run-state is instant.
 */
import {describe, expect, it} from "vitest"

import {isRunningElsewhere} from "./liveness"

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
