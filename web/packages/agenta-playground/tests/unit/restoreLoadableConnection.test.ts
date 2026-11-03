/**
 * Unit tests for playgroundController.actions.restoreLoadableConnection, the step that reconnects
 * a shared playground link's test set. It fetches the test cases first; the playground can be
 * left while that request runs, and the late answer must not connect a test set then.
 */

import {loadableController} from "@agenta/entities/loadable"
import {projectIdAtom} from "@agenta/shared/state"
import {createStore} from "jotai"
import {describe, expect, it, vi} from "vitest"

const page = vi.hoisted(() => ({release: () => undefined as void}))

vi.mock("@agenta/entities/testcase", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/testcase")>()),
    fetchTestcasesPage: () =>
        new Promise((resolve) => {
            page.release = () =>
                resolve({
                    testcases: [{id: "tc-1", country: "Peru"}],
                    nextCursor: null,
                    hasMore: false,
                })
        }),
}))

import {playgroundController} from "../../src/state/controllers/playgroundController"

const REVISION_ID = "rev-1"
const LOADABLE_ID = `testset:workflow:${REVISION_ID}`
const TESTSET_REVISION_ID = "11111111-1111-4111-8111-111111111111"

const restore = (store: ReturnType<typeof createStore>, isCurrent?: () => boolean) => {
    store.set(projectIdAtom, "proj-1")
    store.set(
        playgroundController.actions.addPrimaryNode,
        {type: "workflow", id: REVISION_ID, label: "Prompt"},
        {skipInitialRow: true},
    )
    return store.set(
        playgroundController.actions.restoreLoadableConnection,
        {revisionId: TESTSET_REVISION_ID, sourceName: "Countries v1", testsetId: "ts-1"},
        isCurrent ? {isCurrent} : undefined,
    )
}

describe("restoreLoadableConnection", () => {
    it("connects the test set once its test cases arrive", async () => {
        const store = createStore()
        const done = restore(store)
        page.release()
        await done

        const source = store.get(loadableController.selectors.connectedSource(LOADABLE_ID))
        expect(source.id).toBe(TESTSET_REVISION_ID)
    })

    it("connects nothing when the playground was left before the test cases arrived", async () => {
        const store = createStore()
        const done = restore(store)
        store.set(playgroundController.actions.resetAll)
        page.release()
        await done

        const source = store.get(loadableController.selectors.connectedSource(LOADABLE_ID))
        expect(source.id).toBeNull()
    })

    it("connects nothing when the caller says the restore is no longer wanted", async () => {
        const store = createStore()
        let wanted = true
        const done = restore(store, () => wanted)
        // The same revision opens again: the loadable id is unchanged.
        wanted = false
        page.release()
        await done

        const source = store.get(loadableController.selectors.connectedSource(LOADABLE_ID))
        expect(source.id).toBeNull()
    })
})
