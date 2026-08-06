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
    // Fully visible cards at THIS viewport (n cards fit when n*WIDTH + (n-1)*GAP ≤ clientWidth) —
    // a fixed 3-card window mislabels the range once the row shows more (e.g. "3-5 of 6" at the end
    // while card 6 is on screen).
    const visible = Math.max(1, Math.min(Math.floor((clientWidth + CARD_GAP) / PER), cardCount))
    const lastFirst = Math.max(cardCount - visible + 1, 1)
    // Floor at 1: Safari exposes a transient negative scrollLeft during elastic overscroll.
    const first = atEnd
        ? lastFirst
        : Math.max(1, Math.min(Math.round(scrollLeft / PER) + 1, lastFirst))
    const counterLabel = `${first}–${Math.min(first + visible - 1, cardCount)} of ${cardCount}`
    return {atStart, atEnd, counterLabel, showPager: cardCount > visible}
}

/** Scroll delta for one arrow click (page by 3 cards). */
export const pageDelta = (direction: 1 | -1): number => direction * PER * PAGE_SIZE
