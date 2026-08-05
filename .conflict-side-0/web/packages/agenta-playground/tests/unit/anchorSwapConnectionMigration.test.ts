/**
 * Unit tests for the testset-connection migration on anchor swaps.
 *
 * Committing a playground draft replaces the anchor entity id (old revision
 * → new revision), which changes the derived loadable id
 * (`testset:workflow:<revisionId>`). `relinkLoadableSessions` already moved
 * chat history and execution results to the new loadable id (AGE-3785), but
 * left the testset connection behind on the old key. The playground then
 * silently dropped to local mode after every commit: the TestsetDropdown
 * showed unsynced and the connection-gated unused-columns footer vanished.
 *
 * These tests drive the real controller through the same path a commit
 * takes (`setEntityIds` with a positional anchor swap) and assert the
 * connection follows the rename.
 *
 * Each test uses a fresh createStore() and unique entity ids for isolation
 * (the loadable anchor in `derivedLoadableIdAtom` is module-level state).
 */

import {loadableController} from "@agenta/entities/loadable"
import {createStore} from "jotai"
import {describe, expect, it} from "vitest"

import {playgroundController} from "../../src/state/controllers/playgroundController"

const REVISION_ID = "11111111-1111-4111-8111-111111111111"
const TESTCASE_ID = "22222222-2222-4222-8222-222222222222"

function connectPayload(loadableId: string) {
    return {
        loadableId,
        revisionId: REVISION_ID,
        testcases: [{id: TESTCASE_ID, country: "Spain"}],
        testsetName: "Countries",
        testsetId: "ts-1",
        revisionVersion: 1,
    }
}

/** Seed the playground with a connected primary entity. */
function setupConnected(store: ReturnType<typeof createStore>, entityId: string) {
    const loadableId = `testset:workflow:${entityId}`
    // Connect before selecting the entity: with no nodes, isChatModeAtom
    // resolves undefined → non-chat (same approach as the
    // connectToTestsetKeepingLocalRows tests).
    store.set(playgroundController.actions.connectToTestset, connectPayload(loadableId))
    store.set(playgroundController.actions.setEntityIds, [entityId])
    return loadableId
}

describe("anchor swap testset connection migration", () => {
    it("moves the connection to the new loadable id on commit-style swaps", () => {
        const store = createStore()
        const oldLoadableId = setupConnected(store, "rev-a1")

        // Commit-style anchor swap: rev-a1 is replaced in place by rev-a2.
        store.set(playgroundController.actions.setEntityIds, ["rev-a2"])

        const migrated = store.get(
            loadableController.selectors.connectedSource("testset:workflow:rev-a2"),
        )
        expect(migrated?.id).toBe(REVISION_ID)
        expect(migrated?.name).toBe("Countries (v1)")

        const stranded = store.get(loadableController.selectors.connectedSource(oldLoadableId))
        expect(stranded?.id).toBeNull()
    })

    it("keeps testcase rows visible through the swap", () => {
        const store = createStore()
        setupConnected(store, "rev-b1")

        store.set(playgroundController.actions.setEntityIds, ["rev-b2"])

        const rowIds = store.get(
            loadableController.selectors.displayRowIds("testset:workflow:rev-b2"),
        )
        expect(rowIds).toEqual([TESTCASE_ID])
    })

    it("does not invent a connection when the old loadable had none", () => {
        const store = createStore()
        store.set(playgroundController.actions.setEntityIds, ["rev-c1"])

        store.set(playgroundController.actions.setEntityIds, ["rev-c2"])

        const source = store.get(
            loadableController.selectors.connectedSource("testset:workflow:rev-c2"),
        )
        expect(source?.id).toBeNull()
    })
})
