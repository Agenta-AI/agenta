import type {Transition} from "motion/react"

/** The slice-wide spring for chrome enter/leave — one physical feel across every surface. */
export const SESSION_SPRING: Transition = {type: "spring", visualDuration: 0.28, bounce: 0}
