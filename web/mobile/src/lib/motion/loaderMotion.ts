/**
 * Motion for the sign-in hand-off and the post-auth loader, from the sign-in design (agOut,
 * agFadeIn, agFadeUp, agTip, agBreathe). Kept beside `presets.ts` with the same rule: components
 * take these through `useLoaderMotion()`, which collapses everything under reduced motion.
 */
import {useMemo} from "react"

import {useReducedMotion} from "motion/react"
import type {Transition, Variants} from "motion/react"

/** How long the sign-in screen's exit plays before the loader takes over (the CSS `auth-out`). */
export const authLeaveMs = 420

/** The loader arriving over the faded sign-in screen, and leaving over the first real screen. */
export const loaderOverlay: Variants = {
    initial: {opacity: 0},
    animate: {opacity: 1, transition: {duration: 0.5, ease: "easeOut"}},
    exit: {opacity: 0, transition: {duration: 0.3, ease: "easeOut"}},
}

/** A status line replacing the last one: it rises into place. */
export const statusSwap: Variants = {
    initial: {opacity: 0, y: 8},
    animate: {opacity: 1, y: 0, transition: {duration: 0.3, ease: "easeOut"}},
    exit: {opacity: 0, transition: {duration: 0.12, ease: "easeOut"}},
}

/** A tip rising in and lifting out; with `mode="wait"` the pair fills the 3.6s rotation's edges. */
export const tipSwap: Variants = {
    initial: {opacity: 0, y: 6},
    animate: {opacity: 1, y: 0, transition: {duration: 0.43, ease: "easeOut"}},
    exit: {opacity: 0, y: -4, transition: {duration: 0.43, ease: "easeIn"}},
}

/** The mark breathing while the loader waits. Spread onto `animate`. */
export const breathe = {
    scale: [1, 1.06, 1],
    transition: {duration: 2.4, ease: "easeInOut", repeat: Infinity} satisfies Transition,
}

const still: Variants = {
    initial: {opacity: 0},
    animate: {opacity: 1, transition: {duration: 0}},
    exit: {opacity: 0, transition: {duration: 0}},
}

export interface LoaderMotion {
    reduced: boolean
    leaveMs: number
    loaderOverlay: Variants
    statusSwap: Variants
    tipSwap: Variants
    /** Undefined when reduced: the mark holds still. */
    breathe: typeof breathe | undefined
}

/** Reduced-motion-aware loader motion: no exit wait, instant swaps, a still mark. */
export function useLoaderMotion(): LoaderMotion {
    const reduced = useReducedMotion() ?? false
    return useMemo(
        () =>
            reduced
                ? {
                      reduced,
                      leaveMs: 0,
                      loaderOverlay: still,
                      statusSwap: still,
                      tipSwap: still,
                      breathe: undefined,
                  }
                : {reduced, leaveMs: authLeaveMs, loaderOverlay, statusSwap, tipSwap, breathe},
        [reduced],
    )
}
