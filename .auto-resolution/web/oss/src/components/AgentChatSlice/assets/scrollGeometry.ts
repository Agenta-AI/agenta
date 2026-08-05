/** The last real content element in the log (the last turn's last child). Used to measure the REAL
 * content bottom and ignore the min-h-full reserve that pads a streaming turn — so the jump pill and
 * stick-to-bottom track the latest message, not the bottom of the empty reserved space. */
export const lastContentEl = (el: HTMLElement): HTMLElement | null => {
    const wrappers = el.querySelectorAll<HTMLElement>("[data-mid]")
    const wrapper = wrappers[wrappers.length - 1]
    if (!wrapper) return null
    return (wrapper.lastElementChild as HTMLElement | null) ?? wrapper
}

/** True when the latest message content sits at or above the viewport bottom (i.e. fully visible). */
export const atLiveEdge = (el: HTMLElement): boolean => {
    const last = lastContentEl(el)
    if (!last) return true
    return last.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom < 24
}
