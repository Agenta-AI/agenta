/**
 * Page gutters: 56px top, 16px sides below `lg` / 64px from `lg` up, 32px bottom.
 *
 * The app layout used to give pages 24px side padding; it was dropped when pages moved onto
 * `PageLayout`, which only carried 16px, and every page has felt cramped since. `PageLayout`
 * applies this for the pages that use it; a page with its own shell applies it directly.
 *
 * Sides used to be a hard `px-16` (64px each). On a 390px phone that spent 128px on gutters
 * and left 262px for the page — Settings titles truncated ("AI provid…") and tables clipped.
 * `px-4 lg:px-16` is the same collapse the sessions screen already uses; desktop is unchanged.
 *
 * `box-border` is load-bearing, not decoration: Tailwind preflight is off app-wide, so a plain div
 * is content-box and `w-full` + `px-16` would size the box 128px wider than its parent.
 */
export const pageGutterClass = "box-border px-4 pb-8 pt-14 lg:px-16"

/**
 * The shared cap for a centered page column, applied to the box that carries
 * `pageGutterClass` — so 1248 = a 1120px content column plus its two 64px gutters.
 *
 * 1120 is the width Settings' tables were already designed at. The cap engages only above
 * ~1490px of viewport; below that a page just fills its gutters, so laptops keep the full
 * width and only larger screens turn the surplus into symmetric margins.
 *
 * Put it on the same element as the gutters — `PageLayout`'s `className`, or a custom shell's
 * outermost box — so title and content share one column:
 *
 * ```tsx
 * import {pageContentWidthClass} from "@agenta/ui/components/page-width"
 *
 * <PageLayout className={pageContentWidthClass}>…</PageLayout>
 * ```
 */
export const pageContentWidthClass = "box-border mx-auto w-full max-w-[1248px]"
