import {describe, expect, it} from "vitest"

import {
    applyDriveDraftChange,
    commitDriveDraft,
    isDriveDraftDirty,
    revertDriveDraft,
    seedDriveDraft,
} from "../../src/drive/driveDraft"

describe("driveDraft", () => {
    it("is clean on open, whatever the editor would normalise", () => {
        const d = seedDriveDraft("# Title\n\n- a\n")
        expect(isDriveDraftDirty(d)).toBe(false)
    })

    // The editor emits only on edits, never on hydration — so the first emission IS an edit.
    it("the first emission that differs from the seed is dirty", () => {
        const d = applyDriveDraftChange(seedDriveDraft("hello"), "hello world")
        expect(isDriveDraftDirty(d)).toBe(true)
        expect(d.value).toBe("hello world")
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

    it("commit makes the value the new seed; revert re-seeds from the saved text", () => {
        const edited = applyDriveDraftChange(seedDriveDraft("v1"), "v2")
        const committed = commitDriveDraft(edited)
        expect(committed.seed).toBe("v2")
        expect(isDriveDraftDirty(committed)).toBe(false)
        const reverted = revertDriveDraft(applyDriveDraftChange(committed, "v3"))
        expect(reverted.value).toBe("v2")
        expect(isDriveDraftDirty(reverted)).toBe(false)
    })
})
