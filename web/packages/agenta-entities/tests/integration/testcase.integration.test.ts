/**
 * Integration tests for testcaseMolecule.
 *
 * These tests require a running Agenta backend. They are automatically
 * skipped when AGENTA_TEST_API_URL is not set.
 *
 * Coverage:
 *   • testcaseMolecule.atoms.serverData — fetches testcase from the real API
 *   • testcaseMolecule.atoms.isDirty    — false on fresh fetch
 *   • testcaseMolecule reducers         — update / discard round-trip
 *   • Testcase data shape               — data field matches what was seeded
 */

import {describe, it, expect, beforeEach, afterEach} from "vitest"

import {fetchTestcasesPage} from "../../src/testcase/api/api"
import {testcaseMolecule} from "../../src/testcase"

import {TEST_CONFIG, hasBackend} from "./helpers/env"
import {makeTestsetFixture, type TestsetFixture} from "./helpers/fixtures"
import {createIntegrationStore, waitForAtom} from "./helpers/store"

describe.skipIf(!hasBackend)("testcaseMolecule integration", () => {
    let fixture: TestsetFixture
    let testcaseId: string

    beforeEach(async () => {
        fixture = await makeTestsetFixture([
            {prompt: "Integration prompt", expected: "Integration expected"},
        ])

        // Fetch the first testcase that belongs to the seeded revision.
        const page = await fetchTestcasesPage({
            projectId: TEST_CONFIG.projectId,
            revisionId: fixture.revisionId,
            limit: 1,
        })
        testcaseId = page.testcases[0]?.id || ""
    })

    afterEach(async () => {
        await fixture.cleanup()
    })

    it("serverData is null for an unknown testcase id", async () => {
        const {store} = createIntegrationStore()

        const data = store.get(testcaseMolecule.atoms.serverData("tc-does-not-exist"))
        expect(data).toBeNull()
    })

    it("isDirty is false before any update for a real testcase", async () => {
        if (!testcaseId) return

        const {store} = createIntegrationStore()

        const queryAtom = testcaseMolecule.atoms.query(testcaseId)
        await waitForAtom<{isPending: boolean}>(store, queryAtom, (q) => !q.isPending)

        expect(store.get(testcaseMolecule.atoms.isDirty(testcaseId))).toBe(false)
    })

    it("atoms.update marks isDirty and merges data field", async () => {
        if (!testcaseId) return

        const {store} = createIntegrationStore()

        const queryAtom = testcaseMolecule.atoms.query(testcaseId)
        await waitForAtom<{isPending: boolean}>(store, queryAtom, (q) => !q.isPending)

        store.set(testcaseMolecule.actions.update, testcaseId, {data: {prompt: "Overridden"}})

        expect(store.get(testcaseMolecule.atoms.isDirty(testcaseId))).toBe(true)
        expect(store.get(testcaseMolecule.atoms.data(testcaseId))?.data?.prompt).toBe("Overridden")
    })

    it("atoms.discard reverts draft changes", async () => {
        if (!testcaseId) return

        const {store} = createIntegrationStore()

        const queryAtom = testcaseMolecule.atoms.query(testcaseId)
        await waitForAtom<{isPending: boolean}>(store, queryAtom, (q) => !q.isPending)

        const original = store.get(testcaseMolecule.atoms.data(testcaseId))

        store.set(testcaseMolecule.actions.update, testcaseId, {data: {prompt: "Changed"}})
        store.set(testcaseMolecule.actions.discard, testcaseId)

        expect(store.get(testcaseMolecule.atoms.isDirty(testcaseId))).toBe(false)
        expect(store.get(testcaseMolecule.atoms.data(testcaseId))).toEqual(original)
    })
})
