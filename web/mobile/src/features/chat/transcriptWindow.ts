/** Turns rendered when a session opens, and how many more each widening adds. */
export const TAIL_TURNS = 12

/** How close to the top a reader scrolling up must be before older turns are added. */
const NEAR_TOP_PX = 600

export interface TranscriptWindow {
    /** True index of the first rendered turn; everything after it is rendered. */
    start: number
    total: number
}

export const openWindow = (total: number): TranscriptWindow => ({
    start: Math.max(0, total - TAIL_TURNS),
    total,
})

/**
 * The window after the turn count changed. Appended turns join it and `start` holds, so no rendered
 * turn unmounts above the reader. More than a window at once is a load (the server's transcript
 * over a short local cache), which opens at the tail again. Removed turns keep a full tail.
 */
export const settleWindow = (held: TranscriptWindow, total: number): TranscriptWindow => {
    if (total === held.total) return held
    if (total - held.total > TAIL_TURNS) return openWindow(total)
    return {start: Math.min(held.start, openWindow(total).start), total}
}

export const widenWindow = (held: TranscriptWindow): TranscriptWindow => ({
    ...held,
    start: Math.max(0, held.start - TAIL_TURNS),
})

/**
 * Should older turns be added now? Only for a reader moving up near the top, or when the content is
 * too short to scroll out of the follow band at all. Inside the band a reader still counts as
 * following, so the resize that added rows would pull them back down.
 */
export const wantsOlderTurns = (
    {
        scrollTop,
        scrollHeight,
        clientHeight,
    }: {scrollTop: number; scrollHeight: number; clientHeight: number},
    movedUp: boolean,
    followBandPx: number,
): boolean => {
    // A pane hidden behind the config split measures 0 everywhere.
    if (clientHeight === 0) return false
    const overflow = scrollHeight - clientHeight
    if (overflow <= followBandPx) return true
    return movedUp && scrollTop <= NEAR_TOP_PX && overflow - scrollTop > followBandPx
}
