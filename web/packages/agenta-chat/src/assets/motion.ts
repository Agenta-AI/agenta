import type {Transition} from "motion/react"

/** The slice-wide spring for chrome enter/leave — one physical feel across every surface. */
export const SESSION_SPRING: Transition = {type: "spring", visualDuration: 0.28, bounce: 0}

/**
 * The connect dock's progress pill. A touch of bounce so it SETTLES onto a dot rather than stopping
 * dead, and — being a spring — it carries velocity through an interruption, so clicking dots in
 * quick succession retargets mid-flight instead of restarting.
 */
export const CONNECT_PILL_SPRING: Transition = {type: "spring", duration: 0.5, bounce: 0.2}
