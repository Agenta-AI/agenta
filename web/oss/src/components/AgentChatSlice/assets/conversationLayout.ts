/** Height of the top-edge fade, in px. Shared by the CSS mask and the SC-1 pin so a pinned turn
 * lands BELOW the fade (otherwise the freshly-asked question renders partially faded). */
export const TOP_FADE_PX = 28
/** Height of the bottom-edge fade, matching the top so content dissolves into the composer edge. */
export const BOTTOM_FADE_PX = 28
/** Top-edge fade for the message scroll area: transparent at the very top, fully opaque by
 * TOP_FADE_PX. Applied as a CSS mask so the content itself fades (correct in any theme).
 *
 * Deliberately top-only: a `mask-image` establishes a stacking context, which traps any
 * z-indexed descendant (e.g. a message's hover-revealed stats chip near the bottom edge)
 * BELOW the mask — no z-index can escape an ancestor's mask. The bottom fade is instead
 * painted by `BOTTOM_FADE_OVERLAY_STYLE` below, as a sibling overlay outside the masked
 * subtree, so a chip can legitimately out-z-index it. */
export const EDGE_FADE_MASK = `linear-gradient(to bottom, transparent 0, #000 ${TOP_FADE_PX}px, #000 100%)`
/** Bottom-edge fade, visually equivalent to fading content to transparent (the old mask
 * behaviour) since it fades an opaque copy of the canvas background down to transparent over
 * the same BOTTOM_FADE_PX run — content under it dissolves into the canvas either way. Render
 * as an `aria-hidden`, `pointer-events-none`, absolutely-positioned sibling of the scroll
 * container (not a descendant), so it never traps a hovering message's stats chip beneath it. */
export const BOTTOM_FADE_OVERLAY_STYLE = {
    height: BOTTOM_FADE_PX,
    background: "linear-gradient(to top, var(--ag-surface-canvas), transparent)",
} as const
/** Centered reading column for the chat body. Caps line length / bubble width so a wide (maximized)
 * panel doesn't sprawl into oversized bubbles and over-spaced turns; freed side space is whitespace. */
export const CHAT_COLUMN = "mx-auto w-full max-w-[880px]"

/** Single source of truth for the (currently DISABLED) content-visibility optimization. Disabled in
 * 5f0fa73d06 — it caused a scrollbar-shrink on first scroll-through — but the mechanism is kept so it
 * can be re-enabled with a fix. Gates BOTH the CSS class and the SC-3 intrinsic-size measurement, so
 * while off neither the styling nor the measurement runs. Typed `boolean` so the guards aren't
 * flagged as always-false. Under Virtuoso it must stay off regardless (it corrupts item measurement). */
export const CONTENT_VISIBILITY_ENABLED = false as boolean
