/**
 * Shared motion presets — the ONLY place transition values live in this app.
 * Components consume presets via useMotionPresets() (reduced-motion aware);
 * they never define their own durations, easings, or springs.
 * See the mobile-motion-patterns skill for usage rules.
 */
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

/** Instant variants used when the user prefers reduced motion. */
const instant: Variants = {
    initial: {opacity: 0},
    animate: {opacity: 1, transition: {duration: 0}},
    exit: {opacity: 0, transition: {duration: 0}},
}

export interface MotionPresets {
    reduced: boolean
    sharedAxisPush: Variants
    sheetSlideUp: Variants
    crossfade: Variants
}

/**
 * Reduced-motion-aware presets. ALWAYS consume presets through this hook in
 * components; import the raw variants above only in tests.
 */
export function useMotionPresets(): MotionPresets {
    const reduced = useReducedMotion() ?? false
    return reduced
        ? {reduced, sharedAxisPush: instant, sheetSlideUp: instant, crossfade: instant}
        : {reduced, sharedAxisPush, sheetSlideUp, crossfade}
}
