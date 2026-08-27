// @vitest-environment jsdom
import {act, renderHook} from "@testing-library/react"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {
    advanceByGraphemes,
    TYPEWRITER_HORIZON_MS,
    useTypewriter,
} from "../../../src/hooks/useTypewriter"

/**
 * The frame-paced reveal for streamed text.
 *
 * The regressions worth guarding are the ones that look like features: snapping to the full text
 * when the stream ends (pops the last horizon of every turn), retyping on remount (list windowing
 * unmounts off-screen rows), and typing across a rewind (types nonsense).
 */

const FRAME_MS = 1000 / 60

let now = 0
let nextFrameId = 1
let frames: Map<number, FrameRequestCallback>

/** Run every frame currently queued, then advance the clock. Callbacks may queue the next one. */
const runFrames = (count = 1) => {
    for (let i = 0; i < count; i++) {
        const due = [...frames.values()]
        frames.clear()
        now += FRAME_MS
        act(() => {
            for (const cb of due) cb(now)
        })
    }
}

const stubMatchMedia = (reduce: boolean) => {
    vi.stubGlobal("matchMedia", (query: string) => ({
        matches: reduce,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
    }))
}

beforeEach(() => {
    now = 0
    nextFrameId = 1
    frames = new Map()
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
        const id = nextFrameId++
        frames.set(id, cb)
        return id
    })
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
        frames.delete(id)
    })
    vi.spyOn(performance, "now").mockImplementation(() => now)
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe("useTypewriter", () => {
    it("mounts fully revealed so hydrated history and re-mounted rows never retype", () => {
        const {result} = renderHook(() => useTypewriter("already here"))
        expect(result.current.text).toBe("already here")
        expect(result.current.settled).toBe(true)
        expect(frames.size).toBe(0)
    })

    it("reveals growth across frames instead of in one commit", () => {
        const target = "x".repeat(60)
        const {result, rerender} = renderHook(({t}) => useTypewriter(t), {
            initialProps: {t: ""},
        })

        rerender({t: target})
        runFrames(1)

        // One horizon is 18 frames, so a 60-char backlog moves ~4 chars on the first frame.
        expect(result.current.text.length).toBeGreaterThan(0)
        expect(result.current.text.length).toBeLessThan(target.length)
        expect(result.current.settled).toBe(false)
    })

    it("keeps draining to the end after the target stops growing", () => {
        const target = "y".repeat(60)
        const {result, rerender} = renderHook(({t}) => useTypewriter(t), {
            initialProps: {t: ""},
        })

        rerender({t: target})
        runFrames(Math.ceil(TYPEWRITER_HORIZON_MS / FRAME_MS) + 1)

        expect(result.current.text).toBe(target)
        expect(result.current.settled).toBe(true)
    })

    it("never stalls: every reveal moves at least one grapheme", () => {
        const {result, rerender} = renderHook(({t}) => useTypewriter(t), {
            initialProps: {t: ""},
        })

        rerender({t: "ab"})
        runFrames(1)
        // Reveals are capped at REVEAL_INTERVAL_MS, so a 60fps clock reveals every other frame.
        expect(result.current.text.length).toBeGreaterThanOrEqual(1)

        runFrames(4)
        expect(result.current.text).toBe("ab")
    })

    it("snaps when the target is not a continuation (rewind / regenerate)", () => {
        const {result, rerender} = renderHook(({t}) => useTypewriter(t), {
            initialProps: {t: ""},
        })

        rerender({t: "the first answer, at length"})
        runFrames(1)
        expect(result.current.settled).toBe(false)

        rerender({t: "a different answer"})
        expect(result.current.text).toBe("a different answer")
        expect(result.current.settled).toBe(true)
    })

    it("finishes sooner when urgent, so a card below never outruns its prose", () => {
        const target = "z".repeat(60)
        const calm = renderHook(({t}) => useTypewriter(t), {initialProps: {t: ""}})
        calm.rerender({t: target})
        runFrames(1)
        const calmLength = calm.result.current.text.length

        now = 0
        frames.clear()
        const rushed = renderHook(({t}) => useTypewriter(t, {urgent: true}), {
            initialProps: {t: ""},
        })
        rushed.rerender({t: target})
        runFrames(1)

        expect(rushed.result.current.text.length).toBeGreaterThan(calmLength)
    })

    /**
     * The acceptance case, replayed from the frame capture that motivated this: a reasoning
     * block gained "Research" at ~1.85s and "Ledger:" at ~2.25s — two paints 400ms apart. The
     * point of the hook is that the same arrivals become continuous motion.
     */
    it("turns two arrivals 400ms apart into continuous motion", () => {
        const {result, rerender} = renderHook(({t}) => useTypewriter(t), {
            initialProps: {t: "I have enough information now."},
        })

        const painted = new Set<string>()
        const framesPerGap = Math.round(400 / FRAME_MS)

        for (const word of [" Research", " Ledger:"]) {
            rerender({t: result.current.text + word})
            for (let i = 0; i < framesPerGap; i++) {
                runFrames(1)
                painted.add(result.current.text)
            }
        }

        // Before this hook both arrivals were a single commit each: two distinct paints total.
        // Reveals are capped at REVEAL_INTERVAL_MS, so ~12 is the guarantee, not the ceiling.
        expect(painted.size).toBeGreaterThanOrEqual(12)
        expect(result.current.text).toBe("I have enough information now. Research Ledger:")
    })

    it("reveals everything at once under prefers-reduced-motion", () => {
        stubMatchMedia(true)
        const {result, rerender} = renderHook(({t}) => useTypewriter(t), {
            initialProps: {t: ""},
        })

        rerender({t: "the whole thing, immediately"})

        expect(result.current.text).toBe("the whole thing, immediately")
        expect(result.current.settled).toBe(true)
    })
})

describe("advanceByGraphemes", () => {
    it("never splits a multi-code-unit cluster", () => {
        // Family emoji: one grapheme, eleven UTF-16 code units.
        const family = "👨‍👩‍👧‍👦"
        const text = `hi ${family} there`
        let cursor = 0
        const seen: string[] = []
        while (cursor < text.length) {
            const next = advanceByGraphemes(text, cursor, 1)
            expect(next).toBeGreaterThan(cursor)
            seen.push(text.slice(cursor, next))
            cursor = next
        }
        expect(seen.join("")).toBe(text)
        expect(seen).toContain(family)
    })

    /**
     * A cluster can be longer than the segmentation window. Settling for the window's partial
     * view there used to return `from + 1`, which cut the surrogate pair and painted U+FFFD.
     */
    it("never splits a cluster longer than the segmentation window", () => {
        const cluster = "\u{1F600}" + "́".repeat(45) // one grapheme, 47 code units
        const text = `${cluster} and then some ordinary trailing prose`
        const next = advanceByGraphemes(text, 0, 1)

        expect(text.slice(0, next)).toBe(cluster)
        const lastCode = text.charCodeAt(next - 1)
        expect(lastCode >= 0xd800 && lastCode <= 0xdbff).toBe(false)
    })

    it("consumes the remainder when the step count covers it", () => {
        expect(advanceByGraphemes("abc", 0, 99)).toBe(3)
        expect(advanceByGraphemes("abc", 3, 5)).toBe(3)
        expect(advanceByGraphemes("abc", 0, 0)).toBe(0)
    })
})
