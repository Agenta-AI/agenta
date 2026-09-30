/**
 * Shared motion presets — the ONLY place transition values live in this app.
 * Components consume presets via useMotionPresets() (reduced-motion aware);
 * they never define their own durations, easings, or springs.
 * See the mobile-motion-patterns skill for usage rules.
 */
import {useMemo} from "react"

import {useReducedMotion} from "motion/react"
import type {Transition, Variants} from "motion/react"

/** Spring for screen-level shared-axis pushes (list → chat). */
export const pushTransition: Transition = {
    type: "spring",
    stiffness: 380,
    damping: 38,
    mass: 1,
}

/** Spring for bottom/side sheets (project drawer). */
export const sheetTransition: Transition = {
    type: "spring",
    stiffness: 300,
    damping: 32,
    mass: 0.9,
}

/** Tween for skeleton → content crossfades (no layout jump). */
export const crossfadeTransition: Transition = {
    duration: 0.18,
    ease: "easeOut",
}

/**
 * Shared-axis horizontal push. `custom` is the direction: +1 forward
 * (list → chat), -1 back. Use inside <AnimatePresence custom={direction}>.
 */
export const sharedAxisPush: Variants = {
    initial: (direction: number) => ({x: `${direction * 30}%`, opacity: 0}),
    animate: {x: 0, opacity: 1, transition: pushTransition},
    exit: (direction: number) => ({
        x: `${direction * -30}%`,
        opacity: 0,
        transition: pushTransition,
    }),
}

/** Spring-based sheet slide-up (project drawer, bottom sheets). */
export const sheetSlideUp: Variants = {
    initial: {y: "100%"},
    animate: {y: 0, transition: sheetTransition},
    exit: {y: "100%", transition: sheetTransition},
}

/** Crossfade for skeleton → content swaps (geometry must match). */
export const crossfade: Variants = {
    initial: {opacity: 0},
    animate: {opacity: 1, transition: crossfadeTransition},
    exit: {opacity: 0, transition: crossfadeTransition},
}

/** Tween for a stack of tiles fanning out under the pointer. */
export const fanTransition: Transition = {
    duration: 0.3,
    ease: "easeOut",
}

/** Cadence, in ms, at which an example run reveals its steps one by one. */
export const stepRevealMs = 900

/** How long the featured carousel dwells on a slide before it moves on. */
export const featuredDwellMs = 5000

/** How long a finished example run holds before it fades and plays again. */
export const runHoldMs = 4000

/** Instant variants used when the user prefers reduced motion. */
const instant: Variants = {
    initial: {opacity: 0},
    animate: {opacity: 1, transition: {duration: 0}},
    exit: {opacity: 0, transition: {duration: 0}},
}

/** Zero-duration transition returned for every raw transition when reduced. */
const instantTransition: Transition = {duration: 0}

export interface MotionPresets {
    reduced: boolean
    sharedAxisPush: Variants
    sheetSlideUp: Variants
    crossfade: Variants
    /** Raw transitions for imperative use (e.g. drag-settle on sheets). */
    pushTransition: Transition
    sheetTransition: Transition
    crossfadeTransition: Transition
    fanTransition: Transition
    /** 0 when reduced: every step shows at once. */
    stepRevealMs: number
    /** 0 when reduced: a finished run stays still instead of looping. */
    runHoldMs: number
    /** 0 when reduced: the featured carousel does not advance by itself. */
    featuredDwellMs: number
}

/**
 * Reduced-motion-aware presets — the only sanctioned consumption path in
 * components (variants AND raw transitions; everything collapses to
 * zero-duration when the user prefers reduced motion). Import the raw exports
 * above only in tests.
 */
export function useMotionPresets(): MotionPresets {
    const reduced = useReducedMotion() ?? false
    return useMemo(
        () =>
            reduced
                ? {
                      reduced,
                      sharedAxisPush: instant,
                      sheetSlideUp: instant,
                      crossfade: instant,
                      pushTransition: instantTransition,
                      sheetTransition: instantTransition,
                      crossfadeTransition: instantTransition,
                      fanTransition: instantTransition,
                      stepRevealMs: 0,
                      runHoldMs: 0,
                      featuredDwellMs: 0,
                  }
                : {
                      reduced,
                      sharedAxisPush,
                      sheetSlideUp,
                      crossfade,
                      pushTransition,
                      sheetTransition,
                      crossfadeTransition,
                      fanTransition,
                      stepRevealMs,
                      runHoldMs,
                      featuredDwellMs,
                  },
        [reduced],
    )
}
