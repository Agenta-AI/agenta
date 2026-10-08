/**
 * JS mirror of the motion tokens in `motion.css`, for `motion` presets. No React, safe to import
 * anywhere. `tests/unit/motionTokens.test.ts` fails if the two drift apart.
 */

/** `--ease-out`: fast start, long soft landing. Enters and moves. */
export const EASE_OUT = [0.32, 0.72, 0, 1] as const

/** `--ease-in`: gentle acceleration away. Exits only. */
export const EASE_IN = [0.32, 0, 0.67, 0] as const

/** `--ease-in-out`: symmetric, for things that slide or resize in place. */
export const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const

/** `--transition-duration-*`, in seconds (the unit `motion` takes). */
export const DURATION = {
    instant: 0.1,
    fast: 0.16,
    base: 0.24,
    slow: 0.38,
} as const
