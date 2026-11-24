/**
 * The general page frame (LAYOUT-02, LAYOUT-03): one set of gutters, caps and top padding for
 * every page that uses `PageLayout`, and for the loading skeletons that stand in for it.
 *
 * The gutters follow the page area's width (the `page` container on `ScreenScaffold`), so a
 * docked right pane or sidebar shrinks them: 16px under 640px, 32px under 960px, then 80px.
 */
export const PAGE_GUTTERS =
    "box-border w-full px-4 @min-[640px]/page:px-8 @min-[960px]/page:px-page-margin"

/** The content caps; lists use `lg`, item pages and Home `md`, settings and forms `sm`; `full` is a
 * developer view's uncapped table (beta developer mode). */
export const PAGE_WIDTH = {
    full: "max-w-none",
    sm: "max-w-content-sm",
    md: "max-w-content-md",
    lg: "max-w-content-lg",
} as const

export type PageWidth = keyof typeof PAGE_WIDTH

/** The centred column inside the gutters. */
export const pageColumn = (width: PageWidth = "lg") => `mx-auto w-full min-w-0 ${PAGE_WIDTH[width]}`

/** The title block: 24px from the top, 32px once the page area is 960px wide. */
export const PAGE_TITLE_BLOCK = "shrink-0 pt-6 @min-[960px]/page:pt-8"

/** The title row: one height on every page, with or without actions in it. */
export const PAGE_TITLE_ROW = "flex min-h-control min-w-0 items-center gap-2"

/** The body under the title: 24px below it, room at the end of the scroll. */
export const PAGE_BODY = "min-w-0 pb-12 pt-6"
/** The body under a pinned toolbar: the toolbar already holds the space above the rows. */
export const PAGE_BODY_UNDER_TOOLBAR = "min-w-0 pb-12 pt-1"
