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
