/**
 * Unit tests for loadableController.actions.resetRowsForAppSwitch.
 *
 * The testcase row store is a global singleton shared across loadables.
 * When the playground navigates app→app, rows drafted for the previous app
 * must be cleared from the global store; otherwise they appear in the next
 * app's playground (rows are not keyed per loadable or per app). The reset
 * is intentionally thin: it clears only the global row store, leaving the
 * previous loadable's per-id state untouched, and seeds no row itself — the
 * next linkToRunnable does that once the store is empty.
 *
 * Each test uses a fresh createStore() for isolation.
 */

import {createStore} from "jotai"
import {describe, it, expect} from "vitest"

import {loadableController} from "../../src/loadable/controller"
import {testcaseMolecule} from "../../src/testcase/state/molecule"
import {
    currentRevisionIdAtom,
    deletedEntityIdsAtom,
    markDeletedAtom,
    testcaseIdsAtom,
} from "../../src/testcase/state/store"

const OLD_LOADABLE_ID = "testset:workflow:old-entity"
const NEW_LOADABLE_ID = "testset:workflow:new-entity"
const REVISION_ID = "11111111-1111-4111-8111-111111111111"
const SERVER_ROW_ID = "22222222-2222-4222-8222-222222222222"

function freshStore() {
    return createStore()
}

/** Seed the global store as if app A's playground was in active use:
 *  connected to a testset (server row + revision id), one local draft row,
 *  and one server row marked deleted. */
function seedAppAState(store: ReturnType<typeof freshStore>) {
    store.set(loadableController.actions.connectToSource, OLD_LOADABLE_ID, REVISION_ID, "TS v1", [
        {id: SERVER_ROW_ID, data: {country: "Spain"}},
    ])
    store.set(testcaseMolecule.actions.add, {data: {country: "France"}})
    store.set(markDeletedAtom, SERVER_ROW_ID)
}

describe("resetRowsForAppSwitch", () => {
    it("clears local rows, server ids, deleted set, and the current revision id", () => {
        const store = freshStore()
        seedAppAState(store)

        // Sanity: the seeded state is dirty in every dimension the reset targets
        expect(store.get(testcaseMolecule.newIds)).toHaveLength(1)
        expect(store.get(testcaseIdsAtom)).toEqual([SERVER_ROW_ID])
        expect(store.get(deletedEntityIdsAtom).size).toBe(1)
        expect(store.get(currentRevisionIdAtom)).toBe(REVISION_ID)

        store.set(loadableController.actions.resetRowsForAppSwitch)

        expect(store.get(testcaseMolecule.atoms.displayRowIds)).toEqual([])
        expect(store.get(testcaseMolecule.newIds)).toEqual([])
        expect(store.get(testcaseIdsAtom)).toEqual([])
        expect(store.get(deletedEntityIdsAtom).size).toBe(0)
        expect(store.get(currentRevisionIdAtom)).toBeNull()
    })

    it("does not seed a replacement row itself", () => {
        const store = freshStore()
        store.set(testcaseMolecule.actions.add, {data: {country: "France"}})

        store.set(loadableController.actions.resetRowsForAppSwitch)

        expect(store.get(testcaseMolecule.atoms.displayRowIds)).toEqual([])
    })

    it("leaves the previous loadable's connection state untouched (thin scope)", () => {
        const store = freshStore()
        seedAppAState(store)

        store.set(loadableController.actions.resetRowsForAppSwitch)

        const source = store.get(loadableController.selectors.connectedSource(OLD_LOADABLE_ID))
        expect(source?.id).toBe(REVISION_ID)
    })

    it("lets the next app's linkToRunnable seed exactly one fresh empty row", () => {
        const store = freshStore()
        seedAppAState(store)

        store.set(loadableController.actions.resetRowsForAppSwitch)
        store.set(
            loadableController.actions.linkToRunnable,
            NEW_LOADABLE_ID,
            "workflow",
            "new-entity",
        )

        const rowIds = store.get(testcaseMolecule.atoms.displayRowIds)
        expect(rowIds).toHaveLength(1)
        expect(rowIds[0].startsWith("new-")).toBe(true)
        expect(store.get(testcaseMolecule.data(rowIds[0]))?.data).toEqual({})
    })

    it("without the reset, the previous app's rows leak into the next loadable (the bug being guarded)", () => {
        const store = freshStore()
        seedAppAState(store)

        store.set(
            loadableController.actions.linkToRunnable,
            NEW_LOADABLE_ID,
            "workflow",
            "new-entity",
        )

        // linkToRunnable sees a non-empty global store and seeds nothing,
        // so app A's rows remain visible in app B's playground.
        const rowIds = store.get(testcaseMolecule.atoms.displayRowIds)
        expect(rowIds.length).toBeGreaterThan(0)
        expect(rowIds.some((id: string) => id.startsWith("new-"))).toBe(true)
    })
})
