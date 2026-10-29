import type {Transition, Variants} from "motion/react"

/** The panel's view change: a short ease-out, so the next view settles without a bounce. */
export const PANEL_VIEW_TRANSITION: Transition = {duration: 0.25, ease: [0.22, 1, 0.36, 1]}

/**
 * Side-by-side view change. `custom` is the direction: +1 forward (the new view comes from the
 * right), -1 back. Use inside <AnimatePresence custom={direction}>.
 */
export const panelViewSlide: Variants = {
    initial: (direction: number) => ({x: direction * 8, opacity: 0, filter: "blur(3px)"}),
    animate: {x: 0, opacity: 1, filter: "blur(0px)", transition: PANEL_VIEW_TRANSITION},
    exit: (direction: number) => ({
        x: direction * -8,
        opacity: 0,
        filter: "blur(3px)",
        transition: PANEL_VIEW_TRANSITION,
    }),
}

/** The same change with reduced motion: no movement or blur, only a quick fade. */
export const panelViewFade: Variants = {
    initial: {opacity: 0},
    animate: {opacity: 1, transition: {duration: 0.15}},
    exit: {opacity: 0, transition: {duration: 0.15}},
}
