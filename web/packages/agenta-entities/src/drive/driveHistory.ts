/**
 * The explorer's back / forward stack — pure, so the selection hook stays thin and the rules are
 * unit-testable: a new selection drops any forward entries (browser semantics), re-selecting the
 * current entry is a no-op, and stepping never leaves the stack.
 */
export interface DriveHistory {
    entries: string[]
    /** Index of the current entry; -1 while nothing has been selected. */
    index: number
}

export const EMPTY_DRIVE_HISTORY: DriveHistory = {entries: [], index: -1}

export const pushDriveHistory = (h: DriveHistory, path: string): DriveHistory => {
    if (h.index >= 0 && h.entries[h.index] === path) return h
    return {entries: [...h.entries.slice(0, h.index + 1), path], index: h.index + 1}
}

/** Replace the current entry (a rename / move keeps its place in the stack). */
export const replaceDriveHistory = (h: DriveHistory, path: string): DriveHistory => {
    if (h.index < 0) return pushDriveHistory(h, path)
    const entries = h.entries.slice()
    entries[h.index] = path
    return {entries, index: h.index}
}

export const canGoBack = (h: DriveHistory): boolean => h.index > 0
export const canGoForward = (h: DriveHistory): boolean => h.index < h.entries.length - 1

export const stepDriveHistory = (h: DriveHistory, delta: -1 | 1): DriveHistory => {
    const next = h.index + delta
    if (next < 0 || next >= h.entries.length) return h
    return {entries: h.entries, index: next}
}

export const currentDriveHistoryPath = (h: DriveHistory): string | null =>
    h.index >= 0 ? (h.entries[h.index] ?? null) : null
