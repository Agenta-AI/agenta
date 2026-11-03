import {
    ADD_TO_TESTSET_COMMIT_MODES,
    createQueueDrawerOpenAtom,
    getAddToTestsetDisabledReason,
    SESSION_TABS,
} from "@agenta/annotation"
import {createStore} from "jotai"
import {describe, expect, it} from "vitest"

describe("@agenta/annotation from mobile", () => {
    it("lists the session tabs in order", () => {
        expect(SESSION_TABS.map((tab) => tab.label)).toEqual([
            "Annotate",
            "All Annotations",
            "Configuration",
        ])
    })

    it("offers the existing and new testset commit modes", () => {
        expect(ADD_TO_TESTSET_COMMIT_MODES.map((mode) => mode.id)).toEqual(["existing", "new"])
    })

    it("explains why a scenario cannot be added to a testset yet", () => {
        const base = {scenarioId: "s1", isCompleted: false, isSubmitting: false}
        expect(
            getAddToTestsetDisabledReason({...base, scenarioId: "", hasPendingChanges: false}),
        ).toBe("Select a scenario before adding it to a testset.")
        expect(getAddToTestsetDisabledReason({...base, hasPendingChanges: true})).toBe(
            "Save annotations before adding to a testset.",
        )
        expect(
            getAddToTestsetDisabledReason({...base, isSubmitting: true, hasPendingChanges: false}),
        ).toBe("Saving annotations")
        expect(getAddToTestsetDisabledReason({...base, hasPendingChanges: false})).toBeNull()
    })

    it("keeps the create queue sheet closed until something opens it", () => {
        const store = createStore()
        expect(store.get(createQueueDrawerOpenAtom)).toBe(false)
        store.set(createQueueDrawerOpenAtom, true)
        expect(store.get(createQueueDrawerOpenAtom)).toBe(true)
    })
})
