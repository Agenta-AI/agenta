import {describe, expect, it} from "vitest"

import {visibleCommitMessage} from "@/features/testsets/list/commitMessage"

describe("Testset commit message", () => {
    it("shows a message a person wrote", () => {
        expect(visibleCommitMessage("  Added the refund cases ")).toBe("Added the refund cases")
    })

    it("hides the messages the system writes, and an empty one", () => {
        expect(visibleCommitMessage('Updated testset: "Alpha set"')).toBeNull()
        expect(visibleCommitMessage("Patched testset Alpha set")).toBeNull()
        expect(visibleCommitMessage("Initial commit")).toBeNull()
        expect(visibleCommitMessage("   ")).toBeNull()
        expect(visibleCommitMessage(null)).toBeNull()
        expect(visibleCommitMessage(undefined)).toBeNull()
    })
})
