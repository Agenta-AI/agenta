/**
 * The startup ladder's timing rules (#6047).
 *
 * The five cases the issue asks for coverage of — cold start, warm start, failure, cancellation,
 * and the transition into streaming — all reduce to these two pure functions plus the turn clock:
 * the label is a function of elapsed time, showing it at all is a function of liveness, and every
 * terminal path (answer, error, stop) clears the clock, after which there is no elapsed time to
 * read. So they are asserted here rather than through a render loop.
 */
import {describe, expect, it} from "vitest"

import {
    STARTUP_PHASES,
    msUntilNextStartupPhase,
    shouldShowStartupLadder,
    startupPhaseAt,
} from "./startupPhases"

describe("startupPhaseAt", () => {
    it("speaks from the very first instant — there is no silent window", () => {
        expect(startupPhaseAt(0)).toBe("Working")
    })

    it("opens on a line that is true of any turn, so an early answer can't catch it lying", () => {
        // The ladder shows immediately, so its first line has to survive a turn misjudged as cold
        // that answers in 300ms. "Working" does; anything claiming a startup step would not.
        expect(STARTUP_PHASES[0].atMs).toBe(0)
        expect(STARTUP_PHASES[0].label).toBe("Working")
    })

    it("degrades to no label if the clock runs backwards", () => {
        expect(startupPhaseAt(-1)).toBeNull()
    })

    it("takes over exactly at each phase's mark", () => {
        for (const phase of STARTUP_PHASES) {
            expect(startupPhaseAt(phase.atMs)).toBe(phase.label)
            if (phase.atMs > 0) expect(startupPhaseAt(phase.atMs - 1)).not.toBe(phase.label)
        }
    })

    it("walks the startup story in order across a cold start", () => {
        expect(startupPhaseAt(500)).toBe("Working")
        expect(startupPhaseAt(3_000)).toBe("Starting the agent")
        expect(startupPhaseAt(9_000)).toBe("Preparing instructions and tools")
        expect(startupPhaseAt(15_000)).toBe("Almost ready")
    })

    it("keeps our infrastructure vocabulary out of the reader's way", () => {
        for (const {label} of STARTUP_PHASES) {
            expect(label).not.toMatch(/sandbox|harness|daytona|runner|provision/i)
        }
    })

    it("holds the last phase instead of blanking on a very slow start", () => {
        const last = STARTUP_PHASES[STARTUP_PHASES.length - 1]
        expect(startupPhaseAt(60_000)).toBe(last.label)
        expect(startupPhaseAt(600_000)).toBe(last.label)
    })

    it("is declared in ascending order — the scan depends on it", () => {
        const marks = STARTUP_PHASES.map((p) => p.atMs)
        expect(marks).toEqual([...marks].sort((a, b) => a - b))
    })
})

describe("msUntilNextStartupPhase", () => {
    it("sleeps exactly to the next boundary rather than polling toward it", () => {
        expect(msUntilNextStartupPhase(0)).toBe(2_000)
        expect(msUntilNextStartupPhase(500)).toBe(1_500)
        expect(msUntilNextStartupPhase(1_999)).toBe(1)
    })

    it("stops scheduling once the last phase has landed", () => {
        const last = STARTUP_PHASES[STARTUP_PHASES.length - 1]
        expect(msUntilNextStartupPhase(last.atMs)).toBeUndefined()
        expect(msUntilNextStartupPhase(600_000)).toBeUndefined()
    })

    it("skips boundaries a backgrounded tab slept through", () => {
        // Woken at 9s having missed 2s and 8s: the next hop is the 14s phase, not a replay.
        expect(msUntilNextStartupPhase(9_000)).toBe(5_000)
    })
})

describe("shouldShowStartupLadder", () => {
    it("narrates a cold start", () => {
        expect(shouldShowStartupLadder({isAlive: false})).toBe(true)
    })

    it("stays out of a warm turn's way — nothing is booting to narrate", () => {
        expect(shouldShowStartupLadder({isAlive: true})).toBe(false)
    })
})
