/** Height of the top-edge fade, in px. Shared by the CSS mask and the SC-1 pin so a pinned turn
 * lands BELOW the fade (otherwise the freshly-asked question renders partially faded). */
export const TOP_FADE_PX = 28
/** Height of the bottom-edge fade, matching the top so content dissolves into the composer edge. */
export const BOTTOM_FADE_PX = 28
/** Top-edge fade for the message scroll area: transparent at the very top, fully opaque by
 * TOP_FADE_PX. Applied as a CSS mask so the content itself fades (correct in any theme).
 *
 * Top-only because a bottom mask would fade the hover toolbar of any message that scrolls into
 * the bottom band, and no z-index can escape an ancestor's mask. The bottom fade is a sibling
 * overlay instead — see BOTTOM_FADE_OVERLAY_STYLE for why that alone was NOT enough. */
export const EDGE_FADE_MASK = `linear-gradient(to bottom, transparent 0, #000 ${TOP_FADE_PX}px, #000 100%)`
/** Bottom-edge fade: an opaque copy of the canvas background faded down to transparent over
 * BOTTOM_FADE_PX, so content dissolves into the composer edge exactly as a mask would.
 *
 * Painting it as a SIBLING of the scroll container does not, on its own, keep a message's hover
 * toolbar crisp — the earlier comment here claimed it did, and that was wrong. `mask-image` makes
 * the scroll container a stacking context, so the toolbar's `z-10` is confined INSIDE it; the
 * container then participates in the parent at `z-index: auto`, and this overlay's `z-[5]` paints
 * over the whole container, toolbar included. Measured: light ink 36 → 113, dark 222 → 147.
 *
 * The fade is therefore suppressed while a turn is hovered or focused (the only time a toolbar is
 * visible) — see the `.ag-turn` hook in AgentTranscript. Nothing is washed because nothing is
 * revealed at rest, and the toolbar renders at full contrast wherever it sits. */
export const BOTTOM_FADE_OVERLAY_STYLE = {
    height: BOTTOM_FADE_PX,
    background: "linear-gradient(to top, var(--ag-surface-canvas), transparent)",
} as const
/** Drops the bottom fade while any turn is hovered/focused, so a revealed toolbar inside the fade
 * band renders crisp. Applied to the overlay, which is a descendant of the `.ag-canvas` wrapper;
 * the short transition keeps the change from reading as a flicker on pointer entry. */
export const BOTTOM_FADE_HOVER_HIDE =
    "transition-opacity duration-150 [.ag-canvas:has(.ag-turn:hover)_&]:opacity-0 [.ag-canvas:has(.ag-turn:focus-within)_&]:opacity-0"
/** Centered reading column for the chat body. Caps line length / bubble width so a wide (maximized)
 * panel doesn't sprawl into oversized bubbles and over-spaced turns; freed side space is whitespace. */
export const CHAT_COLUMN = "mx-auto w-full max-w-[880px]"

/** Single source of truth for the (currently DISABLED) content-visibility optimization. Disabled in
 * 5f0fa73d06 — it caused a scrollbar-shrink on first scroll-through — but the mechanism is kept so it
 * can be re-enabled with a fix. Gates BOTH the CSS class and the SC-3 intrinsic-size measurement, so
 * while off neither the styling nor the measurement runs. Typed `boolean` so the guards aren't
 * flagged as always-false. Under Virtuoso it must stay off regardless (it corrupts item measurement). */
export const CONTENT_VISIBILITY_ENABLED = false as boolean
