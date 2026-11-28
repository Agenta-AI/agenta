/**
 * Sizes the reader sets (the queue panel width, a note's height), kept per browser.
 * Storage can be blocked or full: a read then gives null and a write does nothing.
 */
export const readStoredSize = (key: string): number | null => {
    try {
        const stored = Number(window.localStorage.getItem(key))
        return Number.isFinite(stored) && stored > 0 ? stored : null
    } catch {
        return null
    }
}

export const writeStoredSize = (key: string, size: number) => {
    try {
        window.localStorage.setItem(key, String(Math.round(size)))
    } catch {
        // The size is a convenience; the view works without it.
    }
}

export const PANEL_WIDTH_KEY = "agenta:annotation-queue:panel-width"
/** A note's height, per evaluator field; every annotation form keeps it. */
export const noteHeightKey = (slug: string, fieldKey: string) =>
    `agenta:annotation:note-height:${slug}:${fieldKey}`
