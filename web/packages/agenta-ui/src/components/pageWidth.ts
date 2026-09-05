/**
 * Page gutters: 56px top, 64px sides, 32px bottom from `lg`; 24/16/24 below it.
 *
 * The app layout used to give pages 24px side padding; it was dropped when pages moved onto
 * `PageLayout`, which only carried 16px, and every page has felt cramped since. `PageLayout`
 * applies this for the pages that use it; a page with its own shell applies it directly.
 *
 * `box-border` is load-bearing, not decoration: Tailwind preflight is off app-wide, so a plain div
 * is content-box and `w-full` + `px-16` would size the box 128px wider than its parent.
 */
// A phone has no 64px to spare: 128px of gutter left a 320px screen a 192px column.
export const pageGutterClass = "box-border px-4 pb-6 pt-6 lg:px-16 lg:pb-8 lg:pt-14"

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
