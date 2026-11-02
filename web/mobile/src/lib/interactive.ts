/**
 * The keyboard focus ring for the app's own plain controls (tabs, inline edit buttons), in ONE
 * place so they all read the same. The color comes from the semantic `ring` token, which already
 * resolves per theme, so there is nothing to override in dark.
 *
 * (shadcn components in `components/ui/` carry their own focus states; this is for the plain
 * elements the features render directly.)
 */

/**
 * Drawn INSIDE the box: rows are full-bleed inside the scroller, so an outward ring is clipped
 * at the viewport edges.
 *
 * `outline-solid` is not redundant — Tailwind v4's `outline-none` sets `--tw-outline-style:
 * none`, which `outline-2` then reads back (`outline-style: var(--tw-outline-style)`), so the
 * pair alone renders NO ring at all. This restores the style at focus time.
 */
export const FOCUS_RING =
    "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]"
