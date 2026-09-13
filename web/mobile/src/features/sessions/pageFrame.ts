import {pageContentWidthClass} from "@agenta/ui/components/page-width"

/**
 * The sessions page column — same max width and gutters as the automations page, so a reader
 * moving between the two nav entries sees one page frame rather than two.
 *
 * Its own module because the screen and its loading skeleton must agree on it: defined twice, the
 * skeleton keeps the old gutters the moment the screen's change and the page shifts as it settles.
 */
export const SESSIONS_PAGE_FRAME = `${pageContentWidthClass} lg:px-16`
