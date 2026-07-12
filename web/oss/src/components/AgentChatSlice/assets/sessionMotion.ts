import type {Transition, Variants} from "motion/react"

/** Shared session-item motion so the bar (tags) and rail (rows) move with identical physics. */
export const SESSION_SPRING: Transition = {type: "spring", visualDuration: 0.28, bounce: 0}

/** Rail row: collapses height + its bottom-gap margin (2px = gap-0.5) together so nothing snaps on unmount. */
export const ROW_VARIANTS: Variants = {
    initial: {height: 0, opacity: 0, marginBottom: 0},
    animate: {height: "auto", opacity: 1, marginBottom: 2},
    exit: {height: 0, opacity: 0, marginBottom: 0},
}

/** Bar tag: collapses width + its right-gap margin (6px = gap-1.5) together so nothing snaps on unmount. */
export const TAG_VARIANTS: Variants = {
    initial: {width: 0, opacity: 0, marginRight: 0},
    animate: {width: "auto", opacity: 1, marginRight: 6},
    exit: {width: 0, opacity: 0, marginRight: 0},
}
