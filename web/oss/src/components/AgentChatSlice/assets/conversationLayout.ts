/** Height of the top-edge fade, in px. Shared by the CSS mask and the SC-1 pin so a pinned turn
 * lands BELOW the fade (otherwise the freshly-asked question renders partially faded). */
export const TOP_FADE_PX = 28
/** Height of the bottom-edge fade, matching the top so content dissolves into the composer edge. */
export const BOTTOM_FADE_PX = 28
/** Edge fades for the message scroll area: transparent at the very top, fully opaque by TOP_FADE_PX,
 * then fading back to transparent over the last BOTTOM_FADE_PX. Applied as a CSS mask so the content
 * itself fades (correct in any theme). */
export const EDGE_FADE_MASK = `linear-gradient(to bottom, transparent 0, #000 ${TOP_FADE_PX}px, #000 calc(100% - ${BOTTOM_FADE_PX}px), transparent 100%)`
/** Centered reading column for the chat body. Caps line length / bubble width so a wide (maximized)
 * panel doesn't sprawl into oversized bubbles and over-spaced turns; freed side space is whitespace. */
export const CHAT_COLUMN = "mx-auto w-full max-w-[880px]"

/** Single source of truth for the (currently DISABLED) content-visibility optimization. Disabled in
 * 5f0fa73d06 — it caused a scrollbar-shrink on first scroll-through — but the mechanism is kept so it
 * can be re-enabled with a fix. Gates BOTH the CSS class and the SC-3 intrinsic-size measurement, so
 * while off neither the styling nor the measurement runs. Typed `boolean` so the guards aren't
 * flagged as always-false. Under Virtuoso it must stay off regardless (it corrupts item measurement). */
export const CONTENT_VISIBILITY_ENABLED = false as boolean
