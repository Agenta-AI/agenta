/**
 * Keyboard helpers shared by the drive list surfaces (config Files list, chat context rail).
 * Roving focus: the rows are native buttons that bubble their keydown to the list container this
 * handler is bound to. The tree (DriveExplorer) has its own hierarchical handler (left/right
 * collapse/expand), so it does NOT use this flat-list one.
 */
import {type KeyboardEvent} from "react"

/** ↑/↓ move focus between the container's direct row buttons; Home/End jump to the ends.
 * preventDefault stops the arrow keys from scrolling the surrounding panel. */
export const listArrowKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button"))
    if (!rows.length) return
    e.preventDefault()
    const idx = rows.findIndex((r) => r === document.activeElement)
    const next =
        e.key === "Home"
            ? 0
            : e.key === "End"
              ? rows.length - 1
              : idx < 0
                ? 0
                : Math.min(Math.max(idx + (e.key === "ArrowDown" ? 1 : -1), 0), rows.length - 1)
    rows[next]?.focus()
}

/** 2D roving focus for a tile grid: ←/→ step one tile, ↑/↓ step one row, Home/End jump to the ends.
 * The column count is read from the layout (tiles sharing the first tile's offsetTop), so it stays
 * correct if the grid ever becomes responsive. */
export const gridArrowKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button"))
    if (!items.length) return
    e.preventDefault()
    const idx = items.findIndex((r) => r === document.activeElement)
    const cur = idx < 0 ? 0 : idx
    const top0 = items[0].offsetTop
    const cols = Math.max(1, items.filter((it) => it.offsetTop === top0).length)
    const focusAt = (i: number) => items[Math.min(Math.max(i, 0), items.length - 1)]?.focus()
    switch (e.key) {
        case "Home":
            return focusAt(0)
        case "End":
            return focusAt(items.length - 1)
        case "ArrowLeft":
            return focusAt(cur - 1)
        case "ArrowRight":
            return focusAt(cur + 1)
        case "ArrowUp":
            return focusAt(idx < 0 ? 0 : cur - cols)
        case "ArrowDown":
            return focusAt(idx < 0 ? 0 : cur + cols)
    }
}
