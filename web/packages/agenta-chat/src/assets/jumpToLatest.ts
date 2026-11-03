// The one jump-to-latest rule, shared by all three transcript engines (was 24px / ~4px / 80px).

/** Floor, so a short or embedded panel does not fire on a nudge. */
export const JUMP_REVEAL_MIN_PX = 200
/** Half a viewport — two to four turns on a desktop panel and on a phone alike. */
export const JUMP_REVEAL_VIEWPORT_FRACTION = 0.5

/** How far past the newest turn the reader must be before the pill is worth showing. */
export const jumpRevealDistance = (viewportPx: number) =>
    Math.max(JUMP_REVEAL_MIN_PX, viewportPx * JUMP_REVEAL_VIEWPORT_FRACTION)

/** The newest turn's content box, or null when it is not rendered. `newestId` guards windowing:
 * the last rendered row is not the newest one, and measuring it under-reports the distance. */
export const newestContentEl = (el: HTMLElement, newestId?: string): HTMLElement | null => {
    const wrappers = el.querySelectorAll<HTMLElement>("[data-mid]")
    const wrapper = wrappers[wrappers.length - 1]
    if (!wrapper) return null
    if (newestId !== undefined && wrapper.dataset.mid !== newestId) return null
    return (wrapper.lastElementChild as HTMLElement | null) ?? wrapper
}

/** Distance below the newest content. Measures the turn's box when it is rendered, because a
 * reserved transcript pads the scroll bottom by up to a viewport; otherwise the scroll gap. */
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

/** A blocking gate is docked, so the pill stands down: same bottom corner, and a paused run has
 * nothing arriving below. Only blocking gates count (the connect-model banner is up all session). */
export const jumpGateOpen = ({
    approvals,
    elicitationOpen,
    connectionOpen,
}: JumpGateState): boolean => approvals > 0 || elicitationOpen || connectionOpen
