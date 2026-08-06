/**
 * Unit tests for `commitWorkflowRevisionAtom`'s handling of a 409 `revision_conflict` — the
 * playground save guard (Option A). The bug this guards against, reproduced live: a browser tab
 * held a stale draft (loaded before someone else's newer commit) and its save silently
 * overwrote that newer revision. Sending `base_revision_id` (covered separately in
 * `commitWorkflowRevisionBaseRevisionId.test.ts`) makes the backend refuse the commit instead;
 * this test covers what the atom does with that refusal: return a failed outcome with a plain
 * human message and a `code` the UI branches on, and stop — no retry, no draft discard, no
 * "new revision" callback (i.e. nothing commits).
 *
 * Only the network boundary (`commitWorkflowRevisionApi`) is mocked; everything else runs
 * through the real jotai store, seeded via `workflowLocalServerDataAtomFamily` the same way
 * `create-ephemeral-app-from-template.test.ts` seeds local entity data.
 */
import {QueryClient} from "@tanstack/react-query"
import {projectIdAtom} from "@agenta/shared/state"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

const {commitWorkflowRevisionApiMock} = vi.hoisted(() => ({
    commitWorkflowRevisionApiMock: vi.fn(),
}))

vi.mock("../../src/workflow/api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/workflow/api")>()
    return {
        ...actual,
        commitWorkflowRevisionApi: commitWorkflowRevisionApiMock,
    }
})

import {
    commitWorkflowRevisionAtom,
    registerWorkflowCommitCallbacks,
    clearWorkflowCommitCallbacks,
} from "../../src/workflow/state/commit"
import {workflowLocalServerDataAtomFamily} from "../../src/workflow/state/store"

const PROJECT_ID = "proj-1"
const REVISION_ID = "rev-1"

const seedEntity = () => {
    getDefaultStore().set(workflowLocalServerDataAtomFamily(REVISION_ID), {
        id: REVISION_ID,
        workflow_id: "wf-1",
        workflow_variant_id: "var-1",
        name: "default",
        data: {
            uri: "agenta:builtin:agent:v0",
            parameters: {agent: {}},
        },
    } as never)
}

const conflictError = {
    response: {
        status: 409,
        data: {
            detail: {
                code: "revision_conflict",
                message: "The workflow head changed. No revision was committed.",
                retryable: false,
                details: {base_revision_id: REVISION_ID, current_revision_id: "rev-2"},
            },
        },
    },
}

beforeEach(() => {
    const store = getDefaultStore()
    store.set(queryClientAtom, new QueryClient())
    store.set(projectIdAtom, PROJECT_ID)
    commitWorkflowRevisionApiMock.mockReset()
    clearWorkflowCommitCallbacks()
    seedEntity()
})

describe("commitWorkflowRevisionAtom — 409 revision_conflict", () => {
    it("sends the loaded revision id as baseRevisionId", async () => {
        commitWorkflowRevisionApiMock.mockResolvedValueOnce({id: "rev-2"})

        await getDefaultStore().set(commitWorkflowRevisionAtom, {revisionId: REVISION_ID})

        expect(commitWorkflowRevisionApiMock).toHaveBeenCalledWith(
            PROJECT_ID,
            expect.objectContaining({baseRevisionId: REVISION_ID}),
        )
    })

    it("returns a failed outcome with a plain human message and a stable code, and does not commit", async () => {
        commitWorkflowRevisionApiMock.mockRejectedValueOnce(conflictError)
        const onNewRevision = vi.fn()
        registerWorkflowCommitCallbacks({onNewRevision})

        const result = await getDefaultStore().set(commitWorkflowRevisionAtom, {
            revisionId: REVISION_ID,
        })

        expect(result.success).toBe(false)
        if (result.success) throw new Error("expected failure")
        expect(result.error.message).toBe(
            "This agent changed since you opened it. Reload before saving.",
        )
        expect((result.error as {code?: string}).code).toBe("revision_conflict")
        expect((result.error as {conflict?: {currentRevisionId?: string}}).conflict).toEqual({
            baseRevisionId: REVISION_ID,
            currentRevisionId: "rev-2",
            currentRevisionVersion: undefined,
        })
        // No new revision was created, so the entity-switch callback must not fire.
        expect(onNewRevision).not.toHaveBeenCalled()
    })

    it("does not retry the commit after a conflict", async () => {
        commitWorkflowRevisionApiMock.mockRejectedValueOnce(conflictError)

        await getDefaultStore().set(commitWorkflowRevisionAtom, {revisionId: REVISION_ID})

        expect(commitWorkflowRevisionApiMock).toHaveBeenCalledTimes(1)
    })

    it("keeps the server message for a non-conflict failure", async () => {
        commitWorkflowRevisionApiMock.mockRejectedValueOnce({
            response: {status: 500, data: {detail: "Internal error"}},
        })

        const result = await getDefaultStore().set(commitWorkflowRevisionAtom, {
            revisionId: REVISION_ID,
        })

        expect(result.success).toBe(false)
        if (result.success) throw new Error("expected failure")
        expect(result.error.message).toBe("Internal error")
        expect((result.error as {code?: string}).code).toBeUndefined()
    })
})
