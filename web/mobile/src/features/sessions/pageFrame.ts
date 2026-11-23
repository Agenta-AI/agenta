import {pageContentWidthClass} from "@agenta/ui/components/page-width"

/**
 * The one frame of the list pages (Agents, Automations, Skills, Sessions, Templates): the same
 * `content-lg` column, gutters, top padding and header row on each, so a reader moving between the
 * nav entries sees one page, not five (LAYOUT-02, LAYOUT-03).
 *
 * Its own module because each screen and its loading skeleton must agree on it: defined twice, the
 * skeleton keeps the old gutters the moment the screen's change and the page shifts as it settles.
 */
export const LIST_PAGE_FRAME = "mx-auto box-border w-full max-w-content-lg px-4 md:px-6"

/** The header box: the frame plus the shared top padding. */
export const LIST_PAGE_HEADER = `shrink-0 pb-3 pt-3 lg:pt-14 ${LIST_PAGE_FRAME}`

/** The header row: one height on every page, with or without a New button in it. */
export const LIST_PAGE_HEADER_ROW = "flex min-h-control min-w-0 items-center gap-2"

/** The body box under the header. */
export const LIST_PAGE_BODY = `min-w-0 pb-12 pt-3 ${LIST_PAGE_FRAME}`

/** The older 1248px column the agent pages still use; list pages use `LIST_PAGE_FRAME`. */
export const SESSIONS_PAGE_FRAME = `${pageContentWidthClass} lg:px-16`
