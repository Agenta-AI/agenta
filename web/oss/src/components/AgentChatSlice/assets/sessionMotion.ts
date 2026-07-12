import type {Transition, Variants} from "motion/react"

/**
 * Shared session-item motion. The bar (SessionTagBar) and the rail (SessionRail) render the same
 * sessions two ways — compact tags vs list rows — and both import these so a session's two
 * representations enter and leave with IDENTICAL physics: the "connected" feel across the views.
 *
 * Each item collapses its OWN size (tags their width, rows their height) in step with its fade, so
 * neighbours close the gap as one continuous motion rather than a pop-then-reflow two-step. No
 * overshoot (bounce 0) so the size settles cleanly into — and out of — the flow.
 */
export const SESSION_SPRING: Transition = {type: "spring", visualDuration: 0.28, bounce: 0}

/** Vertical row (rail): grows/collapses its height AND its bottom gap (2px = gap-0.5) together, so
 * the spacing shrinks to nothing with the row — no leftover margin to snap when it unmounts. */
export const ROW_VARIANTS: Variants = {
    initial: {height: 0, opacity: 0, marginBottom: 0},
    animate: {height: "auto", opacity: 1, marginBottom: 2},
    exit: {height: 0, opacity: 0, marginBottom: 0},
}

/** Horizontal tag (bar): grows/collapses its width AND its right gap (6px = gap-1.5) together, so
 * the spacing shrinks to nothing with the tag — no leftover margin to snap when it unmounts. */
export const TAG_VARIANTS: Variants = {
    initial: {width: 0, opacity: 0, marginRight: 0},
    animate: {width: "auto", opacity: 1, marginRight: 6},
    exit: {width: 0, opacity: 0, marginRight: 0},
}
