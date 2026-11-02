/**
 * Reopening a session re-read its whole record log twice (#6296).
 *
 * The relay's `ready` fires on every connect — every tab activation, every return to the window —
 * and it ran the same full fetch + remap + replace that a real records change does, right next to
 * the mount's own revalidation.
 */
import {describe, expect, it} from "vitest"

import {READY_RELOAD_GRACE_MS, shouldRefreshOnReady} from "./readyRefresh"

const NOW = 1_000_000

describe("shouldRefreshOnReady", () => {
    it("reads the log when this mount has never read it", () => {
        expect(shouldRefreshOnReady({inFlight: false, lastLoadedAt: undefined, now: NOW})).toBe(
            true,
        )
    })

    it("skips while the mount's own read is still running", () => {
        // The reopen case: the revalidation is in flight and `ready` lands beside it.
        expect(shouldRefreshOnReady({inFlight: true, lastLoadedAt: undefined, now: NOW})).toBe(
            false,
        )
    })

    it("skips a read that just completed", () => {
        expect(shouldRefreshOnReady({inFlight: false, lastLoadedAt: NOW - 100, now: NOW})).toBe(
            false,
        )
    })

    it("reads again once the grace window has passed", () => {
        // A reconnect after the tab was hidden: we may have missed events, so re-read.
        expect(
            shouldRefreshOnReady({
                inFlight: false,
                lastLoadedAt: NOW - READY_RELOAD_GRACE_MS,
                now: NOW,
            }),
        ).toBe(true)
        expect(
            shouldRefreshOnReady({
                inFlight: false,
                lastLoadedAt: NOW - READY_RELOAD_GRACE_MS - 1,
                now: NOW,
            }),
        ).toBe(true)
    })

    it("still skips inside the window even with a completed read on record", () => {
        expect(
            shouldRefreshOnReady({
                inFlight: true,
                lastLoadedAt: NOW - READY_RELOAD_GRACE_MS - 1,
                now: NOW,
            }),
        ).toBe(false)
    })
})
