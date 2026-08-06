/**
 * Unit tests for playgroundController.actions.connectToTestsetKeepingLocalRows.
 *
 * The action backs the "Keep and load" choice in the playground's keep-drafts
 * modal: it captures meaningful local rows before connectToSource clears
 * them, connects to the test set, then re-imports the captured rows as
 * unsaved additions so the user can sync them into the test set later.
 *
 * Chat mode is not exercised here: isChatModeAtom derives from the primary
 * node's workflow molecule, which needs the full entity stack. With no nodes
 * it resolves undefined → non-chat, which is the path under test.
 *
 * Each test uses a fresh createStore() for isolation.
 */

import {loadableController} from "@agenta/entities/loadable"
import {testcaseMolecule} from "@agenta/entities/testcase"
import {createStore} from "jotai"
import {describe, it, expect} from "vitest"

import {playgroundController} from "../../src/state/controllers/playgroundController"

const LOADABLE_ID = "testset:workflow:test-entity"
const REVISION_ID = "11111111-1111-4111-8111-111111111111"
const TESTCASE_ID = "22222222-2222-4222-8222-222222222222"

function freshStore() {
    return createStore()
}

function connectPayload() {
    return {
        loadableId: LOADABLE_ID,
        revisionId: REVISION_ID,
        testcases: [{id: TESTCASE_ID, country: "Spain"}],
        testsetName: "Countries",
        testsetId: "ts-1",
        revisionVersion: 1,
    }
}

describe("connectToTestsetKeepingLocalRows", () => {
    it("re-imports meaningful drafts as unsaved additions after connecting", () => {
        const store = freshStore()
        store.set(testcaseMolecule.actions.add, {data: {country: "France"}})
        store.set(testcaseMolecule.actions.add, {data: {country: ""}})

        store.set(playgroundController.actions.connectToTestsetKeepingLocalRows, connectPayload())

        const rowIds = store.get(loadableController.selectors.displayRowIds(LOADABLE_ID))
        expect(rowIds).toHaveLength(2)
        expect(rowIds).toContain(TESTCASE_ID)

        const keptId = rowIds.find((id: string) => id !== TESTCASE_ID) as string
        expect(keptId.startsWith("new-")).toBe(true)
        expect(store.get(testcaseMolecule.data(keptId))?.data).toMatchObject({country: "France"})

        // Connection established + kept row pending sync
        const source = store.get(loadableController.selectors.connectedSource(LOADABLE_ID))
        expect(source?.id).toBe(REVISION_ID)
        expect(store.get(loadableController.selectors.hasLocalChanges(LOADABLE_ID))).toBe(true)
    })

    it("connects without importing when no meaningful drafts exist", () => {
        const store = freshStore()
        store.set(testcaseMolecule.actions.add, {data: {country: ""}})

        store.set(playgroundController.actions.connectToTestsetKeepingLocalRows, connectPayload())

        expect(store.get(loadableController.selectors.displayRowIds(LOADABLE_ID))).toEqual([
            TESTCASE_ID,
        ])
        expect(store.get(loadableController.selectors.hasLocalChanges(LOADABLE_ID))).toBe(false)
    })

    it("plain connectToTestset still replaces drafts (modal's Discard path)", () => {
        const store = freshStore()
        store.set(testcaseMolecule.actions.add, {data: {country: "France"}})

        store.set(playgroundController.actions.connectToTestset, connectPayload())

        expect(store.get(loadableController.selectors.displayRowIds(LOADABLE_ID))).toEqual([
            TESTCASE_ID,
        ])
        expect(store.get(testcaseMolecule.newIds)).toEqual([])
    })
})
