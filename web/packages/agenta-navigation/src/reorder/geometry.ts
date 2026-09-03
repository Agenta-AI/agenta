/** Pure geometry for the sidebar drag. No DOM, no React — unit-testable on its own. */

/** A peer's extent, in the scroller's CONTENT coordinates so autoscroll needs no re-measure. */
export interface DragSlot {
    id: string
    top: number
    mid: number
    bottom: number
}

/** How many peers the pointer has passed — i.e. the gap the row would land in. */
export const insertionIndex = (slots: readonly DragSlot[], contentY: number): number => {
    let index = 0
    for (const slot of slots) if (contentY > slot.mid) index += 1
    return index
}

/** Where the insertion line sits, in content coordinates. */
export const insertionOffset = (slots: readonly DragSlot[], index: number): number => {
    if (!slots.length) return 0
    return index === 0 ? slots[0].top : slots[Math.min(index, slots.length) - 1].bottom
}

/** The zone's ids after moving `from` into the gap at `index`. */
export const reorderedIds = (ids: readonly string[], from: number, index: number): string[] => {
    const next = [...ids]
    const [moved] = next.splice(from, 1)
    // The gap index counts the dragged row too while it is still in the list.
    next.splice(index > from ? index - 1 : index, 0, moved)
    return next
}

/** Autoscroll speed at this pointer position, in px/frame. 0 outside the trigger bands. */
export const autoscrollSpeed = (
    pointerY: number,
    top: number,
    bottom: number,
    band = 48,
    max = 14,
): number => {
    const intoTop = top + band - pointerY
    if (intoTop > 0) return -Math.min(max, 2 + (intoTop / band) * max)
    const intoBottom = pointerY - (bottom - band)
    if (intoBottom > 0) return Math.min(max, 2 + (intoBottom / band) * max)
    return 0
}
