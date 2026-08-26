/**
 * The ONE rule behind the jump-to-latest pill, shared by every transcript engine (the desktop
 * scroller, the desktop Virtuoso variant, and /m). It used to be three numbers in three files —
 * 24px, Virtuoso's 4px default, and 80px — so "scrolled up a little" meant something different on
 * each surface.
 */

/** Floor, so a short or embedded panel does not go back to firing on a nudge. */
export const JUMP_REVEAL_MIN_PX = 200
/** Half a viewport — two to four turns on a desktop panel and on a phone alike. */
export const JUMP_REVEAL_VIEWPORT_FRACTION = 0.5

/** How far past the newest turn the reader must be before the pill is worth showing. */
export const jumpRevealDistance = (viewportPx: number) =>
    Math.max(JUMP_REVEAL_MIN_PX, viewportPx * JUMP_REVEAL_VIEWPORT_FRACTION)

/**
 * The newest turn's last content box, or null when it is not in the DOM to measure.
 *
 * `newestId` is what makes this safe under windowing: a virtualized transcript scrolled far up has
 * rendered rows, but the LAST one is not the newest turn, and measuring it would report a distance
 * far shorter than the truth. Callers that know the newest message id pass it; a transcript that
 * renders every row can omit it.
 */
export const newestContentEl = (el: HTMLElement, newestId?: string): HTMLElement | null => {
    const wrappers = el.querySelectorAll<HTMLElement>("[data-mid]")
    const wrapper = wrappers[wrappers.length - 1]
    if (!wrapper) return null
    if (newestId !== undefined && wrapper.dataset.mid !== newestId) return null
    return (wrapper.lastElementChild as HTMLElement | null) ?? wrapper
}

/**
 * Distance from the viewport bottom down to the newest content.
 *
 * Two measurements, and which one is right depends on whether the newest turn is rendered:
 *  - It is → measure its box. A transcript that reserves a viewport for the streaming turn
 *    (desktop `min-h-full`, the Virtuoso footer's explicit reserve) has up to a screen of empty
 *    space below the last message, so the scroll gap would claim the reader is miles away.
 *  - It is not (windowed away, or a plain scroller with no `data-mid` rows at all, like /m) →
 *    the scroll gap. There is no reserve in either of those cases, so the gap is exact.
 */
export const distanceBelowNewest = (el: HTMLElement, newestId?: string): number => {
    const newest = newestContentEl(el, newestId)
    if (newest) return newest.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom
    return el.scrollHeight - el.scrollTop - el.clientHeight
}

/** Is the reader far enough above the newest turn to want a way back? */
export const shouldRevealJump = (el: HTMLElement, newestId?: string): boolean =>
    distanceBelowNewest(el, newestId) > jumpRevealDistance(el.clientHeight)

export interface JumpGateState {
    /** Pending HITL approvals. */
    approvals: number
    /** A parked question form is open. */
    elicitationOpen: boolean
    /** A parked connect-to-X card is open. */
    connectionOpen: boolean
}

/**
 * A blocking gate is docked above the composer, so the pill stands down.
 *
 * Two reasons, and the second is the real one: the pill floats in the same bottom corner the dock
 * card occupies, and while a gate is open the run is PAUSED — nothing is arriving below, so
 * "jump to latest" has nothing to offer and is only competing for the attention the gate needs.
 * The dock cannot scroll out of reach, so suppressing this costs the reader nothing, and the pill
 * returns the moment the gate is answered.
 *
 * Only the blocking gates count. The queue and the connect-model banner are informational, and the
 * banner in particular is up for the whole session on a workspace with no provider key.
 */
export const jumpGateOpen = ({
    approvals,
    elicitationOpen,
    connectionOpen,
}: JumpGateState): boolean => approvals > 0 || elicitationOpen || connectionOpen
