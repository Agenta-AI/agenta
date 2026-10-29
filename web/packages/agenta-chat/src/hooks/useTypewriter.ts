import {useCallback, useEffect, useRef, useState, useSyncExternalStore} from "react"

/**
 * Reveal streamed text on the frame clock instead of the commit clock.
 *
 * Frame-by-frame capture of a cloud session measured a reasoning block gaining ONE word every
 * ~400ms; `useChat` commits at 50ms and repaints each lump whole, so the gap reads as a freeze
 * then a pop. Pacing cannot live upstream of React — the transport used to word-split deltas on
 * an 18ms timer, but a 50ms commit cannot show more than 20 steps a second however finely the
 * bytes are chopped, and a one-word delta had nothing to split. So it lives here, between "text
 * arrived" and "text painted", on `requestAnimationFrame`.
 *
 * The rate is a deadline, not a constant: new text gives the whole backlog {@link
 * TYPEWRITER_HORIZON_MS} to drain and each frame reveals `remaining / framesLeft`, so a paragraph
 * types fast, a lone word types character by character, and the lag stays bounded at one horizon.
 */

/** A backlog of any size is fully revealed within this long. Also the maximum display lag. */
export const TYPEWRITER_HORIZON_MS = 300

/** Horizon for a part that is no longer last — see `urgent`. */
export const TYPEWRITER_URGENT_HORIZON_MS = 120

/**
 * Minimum gap between reveals. Each reveal costs a markdown re-parse (and a Shiki re-highlight
 * inside a fence), so revealing on every vsync would triple that work against the old 50ms
 * commit for no perceptual gain — 30 steps a second is the cadence Claude Code's transcript
 * measured at, and it reads as continuous.
 */
const REVEAL_INTERVAL_MS = 1000 / 30

/** Segmenting lookahead per grapheme; wide enough for ZWJ emoji sequences. */
const SEGMENT_WINDOW_PER_STEP = 8
const SEGMENT_WINDOW_PADDING = 32

export interface TypewriterOptions {
    /** Finish fast: the part is no longer last, so a card below it must not outrun its prose. */
    urgent?: boolean
}

export interface TypewriterState {
    /** The prefix of `target` revealed so far. */
    text: string
    /** Nothing left to reveal. Keep incomplete-markdown healing on until this is true. */
    settled: boolean
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)"

const reducedMotionQuery = (): MediaQueryList | null => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null
    try {
        return window.matchMedia(REDUCED_MOTION_QUERY)
    } catch {
        return null
    }
}

// One shared subscription: a long transcript renders this hook once per text part.
const subscribeReducedMotion = (onChange: () => void) => {
    const query = reducedMotionQuery()
    query?.addEventListener("change", onChange)
    return () => query?.removeEventListener("change", onChange)
}

const getReducedMotion = () => reducedMotionQuery()?.matches ?? false

const useReducedMotion = () =>
    useSyncExternalStore(subscribeReducedMotion, getReducedMotion, () => false)

interface Segmenter {
    segment: (input: string) => Iterable<{segment: string}>
}

let graphemeSegmenter: Segmenter | null | undefined

/** Cached: constructing an `Intl.Segmenter` per frame is not free. */
const getGraphemeSegmenter = (): Segmenter | null => {
    if (graphemeSegmenter !== undefined) return graphemeSegmenter
    const ctor = (Intl as {Segmenter?: new (l?: string, o?: object) => Segmenter}).Segmenter
    graphemeSegmenter = ctor ? new ctor(undefined, {granularity: "grapheme"}) : null
    return graphemeSegmenter
}

/**
 * Offset reached by advancing `steps` grapheme clusters from `from`, so a frame boundary never
 * splits an emoji, flag, or combining sequence. Only a window ahead of the cursor is segmented —
 * segmenting the whole string would be O(n) every frame.
 */
export const advanceByGraphemes = (text: string, from: number, steps: number): number => {
    if (steps <= 0 || from >= text.length) return from
    let windowEnd = Math.min(
        text.length,
        from + steps * SEGMENT_WINDOW_PER_STEP + SEGMENT_WINDOW_PADDING,
    )
    // A cluster is never shorter than a code unit, so this many steps consumes the rest.
    if (windowEnd >= text.length && steps >= text.length - from) return text.length
    const segmenter = getGraphemeSegmenter()
    if (!segmenter) {
        let next = Math.min(text.length, from + steps)
        // No segmenter: advance by code unit, but never between a surrogate pair.
        const code = text.charCodeAt(next - 1)
        if (code >= 0xd800 && code <= 0xdbff && next < text.length) next += 1
        return next
    }
    let clusters: string[] = []
    // Grow until at least one COMPLETE cluster is in view. A single cluster can be longer than
    // the window (an emoji carrying many combining marks), and settling for a partial one there
    // splits a surrogate pair and paints U+FFFD.
    for (;;) {
        clusters = []
        for (const {segment} of segmenter.segment(text.slice(from, windowEnd)))
            clusters.push(segment)
        if (windowEnd >= text.length) break
        clusters.pop() // the window may have cut its final cluster in half
        if (clusters.length > 0) break
        windowEnd = Math.min(text.length, from + (windowEnd - from) * 2)
    }
    let advanced = 0
    for (let i = 0; i < steps && i < clusters.length; i++) advanced += clusters[i].length
    // A frame that reveals nothing is the stall this hook exists to remove; the loop above makes
    // that unreachable, and revealing the remainder is the one fallback that cannot split.
    return advanced > 0 ? from + advanced : text.length
}

export function useTypewriter(target: string, {urgent = false}: TypewriterOptions = {}) {
    const reduced = useReducedMotion()
    // Mount fully revealed: text present at mount was hydrated or re-mounted by list windowing,
    // and retyping it every time a row scrolls back in would be a bug, not an animation.
    const [text, setText] = useState(target)

    const targetRef = useRef(target)
    const shownRef = useRef(target.length)
    const deadlineRef = useRef(0)
    // -Infinity so the first frame after new text reveals at once instead of waiting an interval.
    const lastRevealRef = useRef(-Infinity)
    const rafRef = useRef(0)
    const horizon = urgent ? TYPEWRITER_URGENT_HORIZON_MS : TYPEWRITER_HORIZON_MS

    const stop = useCallback(() => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
    }, [])

    const settle = useCallback(() => {
        stop()
        shownRef.current = targetRef.current.length
        setText(targetRef.current)
    }, [stop])

    const tick = useCallback(() => {
        rafRef.current = 0
        const full = targetRef.current
        const remaining = full.length - shownRef.current
        if (remaining <= 0) return
        const now = performance.now()
        if (now - lastRevealRef.current >= REVEAL_INTERVAL_MS) {
            // Clamped to 1 so an overdue backlog lands on this reveal rather than never finishing.
            const revealsLeft = Math.max(1, (deadlineRef.current - now) / REVEAL_INTERVAL_MS)
            shownRef.current = advanceByGraphemes(
                full,
                shownRef.current,
                Math.max(1, Math.ceil(remaining / revealsLeft)),
            )
            lastRevealRef.current = now
            setText(full.slice(0, shownRef.current))
        }
        if (shownRef.current < full.length) rafRef.current = requestAnimationFrame(tick)
    }, [])

    useEffect(() => {
        targetRef.current = target
        if (reduced) {
            settle()
            return
        }
        // Not a continuation of what is on screen: a rewind, regenerate, or hydrated replacement.
        if (!target.startsWith(text)) {
            settle()
            return
        }
        if (shownRef.current >= target.length) return
        // `horizon` is a dependency, not a ref read: a part goes urgent the moment a later part
        // renders below it, which is usually AFTER its last delta. Recomputing the deadline only
        // on new text would leave that drain finishing on the calm horizon, so the guarantee
        // `urgent` exists for would not hold in the one case it was written for.
        deadlineRef.current = performance.now() + horizon
        if (!rafRef.current) rafRef.current = requestAnimationFrame(tick)
        // `text` is out of the deps on purpose: it changes every frame from `tick`, and this
        // effect reacts only to a new target. The check above reads the prefix `tick` last painted.
    }, [target, horizon, reduced, settle, tick])

    // No "stream ended, show everything" path: snapping there would pop the last horizon of
    // every turn, the exact defect this removes. The loop drains itself; this frees it on unmount.
    useEffect(() => stop, [stop])

    const state: TypewriterState = {text, settled: text === target}
    return state
}
