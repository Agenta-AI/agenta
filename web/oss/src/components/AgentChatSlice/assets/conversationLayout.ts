/** Single source of truth for the (currently DISABLED) content-visibility optimization. Disabled in
 * 5f0fa73d06 — it caused a scrollbar-shrink on first scroll-through — but the mechanism is kept so it
 * can be re-enabled with a fix. Gates BOTH the CSS class and the SC-3 intrinsic-size measurement, so
 * while off neither the styling nor the measurement runs. Typed `boolean` so the guards aren't
 * flagged as always-false. Under Virtuoso it must stay off regardless (it corrupts item measurement). */
export const CONTENT_VISIBILITY_ENABLED = false as boolean
