import {pageContentWidthClass} from "@agenta/ui/components/page-width"

/**
 * The frame Home applies: the shared column plus a phone's own gutters below `lg`, widening to
 * the page gutters above it. The deep top inset is Home's own — the centred column is the whole
 * page, so it hangs rather than starting at the top.
 *
 * Its own module because the screen and its loading skeleton must agree on it: defined twice,
 * the skeleton keeps the old inset the moment the screen's changes and the page shifts as it
 * settles.
 */
export const HOME_PAGE_FRAME = `${pageContentWidthClass} px-4 pb-12 pt-10 lg:px-16 lg:pb-16 lg:pt-[120px]`
