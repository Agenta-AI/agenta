/**
 * Integration test — onboarding completion derived from REAL backend entity state.
 *
 * This is the "how they come together" coverage: it registers a real entity-derived completion
 * selector (reading @agenta/entities `testsetsListAtom`) and proves the onboarding completion
 * map flips to complete once the project actually has a testset on the backend — with NO
 * imperative recordWidgetEvent fired. It exercises the full chain: real API → entities list
 * molecule → onboarding's registered-selector union.
 *
 * Reuses the @agenta/entities integration harness (ephemeral account via global setup,
 * createIntegrationStore, makeTestsetFixture). Skipped unless the runner provides
 * AGENTA_API_URL + AGENTA_AUTH_KEY (globalSetup mints the ephemeral account from them):
 *   pnpm --filter @agenta/onboarding test:integration   (with those env vars set)
 */
import {atom} from "jotai"
import {afterEach, describe, expect, it} from "vitest"

import {testsetsListAtom} from "@agenta/entities/testset"

import {hasBackend} from "../../../agenta-entities/tests/integration/helpers/env"
import {
    makeTestsetFixture,
    type TestsetFixture,
} from "../../../agenta-entities/tests/integration/helpers/fixtures"
import {
    createIntegrationStore,
    waitForAtom,
} from "../../../agenta-entities/tests/integration/helpers/store"

import {
    onboardingWidgetCompletionAtom,
    resetCompletionSelectors,
    setCompletionSelectors,
    setOnboardingWidgetConfigAtom,
} from "../../src/state"
import type {CompletionState, OnboardingWidgetConfig} from "../../src/state"

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

describe.skipIf(!hasBackend)("onboarding completion from real backend testsets", () => {
    let fixture: TestsetFixture | null = null

    afterEach(async () => {
        resetCompletionSelectors()
        if (fixture) {
            await fixture.cleanup()
            fixture = null
        }
    })

    it("marks create-test-set complete from a real testset, with no event fired", async () => {
        // 1. Seed a real testset on the backend (ephemeral account from global setup).
        fixture = await makeTestsetFixture([{prompt: "What is AI?", expected: "A field of CS"}])

        // 2. Wire onboarding completion to derive from real entity state.
        const {store} = createIntegrationStore()
        store.set(setOnboardingWidgetConfigAtom, config)

        const hasTestsetsSelector = atom<CompletionState>((get) => {
            const list = get(testsetsListAtom)
            return {loading: list.isPending, complete: list.data.length > 0}
        })
        setCompletionSelectors({testset_created: hasTestsetsSelector})

        // 3. Completion flips to true purely from the real testsetsListAtom resolving —
        //    no recordWidgetEvent("testset_created") was ever called.
        const completion = await waitForAtom<Record<string, boolean>>(
            store,
            onboardingWidgetCompletionAtom,
            (map) => map["create-test-set"] === true,
            20_000,
        )

        expect(completion["create-test-set"]).toBe(true)
    })
})
