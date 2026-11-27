import {getAddToTestsetDisabledReason} from "@agenta/annotation"
import {describe, expect, it} from "vitest"

describe("@agenta/annotation from mobile", () => {
    it("explains why a scenario cannot be added to a testset yet", () => {
        const base = {scenarioId: "s1", isCompleted: false, isSubmitting: false}
        expect(
            getAddToTestsetDisabledReason({...base, scenarioId: "", hasPendingChanges: false}),
        ).toBe("Select an item before adding it to a test set.")
        expect(getAddToTestsetDisabledReason({...base, hasPendingChanges: true})).toBe(
            "Mark this item completed before adding it to a test set.",
        )
        expect(
            getAddToTestsetDisabledReason({...base, isSubmitting: true, hasPendingChanges: false}),
        ).toBe("Saving annotations")
        expect(getAddToTestsetDisabledReason({...base, hasPendingChanges: false})).toBeNull()
    })
})
