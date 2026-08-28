/**
 * Closing a running tab has to cancel the run (#6296).
 *
 * Closing only unmounted the pane, and the pane's teardown aborts this browser's fetch and nothing
 * else — the runner kept going and kept the session's alive lock, so the tab you reopened read as
 * running-elsewhere until that lock timed out.
 *
 * The cancel is held back behind `CLOSE_CANCELS_RUN` for now, so the running case is pinned to the
 * flag: it reads false while the switch is off and true the moment it is flipped back on. The
 * carve-outs below hold either way.
 */
import {describe, expect, it} from "vitest"

import {CLOSE_CANCELS_RUN, shouldCancelRunOnClose} from "./closeSessionCancel"

const PROJECT = "project-1"

describe("shouldCancelRunOnClose", () => {
    it("cancels a run this browser is driving, only while the kill switch is on", () => {
        expect(shouldCancelRunOnClose({status: "running", projectId: PROJECT})).toBe(
            CLOSE_CANCELS_RUN,
        )
    })

    it("leaves a parked approval alone — it is durable and answerable later", () => {
        expect(shouldCancelRunOnClose({status: "awaiting", projectId: PROJECT})).toBe(false)
    })

    it("has nothing to cancel on a settled session", () => {
        expect(shouldCancelRunOnClose({status: "idle", projectId: PROJECT})).toBe(false)
        expect(shouldCancelRunOnClose({status: "error", projectId: PROJECT})).toBe(false)
    })

    it("skips the command when no project has resolved to scope it", () => {
        expect(shouldCancelRunOnClose({status: "running", projectId: null})).toBe(false)
        expect(shouldCancelRunOnClose({status: "running", projectId: undefined})).toBe(false)
    })
})
