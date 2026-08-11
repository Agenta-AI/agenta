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

// One fade for every folder-pane state swap — crossfaded (absolute, overlapping) so nothing hard-cuts.
export const PANE_FADE = {
    initial: {opacity: 0},
    animate: {opacity: 1},
    exit: {opacity: 0},
    transition: {duration: 0.16, ease: [0.4, 0, 0.2, 1] as const},
}

// Row/tile ENTRANCE when a level first reveals: a quick UNIFORM opacity fade — no per-item stagger
// (reads as "too much" on a big folder) and no y-shift (which fought the block reshuffling). Because
// the placeholders reserved the space + match height, the real content just fades in over the same
// slots — a crossfade in feel, not a two-step "skeleton gone → items appear". `on=false` → no animation
// (mounts at rest), so scrolling a virtualized row into view never replays it.
export const revealFade = (on: boolean) => ({
    initial: on ? {opacity: 0} : false,
    animate: {opacity: 1},
    transition: {duration: 0.18, ease: [0.4, 0, 0.2, 1] as const},
})

// Height+fade reveal for the header's detail panels (file meta / repo meta) as the toggle mounts and
// unmounts them — the enclosing `AnimatePresence` defers the unmount so the collapse plays out.
export const META_REVEAL = {
    initial: {height: 0, opacity: 0},
    animate: {height: "auto", opacity: 1},
    exit: {height: 0, opacity: 0},
    transition: {duration: 0.2, ease: [0.4, 0, 0.2, 1] as const},
}
