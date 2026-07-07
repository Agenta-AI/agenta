/** Pure pager/counter math for the strip's horizontal scroller (prototype-exact). */

export const CARD_WIDTH = 238
export const CARD_GAP = 14
export const PAGE_SIZE = 3

const PER = CARD_WIDTH + CARD_GAP
const TOLERANCE = 4

export interface PagerState {
    atStart: boolean
    atEnd: boolean
    counterLabel: string
    showPager: boolean
}

export function computePagerState(
    scrollLeft: number,
    scrollWidth: number,
    clientWidth: number,
    cardCount: number,
): PagerState {
    const max = scrollWidth - clientWidth
    const atStart = scrollLeft <= TOLERANCE
    const atEnd = max <= TOLERANCE || scrollLeft >= max - TOLERANCE
    const first = Math.min(Math.round(scrollLeft / PER) + 1, Math.max(cardCount - 2, 1))
    const counterLabel = `${first}-${Math.min(first + 2, cardCount)} of ${cardCount}`
    return {atStart, atEnd, counterLabel, showPager: cardCount > PAGE_SIZE}
}

/** Scroll delta for one arrow click (page by 3 cards). */
export const pageDelta = (direction: 1 | -1): number => direction * PER * PAGE_SIZE
