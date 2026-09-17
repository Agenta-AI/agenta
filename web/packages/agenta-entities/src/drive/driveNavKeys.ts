/**
 * The Files pane's navigation chords, resolved from a key event (pure, so the map is testable):
 * back ⌥← / ⌘[, forward ⌥→ / ⌘], up a level ⌫ / ⌘↑, Esc leaves an open file for its folder.
 */
export type DriveNavAction = "back" | "forward" | "up" | "close"

export interface DriveNavKeyEvent {
    key: string
    metaKey: boolean
    ctrlKey: boolean
    altKey: boolean
    shiftKey: boolean
    /** The event's target is a text field or editor, where ⌫ / Esc belong to the typing. */
    editable: boolean
}

export const isEditableTarget = (target: EventTarget | null): boolean => {
    const el = target as HTMLElement | null
    if (!el || !el.tagName) return false
    return /^(input|textarea|select)$/i.test(el.tagName) || el.isContentEditable
}

export const driveNavAction = (e: DriveNavKeyEvent): DriveNavAction | null => {
    const mod = e.metaKey || e.ctrlKey
    if (e.shiftKey) return null
    if (e.altKey && !mod) {
        if (e.key === "ArrowLeft") return "back"
        if (e.key === "ArrowRight") return "forward"
        return null
    }
    if (mod && !e.altKey) {
        if (e.key === "[") return "back"
        if (e.key === "]") return "forward"
        if (e.key === "ArrowUp") return "up"
        return null
    }
    if (mod || e.altKey || e.editable) return null
    if (e.key === "Backspace") return "up"
    if (e.key === "Escape") return "close"
    return null
}
