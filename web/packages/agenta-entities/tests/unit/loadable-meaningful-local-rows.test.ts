/**
 * Unit tests for loadableController.selectors.meaningfulLocalRows and the
 * keep-drafts connect sequence (capture → connectToSource → importRows).
 *
 * meaningfulLocalRows backs the playground's "Keep your draft test cases?"
 * modal: it must surface local rows that hold user-entered data, while
 * ignoring the blank row every fresh playground seeds, and it must return []
 * once a loadable is connected (connected loadables use hasLocalChanges).
 *
 * Each test uses a fresh createStore() for isolation.
 */

import {createStore} from "jotai"
import {describe, it, expect} from "vitest"

import {loadableController} from "../../src/loadable/controller"
import {testcaseMolecule} from "../../src/testcase/state/molecule"

const LOADABLE_ID = "testset:workflow:test-entity"
const REVISION_ID = "11111111-1111-4111-8111-111111111111"
const TESTCASE_ID = "22222222-2222-4222-8222-222222222222"

function freshStore() {
    return createStore()
}

function meaningfulRows(store: ReturnType<typeof freshStore>) {
    return store.get(loadableController.selectors.meaningfulLocalRows(LOADABLE_ID))
}

describe("meaningfulLocalRows", () => {
    it("returns [] when no rows exist", () => {
        const store = freshStore()
        expect(meaningfulRows(store)).toEqual([])
    })

    it("ignores the seeded empty row", () => {
        const store = freshStore()
        store.set(testcaseMolecule.actions.add, {data: {country: "", capital: "  "}})
        expect(meaningfulRows(store)).toEqual([])
    })

    it("includes rows with user-entered data", () => {
        const store = freshStore()
        store.set(testcaseMolecule.actions.add, {data: {country: "France"}})
        store.set(testcaseMolecule.actions.add, {data: {country: ""}})

        const rows = meaningfulRows(store)
        expect(rows).toHaveLength(1)
        expect(rows[0].data).toMatchObject({country: "France"})
    })

    it("treats blank chat message shells as empty", () => {
        const store = freshStore()
        store.set(testcaseMolecule.actions.add, {
            data: {messages: [{role: "user", content: ""}]},
        })
        expect(meaningfulRows(store)).toEqual([])

        store.set(testcaseMolecule.actions.add, {
            data: {messages: [{role: "user", content: "hello"}]},
        })
        expect(meaningfulRows(store)).toHaveLength(1)
    })

    it("excludes rows the user removed from the playground (hiddenTestcaseIds)", () => {
        const store = freshStore()
        const kept = store.set(testcaseMolecule.actions.add, {data: {country: "France"}})
        const removed = store.set(testcaseMolecule.actions.add, {data: {country: "Spain"}})

        // Playground row delete hides local rows via the loadable removeRow path
        store.set(loadableController.actions.removeRow, LOADABLE_ID, removed!.id)

        const rows = meaningfulRows(store)
        expect(rows.map((r) => r.id)).toEqual([kept!.id])
    })

    it("returns [] once the loadable is connected", () => {
        const store = freshStore()
        store.set(testcaseMolecule.actions.add, {data: {country: "France"}})

        store.set(loadableController.actions.connectToSource, LOADABLE_ID, REVISION_ID, "TS v1", [
            {id: TESTCASE_ID, data: {country: "Spain"}},
        ])

        expect(meaningfulRows(store)).toEqual([])
    })
})

describe("keep-drafts connect sequence", () => {
    it("connectToSource alone destroys local drafts (the bug being guarded)", () => {
        const store = freshStore()
        store.set(testcaseMolecule.actions.add, {data: {country: "France"}})

        store.set(loadableController.actions.connectToSource, LOADABLE_ID, REVISION_ID, "TS v1", [
            {id: TESTCASE_ID, data: {country: "Spain"}},
        ])

        const rowIds = store.get(loadableController.selectors.displayRowIds(LOADABLE_ID))
        expect(rowIds).toEqual([TESTCASE_ID])
        expect(store.get(testcaseMolecule.newIds)).toEqual([])
        expect(store.get(loadableController.selectors.hasLocalChanges(LOADABLE_ID))).toBe(false)
    })

    it("capture → connect → importRows keeps drafts as unsaved additions", () => {
        const store = freshStore()
        store.set(testcaseMolecule.actions.add, {data: {country: "France"}})
        store.set(testcaseMolecule.actions.add, {data: {country: ""}})

        // Capture BEFORE connecting - connectToSource clears local entities
        const captured = meaningfulRows(store)
        expect(captured).toHaveLength(1)

        store.set(loadableController.actions.connectToSource, LOADABLE_ID, REVISION_ID, "TS v1", [
            {id: TESTCASE_ID, data: {country: "Spain"}},
        ])
        store.set(
            loadableController.actions.importRows,
            LOADABLE_ID,
            captured.map((row) => ({...row.data})),
        )

        const rowIds = store.get(loadableController.selectors.displayRowIds(LOADABLE_ID))
        expect(rowIds).toHaveLength(2)
        expect(rowIds).toContain(TESTCASE_ID)

        const keptId = rowIds.find((id: string) => id !== TESTCASE_ID) as string
        expect(keptId.startsWith("new-")).toBe(true)
        const kept = store.get(testcaseMolecule.data(keptId))
        expect(kept?.data).toMatchObject({country: "France"})

        // The kept row counts as an unsaved change, enabling "Sync changes"
        expect(store.get(loadableController.selectors.hasLocalChanges(LOADABLE_ID))).toBe(true)
    })
})
