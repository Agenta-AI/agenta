/**
 * Pins the session-liveness derivation (`core/liveness.ts`). The backend stores only the three
 * primitive flags (`is_alive`/`is_running`/`is_attached`) and leaves `resumable`/`reattachable`
 * and the lifecycle label to the client. These tests lock the nest algebra + the coarse (proc-axis)
 * lifecycle + the sandbox-refinement seam so a future flag rename or lifecycle change is caught.
 */
import {describe, expect, it} from "vitest"

import {
    deriveSessionLifecycle,
    deriveStreamNest,
    livenessPollInterval,
    refineLifecycleWithSandbox,
} from "../../src/session/core/liveness"
import type {SessionStream} from "../../src/session/core/schema"

const streamWith = (flags: Partial<NonNullable<SessionStream["flags"]>>): SessionStream => ({
    id: "stream-1",
    project_id: "proj-1",
    session_id: "sess-1",
    flags,
})

describe("deriveStreamNest", () => {
    it("treats a missing stream as all-false / not-alive", () => {
        const nest = deriveStreamNest(null)
        expect(nest).toEqual({
            isAlive: false,
            isRunning: false,
            isAttached: false,
            resumable: false,
            reattachable: false,
        })
    })

    it("resumable = alive && !running (alive-but-idle)", () => {
        const nest = deriveStreamNest(streamWith({is_alive: true, is_running: false}))
        expect(nest.resumable).toBe(true)
        expect(nest.reattachable).toBe(false)
    })

    it("reattachable = running && !attached (live turn nobody is watching)", () => {
        const nest = deriveStreamNest(
            streamWith({is_alive: true, is_running: true, is_attached: false}),
        )
        expect(nest.reattachable).toBe(true)
        expect(nest.resumable).toBe(false)
    })

    it("running && attached is neither resumable nor reattachable (someone is watching)", () => {
        const nest = deriveStreamNest(
            streamWith({is_alive: true, is_running: true, is_attached: true}),
        )
        expect(nest.resumable).toBe(false)
        expect(nest.reattachable).toBe(false)
    })

    it("defaults absent flags to false without throwing", () => {
        expect(deriveStreamNest(streamWith({})).isAlive).toBe(false)
    })
})

describe("deriveSessionLifecycle (coarse, proc-axis)", () => {
    it("no stream → new", () => {
        expect(deriveSessionLifecycle(null)).toBe("new")
        expect(deriveSessionLifecycle(undefined)).toBe("new")
    })

    it("alive → hot (running or idle)", () => {
        expect(deriveSessionLifecycle(streamWith({is_alive: true, is_running: true}))).toBe("hot")
        expect(deriveSessionLifecycle(streamWith({is_alive: true, is_running: false}))).toBe("hot")
    })

    it("proc-dead → cold (conservative resume-needed default)", () => {
        expect(deriveSessionLifecycle(streamWith({is_alive: false}))).toBe("cold")
    })
})

describe("refineLifecycleWithSandbox", () => {
    it("passes hot/new through unchanged (proc state is authoritative)", () => {
        expect(refineLifecycleWithSandbox("hot", {alive: false})).toBe("hot")
        expect(refineLifecycleWithSandbox("new", {alive: true})).toBe("new")
    })

    it("leaves cold coarse when no sandbox info is available", () => {
        expect(refineLifecycleWithSandbox("cold", null)).toBe("cold")
        expect(refineLifecycleWithSandbox("cold", {})).toBe("cold")
    })

    it("refines proc-dead by disk state: gone → dead, warm → warm, cold-stored → cold", () => {
        expect(refineLifecycleWithSandbox("cold", {alive: false})).toBe("dead")
        expect(refineLifecycleWithSandbox("cold", {alive: true, warm: true})).toBe("warm")
        expect(refineLifecycleWithSandbox("cold", {alive: true, warm: false})).toBe("cold")
    })
})

// The cadence rule every liveness poll shares. It exists because "the alive set is non-empty" is
// not the same question as "is anything running", and Stop is what makes the difference visible.
describe("livenessPollInterval", () => {
    const rows = (...flags: Partial<NonNullable<SessionStream["flags"]>>[]) => flags.map(streamWith)

    it("polls fast while any row is running", () => {
        expect(livenessPollInterval(rows({is_alive: true, is_running: true}))).toBe(15_000)
        expect(livenessPollInterval(rows({is_alive: true}, {is_running: true}))).toBe(15_000)
    })

    // A stopped session, and equally an ordinary finished turn: both keep `alive` so the sandbox
    // can resume warm. Keyed on `is_alive` this would stay at 15s for the whole hour that lock
    // lives, in every open tab, for a session nobody is running.
    it("drops to the slow cadence for a session that is alive but not running", () => {
        expect(livenessPollInterval(rows({is_alive: true}))).toBe(60_000)
    })

    it("stops by default when nothing is alive", () => {
        expect(livenessPollInterval(rows({}))).toBe(false)
        expect(livenessPollInterval([])).toBe(false)
        expect(livenessPollInterval(null)).toBe(false)
        expect(livenessPollInterval(undefined)).toBe(false)
    })

    // The rail must still DISCOVER a run it did not start, so it names a floor instead of false.
    it("uses the caller's idle floor when one is given", () => {
        expect(livenessPollInterval([], {idle: 60_000})).toBe(60_000)
        expect(livenessPollInterval(rows({}), {idle: 60_000})).toBe(60_000)
    })
})
