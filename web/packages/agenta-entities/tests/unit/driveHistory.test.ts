import {describe, expect, it} from "vitest"

import {
    canGoBack,
    canGoForward,
    currentDriveHistoryPath,
    EMPTY_DRIVE_HISTORY,
    pushDriveHistory,
    replaceDriveHistory,
    stepDriveHistory,
} from "../../src/drive/driveHistory"

describe("driveHistory", () => {
    it("pushes selections and steps back and forward", () => {
        let h = pushDriveHistory(EMPTY_DRIVE_HISTORY, "")
        h = pushDriveHistory(h, "docs")
        h = pushDriveHistory(h, "docs/a.md")
        expect(canGoBack(h)).toBe(true)
        expect(canGoForward(h)).toBe(false)
        h = stepDriveHistory(h, -1)
        expect(currentDriveHistoryPath(h)).toBe("docs")
        expect(canGoForward(h)).toBe(true)
        h = stepDriveHistory(h, 1)
        expect(currentDriveHistoryPath(h)).toBe("docs/a.md")
    })

    it("re-selecting the current entry is a no-op", () => {
        const h = pushDriveHistory(EMPTY_DRIVE_HISTORY, "docs")
        expect(pushDriveHistory(h, "docs")).toBe(h)
    })

    // Browser semantics: a new pick after going back drops the forward entries.
    it("a new selection drops the forward stack", () => {
        let h = pushDriveHistory(EMPTY_DRIVE_HISTORY, "")
        h = pushDriveHistory(h, "a")
        h = pushDriveHistory(h, "b")
        h = stepDriveHistory(h, -1)
        h = pushDriveHistory(h, "c")
        expect(h.entries).toEqual(["", "a", "c"])
        expect(canGoForward(h)).toBe(false)
    })

    it("stepping never leaves the stack", () => {
        const h = pushDriveHistory(EMPTY_DRIVE_HISTORY, "")
        expect(stepDriveHistory(h, -1)).toBe(h)
        expect(stepDriveHistory(h, 1)).toBe(h)
        expect(stepDriveHistory(EMPTY_DRIVE_HISTORY, -1)).toBe(EMPTY_DRIVE_HISTORY)
    })

    // A rename keeps its place: the renamed path stands where the old one stood.
    it("replace swaps the current entry in place", () => {
        let h = pushDriveHistory(EMPTY_DRIVE_HISTORY, "a.md")
        h = pushDriveHistory(h, "b.md")
        h = replaceDriveHistory(h, "c.md")
        expect(h.entries).toEqual(["a.md", "c.md"])
        expect(h.index).toBe(1)
        expect(replaceDriveHistory(EMPTY_DRIVE_HISTORY, "x").entries).toEqual(["x"])
    })
})
