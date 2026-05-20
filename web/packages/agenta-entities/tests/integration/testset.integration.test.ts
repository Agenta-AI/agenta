/**
 * Integration tests for testsetMolecule and revisionMolecule.
 *
 * These tests require a running Agenta backend. They are automatically
 * skipped when AGENTA_TEST_API_URL is not set.
 *
 * Coverage:
 *   • testsetMolecule.atoms.serverData  — fetches testset from the real API
 *   • testsetMolecule.atoms.query       — query state (isPending → resolved)
 *   • testsetMolecule.atoms.isDirty     — false on fresh fetch
 *   • testsetMolecule reducers          — update/discard round-trip
 *   • revisionMolecule.atoms.serverData — fetches revision from the real API
 *   • Testset list query                — atoms.query returns testsets array
 */

import {describe, it, expect, beforeEach, afterEach} from "vitest"

import {testsetMolecule, revisionMolecule} from "../../src/testset"

import {hasBackend} from "./helpers/env"
import {makeTestsetFixture, type TestsetFixture} from "./helpers/fixtures"
import {createIntegrationStore, waitForAtom} from "./helpers/store"

describe.skipIf(!hasBackend)("testsetMolecule integration", () => {
    let fixture: TestsetFixture

    beforeEach(async () => {
        fixture = await makeTestsetFixture([
            {prompt: "What is AI?", expected: "A branch of computer science"},
            {prompt: "Hello?", expected: "World"},
        ])
    })

    afterEach(async () => {
        await fixture.cleanup()
    })

    it("atoms.query resolves from pending to settled", async () => {
        const {store} = createIntegrationStore()

        const queryAtom = testsetMolecule.atoms.query(fixture.testsetId)
        const settled = await waitForAtom<{isPending: boolean}>(
            store,
            queryAtom,
            (q) => !q.isPending,
        )

        expect(settled.isPending).toBe(false)
    })

    it("atoms.serverData returns the created testset", async () => {
        const {store} = createIntegrationStore()

        const queryAtom = testsetMolecule.atoms.query(fixture.testsetId)
        await waitForAtom<{isPending: boolean}>(store, queryAtom, (q) => !q.isPending)

        const serverData = store.get(testsetMolecule.atoms.serverData(fixture.testsetId))
        expect(serverData).not.toBeNull()
        expect(serverData?.id).toBe(fixture.testsetId)
        expect(serverData?.name).toBe(fixture.name)
    })

    it("atoms.data equals serverData when no draft is staged", async () => {
        const {store} = createIntegrationStore()

        const queryAtom = testsetMolecule.atoms.query(fixture.testsetId)
        await waitForAtom<{isPending: boolean}>(store, queryAtom, (q) => !q.isPending)

        const data = store.get(testsetMolecule.atoms.data(fixture.testsetId))
        const serverData = store.get(testsetMolecule.atoms.serverData(fixture.testsetId))
        expect(data).toEqual(serverData)
    })

    it("atoms.isDirty is false on a freshly fetched testset", async () => {
        const {store} = createIntegrationStore()

        const queryAtom = testsetMolecule.atoms.query(fixture.testsetId)
        await waitForAtom<{isPending: boolean}>(store, queryAtom, (q) => !q.isPending)

        expect(store.get(testsetMolecule.atoms.isDirty(fixture.testsetId))).toBe(false)
    })

    it("actions.update marks isDirty and merges into atoms.data", async () => {
        const {store} = createIntegrationStore()

        const queryAtom = testsetMolecule.atoms.query(fixture.testsetId)
        await waitForAtom<{isPending: boolean}>(store, queryAtom, (q) => !q.isPending)

        store.set(testsetMolecule.actions.update, fixture.testsetId, {name: "Updated Name"})

        expect(store.get(testsetMolecule.atoms.isDirty(fixture.testsetId))).toBe(true)
        expect(store.get(testsetMolecule.atoms.data(fixture.testsetId))?.name).toBe("Updated Name")
    })

    it("actions.discard clears draft and isDirty returns false", async () => {
        const {store} = createIntegrationStore()

        const queryAtom = testsetMolecule.atoms.query(fixture.testsetId)
        await waitForAtom<{isPending: boolean}>(store, queryAtom, (q) => !q.isPending)

        store.set(testsetMolecule.actions.update, fixture.testsetId, {name: "Pending"})
        store.set(testsetMolecule.actions.discard, fixture.testsetId)

        expect(store.get(testsetMolecule.atoms.isDirty(fixture.testsetId))).toBe(false)
        expect(store.get(testsetMolecule.atoms.data(fixture.testsetId))?.name).toBe(fixture.name)
    })

    it("revisionMolecule.atoms.serverData returns the created revision", async () => {
        const {store} = createIntegrationStore()

        const queryAtom = revisionMolecule.atoms.query(fixture.revisionId)
        await waitForAtom<{isPending: boolean}>(store, queryAtom, (q) => !q.isPending)

        const serverData = store.get(revisionMolecule.atoms.serverData(fixture.revisionId))
        expect(serverData).not.toBeNull()
        expect(serverData?.id).toBe(fixture.revisionId)
        expect(serverData?.testset_id).toBe(fixture.testsetId)
    })
})
