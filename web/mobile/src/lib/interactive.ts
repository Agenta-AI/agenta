/**
 * Interaction states for the app's own links and rows — hover, active, and keyboard focus, in
 * ONE place so every list row and every "View all" reads the same. Colors come from the
 * semantic tokens, which already resolve per theme, so there is nothing to override in dark.
 *
 * (shadcn components in `components/ui/` carry their own states; these are for the plain
 * `<Link>`s and rows the features render directly.)
 */

/**
 * Drawn INSIDE the box: rows are full-bleed inside the scroller, so an outward ring is clipped
 * at the viewport edges.
 *
 * `outline-solid` is not redundant — Tailwind v4's `outline-none` sets `--tw-outline-style:
 * none`, which `outline-2` then reads back (`outline-style: var(--tw-outline-style)`), so the
 * pair alone renders NO ring at all. This restores the style at focus time.
 */
const FOCUS_RING =
    "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]"

/** A full-width tappable list row (agent roster, session list): the whole row tints. */
export const ROW_LINK = `transition-colors hover:bg-accent active:bg-accent ${FOCUS_RING}`

/** A quiet inline link in a heading or a header bar ("View all", "Back"): the text darkens. */
export const INLINE_LINK = `rounded-sm transition-colors hover:text-foreground active:text-foreground ${FOCUS_RING}`

/** An icon-only tap target in a header bar (the back chevron): the square tints. */
export const ICON_LINK = `rounded-md transition-colors hover:bg-accent active:bg-accent ${FOCUS_RING}`
