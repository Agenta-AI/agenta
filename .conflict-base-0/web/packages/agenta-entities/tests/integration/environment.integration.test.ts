/**
 * Integration tests for environmentMolecule.
 *
 * These tests require a running Agenta backend. They are automatically
 * skipped when AGENTA_TEST_API_URL is not set.
 *
 * Coverage:
 *   • environmentMolecule.atoms.query      — resolves from pending to settled
 *   • environmentMolecule.atoms.serverData — returns the created environment
 *   • environmentMolecule.atoms.isDirty    — false on fresh fetch
 *   • actions.update / actions.discard     — draft round-trip against server data
 *   • queryOptional(null)                  — returns null without fetching
 *   • revisionsList atoms                  — shape is returned from server
 */

import {describe, it, expect, beforeEach, afterEach} from "vitest"

import {environmentMolecule, enableRevisionsListQueryAtom} from "../../src/environment"

import {hasBackend, TEST_CONFIG} from "./helpers/env"
import {makeEnvironmentFixture, type EnvironmentFixture} from "./helpers/fixtures"
import {createIntegrationStore, waitForAtom} from "./helpers/store"

describe.skipIf(!hasBackend)("environmentMolecule integration", () => {
    let fixture: EnvironmentFixture

    beforeEach(async () => {
        fixture = await makeEnvironmentFixture()
    })

    afterEach(async () => {
        await fixture.cleanup()
    })

    it("atoms.query resolves from pending to settled", async () => {
        const {store} = createIntegrationStore()

        const queryAtom = environmentMolecule.atoms.query(fixture.environmentId)
        const settled = await waitForAtom<{isPending: boolean}>(
            store,
            queryAtom,
            (q) => !q.isPending,
        )

        expect(settled.isPending).toBe(false)
    })

    it("atoms.serverData returns the created environment", async () => {
        const {store} = createIntegrationStore()

        const queryAtom = environmentMolecule.atoms.query(fixture.environmentId)
        await waitForAtom<{isPending: boolean}>(store, queryAtom, (q) => !q.isPending)

        const serverData = store.get(environmentMolecule.atoms.serverData(fixture.environmentId))
        expect(serverData).not.toBeNull()
        expect(serverData?.id).toBe(fixture.environmentId)
        expect(serverData?.name).toBe(fixture.name)
    })

    it("atoms.isDirty is false on a freshly fetched environment", async () => {
        const {store} = createIntegrationStore()

        const queryAtom = environmentMolecule.atoms.query(fixture.environmentId)
        await waitForAtom<{isPending: boolean}>(store, queryAtom, (q) => !q.isPending)

        expect(store.get(environmentMolecule.atoms.isDirty(fixture.environmentId))).toBe(false)
    })

    it("actions.update marks isDirty with a name change", async () => {
        const {store} = createIntegrationStore()

        const queryAtom = environmentMolecule.atoms.query(fixture.environmentId)
        await waitForAtom<{isPending: boolean}>(store, queryAtom, (q) => !q.isPending)

        store.set(environmentMolecule.actions.update, fixture.environmentId, {
            name: "Renamed in draft",
        })

        expect(store.get(environmentMolecule.atoms.isDirty(fixture.environmentId))).toBe(true)
        expect(store.get(environmentMolecule.atoms.data(fixture.environmentId))?.name).toBe(
            "Renamed in draft",
        )
    })

    it("actions.discard reverts the draft to server data", async () => {
        const {store} = createIntegrationStore()

        const queryAtom = environmentMolecule.atoms.query(fixture.environmentId)
        await waitForAtom<{isPending: boolean}>(store, queryAtom, (q) => !q.isPending)

        store.set(environmentMolecule.actions.update, fixture.environmentId, {
            name: "About to be discarded",
        })
        store.set(environmentMolecule.actions.discard, fixture.environmentId)

        expect(store.get(environmentMolecule.atoms.isDirty(fixture.environmentId))).toBe(false)
        expect(store.get(environmentMolecule.atoms.data(fixture.environmentId))?.name).toBe(
            fixture.name,
        )
    })

    it("queryOptional(null) returns non-pending null result without a network call", async () => {
        const {store} = createIntegrationStore()

        const result = store.get(environmentMolecule.queryOptional(null))
        expect(result.isPending).toBe(false)
        expect(result.data).toBeNull()
    })

    it("revisionsList atoms shape is returned for the created environment", async () => {
        const {store} = createIntegrationStore()

        const queryAtom = environmentMolecule.atoms.query(fixture.environmentId)
        await waitForAtom<{isPending: boolean}>(store, queryAtom, (q) => !q.isPending)

        // revisionsList query is demand-driven — must be enabled before it fetches.
        store.set(enableRevisionsListQueryAtom, {
            environmentId: fixture.environmentId,
            projectId: TEST_CONFIG.projectId,
        })

        const revisionsAtom = environmentMolecule.revisionsList.atoms.query(fixture.environmentId)
        const settled = await waitForAtom<{isPending: boolean}>(
            store,
            revisionsAtom,
            (q) => !q.isPending,
        )

        expect(settled.isPending).toBe(false)
    })
})
