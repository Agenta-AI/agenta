import type {Transition, Variants} from "motion/react"

/** The panel's view change: the theme's `duration-base` (200ms) on its `ease-out` curve. */
export const PANEL_VIEW_TRANSITION: Transition = {duration: 0.2, ease: [0.2, 0.8, 0.2, 1]}

/**
 * Side-by-side view change (MOTION-01: a fade and a 4px slide). `custom` is the direction: +1
 * forward (the new view comes from the right), -1 back. Use inside <AnimatePresence custom>.
 */
export const panelViewSlide: Variants = {
    initial: (direction: number) => ({x: direction * 4, opacity: 0}),
    animate: {x: 0, opacity: 1, transition: PANEL_VIEW_TRANSITION},
    exit: (direction: number) => ({
        x: direction * -4,
        opacity: 0,
        transition: PANEL_VIEW_TRANSITION,
    }),
}

/** The same change with reduced motion: no movement, a `duration-fast` (120ms) fade. */
export const panelViewFade: Variants = {
    initial: {opacity: 0},
    animate: {opacity: 1, transition: {duration: 0.12}},
    exit: {opacity: 0, transition: {duration: 0.12}},
}
