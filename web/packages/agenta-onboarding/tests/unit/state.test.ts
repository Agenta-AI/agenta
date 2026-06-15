/**
 * Unit + regression coverage for the @agenta/onboarding state/event layer.
 *
 * Exercises atoms through a fresh jotai store per test (in-memory store semantics; localStorage
 * persistence is a side effect that does not affect single-store logic).
 *
 * Regression markers from plan-eng-review:
 *   R1 — openWidgetAtom is a no-op without a userId (supertokens fallback was deleted; the app
 *        sets the userId reactively, so the package must safely no-op when it is absent).
 *   R2 — recordWidgetEventAtom is importable from @agenta/onboarding/state and fires at runtime
 *        (guards the un-gated oss tsc: a broken export would surface here, not just at runtime).
 */
import {createStore} from "jotai"
import {beforeEach, describe, expect, it} from "vitest"

import {
    computedExpandedSectionsAtom,
    isNewUserAtom,
    markTourSeenAtom,
    onboardingStorageUserIdAtom,
    onboardingWidgetCompletionAtom,
    onboardingWidgetStatusAtom,
    onboardingWidgetUIStateAtom,
    onboardingWidgetEventsAtom,
    openWidgetAtom,
    recordWidgetEventAtom,
    resetSeenToursAtom,
    seenToursAtom,
    setOnboardingWidgetConfigAtom,
    setWidgetSectionExpandedAtom,
    setWidgetSectionManuallyCollapsedAtom,
} from "../../src/state"
import type {OnboardingWidgetConfig} from "../../src/state"

const USER = "user-1"

let store: ReturnType<typeof createStore>

beforeEach(() => {
    store = createStore()
    store.set(onboardingStorageUserIdAtom, USER)
})

describe("recordWidgetEventAtom", () => {
    it("records an event once and is idempotent on repeat (dup-guard)", () => {
        store.set(recordWidgetEventAtom, "playground_ran_prompt")
        const first = store.get(onboardingWidgetEventsAtom)
        expect(typeof first.playground_ran_prompt).toBe("number")

        const ts = first.playground_ran_prompt
        store.set(recordWidgetEventAtom, "playground_ran_prompt")
        // dup-guard: timestamp must be unchanged, not re-stamped
        expect(store.get(onboardingWidgetEventsAtom).playground_ran_prompt).toBe(ts)
    })

    it("no-ops (no throw) when no userId is set", () => {
        const s = createStore()
        expect(() => s.set(recordWidgetEventAtom, "x")).not.toThrow()
        expect(s.get(onboardingWidgetEventsAtom)).toEqual({})
    })
})

describe("onboardingWidgetCompletionAtom", () => {
    const config: OnboardingWidgetConfig = {
        sections: [
            {
                id: "s1",
                title: "S1",
                items: [
                    {
                        id: "i-any",
                        title: "any",
                        completionEventIds: ["a", "b"],
                        completionMode: "any",
                    },
                    {
                        id: "i-all",
                        title: "all",
                        completionEventIds: ["a", "b"],
                        completionMode: "all",
                    },
                    {id: "i-none", title: "none", completionEventIds: []},
                ],
            },
        ],
    }

    it("resolves 'any' vs 'all' completion modes against recorded events", () => {
        store.set(setOnboardingWidgetConfigAtom, config)
        store.set(recordWidgetEventAtom, "a")

        let map = store.get(onboardingWidgetCompletionAtom)
        expect(map["i-any"]).toBe(true) // any: 'a' present
        expect(map["i-all"]).toBe(false) // all: 'b' missing
        expect(map["i-none"]).toBe(false) // no completion ids → never complete

        store.set(recordWidgetEventAtom, "b")
        map = store.get(onboardingWidgetCompletionAtom)
        expect(map["i-all"]).toBe(true)
    })
})

describe("computedExpandedSectionsAtom (priority ladder)", () => {
    const config: OnboardingWidgetConfig = {
        sections: [
            {id: "s1", title: "S1", items: [{id: "i1", title: "", completionEventIds: ["x"]}]},
            {id: "s2", title: "S2", items: [{id: "i2", title: "", completionEventIds: ["y"]}]},
        ],
    }

    beforeEach(() => store.set(setOnboardingWidgetConfigAtom, config))

    it("auto-expands the first incomplete section by default", () => {
        const exp = store.get(computedExpandedSectionsAtom)
        expect(exp.s1).toBe(true)
        expect(exp.s2).toBe(false)
    })

    it("manual collapse beats first-incomplete auto-expand", () => {
        store.set(setWidgetSectionManuallyCollapsedAtom, {sectionId: "s1", collapsed: true})
        expect(store.get(computedExpandedSectionsAtom).s1).toBe(false)
    })

    it("explicit expand opens a non-first-incomplete section", () => {
        store.set(setWidgetSectionExpandedAtom, {sectionId: "s2", expanded: true})
        expect(store.get(computedExpandedSectionsAtom).s2).toBe(true)
    })
})

describe("openWidgetAtom (R1 — supertokens fallback removed)", () => {
    it("no-ops (no throw) when userId is absent", () => {
        const s = createStore()
        expect(() => s.set(openWidgetAtom)).not.toThrow()
        expect(s.get(onboardingWidgetUIStateAtom).isOpen).toBe(false)
    })

    it("opens and marks pending once userId is present", () => {
        store.set(openWidgetAtom)
        expect(store.get(onboardingWidgetUIStateAtom).isOpen).toBe(true)
        expect(store.get(onboardingWidgetStatusAtom)).toBe("pending")
    })
})

describe("tour-seen + new-user state (userId scoping)", () => {
    it("markTourSeen records, reset clears", () => {
        store.set(markTourSeenAtom, "tour-1")
        expect(Boolean(store.get(seenToursAtom)["tour-1"])).toBe(true)
        store.set(resetSeenToursAtom)
        expect(store.get(seenToursAtom)).toEqual({})
    })

    it("isNewUser is false and unsettable without a userId", () => {
        const s = createStore()
        expect(s.get(isNewUserAtom)).toBe(false)
        s.set(isNewUserAtom, true) // scoped write is a no-op without userId
        expect(s.get(isNewUserAtom)).toBe(false)
    })

    it("isNewUser is settable with a userId", () => {
        store.set(isNewUserAtom, true)
        expect(store.get(isNewUserAtom)).toBe(true)
    })
})
