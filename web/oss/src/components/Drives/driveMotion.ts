import type {Transition, Variants} from "motion/react"

/**
 * Shared file-list motion. Wrap a list in `<AnimatePresence mode="popLayout" initial={false}>` and
 * each item in a `<motion.div layout variants={FILE_ITEM_VARIANTS} … transition={FILE_SPRING}>`:
 * `layout` animates recency reorders + the reflow when an item leaves, `popLayout` pops the exiting
 * item out of flow so siblings close the gap while it fades, and `initial={false}` skips the
 * animation for items already present on first paint (so the list doesn't flash in on load).
 *
 * Spring physics match the session bar/rail (see `AgentChatSlice/assets/sessionMotion`) so every
 * moving surface in the playground shares one feel.
 */
export const FILE_SPRING: Transition = {type: "spring", visualDuration: 0.28, bounce: 0}

export const FILE_ITEM_VARIANTS: Variants = {
    initial: {opacity: 0, scale: 0.97},
    animate: {opacity: 1, scale: 1},
    exit: {opacity: 0, scale: 0.97},
}
