/**
 * Integration test — onboarding completion derived from REAL backend entity state.
 *
 * This is the "how they come together" coverage: it registers a real entity-derived completion
 * selector (reading @agenta/entities `testsetsListAtom`) and proves the onboarding completion
 * map flips once the project actually has a testset on the backend — with NO imperative
 * recordWidgetEvent fired. It exercises the full chain: real API → entities list molecule →
 * onboarding's registered-selector union.
 *
 * No request mocking is involved (the only vitest alias is a @agenta/ui UI stub). Proof the real
 * backend is hit, not a mock or a coincidence:
 *   1. Negative control — a freshly minted, empty ephemeral project resolves to an EMPTY list
 *      (isError false, data []) and completion stays false.
 *   2. Positive — after creating a real testset, the list query returns the EXACT
 *      server-generated testset id + name we created, and completion flips to true.
 * A mock could not produce the server-generated id, and the empty-vs-populated delta is driven
 * solely by real backend state.
 *
 * Reuses the @agenta/entities integration harness (ephemeral account via global setup,
 * createIntegrationStore, makeTestsetFixture). Skipped unless the runner provides
 * AGENTA_API_URL + AGENTA_AUTH_KEY (globalSetup mints the ephemeral account from them):
 *   AGENTA_API_URL=http://localhost/api AGENTA_AUTH_KEY=<admin key> \
 *     pnpm --filter @agenta/onboarding test:integration
 */
import {atom} from "jotai"
import {afterEach, describe, expect, it} from "vitest"

import {testsetsListAtom} from "@agenta/entities/testset"
import type {Testset} from "@agenta/entities/testset"

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

interface TestsetsListState {
    data: Testset[]
    isPending: boolean
    isError: boolean
    error: unknown
}

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

/** Build a store whose onboarding completion derives `testset_created` from the real list atom. */
function storeWithRealTestsetSelector() {
    const {store} = createIntegrationStore()
    store.set(setOnboardingWidgetConfigAtom, config)

    const hasTestsetsSelector = atom<CompletionState>((get) => {
        const list = get(testsetsListAtom)
        return {loading: list.isPending, complete: list.data.length > 0}
    })
    setCompletionSelectors({testset_created: hasTestsetsSelector})

    return store
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

    it("negative control: an empty backend project leaves create-test-set incomplete", async () => {
        const store = storeWithRealTestsetSelector()

        // Real round-trip against the freshly minted (empty) ephemeral project.
        const list = await waitForAtom<TestsetsListState>(
            store,
            testsetsListAtom,
            (l) => !l.isPending,
            15_000,
        )

        expect(list.isError).toBe(false) // the backend call succeeded (not a swallowed error)
        expect(list.data).toEqual([]) // genuinely empty project
        expect(store.get(onboardingWidgetCompletionAtom)["create-test-set"]).toBe(false)
    })

    it("positive: a real backend testset flips create-test-set to complete (no event fired)", async () => {
        // 1. Seed a real testset on the backend (server generates the id).
        fixture = await makeTestsetFixture([{prompt: "What is AI?", expected: "A field of CS"}])

        // 2. Completion derives purely from the real testsetsListAtom resolving — no event.
        const store = storeWithRealTestsetSelector()
        const completion = await waitForAtom<Record<string, boolean>>(
            store,
            onboardingWidgetCompletionAtom,
            (map) => map["create-test-set"] === true,
            20_000,
        )
        expect(completion["create-test-set"]).toBe(true)

        // 3. Prove the data came from the real backend: the list returned the EXACT
        //    server-generated testset (id + name) we created. A mock cannot produce this id.
        const list = store.get(testsetsListAtom) as TestsetsListState
        expect(list.isError).toBe(false)
        const match = list.data.find((t) => t.id === fixture?.testsetId)
        expect(match, "real backend list must contain the created testset").toBeDefined()
        expect(match?.name).toBe(fixture.name)

        // eslint-disable-next-line no-console
        console.info(
            `[proof] real backend returned created testset id=${fixture.testsetId} name=${fixture.name}`,
        )
    })
})
