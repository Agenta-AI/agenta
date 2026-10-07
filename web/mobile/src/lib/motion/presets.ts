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

/** Ease-out for a step or panel settling into place: a quick start, a long soft landing. */
const settleEase = [0.2, 0.7, 0.2, 1] as const

/** Tween for a flow step or a swapped panel arriving. */
export const stepTransition: Transition = {duration: 0.38, ease: settleEase}

/** A step sliding in while it fades; `custom` is +1 forward, -1 back. */
export const stepSlide: Variants = {
    initial: (direction: number) => ({x: direction * 24, opacity: 0}),
    animate: {x: 0, opacity: 1, transition: stepTransition},
    exit: {opacity: 0, transition: {duration: 0.12, ease: "easeOut"}},
}

/** An item rising into place. `custom` is its delay in seconds, for a staggered list. */
export const fadeUp: Variants = {
    initial: {y: 8, opacity: 0},
    animate: (delay = 0) => ({
        y: 0,
        opacity: 1,
        transition: {duration: 0.35, ease: "easeOut", delay},
    }),
    exit: {opacity: 0, transition: {duration: 0.12, ease: "easeOut"}},
}

/** A mark popping in when its value changes (an icon swapped for another). */
export const pop: Variants = {
    initial: {scale: 0.6, opacity: 0},
    animate: {scale: [0.6, 1.06, 1], opacity: 1, transition: {duration: 0.3, ease: "easeOut"}},
}

/** A card following the pointer: near-instant, so the tilt tracks the hand. */
export const tiltFollow: Transition = {duration: 0.1, ease: "linear"}

/** A tilted card settling flat again, or arriving tilted and settling. */
export const tiltSettle: Transition = {duration: 0.9, ease: settleEase}

/** A light sweep crossing a card once, shortly after it lands. */
export const shineSweep: Transition = {duration: 1.4, ease: "easeInOut", delay: 0.6}

/** How long a number counts up to its value. */
export const countUpMs = 1400

/** How long a picked answer holds before a one-tap question moves on. */
export const answerHoldMs = 420

/** How long the sign-in screen's exit plays before the post-auth loader takes over. */
export const authLeaveMs = 420

/** A full-screen overlay fading in, and out over the screen beneath it. */
export const overlayFade: Variants = {
    initial: {opacity: 0},
    animate: {opacity: 1, transition: {duration: 0.5, ease: "easeOut"}},
    exit: {opacity: 0, transition: {duration: 0.3, ease: "easeOut"}},
}

/** A rotating line rising in and lifting out; pair with `AnimatePresence mode="wait"`. */
export const tipSwap: Variants = {
    initial: {opacity: 0, y: 6},
    animate: {opacity: 1, y: 0, transition: {duration: 0.43, ease: "easeOut"}},
    exit: {opacity: 0, y: -4, transition: {duration: 0.43, ease: "easeIn"}},
}

/** A mark breathing while something waits. Spread onto `animate`. */
export const breathe = {
    scale: [1, 1.06, 1],
    transition: {duration: 2.4, ease: "easeInOut", repeat: Infinity} satisfies Transition,
}

/** How long each rotating tip shows. */
export const tipRotateMs = 3600

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
    stepSlide: Variants
    fadeUp: Variants
    pop: Variants
    stepTransition: Transition
    tiltFollow: Transition
    tiltSettle: Transition
    shineSweep: Transition
    /** 0 when reduced: a number shows its value at once. */
    countUpMs: number
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
    /** 0 when reduced: a picked answer moves on at once. */
    answerHoldMs: number
    /** 0 when reduced: the sign-in screen leaves at once. */
    authLeaveMs: number
    overlayFade: Variants
    tipSwap: Variants
    /** Undefined when reduced: the mark holds still. */
    breathe: typeof breathe | undefined
    /** 0 when reduced: the first tip stays. */
    tipRotateMs: number
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
                      stepSlide: instant,
                      fadeUp: instant,
                      pop: instant,
                      stepTransition: instantTransition,
                      tiltFollow: instantTransition,
                      tiltSettle: instantTransition,
                      shineSweep: instantTransition,
                      countUpMs: 0,
                      sheetSlideUp: instant,
                      crossfade: instant,
                      pushTransition: instantTransition,
                      sheetTransition: instantTransition,
                      crossfadeTransition: instantTransition,
                      fanTransition: instantTransition,
                      stepRevealMs: 0,
                      runHoldMs: 0,
                      featuredDwellMs: 0,
                      answerHoldMs: 0,
                      authLeaveMs: 0,
                      overlayFade: instant,
                      tipSwap: instant,
                      breathe: undefined,
                      tipRotateMs: 0,
                  }
                : {
                      reduced,
                      sharedAxisPush,
                      stepSlide,
                      fadeUp,
                      pop,
                      stepTransition,
                      tiltFollow,
                      tiltSettle,
                      shineSweep,
                      countUpMs,
                      sheetSlideUp,
                      crossfade,
                      pushTransition,
                      sheetTransition,
                      crossfadeTransition,
                      fanTransition,
                      stepRevealMs,
                      runHoldMs,
                      featuredDwellMs,
                      answerHoldMs,
                      authLeaveMs,
                      overlayFade,
                      tipSwap,
                      breathe,
                      tipRotateMs,
                  },
        [reduced],
    )
}
