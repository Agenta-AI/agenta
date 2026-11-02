import type {Transition, Variants} from "motion/react"

/** The session surfaces' spring — one physical feel across desktop and mobile lists. */
export const SESSION_SPRING: Transition = {type: "spring", visualDuration: 0.28, bounce: 0}

/** List row: collapses height + its bottom gap together so nothing snaps on unmount. */
export const ROW_VARIANTS: Variants = {
    initial: {height: 0, opacity: 0, marginBottom: 0},
    animate: {height: "auto", opacity: 1, marginBottom: 2},
    exit: {height: 0, opacity: 0, marginBottom: 0},
}
