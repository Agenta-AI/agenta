/**
 * Unit coverage for entity-driven completion (app-registered selectors).
 *
 * Verifies how a registered derived selector and the imperative localStorage event path "come
 * together" in onboarding completion logic: the completion map is the UNION of the two, a
 * derived selector can complete an item without any recorded event, and it never un-completes
 * an item that already has one. Real entity wiring is exercised by the integration test; here
 * the selectors are plain atoms so the union logic is tested in isolation.
 */
import {atom, createStore} from "jotai"
import {afterEach, beforeEach, describe, expect, it} from "vitest"

import {
    onboardingStorageUserIdAtom,
    onboardingWidgetCompletionAtom,
    onboardingWidgetCompletionLoadingAtom,
    recordWidgetEventAtom,
    resetCompletionSelectors,
    setCompletionSelectors,
    setOnboardingWidgetConfigAtom,
} from "../../src/state"
import type {CompletionState, OnboardingWidgetConfig} from "../../src/state"

const USER = "user-1"

const config: OnboardingWidgetConfig = {
    sections: [
        {
            id: "datasets",
            title: "Datasets",
            items: [
                {
                    id: "create-test-set",
                    title: "Create a test set",
                    completionEventIds: ["testset_created"],
                },
            ],
        },
    ],
}

let store: ReturnType<typeof createStore>

beforeEach(() => {
    resetCompletionSelectors()
    store = createStore()
    store.set(onboardingStorageUserIdAtom, USER)
    store.set(setOnboardingWidgetConfigAtom, config)
})

afterEach(() => {
    resetCompletionSelectors()
})

const completeSelector = (state: CompletionState) => atom<CompletionState>(state)

describe("entity-driven completion (registered selectors)", () => {
    it("with no selectors registered, completion falls back to imperative events only", () => {
        // derived path inert by default → item incomplete until the event fires
        expect(store.get(onboardingWidgetCompletionAtom)["create-test-set"]).toBe(false)
        store.set(recordWidgetEventAtom, "testset_created")
        expect(store.get(onboardingWidgetCompletionAtom)["create-test-set"]).toBe(true)
    })

    it("a derived selector completes the item WITHOUT any recorded event", () => {
        setCompletionSelectors({
            testset_created: completeSelector({loading: false, complete: true}),
        })
        // no recordWidgetEvent call — completion comes purely from the derived selector
        expect(store.get(onboardingWidgetCompletionAtom)["create-test-set"]).toBe(true)
    })

    it("a derived selector reporting complete:false leaves the item incomplete", () => {
        setCompletionSelectors({
            testset_created: completeSelector({loading: false, complete: false}),
        })
        expect(store.get(onboardingWidgetCompletionAtom)["create-test-set"]).toBe(false)
    })

    it("union: a recorded event keeps the item complete even when the derived selector is false", () => {
        setCompletionSelectors({
            testset_created: completeSelector({loading: false, complete: false}),
        })
        store.set(recordWidgetEventAtom, "testset_created")
        // stored event OR derived → still complete; derived never un-completes
        expect(store.get(onboardingWidgetCompletionAtom)["create-test-set"]).toBe(true)
    })

    it("reacts to a derived selector flipping to complete", () => {
        const derived = atom<CompletionState>({loading: true, complete: false})
        setCompletionSelectors({testset_created: derived})

        expect(store.get(onboardingWidgetCompletionLoadingAtom)).toBe(true)
        expect(store.get(onboardingWidgetCompletionAtom)["create-test-set"]).toBe(false)

        store.set(derived, {loading: false, complete: true})

        expect(store.get(onboardingWidgetCompletionLoadingAtom)).toBe(false)
        expect(store.get(onboardingWidgetCompletionAtom)["create-test-set"]).toBe(true)
    })

    it("loading atom is false when no selectors are registered", () => {
        expect(store.get(onboardingWidgetCompletionLoadingAtom)).toBe(false)
    })
})
