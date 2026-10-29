import {describe, expect, it} from "vitest"

import {
    applyDriveDraftChange,
    commitDriveDraft,
    driveDraftTextToSave,
    isDriveDraftDirty,
    seedDriveDraft,
} from "../../src/drive/driveDraft"

describe("driveDraft", () => {
    it("is clean on open, whatever the editor would normalise", () => {
        const d = seedDriveDraft("# Title\n\n- a\n")
        expect(isDriveDraftDirty(d)).toBe(false)
    })

    it("the first emission that differs from the seed is dirty", () => {
        const d = applyDriveDraftChange(seedDriveDraft("hello"), "hello world")
        expect(isDriveDraftDirty(d)).toBe(true)
        expect(d.value).toBe("hello world")
    })

    // The code editor drops the trailing newline and echoes the text back on hydration.
    it("a hydration echo (seed minus trailing newlines) is the baseline, not an edit", () => {
        const d = applyDriveDraftChange(seedDriveDraft("a\nb\n"), "a\nb")
        expect(isDriveDraftDirty(d)).toBe(false)
        expect(applyDriveDraftChange(d, "a\nbc").value).toBe("a\nbc")
        expect(isDriveDraftDirty(applyDriveDraftChange(d, "a\nbc"))).toBe(true)
    })

    it("typing back to the saved text is clean again", () => {
        let d = applyDriveDraftChange(seedDriveDraft("hello"), "hello!")
        d = applyDriveDraftChange(d, "hello")
        expect(isDriveDraftDirty(d)).toBe(false)
    })

    it("an unchanged emission returns the same draft", () => {
        const d = applyDriveDraftChange(seedDriveDraft("x"), "y")
        expect(applyDriveDraftChange(d, "y")).toBe(d)
    })

    it("saving keeps the file's trailing newline the editor dropped", () => {
        const d = applyDriveDraftChange(seedDriveDraft("a\n"), "ab")
        expect(driveDraftTextToSave(d)).toBe("ab\n")
        expect(driveDraftTextToSave(applyDriveDraftChange(seedDriveDraft("a"), "ab"))).toBe("ab")
    })

    it("commit re-seeds from the saved text and keeps keystrokes typed meanwhile", () => {
        const edited = applyDriveDraftChange(seedDriveDraft("v1\n"), "v2")
        const committed = commitDriveDraft(edited, "v2\n")
        expect(committed.seed).toBe("v2\n")
        expect(isDriveDraftDirty(committed)).toBe(false)
        const typedMeanwhile = commitDriveDraft(applyDriveDraftChange(edited, "v2x"), "v2\n")
        expect(typedMeanwhile.value).toBe("v2x")
        expect(isDriveDraftDirty(typedMeanwhile)).toBe(true)
    })
})
