/**
 * Closing a running tab has to cancel the run (#6296).
 *
 * Closing only unmounted the pane, and the pane's teardown aborts this browser's fetch and nothing
 * else — the runner kept going and kept the session's alive lock, so the tab you reopened read as
 * running-elsewhere until that lock timed out.
 */
import {describe, expect, it} from "vitest"

import {shouldCancelRunOnClose} from "./closeSessionCancel"

const PROJECT = "project-1"

describe("shouldCancelRunOnClose", () => {
    it("cancels a run this browser is driving", () => {
        expect(shouldCancelRunOnClose({status: "running", projectId: PROJECT})).toBe(true)
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
